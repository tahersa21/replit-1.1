import React, { useState, useRef, useCallback, useEffect } from "react";
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
  Loader2,
  CheckCircle2,
  Circle,
  FileCode2,
  Eye,
  Download,
  Sparkles,
  AlertCircle,
  ArrowLeft,
  BrainCircuit,
  Code2,
  ShieldCheck,
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

interface PhaseModels {
  planModel: string;
  codeModel: string;
  verifyModel: string;
}

type BuildPhase = "idle" | "planning" | "coding" | "verifying" | "done" | "error";

const PHASE_MODELS: Record<Provider, PhaseModels> = {
  freemodel: { planModel: "claude-opus-4-7", codeModel: "gpt-5.5",  verifyModel: "claude-sonnet-4-6" },
  xynera:    { planModel: "claude-opus-4-7", codeModel: "gpt-5.5",  verifyModel: "claude-4-6-sonnet" },
};

const PROVIDERS = [
  { id: "freemodel" as Provider, label: "FreeModel", color: "bg-emerald-500" },
  { id: "xynera"    as Provider, label: "Xynera",    color: "bg-violet-500"  },
];

const EXAMPLE_PROMPTS = [
  "أنشئ موقع محفظة أعمال احترافية باللغة العربية مع قسم للمهارات والمشاريع والتواصل",
  "أنشئ تطبيق قائمة مهام متكامل مع إمكانية الإضافة والحذف والتصفية والحفظ المحلي",
  "أنشئ لعبة Snake كاملة بالـ JavaScript مع نقاط وتسريع تدريجي",
  "أنشئ حاسبة علمية جميلة مع تاريخ العمليات",
  "أنشئ صفحة هبوط لتطبيق موبايل مع ميزات وأسعار وشهادات عملاء",
];

// ── Pipeline step indicator ───────────────────────────────────────────────────
const STEPS = [
  { key: "planning"  as BuildPhase, label: "تخطيط",  Icon: BrainCircuit, modelKey: "planModel"   as keyof PhaseModels },
  { key: "coding"    as BuildPhase, label: "كود",     Icon: Code2,        modelKey: "codeModel"   as keyof PhaseModels },
  { key: "verifying" as BuildPhase, label: "مراجعة",  Icon: ShieldCheck,  modelKey: "verifyModel" as keyof PhaseModels },
];

const PHASE_ORDER: BuildPhase[] = ["idle", "planning", "coding", "verifying", "done", "error"];

function PipelineBar({ phase, phases }: { phase: BuildPhase; phases: PhaseModels }) {
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const stepIdx  = PHASE_ORDER.indexOf(step.key);
        const isDone   = phaseIdx > stepIdx || phase === "done";
        const isActive = phase === step.key;
        const model    = phases[step.modelKey];
        const isClaude = model.includes("claude");
        const { Icon } = step;
        return (
          <React.Fragment key={step.key}>
            {i > 0 && <div className={cn("h-px w-3 flex-none", isDone ? "bg-primary/50" : "bg-border/30")} />}
            <div className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] transition-all whitespace-nowrap",
              isActive ? "bg-primary/10 border-primary/30 text-primary" :
              isDone   ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-700 dark:text-emerald-400" :
                         "bg-muted/30 border-border/20 text-muted-foreground/40"
            )}>
              {isDone    ? <CheckCircle2 className="h-3 w-3 flex-none" /> :
               isActive  ? <Loader2 className="h-3 w-3 flex-none animate-spin" /> :
                           <Icon className="h-3 w-3 flex-none" />}
              <span className="font-medium">{step.label}</span>
              <span className={cn(
                "font-mono text-[9px] px-1 py-0.5 rounded",
                isActive
                  ? isClaude ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : isDone ? "bg-muted text-muted-foreground" : "bg-transparent text-muted-foreground/30"
              )}>{model}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Planning skeleton ─────────────────────────────────────────────────────────
