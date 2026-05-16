import React, { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Hammer,
  ChevronDown,
  Send,
  Loader2,
  CheckCircle2,
  Circle,
  FileCode2,
  Eye,
  Download,
  MessageSquare,
  Sparkles,
  AlertCircle,
  ArrowLeft,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Provider = "freemodel" | "xynera";

interface Task {
  id: string;
  title: string;
  description: string;
  files: string[];
}

interface FileSpec {
  path: string;
  description: string;
  taskId: string;
}

interface Plan {
  projectName: string;
  description: string;
  techStack: string[];
  tasks: Task[];
  files: FileSpec[];
}

interface GeneratedFile {
  path: string;
  content: string;
}

type Phase = "idle" | "planning" | "building" | "verifying" | "done" | "error";

const PROVIDERS = [
  { id: "freemodel" as Provider, label: "FreeModel", color: "bg-emerald-500" },
  { id: "xynera"    as Provider, label: "Xynera",    color: "bg-violet-500" },
];

const EXAMPLE_PROMPTS = [
  "أنشئ موقع محفظة أعمال احترافية باللغة العربية مع قسم للمهارات والمشاريع والتواصل",
  "أنشئ تطبيق قائمة مهام متكامل مع إمكانية الإضافة والحذف والتصفية والحفظ المحلي",
  "أنشئ لعبة Snake كاملة بالـ JavaScript مع نقاط وتسريع تدريجي",
  "أنشئ حاسبة علمية جميلة مع تاريخ العمليات",
  "أنشئ صفحة هبوط لتطبيق موبايل مع ميزات وأسعار وشهادات عملاء",
];

export default function BuilderPage() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<Provider>("freemodel");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [verification, setVerification] = useState<{ ok: boolean; notes: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;

  const handleBuild = useCallback(async () => {
    if (!prompt.trim() || phase === "planning" || phase === "building" || phase === "verifying") return;

    setPlan(null);
    setGeneratedFiles([]);
    setActiveFile(null);
    setVerification(null);
    setErrorMsg("");
    setCompletedFiles(new Set());
    setPhase("planning");

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/builder/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) throw new Error("فشل الاتصال بالخادم");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const msg = JSON.parse(raw) as {
              type: string;
              message?: string;
              plan?: Plan;
              path?: string;
              content?: string;
              verification?: { ok: boolean; notes: string };
              files?: GeneratedFile[];
            };

            switch (msg.type) {
              case "status":
                setStatusMsg(msg.message ?? "");
                if (msg.message?.includes("إنشاء")) setPhase("building");
                if (msg.message?.includes("التحقق")) setPhase("verifying");
                break;

              case "plan":
                if (msg.plan) {
                  setPlan(msg.plan);
                  setPhase("building");
                }
                break;

              case "file_start":
                break;

              case "file_done":
                if (msg.path && msg.content !== undefined) {
                  setGeneratedFiles((prev) => {
                    const exists = prev.find((f) => f.path === msg.path);
                    if (exists) return prev.map((f) => f.path === msg.path ? { ...f, content: msg.content! } : f);
                    return [...prev, { path: msg.path!, content: msg.content! }];
                  });
                  setCompletedFiles((prev) => new Set([...prev, msg.path!]));
                  if (!activeFile) setActiveFile(msg.path!);
                }
                break;

              case "done":
                setVerification(msg.verification ?? { ok: true, notes: "تم البناء بنجاح" });
                if (msg.files) setGeneratedFiles(msg.files);
                setPhase("done");
                break;

              case "error":
                setErrorMsg(msg.message ?? "حدث خطأ غير متوقع");
                setPhase("error");
                break;
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg("فشل الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.");
        setPhase("error");
      }
    }
  }, [prompt, provider, activeFile, phase]);

  const handleDownloadFile = (file: GeneratedFile) => {
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    if (generatedFiles.length === 0) return;

    // For simple HTML/CSS/JS projects, download the main HTML
    const htmlFile = generatedFiles.find((f) => f.path.endsWith(".html"));
    if (htmlFile) {
      let combined = htmlFile.content;

      // Inline CSS
      const cssFile = generatedFiles.find((f) => f.path.endsWith(".css"));
      if (cssFile) {
        combined = combined.replace(
          /<link[^>]*stylesheet[^>]*>/i,
          `<style>\n${cssFile.content}\n</style>`
        );
      }

      // Inline JS
      const jsFile = generatedFiles.find((f) => f.path.endsWith(".js"));
      if (jsFile) {
        combined = combined.replace(
          /<script[^>]*src=[^>]*><\/script>/i,
          `<script>\n${jsFile.content}\n</script>`
        );
      }

      const blob = new Blob([combined], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${plan?.projectName ?? "project"}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "تم التحميل", description: "تم دمج الملفات في ملف HTML واحد جاهز للتشغيل" });
    } else {
      generatedFiles.forEach((f) => handleDownloadFile(f));
    }
  };

  const getPreviewSrc = () => {
    const htmlFile = generatedFiles.find((f) => f.path.endsWith(".html"));
    if (!htmlFile) return null;

    let html = htmlFile.content;

    const cssFile = generatedFiles.find((f) => f.path.endsWith(".css"));
    if (cssFile) {
      html = html.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${cssFile.content}\n</style>`);
    }

    const jsFile = generatedFiles.find((f) => f.path.endsWith(".js"));
    if (jsFile) {
      html = html.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${jsFile.content}\n</script>`);
    }

    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  };

  const activeFileContent = generatedFiles.find((f) => f.path === activeFile);
  const isBuilding = phase === "planning" || phase === "building" || phase === "verifying";
  const previewSrc = getPreviewSrc();

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden" dir="rtl">
      {/* Header */}
      <header className="flex-none px-6 py-4 border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-10 w-10 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm">
              <Hammer className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-semibold text-lg leading-tight">وكيل البناء الذكي</h1>
              <p className="text-sm text-muted-foreground leading-tight">صف ما تريد بناءه وسيبنيه الوكيل لك</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2 rounded-xl border-border/60">
                  <span className={`h-2 w-2 rounded-full ${currentProvider.color}`} />
                  <span className="font-medium text-sm">{currentProvider.label}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 rounded-xl p-1">
                {PROVIDERS.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setProvider(p.id)}
                    className="flex items-center gap-2 rounded-lg cursor-pointer"
                  >
                    <span className={`h-2 w-2 rounded-full ${p.color}`} />
                    <span className="font-medium text-sm">{p.label}</span>
                    {provider === p.id && <span className="h-1.5 w-1.5 rounded-full bg-primary mr-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Input + Plan */}
        <div className="w-80 flex-none flex flex-col border-l border-border/50 overflow-hidden">
          {/* Prompt Input */}
          <div className="p-4 border-b border-border/50">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleBuild(); }}
              placeholder="صف المشروع الذي تريد بناءه..."
              className="w-full h-28 resize-none rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
              disabled={isBuilding}
            />

            <Button
              onClick={handleBuild}
              disabled={!prompt.trim() || isBuilding}
              className="w-full mt-2 rounded-xl gap-2"
            >
              {isBuilding ? (
                <><Loader2 className="h-4 w-4 animate-spin" />جارٍ البناء...</>
              ) : (
                <><Sparkles className="h-4 w-4" />ابنِ المشروع</>
              )}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center mt-1.5">Ctrl+Enter للبناء السريع</p>
          </div>

          {/* Examples */}
          {phase === "idle" && (
            <div className="p-4 flex-1 overflow-y-auto">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">أمثلة</p>
              <div className="space-y-1.5">
                {EXAMPLE_PROMPTS.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(ex)}
                    className="w-full text-right text-xs px-3 py-2 rounded-lg border border-border/40 hover:border-primary/30 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all leading-relaxed"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status + Plan */}
          {(isBuilding || plan || phase === "done" || phase === "error") && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Status */}
              {statusMsg && isBuilding && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 rounded-lg px-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-none" />
                  <span>{statusMsg}</span>
                </div>
              )}

              {/* Error */}
              {phase === "error" && (
                <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Verification */}
              {verification && phase === "done" && (
                <div className={cn(
                  "flex items-start gap-2 text-xs rounded-lg px-3 py-2",
                  verification.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                )}>
                  {verification.ok
                    ? <CheckCircle2 className="h-3.5 w-3.5 flex-none mt-0.5" />
                    : <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />}
                  <span>{verification.notes}</span>
                </div>
              )}

              {/* Plan */}
              {plan && (
                <div>
                  <div className="mb-3">
                    <p className="font-semibold text-sm">{plan.projectName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{plan.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {plan.techStack.map((tech) => (
                        <span key={tech} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full">{tech}</span>
                      ))}
                    </div>
                  </div>

                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">المهام</p>
                  <div className="space-y-2">
                    {plan.tasks.map((task) => {
                      const taskFiles = task.files ?? [];
                      const done = taskFiles.every((f) => completedFiles.has(f));
                      const partial = taskFiles.some((f) => completedFiles.has(f));
                      return (
                        <div key={task.id} className="flex items-start gap-2 text-xs">
                          {done
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-none mt-0.5" />
                            : partial
                              ? <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-none mt-0.5" />
                              : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-none mt-0.5" />}
                          <div>
                            <p className={cn("font-medium", done ? "text-foreground" : "text-muted-foreground")}>{task.title}</p>
                            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{task.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">الملفات</p>
                    <div className="space-y-1">
                      {plan.files.map((f) => {
                        const isDone = completedFiles.has(f.path);
                        return (
                          <button
                            key={f.path}
                            onClick={() => { setActiveFile(f.path); if (generatedFiles.find(gf => gf.path === f.path)) setActiveTab("code"); }}
                            disabled={!isDone}
                            className={cn(
                              "w-full text-right flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all",
                              activeFile === f.path ? "bg-primary/15 text-primary" : isDone ? "hover:bg-accent cursor-pointer text-foreground" : "text-muted-foreground/50 cursor-not-allowed"
                            )}
                          >
                            {isDone
                              ? <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-none" />
                              : <Circle className="h-3 w-3 flex-none" />}
                            <FileCode2 className="h-3 w-3 flex-none" />
                            <span className="font-mono">{f.path}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {phase === "done" && generatedFiles.length > 0 && (
                    <Button
                      onClick={handleDownloadAll}
                      variant="outline"
                      size="sm"
                      className="w-full mt-4 rounded-xl gap-2 text-xs"
                    >
                      <Download className="h-3.5 w-3.5" />
                      تحميل المشروع
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: Code + Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {generatedFiles.length === 0 && phase === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Hammer className="h-8 w-8 text-primary/60" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">وكيل البناء الذكي</h2>
              <p className="text-sm leading-relaxed max-w-xs">
                صف المشروع الذي تريد بناءه باللغة العربية أو الإنجليزية، وسيقوم الوكيل بتخطيط المهام وبناء الكود ملفاً بملف مع معاينة حية.
              </p>
            </div>
          )}

          {generatedFiles.length === 0 && isBuilding && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="relative mx-auto h-16 w-16 mb-4">
                  <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <div className="relative h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="h-7 w-7 text-primary animate-pulse" />
                  </div>
                </div>
                <p className="text-sm font-medium">{statusMsg || "جارٍ التحليل والتخطيط..."}</p>
                <p className="text-xs text-muted-foreground mt-1">قد يستغرق هذا بضع ثوانٍ</p>
              </div>
            </div>
          )}

          {generatedFiles.length > 0 && (
            <>
              {/* Tabs */}
              <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/50">
                <div className="flex items-center gap-1 bg-accent/50 rounded-lg p-0.5">
                  <button
                    onClick={() => setActiveTab("code")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "code" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileCode2 className="h-3.5 w-3.5" />الكود
                  </button>
                  <button
                    onClick={() => setActiveTab("preview")}
                    disabled={!previewSrc}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "preview" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      !previewSrc && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    <Eye className="h-3.5 w-3.5" />معاينة حية
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {activeFileContent && activeTab === "code" && (
                    <Button
                      onClick={() => handleDownloadFile(activeFileContent)}
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 rounded-lg"
                    >
                      <Download className="h-3 w-3" />تحميل
                    </Button>
                  )}
                  {phase === "done" && (
                    <Button
                      onClick={handleDownloadAll}
                      size="sm"
                      className="h-7 px-3 text-xs gap-1 rounded-lg"
                    >
                      <Download className="h-3 w-3" />تحميل الكل
                    </Button>
                  )}
                </div>
              </div>

              {/* File tabs strip */}
              {activeTab === "code" && (
                <div className="flex-none flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 overflow-x-auto bg-accent/20">
                  {generatedFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setActiveFile(f.path)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono whitespace-nowrap transition-all flex-none",
                        activeFile === f.path
                          ? "bg-background shadow-sm text-foreground border border-border/50"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                      )}
                    >
                      <FileCode2 className="h-3 w-3" />
                      {f.path}
                    </button>
                  ))}
                </div>
              )}

              {/* Code view */}
              {activeTab === "code" && activeFileContent && (
                <div className="flex-1 overflow-auto bg-[#1e1e2e]">
                  <pre className="p-4 text-xs font-mono text-[#cdd6f4] leading-relaxed whitespace-pre-wrap break-all">
                    <code>{activeFileContent.content}</code>
                  </pre>
                </div>
              )}

              {/* Live preview */}
              {activeTab === "preview" && previewSrc && (
                <div className="flex-1 overflow-hidden bg-white">
                  <iframe
                    src={previewSrc}
                    className="w-full h-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    title="معاينة المشروع"
                  />
                </div>
              )}

              {/* Building indicator overlay */}
              {isBuilding && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-primary text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg z-10">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {statusMsg}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
