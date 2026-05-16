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

// Mirror what the backend uses so we can display it before the build starts
const PHASE_MODELS: Record<Provider, PhaseModels> = {
  freemodel: {
    planModel:   "claude-opus-4-7",
    codeModel:   "gpt-5.5",
    verifyModel: "claude-sonnet-4-6",
  },
  xynera: {
    planModel:   "claude-opus-4-7",
    codeModel:   "gpt-5.5",
    verifyModel: "claude-4-6-sonnet",
  },
};

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

// ── Tiny phase-model badge ────────────────────────────────────────────────────
function ModelBadge({ model, active }: { model: string; active: boolean }) {
  const isClaude = model.toLowerCase().includes("claude");
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-all",
      active
        ? isClaude
          ? "bg-orange-500/15 border-orange-400/40 text-orange-600 dark:text-orange-400"
          : "bg-emerald-500/15 border-emerald-400/40 text-emerald-700 dark:text-emerald-400"
        : "bg-muted/50 border-border/30 text-muted-foreground/50"
    )}>
      {model}
    </span>
  );
}

// ── 3-step pipeline indicator ─────────────────────────────────────────────────
function PipelineIndicator({ phase, phases }: { phase: BuildPhase; phases: PhaseModels }) {
  const steps = [
    { key: "planning",  label: "تخطيط",  icon: BrainCircuit, model: phases.planModel   },
    { key: "coding",    label: "كود",     icon: Code2,        model: phases.codeModel   },
    { key: "verifying", label: "مراجعة",  icon: ShieldCheck,  model: phases.verifyModel },
  ] as const;

  const order: BuildPhase[] = ["idle", "planning", "coding", "verifying", "done", "error"];
  const phaseIdx = order.indexOf(phase);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {steps.map((step, i) => {
        const stepIdx = order.indexOf(step.key as BuildPhase);
        const isDone    = phaseIdx > stepIdx || phase === "done";
        const isActive  = phase === step.key;
        const Icon = step.icon;
        return (
          <React.Fragment key={step.key}>
            {i > 0 && <div className={cn("h-px w-3 flex-none", isDone ? "bg-primary/50" : "bg-border/40")} />}
            <div className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] transition-all",
              isActive  ? "bg-primary/10 border-primary/30 text-primary" :
              isDone    ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-700 dark:text-emerald-400" :
                          "bg-muted/30 border-border/30 text-muted-foreground/50"
            )}>
              {isDone
                ? <CheckCircle2 className="h-3 w-3" />
                : isActive
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Icon className="h-3 w-3" />}
              <span className="font-medium">{step.label}</span>
              <ModelBadge model={step.model} active={isActive || isDone} />
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function BuilderPage() {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<Provider>("freemodel");
  const [phase, setPhase] = useState<BuildPhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [activePhaseModel, setActivePhaseModel] = useState<string>("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"code" | "preview">("code");
  const [verification, setVerification] = useState<{ ok: boolean; notes: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const activeFileRef = useRef<string | null>(null);
  const { toast } = useToast();

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;
  const phases = PHASE_MODELS[provider];

  const handleBuild = useCallback(async () => {
    if (!prompt.trim() || phase === "planning" || phase === "coding" || phase === "verifying") return;

    setPlan(null);
    setGeneratedFiles([]);
    setActiveFile(null);
    activeFileRef.current = null;
    setVerification(null);
    setErrorMsg("");
    setCompletedFiles(new Set());
    setPhase("planning");
    setActivePhaseModel(PHASE_MODELS[provider].planModel);

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
              phase?: string;
              model?: string;
              plan?: Plan;
              path?: string;
              content?: string;
              verification?: { ok: boolean; notes: string };
              files?: GeneratedFile[];
              phases?: PhaseModels;
            };

            switch (msg.type) {
              case "status":
                setStatusMsg(msg.message ?? "");
                if (msg.model) setActivePhaseModel(msg.model);
                if (msg.phase === "planning")  setPhase("planning");
                if (msg.phase === "coding")    setPhase("coding");
                if (msg.phase === "verifying") setPhase("verifying");
                break;

              case "plan":
                if (msg.plan) {
                  setPlan(msg.plan);
                  setPhase("coding");
                  setActivePhaseModel(PHASE_MODELS[provider].codeModel);
                }
                break;

              case "file_done":
                if (msg.path && msg.content !== undefined) {
                  setGeneratedFiles((prev) => {
                    const exists = prev.find((f) => f.path === msg.path);
                    if (exists) return prev.map((f) => f.path === msg.path ? { ...f, content: msg.content! } : f);
                    return [...prev, { path: msg.path!, content: msg.content! }];
                  });
                  setCompletedFiles((prev) => new Set([...prev, msg.path!]));
                  if (!activeFileRef.current) {
                    activeFileRef.current = msg.path!;
                    setActiveFile(msg.path!);
                  }
                }
                break;

              case "done":
                setVerification(msg.verification ?? { ok: true, notes: "تم البناء بنجاح" });
                if (msg.files) setGeneratedFiles(msg.files);
                setPhase("done");
                setActivePhaseModel("");
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
  }, [prompt, provider, phase]);

  const handleDownloadFile = (file: GeneratedFile) => {
    const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = file.path; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    if (generatedFiles.length === 0) return;
    const htmlFile = generatedFiles.find((f) => f.path.endsWith(".html"));
    if (htmlFile) {
      let combined = htmlFile.content;
      const cssFile = generatedFiles.find((f) => f.path.endsWith(".css"));
      if (cssFile) combined = combined.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${cssFile.content}\n</style>`);
      const jsFile = generatedFiles.find((f) => f.path.endsWith(".js") && !f.path.endsWith(".css.js"));
      if (jsFile) combined = combined.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${jsFile.content}\n</script>`);
      const blob = new Blob([combined], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${plan?.projectName ?? "project"}.html`; a.click();
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
    if (cssFile) html = html.replace(/<link[^>]*stylesheet[^>]*>/i, `<style>\n${cssFile.content}\n</style>`);
    const jsFile = generatedFiles.find((f) => f.path.endsWith(".js") && !f.path.endsWith(".css.js"));
    if (jsFile) html = html.replace(/<script[^>]*src=[^>]*><\/script>/i, `<script>\n${jsFile.content}\n</script>`);
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  };

  const activeFileContent = generatedFiles.find((f) => f.path === activeFile);
  const isBuilding = phase === "planning" || phase === "coding" || phase === "verifying";
  const previewSrc = getPreviewSrc();

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden" dir="rtl">
      {/* Header */}
      <header className="flex-none px-4 py-3 border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-10">
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
              <p className="text-xs text-muted-foreground leading-tight">3 نماذج تتعاون لبناء مشروعك</p>
            </div>
          </div>

          {/* Pipeline always visible in header */}
          <div className="flex-1 flex justify-center">
            <PipelineIndicator phase={phase} phases={phases} />
          </div>

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
        {/* Left Panel */}
        <div className="w-72 flex-none flex flex-col border-l border-border/50 overflow-hidden">

          {/* Model assignment card */}
          <div className="p-3 border-b border-border/30 bg-muted/20">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">النماذج المستخدمة</p>
            <div className="space-y-1.5">
              {[
                { icon: BrainCircuit, label: "التخطيط",  model: phases.planModel,   phaseKey: "planning"  as BuildPhase },
                { icon: Code2,        label: "الكود",     model: phases.codeModel,   phaseKey: "coding"    as BuildPhase },
                { icon: ShieldCheck,  label: "المراجعة",  model: phases.verifyModel, phaseKey: "verifying" as BuildPhase },
              ].map(({ icon: Icon, label, model, phaseKey }) => {
                const order: BuildPhase[] = ["idle", "planning", "coding", "verifying", "done", "error"];
                const phaseIdx   = order.indexOf(phase);
                const stepIdx    = order.indexOf(phaseKey);
                const isDone     = phaseIdx > stepIdx || phase === "done";
                const isActive   = phase === phaseKey;
                const isClaude   = model.toLowerCase().includes("claude");
                return (
                  <div key={phaseKey} className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs transition-all",
                    isActive  ? "bg-primary/8 border-primary/25" :
                    isDone    ? "bg-emerald-500/8 border-emerald-400/20" :
                                "bg-transparent border-border/20"
                  )}>
                    <div className={cn(
                      "h-5 w-5 rounded-md flex items-center justify-center flex-none",
                      isActive ? "bg-primary/15 text-primary" :
                      isDone   ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                                 "bg-muted text-muted-foreground/50"
                    )}>
                      {isDone ? <CheckCircle2 className="h-3 w-3" /> :
                       isActive ? <Loader2 className="h-3 w-3 animate-spin" /> :
                       <Icon className="h-3 w-3" />}
                    </div>
                    <span className={cn("font-medium flex-none w-12",
                      isActive ? "text-foreground" : isDone ? "text-foreground/80" : "text-muted-foreground/60"
                    )}>{label}</span>
                    <span className={cn(
                      "text-[10px] font-mono truncate",
                      isActive
                        ? isClaude ? "text-orange-600 dark:text-orange-400 font-semibold" : "text-emerald-700 dark:text-emerald-400 font-semibold"
                        : isDone   ? "text-muted-foreground" : "text-muted-foreground/40"
                    )}>{model}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prompt Input */}
          <div className="p-3 border-b border-border/30">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) void handleBuild(); }}
              placeholder="صف المشروع الذي تريد بناءه..."
              className="w-full h-24 resize-none rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
              disabled={isBuilding}
            />
            <Button onClick={() => void handleBuild()} disabled={!prompt.trim() || isBuilding}
              className="w-full mt-2 rounded-xl gap-2">
              {isBuilding
                ? <><Loader2 className="h-4 w-4 animate-spin" />جارٍ البناء...</>
                : <><Sparkles className="h-4 w-4" />ابنِ المشروع</>}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-1">Ctrl+Enter للبناء السريع</p>
          </div>

          {/* Examples / Plan */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Status message */}
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

            {/* Verification result */}
            {verification && phase === "done" && (
              <div className={cn(
                "flex items-start gap-2 text-xs rounded-lg px-3 py-2",
                verification.ok
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}>
                {verification.ok
                  ? <CheckCircle2 className="h-3.5 w-3.5 flex-none mt-0.5" />
                  : <AlertCircle className="h-3.5 w-3.5 flex-none mt-0.5" />}
                <span>{verification.notes}</span>
              </div>
            )}

            {/* Plan tasks + files */}
            {plan ? (
              <div>
                <div className="mb-2">
                  <p className="font-semibold text-sm">{plan.projectName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{plan.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {plan.techStack.map((t) => (
                      <span key={t} className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary rounded-full">{t}</span>
                    ))}
                  </div>
                </div>

                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">المهام</p>
                <div className="space-y-1.5 mb-3">
                  {plan.tasks.map((task) => {
                    const taskFiles = task.files ?? [];
                    const done = taskFiles.every((f) => completedFiles.has(f));
                    const partial = !done && taskFiles.some((f) => completedFiles.has(f));
                    return (
                      <div key={task.id} className="flex items-start gap-2 text-xs">
                        {done    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-none mt-0.5" /> :
                         partial ? <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-none mt-0.5" /> :
                                   <Circle className="h-3.5 w-3.5 text-muted-foreground/30 flex-none mt-0.5" />}
                        <div>
                          <p className={cn("font-medium leading-snug", done ? "text-foreground" : "text-muted-foreground")}>{task.title}</p>
                          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{task.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">الملفات</p>
                <div className="space-y-0.5">
                  {plan.files.map((f) => {
                    const isDone = completedFiles.has(f.path);
                    return (
                      <button key={f.path}
                        onClick={() => { if (isDone) { setActiveFile(f.path); setActiveTab("code"); } }}
                        disabled={!isDone}
                        className={cn(
                          "w-full text-right flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-all",
                          activeFile === f.path ? "bg-primary/15 text-primary" :
                          isDone ? "hover:bg-accent cursor-pointer text-foreground" :
                                   "text-muted-foreground/40 cursor-not-allowed"
                        )}>
                        {isDone
                          ? <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-none" />
                          : <Circle className="h-3 w-3 flex-none" />}
                        <FileCode2 className="h-3 w-3 flex-none" />
                        <span className="font-mono">{f.path}</span>
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

        {/* Right Panel: Code + Preview */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {generatedFiles.length === 0 && !isBuilding && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Hammer className="h-8 w-8 text-primary/60" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">وكيل البناء الذكي</h2>
              <p className="text-sm leading-relaxed max-w-xs mb-6">
                صف مشروعك وسيتولى الوكيل التخطيط والبناء والمراجعة تلقائياً باستخدام أنسب نموذج لكل مرحلة.
              </p>
              {/* Pipeline preview when idle */}
              <div className="flex items-center gap-3 text-xs">
                {[
                  { icon: BrainCircuit, label: "Claude يخطط",  color: "text-orange-500" },
                  { icon: Code2,        label: "GPT يكتب الكود", color: "text-emerald-600" },
                  { icon: ShieldCheck,  label: "Claude يراجع",  color: "text-orange-500" },
                ].map(({ icon: Icon, label, color }, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground/30">→</span>}
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-muted/50">
                      <Icon className={cn("h-3.5 w-3.5", color)} />
                      <span className="font-medium text-foreground/70">{label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
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
                {activePhaseModel && (
                  <p className="text-xs text-muted-foreground mt-1">
                    النموذج: <span className="font-mono text-primary">{activePhaseModel}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {generatedFiles.length > 0 && (
            <>
              {/* Tabs bar */}
              <div className="flex-none flex items-center justify-between px-4 py-2 border-b border-border/50 bg-background/50">
                <div className="flex items-center gap-1 bg-accent/50 rounded-lg p-0.5">
                  <button onClick={() => setActiveTab("code")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "code" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}>
                    <FileCode2 className="h-3.5 w-3.5" />الكود
                  </button>
                  <button onClick={() => setActiveTab("preview")} disabled={!previewSrc}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "preview" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      !previewSrc && "opacity-40 cursor-not-allowed"
                    )}>
                    <Eye className="h-3.5 w-3.5" />معاينة حية
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {activeFileContent && activeTab === "code" && (
                    <Button onClick={() => handleDownloadFile(activeFileContent)} variant="ghost" size="sm"
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

              {/* File tabs strip */}
              {activeTab === "code" && (
                <div className="flex-none flex items-center gap-0.5 px-3 py-1.5 border-b border-border/30 overflow-x-auto bg-accent/20">
                  {generatedFiles.map((f) => (
                    <button key={f.path} onClick={() => setActiveFile(f.path)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono whitespace-nowrap transition-all flex-none",
                        activeFile === f.path
                          ? "bg-background shadow-sm text-foreground border border-border/50"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                      )}>
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
                  <iframe src={previewSrc} className="w-full h-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    title="معاينة المشروع" />
                </div>
              )}

              {/* Building status pill */}
              {isBuilding && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-primary text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg z-10">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{statusMsg}</span>
                  {activePhaseModel && (
                    <span className="opacity-70 font-mono">({activePhaseModel})</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