function PlanningSkeleton({ model }: { model: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 select-none" dir="rtl">
      <div className="w-full max-w-lg space-y-5">
        {/* Model badge */}
        <div className="flex items-center gap-2 justify-center mb-2">
          <div className="h-8 w-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
            <BrainCircuit className="h-4 w-4 text-orange-500" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Claude يخطط المشروع</p>
            <p className="text-[10px] text-muted-foreground font-mono">{model}</p>
          </div>
        </div>

        {/* Skeleton lines */}
        {[
          "w-2/3", "w-full", "w-5/6", "w-full", "w-3/4",
          "w-full", "w-4/5", "w-full", "w-2/3",
        ].map((w, i) => (
          <div
            key={i}
            className={cn("h-3 rounded-full bg-muted animate-pulse", w)}
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}

        <p className="text-center text-xs text-muted-foreground pt-2">
          جارٍ تحليل المشروع وتصميم الهيكل...
        </p>
      </div>
    </div>
  );
}

export default function BuilderPage() {
  const [prompt, setPrompt]       = useState("");
  const [provider, setProvider]   = useState<Provider>("freemodel");
  const [phase, setPhase]         = useState<BuildPhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [plan, setPlan]           = useState<Plan | null>(null);
  const [filesMap, setFilesMap]   = useState<Map<string, string>>(new Map());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<"code" | "preview">("code");
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const [verification, setVerification] = useState<{ ok: boolean; notes: string } | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");
  const codeEndRef   = useRef<HTMLDivElement>(null);
  const activeFileRef = useRef<string | null>(null);
  const { toast } = useToast();

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;
  const phases          = PHASE_MODELS[provider];
  const isBuilding      = phase === "planning" || phase === "coding" || phase === "verifying";
  const generatedFiles: GeneratedFile[] = Array.from(filesMap.entries()).map(([path, content]) => ({ path, content }));

  // Auto-scroll code view as content streams in
  useEffect(() => {
    if (isBuilding) codeEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filesMap, isBuilding]);

  const handleBuild = useCallback(async () => {
    if (!prompt.trim() || isBuilding) return;

    setPlan(null);
    setFilesMap(new Map());
    setActiveFile(null);
    activeFileRef.current = null;
    setVerification(null);
    setErrorMsg("");
    setCompletedFiles(new Set());
    setPhase("planning");
    setActiveTab("code");

    try {
      const response = await fetch("/api/builder/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider }),
      });

      if (!response.ok || !response.body) throw new Error("فشل الاتصال بالخادم");

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

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
              type: string; message?: string; phase?: string; model?: string;
              plan?: Plan; path?: string; chunk?: string; content?: string;
              verification?: { ok: boolean; notes: string };
              files?: GeneratedFile[];
            };

            switch (msg.type) {
              case "status":
                setStatusMsg(msg.message ?? "");
                if (msg.phase === "planning")  setPhase("planning");
                if (msg.phase === "coding")    setPhase("coding");
                if (msg.phase === "verifying") setPhase("verifying");
                break;

              case "plan":
                if (msg.plan) { setPlan(msg.plan); setPhase("coding"); }
                break;

              // file_start: switch to this file immediately (shows empty editor)
              case "file_start":
                if (msg.path) {
                  setFilesMap((prev) => { const m = new Map(prev); if (!m.has(msg.path!)) m.set(msg.path!, ""); return m; });
                  if (!activeFileRef.current) {
                    activeFileRef.current = msg.path!;
                    setActiveFile(msg.path!);
                  }
                  // Always follow the currently-generating file
                  activeFileRef.current = msg.path!;
                  setActiveFile(msg.path!);
                }
                break;

              // file_chunk: append token to file content (live typing)
              case "file_chunk":
                if (msg.path && msg.chunk) {
                  setFilesMap((prev) => {
                    const m = new Map(prev);
                    m.set(msg.path!, (m.get(msg.path!) ?? "") + msg.chunk!);
                    return m;
                  });
                }
                break;

              case "file_done":
                if (msg.path) {
                  if (msg.content !== undefined) {
                    setFilesMap((prev) => { const m = new Map(prev); m.set(msg.path!, msg.content!); return m; });
                  }
                  setCompletedFiles((prev) => new Set([...prev, msg.path!]));
                }
                break;

              case "done":
                setVerification(msg.verification ?? { ok: true, notes: "تم البناء بنجاح" });
                if (msg.files) {
                  const m = new Map<string, string>();
                  msg.files.forEach((f) => m.set(f.path, f.content));
                  setFilesMap(m);
                }
                setPhase("done");
                break;

              case "error":
                setErrorMsg(msg.message ?? "حدث خطأ غير متوقع");
                setPhase("error");
                break;
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg("فشل الاتصال بالخادم.");
        setPhase("error");
      }
    }
  }, [prompt, provider, isBuilding]);

  // ── Download helpers ──────────────────────────────────────────────────────
  const handleDownloadFile = (path: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = path; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    const htmlEntry = generatedFiles.find((f) => f.path.endsWith(".html"));
    if (!htmlEntry) { generatedFiles.forEach((f) => handleDownloadFile(f.path, f.content)); return; }

    let html    = htmlEntry.content;
    const css   = generatedFiles.find((f) => f.path.endsWith(".css"));
    const js    = generatedFiles.find((f) => f.path.endsWith(".js"));
    if (css) html = html.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${css.content}\n</style>`);
    if (js)  html = html.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${js.content}\n</script>`);

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${plan?.projectName ?? "project"}.html`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "تم التحميل", description: "ملف HTML واحد يحتوي كل الكود جاهز للتشغيل" });
  };

  const getPreviewSrc = () => {
    const htmlEntry = generatedFiles.find((f) => f.path.endsWith(".html"));
    if (!htmlEntry || !completedFiles.has(htmlEntry.path)) return null;
    let html  = htmlEntry.content;
    const css = generatedFiles.find((f) => f.path.endsWith(".css") && completedFiles.has(f.path));
    const js  = generatedFiles.find((f) => f.path.endsWith(".js")  && completedFiles.has(f.path));
    if (css) html = html.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${css.content}\n</style>`);
    if (js)  html = html.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${js.content}\n</script>`);
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  };

  const activeContent = activeFile ? (filesMap.get(activeFile) ?? "") : "";
  const previewSrc    = getPreviewSrc();

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden" dir="rtl">
      {/* ── Header ── */}
      <header className="flex-none px-4 py-3 border-b border-border/50 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="icon" className="rounded-xl h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-9 w-9 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm flex-none">
              <Hammer className="h-4 w-4" />
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">وكيل البناء الذكي</h1>
              <p className="text-[11px] text-muted-foreground">3 نماذج تتعاون لبناء مشروعك</p>
            </div>
          </div>

          <PipelineBar phase={phase} phases={phases} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-2 rounded-xl border-border/60 flex-none">
                <span className={`h-2 w-2 rounded-full ${currentProvider.color}`} />
                <span className="font-medium text-sm">{currentProvider.label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 rounded-xl p-1">
              {PROVIDERS.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => setProvider(p.id)}
                  className="flex items-center gap-2 rounded-lg cursor-pointer">
                  <span className={`h-2 w-2 rounded-full ${p.color}`} />
                  <span className="font-medium text-sm">{p.label}</span>
                  {provider === p.id && <span className="h-1.5 w-1.5 rounded-full bg-primary mr-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* ── Left Panel ── */}
        <div className="w-72 flex-none flex flex-col border-l border-border/50 overflow-hidden">

          {/* Model assignment */}
          <div className="p-3 border-b border-border/30 bg-muted/20">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">النماذج المستخدمة</p>
            {STEPS.map(({ key: stepKey, label, Icon, modelKey }) => {
              const model    = phases[modelKey];
              const isClaude = model.includes("claude");
              const idx      = PHASE_ORDER.indexOf(phase);
              const sIdx     = PHASE_ORDER.indexOf(stepKey);
              const isDone   = idx > sIdx || phase === "done";
              const isActive = phase === stepKey;
              return (
                <div key={stepKey} className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs mb-1 transition-all",
                  isActive ? "bg-primary/8 border-primary/25" : isDone ? "bg-emerald-500/8 border-emerald-400/20" : "bg-transparent border-border/15"
                )}>
                  <div className={cn(
                    "h-5 w-5 rounded-md flex items-center justify-center flex-none",
                    isActive ? "bg-primary/15 text-primary" : isDone ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground/40"
                  )}>
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  </div>
                  <span className={cn("font-medium flex-none w-12", isActive || isDone ? "text-foreground/90" : "text-muted-foreground/50")}>{label}</span>
                  <span className={cn(
                    "text-[10px] font-mono truncate",
                    isActive ? isClaude ? "text-orange-600 dark:text-orange-400 font-semibold" : "text-emerald-700 dark:text-emerald-400 font-semibold"
                             : isDone  ? "text-muted-foreground" : "text-muted-foreground/35"
                  )}>{model}</span>
                </div>
              );
            })}
          </div>

          {/* Prompt + build button */}
          <div className="p-3 border-b border-border/30">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) void handleBuild(); }}
              placeholder="صف المشروع الذي تريد بناءه..."
              disabled={isBuilding}
              className="w-full h-24 resize-none rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all" />
            <Button onClick={() => void handleBuild()} disabled={!prompt.trim() || isBuilding}
              className="w-full mt-2 rounded-xl gap-2">
              {isBuilding ? <><Loader2 className="h-4 w-4 animate-spin" />جارٍ البناء...</> : <><Sparkles className="h-4 w-4" />ابنِ المشروع</>}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-1">Ctrl+Enter للبناء السريع</p>
          </div>

          {/* Status / plan / examples */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {statusMsg && isBuilding && (
              <div className="flex items-center gap-2 text-xs bg-primary/5 rounded-lg px-3 py-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-none" />
                {statusMsg}
              </div>
            )}

            {phase === "error" && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />{errorMsg}
              </div>
            )}

            {verification && phase === "done" && (
              <div className={cn(
                "flex items-start gap-2 text-xs rounded-lg px-3 py-2",
                verification.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}>
                {verification.ok ? <CheckCircle2 className="h-3.5 w-3.5 flex-none mt-0.5" /> : <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />}
                {verification.notes}
              </div>
            )}

            {plan ? (
              <div>
                <p className="font-semibold text-sm">{plan.projectName}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{plan.description}</p>
                <div className="flex flex-wrap gap-1 mt-1.5 mb-3">
                  {plan.techStack.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full">{t}</span>)}
                </div>

                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">المهام</p>
                <div className="space-y-1.5 mb-3">
                  {plan.tasks.map((task) => {
                    const tf      = task.files ?? [];
                    const done    = tf.every((f) => completedFiles.has(f));
                    const partial = !done && tf.some((f) => completedFiles.has(f));
                    const active  = !done && !partial && tf.some((f) => f === activeFile);
                    return (
                      <div key={task.id} className="flex items-start gap-2 text-xs">
                        {done    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-none mt-0.5" />
                        : active || partial ? <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-none mt-0.5" />
                        :                    <Circle className="h-3.5 w-3.5 text-muted-foreground/30 flex-none mt-0.5" />}
                        <div>
                          <p className={cn("font-medium", done ? "text-foreground" : "text-muted-foreground")}>{task.title}</p>
                          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{task.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">الملفات</p>
                <div className="space-y-0.5">
                  {plan.files.map((f) => {
                    const isDone    = completedFiles.has(f.path);
                    const isCurrent = activeFile === f.path && !isDone && isBuilding;
                    return (
                      <button key={f.path}
                        onClick={() => { setActiveFile(f.path); setActiveTab("code"); }}
                        className={cn(
                          "w-full text-right flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-all",
                          activeFile === f.path ? "bg-primary/15 text-primary" :
                          isDone               ? "hover:bg-accent cursor-pointer text-foreground" :
                          isCurrent            ? "bg-primary/8 text-primary" :
                                                 "text-muted-foreground/50"
                        )}>
                        {isDone    ? <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-none" />
                        : isCurrent ? <Loader2 className="h-3 w-3 animate-spin text-primary flex-none" />
                        :            <Circle className="h-3 w-3 flex-none opacity-40" />}
                        <FileCode2 className="h-3 w-3 flex-none" />
                        <span className="font-mono">{f.path}</span>
                        {isCurrent && <span className="mr-auto text-[9px] opacity-60">يكتب...</span>}
                      </button>
                    );
                  })}
                </div>

                {phase === "done" && generatedFiles.length > 0 && (
                  <Button onClick={handleDownloadAll} variant="outline" size="sm"
                    className="w-full mt-3 rounded-xl gap-2 text-xs">
                    <Download className="h-3.5 w-3.5" />تحميل المشروع
                  </Button>
                )}
              </div>
            ) : phase === "idle" || phase === "error" ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">أمثلة</p>
                <div className="space-y-1.5">
                  {EXAMPLE_PROMPTS.map((ex, i) => (
                    <button key={i} onClick={() => setPrompt(ex)}
                      className="w-full text-right text-xs px-3 py-2 rounded-lg border border-border/40 hover:border-primary/30 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all leading-relaxed">
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">

          {/* Idle screen */}
          {filesMap.size === 0 && phase === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Hammer className="h-8 w-8 text-primary/60" />
              </div>
              <h2 className="text-lg font-semibold mb-2">وكيل البناء الذكي</h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mb-6">
                صف مشروعك وسيتولى الوكيل التخطيط والبناء والمراجعة تلقائياً.
              </p>
              <div className="flex items-center gap-3 text-xs">
                {[
                  { Icon: BrainCircuit, label: "Claude يخطط",    color: "text-orange-500 bg-orange-500/10" },
                  { Icon: Code2,        label: "GPT يكتب الكود", color: "text-emerald-600 bg-emerald-500/10" },
                  { Icon: ShieldCheck,  label: "Claude يراجع",   color: "text-orange-500 bg-orange-500/10" },
                ].map(({ Icon, label, color }, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground/30 text-base">→</span>}
                    <div className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg", color.split(" ")[1])}>
                      <Icon className={cn("h-3.5 w-3.5", color.split(" ")[0])} />
                      <span className="font-medium text-foreground/70">{label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Planning skeleton — something to watch while Claude thinks */}
          {filesMap.size === 0 && phase === "planning" && (
            <PlanningSkeleton model={phases.planModel} />
          )}

          {/* Error (no files) */}
          {filesMap.size === 0 && phase === "error" && (
            <div className="flex-1 flex items-center justify-center text-destructive/70 text-sm gap-2">
              <AlertCircle className="h-5 w-5" /> {errorMsg}
            </div>
          )}

          {/* Code + preview area */}
          {filesMap.size > 0 && (
            <>
              {/* Tab bar */}
              <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/50">
                <div className="flex items-center gap-1 bg-accent/50 rounded-lg p-0.5">
                  <button onClick={() => setActiveTab("code")}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "code" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    <FileCode2 className="h-3.5 w-3.5" />الكود
                    {isBuilding && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                  </button>
                  <button onClick={() => setActiveTab("preview")} disabled={!previewSrc}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "preview" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      !previewSrc && "opacity-40 cursor-not-allowed")}>
                    <Eye className="h-3.5 w-3.5" />معاينة
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {activeFile && activeTab === "code" && (
                    <Button onClick={() => handleDownloadFile(activeFile, activeContent)} variant="ghost" size="sm"
                      className="h-7 px-2 text-xs gap-1 rounded-lg">
                      <Download className="h-3 w-3" />تحميل
                    </Button>
                  )}
                  {phase === "done" && (
                    <Button onClick={handleDownloadAll} size="sm" className="h-7 px-3 text-xs gap-1 rounded-lg">
                      <Download className="h-3 w-3" />تحميل الكل
                    </Button>
                  )}
                </div>
              </div>

              {/* File tab strip */}
              {activeTab === "code" && (
                <div className="flex-none flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 overflow-x-auto bg-accent/20">
                  {Array.from(filesMap.keys()).map((path) => {
                    const isDone    = completedFiles.has(path);
                    const isCurrent = activeFile === path && !isDone && isBuilding;
                    return (
                      <button key={path} onClick={() => setActiveFile(path)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono whitespace-nowrap transition-all flex-none",
                          activeFile === path
                            ? "bg-background shadow-sm text-foreground border border-border/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                        )}>
                        <FileCode2 className="h-3 w-3" />
                        {path}
                        {isCurrent && <Loader2 className="h-2.5 w-2.5 animate-spin opacity-70" />}
                        {isDone && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 opacity-70" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Code editor — live streaming */}
              {activeTab === "code" && (
                <div className="flex-1 overflow-auto bg-[#1e1e2e]">
                  <pre className="p-4 text-xs font-mono text-[#cdd6f4] leading-relaxed whitespace-pre-wrap break-all">
                    <code>{activeContent}</code>
                    {/* Blinking cursor while this file is being written */}
                    {activeFile && !completedFiles.has(activeFile) && isBuilding && (
                      <span className="inline-block w-[2px] h-3.5 bg-primary ml-0.5 align-middle animate-pulse" />
                    )}
                  </pre>
                  <div ref={codeEndRef} />
                </div>
              )}

              {/* Live preview */}
              {activeTab === "preview" && previewSrc && (
                <div className="flex-1 overflow-hidden bg-white">
                  <iframe src={previewSrc} className="w-full h-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    title="معاينة المشروع" />
                </div>
              )}

              {/* Floating status pill */}
              {isBuilding && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-primary/90 text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg z-10 backdrop-blur-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{statusMsg}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
