import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Hammer, ChevronDown, Loader2, CheckCircle2, Circle,
  FileCode2, Eye, Download, Sparkles, AlertCircle, ArrowLeft,
  BrainCircuit, Code2, ShieldCheck, Send, Wand2, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Provider = "freemodel" | "xynera";

interface Task { id: string; title: string; description: string; files: string[] }
interface FileSpec { path: string; description: string; taskId: string }
interface Plan {
  projectName: string; description: string; techStack: string[];
  tasks: Task[]; files: FileSpec[];
}
interface PhaseModels { planModel: string; codeModel: string; verifyModel: string }
type BuildPhase = "idle" | "planning" | "coding" | "verifying" | "done" | "error";

const PHASE_MODELS: Record<Provider, PhaseModels> = {
  freemodel: { planModel: "gpt-4.1",       codeModel: "gpt-5.5", verifyModel: "gpt-4.1" },
  xynera:    { planModel: "gpt-4.1",       codeModel: "gpt-5.5", verifyModel: "gpt-4.1" },
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

const STEPS = [
  { key: "planning"  as BuildPhase, label: "تخطيط",  Icon: BrainCircuit, modelKey: "planModel"   as keyof PhaseModels },
  { key: "coding"    as BuildPhase, label: "كود",     Icon: Code2,        modelKey: "codeModel"   as keyof PhaseModels },
  { key: "verifying" as BuildPhase, label: "مراجعة",  Icon: ShieldCheck,  modelKey: "verifyModel" as keyof PhaseModels },
];
const PHASE_ORDER: BuildPhase[] = ["idle", "planning", "coding", "verifying", "done", "error"];

function getFileLanguage(path: string): string {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css"))  return "css";
  if (path.endsWith(".js"))   return "javascript";
  if (path.endsWith(".ts"))   return "typescript";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}

// ── Pipeline bar ──────────────────────────────────────────────────────────────
function PipelineBar({ phase, phases }: { phase: BuildPhase; phases: PhaseModels }) {
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const stepIdx  = PHASE_ORDER.indexOf(step.key);
        const isDone   = phaseIdx > stepIdx || phase === "done";
        const isActive = phase === step.key;
        const model    = phases[step.modelKey];
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
              <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-muted/50">{model}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Planning skeleton ──────────────────────────────────────────────────────────
function PlanningSkeleton({ model }: { model: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 select-none" dir="rtl">
      <div className="w-full max-w-lg space-y-4">
        <div className="flex items-center gap-2 justify-center mb-4">
          <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <BrainCircuit className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold">يخطط المشروع...</p>
            <p className="text-[10px] text-muted-foreground font-mono">{model}</p>
          </div>
        </div>
        {["w-2/3","w-full","w-5/6","w-full","w-3/4","w-full","w-4/5","w-full","w-2/3"].map((w, i) => (
          <div key={i} className={cn("h-3 rounded-full bg-muted animate-pulse", w)}
            style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    </div>
  );
}

export default function BuilderPage() {
  const [prompt, setPrompt]         = useState("");
  const [provider, setProvider]     = useState<Provider>("freemodel");
  const [phase, setPhase]           = useState<BuildPhase>("idle");
  const [statusMsg, setStatusMsg]   = useState("");
  const [plan, setPlan]             = useState<Plan | null>(null);
  const [filesMap, setFilesMap]     = useState<Map<string, string>>(new Map());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<"code" | "preview">("code");
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const [verification, setVerification] = useState<{ ok: boolean; notes: string } | null>(null);
  const [errorMsg, setErrorMsg]     = useState("");

  // Improve state
  const [improveInput, setImproveInput]   = useState("");
  const [isImproving, setIsImproving]     = useState(false);
  const [improveHistory, setImproveHistory] = useState<{ role: "user" | "ai"; text: string; file?: string }[]>([]);

  const activeFileRef = useRef<string | null>(null);
  const { toast } = useToast();

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;
  const phases          = PHASE_MODELS[provider];
  const isBuilding      = phase === "planning" || phase === "coding" || phase === "verifying";
  const generatedFiles  = Array.from(filesMap.entries()).map(([p, c]) => ({ path: p, content: c }));
  const activeContent   = activeFile ? (filesMap.get(activeFile) ?? "") : "";

  // ── Build ──────────────────────────────────────────────────────────────────
  const handleBuild = useCallback(async () => {
    if (!prompt.trim() || isBuilding) return;
    setPlan(null); setFilesMap(new Map()); setActiveFile(null);
    activeFileRef.current = null; setVerification(null);
    setErrorMsg(""); setCompletedFiles(new Set());
    setPhase("planning"); setActiveTab("code");
    setImproveHistory([]);

    try {
      const response = await fetch("/api/builder/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider }),
      });
      if (!response.ok || !response.body) throw new Error("فشل الاتصال بالخادم");

      const reader = response.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim(); if (!raw) continue;
          try {
            const msg = JSON.parse(raw) as {
              type: string; message?: string; phase?: string;
              plan?: Plan; path?: string; chunk?: string; content?: string;
              verification?: { ok: boolean; notes: string }; files?: { path: string; content: string }[];
            };
            switch (msg.type) {
              case "status":
                setStatusMsg(msg.message ?? "");
                if (msg.phase === "planning")  setPhase("planning");
                if (msg.phase === "coding")    setPhase("coding");
                if (msg.phase === "verifying") setPhase("verifying");
                break;
              case "plan": if (msg.plan) { setPlan(msg.plan); setPhase("coding"); } break;
              case "file_start":
                if (msg.path) {
                  setFilesMap((prev) => { const m = new Map(prev); if (!m.has(msg.path!)) m.set(msg.path!, ""); return m; });
                  activeFileRef.current = msg.path!; setActiveFile(msg.path!);
                } break;
              case "file_chunk":
                if (msg.path && msg.chunk) {
                  setFilesMap((prev) => { const m = new Map(prev); m.set(msg.path!, (m.get(msg.path!) ?? "") + msg.chunk!); return m; });
                } break;
              case "file_done":
                if (msg.path) {
                  if (msg.content !== undefined) setFilesMap((prev) => { const m = new Map(prev); m.set(msg.path!, msg.content!); return m; });
                  setCompletedFiles((prev) => new Set([...prev, msg.path!]));
                } break;
              case "done":
                setVerification(msg.verification ?? { ok: true, notes: "تم البناء بنجاح" });
                if (msg.files) { const m = new Map<string,string>(); msg.files.forEach((f) => m.set(f.path, f.content)); setFilesMap(m); }
                setPhase("done"); break;
              case "error": setErrorMsg(msg.message ?? "حدث خطأ"); setPhase("error"); break;
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setErrorMsg("فشل الاتصال بالخادم."); setPhase("error"); }
    }
  }, [prompt, provider, isBuilding]);

  // ── Improve ────────────────────────────────────────────────────────────────
  const handleImprove = useCallback(async () => {
    if (!improveInput.trim() || !activeFile || isImproving || isBuilding) return;
    const instruction = improveInput.trim();
    const fileContent = filesMap.get(activeFile) ?? "";
    setImproveInput("");
    setIsImproving(true);
    setImproveHistory((h) => [...h, { role: "user", text: instruction, file: activeFile }]);

    try {
      const response = await fetch("/api/builder/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: activeFile, content: fileContent, instruction, provider,
          allFiles: generatedFiles,
        }),
      });
      if (!response.ok || !response.body) throw new Error("فشل الاتصال");

      const reader = response.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // Start replacing the file content live
      setFilesMap((prev) => { const m = new Map(prev); m.set(activeFile, ""); return m; });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim(); if (!raw) continue;
          try {
            const msg = JSON.parse(raw) as { type: string; chunk?: string; content?: string; path?: string; message?: string };
            if (msg.type === "improve_chunk" && msg.chunk) {
              setFilesMap((prev) => { const m = new Map(prev); m.set(activeFile, (m.get(activeFile) ?? "") + msg.chunk!); return m; });
            } else if (msg.type === "improve_done" && msg.content !== undefined) {
              setFilesMap((prev) => { const m = new Map(prev); m.set(activeFile, msg.content!); return m; });
              setImproveHistory((h) => [...h, { role: "ai", text: `تم تحسين ${activeFile} بنجاح ✓`, file: activeFile }]);
            } else if (msg.type === "error") {
              setImproveHistory((h) => [...h, { role: "ai", text: `خطأ: ${msg.message}`, file: activeFile }]);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setImproveHistory((h) => [...h, { role: "ai", text: `فشل: ${(err as Error).message}`, file: activeFile }]);
    } finally {
      setIsImproving(false);
    }
  }, [improveInput, activeFile, filesMap, generatedFiles, provider, isImproving, isBuilding]);

  // ── Download ───────────────────────────────────────────────────────────────
  const downloadFile = (path: string, content: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    a.download = path; a.click();
  };
  const downloadAll = () => {
    const html = generatedFiles.find((f) => f.path.endsWith(".html"));
    if (!html) { generatedFiles.forEach((f) => downloadFile(f.path, f.content)); return; }
    let h = html.content;
    const css = generatedFiles.find((f) => f.path.endsWith(".css"));
    const js  = generatedFiles.find((f) => f.path.endsWith(".js"));
    if (css) h = h.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${css.content}\n</style>`);
    if (js)  h = h.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${js.content}\n</script>`);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([h], { type: "text/html" }));
    a.download = `${plan?.projectName ?? "project"}.html`; a.click();
    toast({ title: "تم التحميل", description: "ملف HTML واحد جاهز للتشغيل" });
  };

  const getPreviewSrc = () => {
    const html = generatedFiles.find((f) => f.path.endsWith(".html") && completedFiles.has(f.path));
    if (!html) return null;
    let h = html.content;
    const css = generatedFiles.find((f) => f.path.endsWith(".css") && completedFiles.has(f.path));
    const js  = generatedFiles.find((f) => f.path.endsWith(".js")  && completedFiles.has(f.path));
    if (css) h = h.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${css.content}\n</style>`);
    if (js)  h = h.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${js.content}\n</script>`);
    return `data:text/html;charset=utf-8,${encodeURIComponent(h)}`;
  };

  const previewSrc = getPreviewSrc();
  const hasFiles   = filesMap.size > 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden" dir="rtl">
      {/* Header */}
      <header className="flex-none px-4 py-3 border-b border-border/50 bg-background/80 backdrop-blur-md z-10">
        <div className="max-w-full flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-none">
            <Link href="/"><Button variant="ghost" size="icon" className="rounded-xl h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div className="h-9 w-9 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm flex-none">
              <Hammer className="h-4 w-4" />
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">وكيل البناء الذكي</h1>
              <p className="text-[11px] text-muted-foreground">بناء · تحرير · تحسين بالذكاء الاصطناعي</p>
            </div>
          </div>
          <PipelineBar phase={phase} phases={phases} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-2 rounded-xl flex-none">
                <span className={`h-2 w-2 rounded-full ${currentProvider.color}`} />
                <span className="font-medium text-sm">{currentProvider.label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 rounded-xl p-1">
              {PROVIDERS.map((p) => (
                <DropdownMenuItem key={p.id} onClick={() => setProvider(p.id)} className="flex items-center gap-2 rounded-lg cursor-pointer">
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
        {/* Left panel */}
        <div className="w-64 flex-none flex flex-col border-l border-border/50 overflow-hidden bg-background">
          {/* Models */}
          <div className="p-3 border-b border-border/30 bg-muted/10">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">النماذج</p>
            {STEPS.map(({ key: sk, label, Icon, modelKey }) => {
              const model = phases[modelKey];
              const idx = PHASE_ORDER.indexOf(phase); const si = PHASE_ORDER.indexOf(sk);
              const isDone = idx > si || phase === "done"; const isActive = phase === sk;
              return (
                <div key={sk} className={cn("flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs mb-1 transition-all",
                  isActive ? "bg-primary/8 border-primary/25" : isDone ? "bg-emerald-500/8 border-emerald-400/20" : "bg-transparent border-border/15")}>
                  <div className={cn("h-5 w-5 rounded-md flex items-center justify-center flex-none",
                    isActive ? "bg-primary/15 text-primary" : isDone ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground/40")}>
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  </div>
                  <span className={cn("font-medium flex-none w-10", isActive || isDone ? "text-foreground/90" : "text-muted-foreground/40")}>{label}</span>
                  <span className={cn("text-[10px] font-mono truncate", isActive ? "text-primary font-semibold" : isDone ? "text-muted-foreground" : "text-muted-foreground/30")}>{model}</span>
                </div>
              );
            })}
          </div>

          {/* Prompt */}
          <div className="p-3 border-b border-border/30">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) void handleBuild(); }}
              placeholder="صف المشروع..." disabled={isBuilding}
              className="w-full h-20 resize-none rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all" />
            <Button onClick={() => void handleBuild()} disabled={!prompt.trim() || isBuilding} className="w-full mt-2 rounded-xl gap-2">
              {isBuilding ? <><Loader2 className="h-4 w-4 animate-spin" />جارٍ البناء...</> : <><Sparkles className="h-4 w-4" />ابنِ المشروع</>}
            </Button>
          </div>

          {/* Status / plan */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {statusMsg && isBuilding && (
              <div className="flex items-center gap-2 text-xs bg-primary/5 rounded-lg px-3 py-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-none" />{statusMsg}
              </div>
            )}
            {phase === "error" && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />{errorMsg}
              </div>
            )}
            {verification && phase === "done" && (
              <div className={cn("flex items-start gap-2 text-xs rounded-lg px-3 py-2",
                verification.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                {verification.ok ? <CheckCircle2 className="h-3.5 w-3.5 flex-none mt-0.5" /> : <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />}
                {verification.notes}
              </div>
            )}
            {plan ? (
              <>
                <div>
                  <p className="font-semibold text-sm">{plan.projectName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{plan.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {plan.techStack.map((t) => <span key={t} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full">{t}</span>)}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">الملفات</p>
                  <div className="space-y-0.5">
                    {plan.files.map((f) => {
                      const isDone    = completedFiles.has(f.path);
                      const isCurrent = activeFile === f.path && !isDone && isBuilding;
                      return (
                        <button key={f.path} onClick={() => { setActiveFile(f.path); setActiveTab("code"); }}
                          className={cn("w-full text-right flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-all",
                            activeFile === f.path ? "bg-primary/15 text-primary" :
                            isDone               ? "hover:bg-accent text-foreground" :
                            isCurrent            ? "bg-primary/8 text-primary" : "text-muted-foreground/50")}>
                          {isDone ? <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-none" />
                            : isCurrent ? <Loader2 className="h-3 w-3 animate-spin text-primary flex-none" />
                            : <Circle className="h-3 w-3 flex-none opacity-40" />}
                          <FileCode2 className="h-3 w-3 flex-none" />
                          <span className="font-mono truncate">{f.path}</span>
                          {isCurrent && <span className="mr-auto text-[9px] opacity-60">يكتب...</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {phase === "done" && <Button onClick={downloadAll} variant="outline" size="sm" className="w-full rounded-xl gap-2 text-xs">
                  <Download className="h-3.5 w-3.5" />تحميل المشروع
                </Button>}
              </>
            ) : (phase === "idle" || phase === "error") ? (
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

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Idle */}
          {!hasFiles && phase === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Hammer className="h-8 w-8 text-primary/60" />
              </div>
              <h2 className="text-lg font-semibold mb-2">وكيل البناء الذكي</h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mb-6">
                صف مشروعك وسيتولى الوكيل التخطيط والبناء والمراجعة — ثم عدّل الكود مباشرة أو اطلب تحسينات بالعربية.
              </p>
              <div className="flex items-center gap-2 text-xs">
                {[
                  { Icon: BrainCircuit, label: "يخطط",  color: "text-primary bg-primary/10" },
                  { Icon: Code2,        label: "يبني",  color: "text-emerald-600 bg-emerald-500/10" },
                  { Icon: ShieldCheck,  label: "يراجع", color: "text-orange-600 bg-orange-500/10" },
                  { Icon: Wand2,        label: "تحسين", color: "text-violet-600 bg-violet-500/10" },
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

          {/* Planning skeleton */}
          {!hasFiles && phase === "planning" && <PlanningSkeleton model={phases.planModel} />}

          {/* Error no files */}
          {!hasFiles && phase === "error" && (
            <div className="flex-1 flex items-center justify-center text-destructive/70 text-sm gap-2">
              <AlertCircle className="h-5 w-5" />{errorMsg}
            </div>
          )}

          {/* Editor area */}
          {hasFiles && (
            <>
              {/* Tab bar */}
              <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/50">
                <div className="flex items-center gap-1 bg-accent/50 rounded-lg p-0.5">
                  <button onClick={() => setActiveTab("code")}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "code" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    <FileCode2 className="h-3.5 w-3.5" />المحرر
                    {isBuilding && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />}
                    {isImproving && <Loader2 className="h-3 w-3 animate-spin text-violet-500" />}
                  </button>
                  <button onClick={() => setActiveTab("preview")} disabled={!previewSrc}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "preview" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      !previewSrc && "opacity-40 cursor-not-allowed")}>
                    <Eye className="h-3.5 w-3.5" />معاينة
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {activeFile && (
                    <Button onClick={() => downloadFile(activeFile, activeContent)} variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 rounded-lg">
                      <Download className="h-3 w-3" />تحميل
                    </Button>
                  )}
                  {(phase === "done" || improveHistory.length > 0) && (
                    <Button onClick={downloadAll} size="sm" className="h-7 px-3 text-xs gap-1 rounded-lg">
                      <Download className="h-3 w-3" />تحميل الكل
                    </Button>
                  )}
                </div>
              </div>

              {/* File tabs */}
              {activeTab === "code" && (
                <div className="flex-none flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 overflow-x-auto bg-[#1e1e2e]/50">
                  {Array.from(filesMap.keys()).map((path) => {
                    const isDone = completedFiles.has(path);
                    const isCurrent = activeFile === path && !isDone && isBuilding;
                    const isImpr = isImproving && activeFile === path;
                    return (
                      <button key={path} onClick={() => setActiveFile(path)}
                        className={cn("flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono whitespace-nowrap transition-all flex-none",
                          activeFile === path ? "bg-background shadow-sm text-foreground border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-accent/60")}>
                        <FileCode2 className="h-3 w-3" />
                        {path}
                        {isCurrent && <Loader2 className="h-2.5 w-2.5 animate-spin opacity-70" />}
                        {isImpr && <Wand2 className="h-2.5 w-2.5 animate-pulse text-violet-400" />}
                        {isDone && !isCurrent && !isImpr && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 opacity-70" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Monaco Editor */}
              {activeTab === "code" && (
                <div className="flex-1 overflow-hidden relative">
                  {activeFile ? (
                    <Editor
                      height="100%"
                      language={getFileLanguage(activeFile)}
                      value={activeContent}
                      theme="vs-dark"
                      onChange={(val) => {
                        if (val !== undefined && !isBuilding) {
                          setFilesMap((prev) => { const m = new Map(prev); m.set(activeFile, val); return m; });
                        }
                      }}
                      options={{
                        fontSize: 13,
                        fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        lineNumbers: "on",
                        readOnly: isBuilding,
                        renderLineHighlight: "all",
                        smoothScrolling: true,
                        cursorBlinking: "smooth",
                        padding: { top: 12, bottom: 12 },
                        fontLigatures: true,
                      }}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                      اختر ملفاً من التبويبات
                    </div>
                  )}
                  {isBuilding && (
                    <div className="absolute inset-0 bg-background/10 pointer-events-none" />
                  )}
                </div>
              )}

              {/* Preview */}
              {activeTab === "preview" && previewSrc && (
                <div className="flex-1 overflow-hidden bg-white">
                  <iframe src={previewSrc} className="w-full h-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-forms" title="معاينة المشروع" />
                </div>
              )}

              {/* ── Improve chat bar (only when not building) ── */}
              {activeTab === "code" && !isBuilding && activeFile && (
                <div className="flex-none border-t border-border/50 bg-background">
                  {/* History */}
                  {improveHistory.length > 0 && (
                    <div className="max-h-32 overflow-y-auto px-4 py-2 space-y-1.5 border-b border-border/30 bg-muted/20">
                      {improveHistory.map((h, i) => (
                        <div key={i} className={cn("flex items-start gap-2 text-xs",
                          h.role === "user" ? "justify-end" : "justify-start")}>
                          <div className={cn("max-w-[80%] px-3 py-1.5 rounded-xl",
                            h.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : h.text.startsWith("خطأ") || h.text.startsWith("فشل")
                                ? "bg-destructive/15 text-destructive rounded-bl-sm"
                                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-bl-sm")}>
                            {h.file && h.role === "user" && (
                              <span className="opacity-60 font-mono text-[10px] block mb-0.5">{h.file}</span>
                            )}
                            {h.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Input */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex-none">
                      <Wand2 className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium font-mono">{activeFile}</span>
                    </div>
                    <input
                      value={improveInput}
                      onChange={(e) => setImproveInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleImprove(); } }}
                      placeholder="اطلب تحسيناً... مثل: غيّر الألوان، أضف تأثير hover، اجعله responsive"
                      disabled={isImproving}
                      className="flex-1 text-sm bg-muted/30 border border-border/60 rounded-xl px-3 py-2 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all"
                    />
                    {improveHistory.length > 0 && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg flex-none opacity-50 hover:opacity-100"
                        onClick={() => setImproveHistory([])}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button onClick={() => void handleImprove()} disabled={!improveInput.trim() || isImproving}
                      size="icon" className="h-9 w-9 rounded-xl flex-none bg-violet-600 hover:bg-violet-700">
                      {isImproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              )}

              {/* Floating status */}
              {isBuilding && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-primary/90 text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg z-10">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />{statusMsg}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
