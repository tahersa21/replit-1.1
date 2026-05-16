import React, { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Hammer, ChevronDown, Loader2, CheckCircle2, Circle,
  FileCode2, Eye, Download, Sparkles, AlertCircle, ArrowLeft,
  BrainCircuit, Code2, ShieldCheck, Send, Wand2, RotateCcw,
  Palette, Type, Smartphone, MousePointer, Layers, Layout,
  XCircle, Clock, TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Provider = "freemodel" | "xynera";
type BuildPhase = "idle" | "planning" | "coding" | "verifying" | "design_review" | "done" | "error";

interface Task     { id: string; title: string; description: string; files: string[] }
interface FileSpec { path: string; description: string; taskId: string }
interface Plan     { projectName: string; description: string; techStack: string[]; tasks: Task[]; files: FileSpec[] }
interface PhaseModels { planModel: string; codeModel: string; verifyModel: string }

interface DesignIssue {
  severity: "high" | "medium" | "low";
  category: "colors" | "typography" | "spacing" | "responsive" | "animation" | "accessibility" | "ux" | "consistency";
  title: string;
  description: string;
  fix: string;
}
interface DesignReview { score: number; summary: string; issues: DesignIssue[] }

const PHASE_MODELS: Record<Provider, PhaseModels> = {
  freemodel: { planModel: "gpt-4.1", codeModel: "gpt-5.5", verifyModel: "gpt-4.1" },
  xynera:    { planModel: "gpt-4.1", codeModel: "gpt-5.5", verifyModel: "gpt-4.1" },
};

// Models available for selection — grouped by family
const MODEL_OPTIONS: { label: string; value: string; family: "gpt" | "claude" | "other" }[] = [
  { label: "GPT-4.1",                 value: "gpt-4.1",           family: "gpt"    },
  { label: "GPT-4.1 Mini",            value: "gpt-4.1-mini",      family: "gpt"    },
  { label: "GPT-5.5",                 value: "gpt-5.5",           family: "gpt"    },
  { label: "Claude Opus 4.7 — الأقوى",   value: "claude-opus-4-7",     family: "claude" },
  { label: "Claude 4.6 Sonnet — متوازن", value: "claude-sonnet-4-6",   family: "claude" },
  { label: "Claude 4.5 Sonnet — مستقر", value: "claude-sonnet-4-5",   family: "claude" },
  { label: "Claude 4.5 Haiku — الأسرع", value: "claude-haiku-4-5",    family: "claude" },
];

const MODEL_PRESETS: { label: string; desc: string; models: PhaseModels }[] = [
  {
    label: "GPT",
    desc: "GPT-4.1 + GPT-5.5",
    models: { planModel: "gpt-4.1", codeModel: "gpt-5.5", verifyModel: "gpt-4.1" },
  },
  {
    label: "Haiku ⚡",
    desc: "Claude 4.5 Haiku — الأسرع",
    models: { planModel: "claude-haiku-4-5", codeModel: "claude-haiku-4-5", verifyModel: "claude-haiku-4-5" },
  },
  {
    label: "Sonnet",
    desc: "Claude 4.6 Sonnet — متوازن وسريع",
    models: { planModel: "claude-sonnet-4-6", codeModel: "claude-sonnet-4-6", verifyModel: "claude-sonnet-4-6" },
  },
  {
    label: "Opus 💪",
    desc: "Claude Opus 4.7 — الأقوى",
    models: { planModel: "claude-opus-4-7", codeModel: "claude-opus-4-7", verifyModel: "claude-opus-4-7" },
  },
  {
    label: "مختلط",
    desc: "Haiku للتخطيط، Opus للكود",
    models: { planModel: "claude-haiku-4-5", codeModel: "claude-opus-4-7", verifyModel: "claude-sonnet-4-6" },
  },
];

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
  { key: "planning"      as BuildPhase, label: "تخطيط",   Icon: BrainCircuit, modelKey: "planModel"   as keyof PhaseModels },
  { key: "coding"        as BuildPhase, label: "كود",      Icon: Code2,        modelKey: "codeModel"   as keyof PhaseModels },
  { key: "verifying"     as BuildPhase, label: "مراجعة",   Icon: ShieldCheck,  modelKey: "verifyModel" as keyof PhaseModels },
  { key: "design_review" as BuildPhase, label: "تصميم",    Icon: Palette,      modelKey: "verifyModel" as keyof PhaseModels },
];
const PHASE_ORDER: BuildPhase[] = ["idle","planning","coding","verifying","design_review","done","error"];

const CATEGORY_META: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  colors:        { label: "الألوان",       Icon: Palette       },
  typography:    { label: "الخطوط",        Icon: Type          },
  spacing:       { label: "المسافات",      Icon: Layout        },
  responsive:    { label: "التجاوب",       Icon: Smartphone    },
  animation:     { label: "الحركة",        Icon: Sparkles      },
  accessibility: { label: "إمكانية الوصول", Icon: Layers       },
  ux:            { label: "تجربة المستخدم", Icon: MousePointer  },
  consistency:   { label: "التناسق",       Icon: Layers        },
};
const SEVERITY_META = {
  high:   { label: "عالي",   cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-400/30"    },
  medium: { label: "متوسط",  cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/30" },
  low:    { label: "منخفض",  cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-400/30"   },
};

function getFileLanguage(path: string) {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css"))  return "css";
  if (path.endsWith(".js"))   return "javascript";
  if (path.endsWith(".ts"))   return "typescript";
  if (path.endsWith(".json")) return "json";
  return "plaintext";
}

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const r = 26; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative flex items-center justify-center" style={{ width: 68, height: 68 }}>
      <svg width="68" height="68" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="34" cy="34" r={r} fill="none" strokeWidth="5" stroke="currentColor" className="text-muted/30" />
        <circle cx="34" cy="34" r={r} fill="none" strokeWidth="5" stroke={color}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }} />
      </svg>
      <span className="absolute text-lg font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

// ── Pipeline bar ──────────────────────────────────────────────────────────────
function PipelineBar({ phase, phases }: { phase: BuildPhase; phases: PhaseModels }) {
  const phaseIdx = PHASE_ORDER.indexOf(phase);
  return (
    <div className="flex items-center gap-1 flex-wrap justify-center">
      {STEPS.map((step, i) => {
        const stepIdx  = PHASE_ORDER.indexOf(step.key);
        const isDone   = phaseIdx > stepIdx || phase === "done";
        const isActive = phase === step.key;
        const model    = phases[step.modelKey];
        const { Icon } = step;
        return (
          <React.Fragment key={step.key}>
            {i > 0 && <div className={cn("h-px w-2 flex-none hidden sm:block", isDone ? "bg-primary/50" : "bg-border/30")} />}
            <div className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] transition-all whitespace-nowrap",
              isActive ? "bg-primary/10 border-primary/30 text-primary" :
              isDone   ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-700 dark:text-emerald-400" :
                         "bg-muted/30 border-border/20 text-muted-foreground/40"
            )}>
              {isDone   ? <CheckCircle2 className="h-3 w-3 flex-none" /> :
               isActive ? <Loader2 className="h-3 w-3 flex-none animate-spin" /> :
                          <Icon className="h-3 w-3 flex-none" />}
              <span className="font-medium">{step.label}</span>
              <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-muted/50 hidden sm:inline">{model}</span>
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

// ── Design issue card ─────────────────────────────────────────────────────────
function IssueCard({
  issue, onFix,
}: { issue: DesignIssue; onFix: (fix: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const sev  = SEVERITY_META[issue.severity];
  const cat  = CATEGORY_META[issue.category] ?? { label: issue.category, Icon: Layers };
  const { Icon: CatIcon } = cat;
  return (
    <div className={cn("rounded-xl border text-xs transition-all", sev.cls)}>
      <button onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-right">
        <CatIcon className="h-3.5 w-3.5 flex-none opacity-80" />
        <span className="flex-1 font-medium text-right leading-snug">{issue.title}</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md border font-medium flex-none", sev.cls)}>
          {sev.label}
        </span>
        <span className={cn("transition-transform text-muted-foreground/60 flex-none text-[10px]", expanded ? "rotate-90" : "")}>▶</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-current/10 pt-2">
          <p className="text-muted-foreground leading-relaxed">{issue.description}</p>
          <div className="bg-background/40 rounded-lg p-2.5 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">الإصلاح المقترح</p>
            <p className="leading-relaxed">{issue.fix}</p>
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1.5 rounded-lg border-current/20 hover:bg-current/10"
              onClick={() => onFix(issue.fix)}>
              <Wand2 className="h-3 w-3" />تطبيق الإصلاح على الـ CSS
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BuilderPage() {
  const [prompt, setPrompt]           = useState("");
  const [provider, setProvider]       = useState<Provider>("freemodel");
  const [phase, setPhase]             = useState<BuildPhase>("idle");
  const [statusMsg, setStatusMsg]     = useState("");
  const [plan, setPlan]               = useState<Plan | null>(null);
  const [filesMap, setFilesMap]       = useState<Map<string, string>>(new Map());
  const [activeFile, setActiveFile]   = useState<string | null>(null);
  const [activeTab, setActiveTab]     = useState<"code" | "preview" | "design">("code");
  const [completedFiles, setCompletedFiles] = useState<Set<string>>(new Set());
  const [verification, setVerification] = useState<{ ok: boolean; notes: string } | null>(null);
  const [designReview, setDesignReview] = useState<DesignReview | null>(null);
  const [errorMsg, setErrorMsg]       = useState("");

  const [improveInput, setImproveInput]     = useState("");
  const [isImproving, setIsImproving]       = useState(false);
  const [improveHistory, setImproveHistory] = useState<{ role: "user" | "ai"; text: string; file?: string }[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tokenWarnings, setTokenWarnings]   = useState<string[]>([]);
  const [contracts, setContracts]           = useState<{ path: string; contract: string }[]>([]);

  const [customModels, setCustomModels] = useState<PhaseModels>(PHASE_MODELS["freemodel"]);

  const activeFileRef = useRef<string | null>(null);
  const abortRef      = useRef<AbortController | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  // Reset models to provider defaults when provider changes
  useEffect(() => { setCustomModels(PHASE_MODELS[provider]); }, [provider]);

  const currentProvider = PROVIDERS.find((p) => p.id === provider)!;
  const phases          = customModels;
  const isBuilding      = ["planning","coding","verifying","design_review"].includes(phase);

  // Start/stop elapsed timer with build state
  useEffect(() => {
    if (isBuilding) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isBuilding]);

  const cancelBuild = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("error");
    setErrorMsg("تم إلغاء البناء من قِبل المستخدم.");
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
  const generatedFiles  = Array.from(filesMap.entries()).map(([p, c]) => ({ path: p, content: c }));
  const activeContent   = activeFile ? (filesMap.get(activeFile) ?? "") : "";

  // ── Build ───────────────────────────────────────────────────────────────────
  const handleBuild = useCallback(async () => {
    if (!prompt.trim() || isBuilding) return;
    setPlan(null); setFilesMap(new Map()); setActiveFile(null);
    activeFileRef.current = null; setVerification(null); setDesignReview(null);
    setErrorMsg(""); setCompletedFiles(new Set()); setTokenWarnings([]); setContracts([]);
    setPhase("planning"); setActiveTab("code"); setImproveHistory([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Auto-cancel after 10 minutes
    const autoCancel = setTimeout(() => {
      ctrl.abort();
      setErrorMsg("تجاوز البناء 10 دقائق — تم الإلغاء تلقائياً. جرّب مشروعاً أبسط أو استخدم مفتاح API الخاص بك.");
      setPhase("error");
    }, 600_000);

    // Read apiKey from localStorage
    const apiKey = localStorage.getItem(`user_api_key_${provider}`) || undefined;

    try {
      const response = await fetch("/api/builder/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, provider, models: customModels, ...(apiKey ? { apiKey } : {}) }),
        signal: ctrl.signal,
      });
      if (!response.ok || !response.body) throw new Error("فشل الاتصال بالخادم");
      const reader = response.body.getReader();
      const dec = new TextDecoder(); let buf = "";

      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim(); if (!raw) continue;
          try {
            const msg = JSON.parse(raw) as {
              type: string; message?: string; phase?: string;
              plan?: Plan; path?: string; chunk?: string; content?: string;
              verification?: { ok: boolean; notes: string };
              designReview?: DesignReview;
              files?: { path: string; content: string }[];
              contracts?: { path: string; contract: string }[];
            };
            switch (msg.type) {
              case "status":
                setStatusMsg(msg.message ?? "");
                if (msg.phase === "planning")      setPhase("planning");
                if (msg.phase === "coding")        setPhase("coding");
                if (msg.phase === "verifying")     setPhase("verifying");
                if (msg.phase === "design_review") setPhase("design_review");
                break;
              case "plan": if (msg.plan) { setPlan(msg.plan); setPhase("coding"); } break;
              case "file_start":
                if (msg.path) {
                  setFilesMap((prev) => { const m = new Map(prev); if (!m.has(msg.path!)) m.set(msg.path!, ""); return m; });
                  // In parallel mode many files start at once — only set active on the first one
                  if (!activeFileRef.current) { activeFileRef.current = msg.path!; setActiveFile(msg.path!); }
                } break;
              case "file_chunk":
                if (msg.path && msg.chunk)
                  setFilesMap((prev) => { const m = new Map(prev); m.set(msg.path!, (m.get(msg.path!) ?? "") + msg.chunk!); return m; });
                break;
              case "file_done":
                if (msg.path) {
                  if (msg.content !== undefined) setFilesMap((prev) => { const m = new Map(prev); m.set(msg.path!, msg.content!); return m; });
                  setCompletedFiles((prev) => new Set([...prev, msg.path!]));
                } break;
              case "token_limit":
                if (msg.path) setTokenWarnings((prev) => [...prev, msg.path!]);
                break;
              case "contracts":
                if (Array.isArray(msg.contracts)) setContracts(msg.contracts as { path: string; contract: string }[]);
                break;
              case "file_error":
                // A single file failed in parallel mode — mark it as done (empty) so the
                // build can still proceed with the remaining files
                if (msg.path) {
                  setCompletedFiles((prev) => new Set([...prev, msg.path!]));
                  setTokenWarnings((prev) => [...prev, `${msg.path!} (فشل: ${msg.message ?? "خطأ"})`]);
                }
                break;
              case "done":
                setVerification(msg.verification ?? { ok: true, notes: "تم البناء بنجاح" });
                if (msg.designReview) { setDesignReview(msg.designReview); setActiveTab("design"); }
                if (msg.files) { const m = new Map<string,string>(); msg.files.forEach((f) => m.set(f.path, f.content)); setFilesMap(m); }
                setPhase("done"); break;
              case "error": setErrorMsg(msg.message ?? "حدث خطأ"); setPhase("error"); break;
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") { setErrorMsg("فشل الاتصال بالخادم."); setPhase("error"); }
    } finally {
      clearTimeout(autoCancel);
      abortRef.current = null;
    }
  }, [prompt, provider, isBuilding]);

  // ── Improve ─────────────────────────────────────────────────────────────────
  const handleImprove = useCallback(async (instruction?: string) => {
    const text = instruction ?? improveInput.trim();
    if (!text || !activeFile || isImproving || isBuilding) return;
    // Find CSS file to target for design fixes from issue cards
    const targetFile = instruction
      ? (generatedFiles.find((f) => f.path.endsWith(".css"))?.path ?? activeFile)
      : activeFile;
    const fileContent = filesMap.get(targetFile) ?? "";
    if (!instruction) setImproveInput("");
    setIsImproving(true);
    if (targetFile !== activeFile) { setActiveFile(targetFile); setActiveTab("code"); }
    setImproveHistory((h) => [...h, { role: "user", text, file: targetFile }]);

    try {
      const response = await fetch("/api/builder/improve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetFile, content: fileContent, instruction: text, provider, allFiles: generatedFiles }),
      });
      if (!response.ok || !response.body) throw new Error("فشل الاتصال");
      const reader = response.body.getReader(); const dec = new TextDecoder(); let buf = "";
      setFilesMap((prev) => { const m = new Map(prev); m.set(targetFile, ""); return m; });

      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim(); if (!raw) continue;
          try {
            const msg = JSON.parse(raw) as { type: string; chunk?: string; content?: string; path?: string; message?: string };
            if (msg.type === "improve_chunk" && msg.chunk)
              setFilesMap((prev) => { const m = new Map(prev); m.set(targetFile, (m.get(targetFile) ?? "") + msg.chunk!); return m; });
            else if (msg.type === "improve_done" && msg.content !== undefined) {
              setFilesMap((prev) => { const m = new Map(prev); m.set(targetFile, msg.content!); return m; });
              setImproveHistory((h) => [...h, { role: "ai", text: `تم تحسين ${targetFile} ✓`, file: targetFile }]);
            } else if (msg.type === "error")
              setImproveHistory((h) => [...h, { role: "ai", text: `خطأ: ${msg.message}`, file: targetFile }]);
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setImproveHistory((h) => [...h, { role: "ai", text: `فشل: ${(err as Error).message}`, file: targetFile }]);
    } finally { setIsImproving(false); }
  }, [improveInput, activeFile, filesMap, generatedFiles, provider, isImproving, isBuilding]);

  // ── Download ─────────────────────────────────────────────────────────────────
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([h], { type: "text/html" }));
    a.download = `${plan?.projectName ?? "project"}.html`; a.click();
    toast({ title: "تم التحميل", description: "ملف HTML جاهز للتشغيل" });
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

  const highCount   = designReview?.issues.filter((i) => i.severity === "high").length   ?? 0;
  const medCount    = designReview?.issues.filter((i) => i.severity === "medium").length ?? 0;

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden" dir="rtl">

      {/* ── Header ── */}
      <header className="flex-none px-4 py-3 border-b border-border/50 bg-background/80 backdrop-blur-md z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-none">
            <Link href="/"><Button variant="ghost" size="icon" className="rounded-xl h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div className="h-9 w-9 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm">
              <Hammer className="h-4 w-4" />
            </div>
            <div>
              <h1 className="font-semibold text-base leading-tight">وكيل البناء الذكي</h1>
              <p className="text-[11px] text-muted-foreground">بناء · تحرير · تحسين · مراجعة بصرية</p>
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

        {/* ── Left panel ── */}
        <div className="w-64 flex-none flex flex-col border-l border-border/50 overflow-hidden bg-background">

          {/* Models */}
          <div className="p-3 border-b border-border/30 bg-muted/10">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">المراحل</p>

            {/* Model presets */}
            {!isBuilding && (
              <div className="flex flex-wrap gap-1 mb-2">
                {MODEL_PRESETS.map((preset) => {
                  const isActive =
                    customModels.planModel   === preset.models.planModel &&
                    customModels.codeModel   === preset.models.codeModel &&
                    customModels.verifyModel === preset.models.verifyModel;
                  return (
                    <button key={preset.label} onClick={() => setCustomModels(preset.models)}
                      title={preset.desc}
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/60 text-muted-foreground border-border/40 hover:border-primary/40 hover:text-foreground"
                      )}>
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Phase rows with per-phase model picker */}
            {STEPS.map(({ key: sk, label, Icon, modelKey }) => {
              const model = phases[modelKey]; const idx = PHASE_ORDER.indexOf(phase); const si = PHASE_ORDER.indexOf(sk);
              const isDone = idx > si || phase === "done"; const isActive = phase === sk;
              // For design_review, verifyModel is shared — only show picker on verifying row to avoid duplicates
              const canPick = !isBuilding && modelKey !== "verifyModel" || (modelKey === "verifyModel" && sk === "verifying");
              return (
                <div key={sk} className={cn("flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs mb-1 transition-all",
                  isActive ? "bg-primary/8 border-primary/25" : isDone ? "bg-emerald-500/8 border-emerald-400/20" : "bg-transparent border-border/15")}>
                  <div className={cn("h-5 w-5 rounded-md flex items-center justify-center flex-none",
                    isActive ? "bg-primary/15 text-primary" : isDone ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground/40")}>
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  </div>
                  <span className={cn("font-medium flex-none w-12", isActive || isDone ? "text-foreground/90" : "text-muted-foreground/40")}>{label}</span>
                  {canPick ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={cn(
                          "text-[10px] font-mono truncate flex items-center gap-0.5 rounded px-1 py-0.5 -ml-1 transition-colors",
                          "hover:bg-muted/60 hover:text-foreground",
                          isActive ? "text-primary font-semibold" : isDone ? "text-muted-foreground" : "text-muted-foreground/50"
                        )}>
                          {model}<ChevronDown className="h-2.5 w-2.5 opacity-50 flex-none" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[180px]">
                        {MODEL_OPTIONS.map((opt) => (
                          <DropdownMenuItem key={opt.value}
                            className={cn("text-xs font-mono gap-2", opt.value === model && "text-primary font-semibold")}
                            onClick={() => setCustomModels((prev) => ({ ...prev, [modelKey]: opt.value }))}>
                            <span className={cn("h-1.5 w-1.5 rounded-full flex-none",
                              opt.family === "claude" ? "bg-violet-500" : opt.family === "gpt" ? "bg-emerald-500" : "bg-muted-foreground")} />
                            {opt.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className={cn("text-[10px] font-mono truncate", isActive ? "text-primary font-semibold" : isDone ? "text-muted-foreground" : "text-muted-foreground/30")}>{model}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Prompt */}
          <div className="p-3 border-b border-border/30">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) void handleBuild(); }}
              placeholder="صف المشروع..." disabled={isBuilding}
              className="w-full h-20 resize-none rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
            {isBuilding ? (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(elapsedSeconds)}</span>
                  <span className="text-[10px] opacity-60">يُلغى تلقائياً عند 10 دقائق</span>
                </div>
                <Button variant="destructive" onClick={cancelBuild} className="w-full rounded-xl gap-2 h-8 text-xs">
                  <XCircle className="h-3.5 w-3.5" />إلغاء البناء
                </Button>
              </div>
            ) : (
              <Button onClick={() => void handleBuild()} disabled={!prompt.trim()} className="w-full mt-2 rounded-xl gap-2">
                <Sparkles className="h-4 w-4" />ابنِ المشروع
              </Button>
            )}
          </div>

          {/* Dynamic panel */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {statusMsg && isBuilding && (
              <div className="flex items-center gap-2 text-xs bg-primary/5 rounded-lg px-3 py-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-none" />{statusMsg}
              </div>
            )}
            {contracts.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1.5 px-1 py-0.5">
                  <span className="group-open:rotate-90 transition-transform inline-block">›</span>
                  عقود الملفات البينية ({contracts.length} ملف)
                </summary>
                <div className="mt-1 space-y-1">
                  {contracts.map((c) => (
                    <div key={c.path} className="text-[10px] bg-muted/50 rounded px-2 py-1.5 border border-border/50">
                      <span className="font-mono font-semibold text-primary">{c.path}</span>
                      <span className="text-muted-foreground ml-2">{c.contract}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {tokenWarnings.length > 0 && (
              <div className="space-y-1">
                {tokenWarnings.map((f) => (
                  <div key={f} className="flex items-start gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-2.5 py-2 border border-amber-400/20">
                    <TriangleAlert className="h-3 w-3 flex-none mt-0.5" />
                    <span><span className="font-mono font-semibold">{f}</span> وصل لحد التوكن — قد يكون ناقصاً. استخدم "تحسين" لاستكماله.</span>
                  </div>
                ))}
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
                  <div className="flex flex-wrap gap-1 mt-1">
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
                {phase === "done" && (
                  <Button onClick={downloadAll} variant="outline" size="sm" className="w-full rounded-xl gap-2 text-xs">
                    <Download className="h-3.5 w-3.5" />تحميل المشروع
                  </Button>
                )}
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

        {/* ── Right panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">

          {/* Idle */}
          {!hasFiles && phase === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Hammer className="h-8 w-8 text-primary/60" />
              </div>
              <h2 className="text-lg font-semibold mb-2">وكيل البناء الذكي</h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mb-6">
                صف مشروعك — يخطط، يبني، يراجع الكود، ثم يحلل التصميم البصري ويقترح إصلاحات.
              </p>
              <div className="flex flex-wrap items-center gap-2 justify-center text-xs">
                {[
                  { Icon: BrainCircuit, label: "يخطط",          color: "text-primary bg-primary/10"      },
                  { Icon: Code2,        label: "يبني",           color: "text-emerald-600 bg-emerald-500/10" },
                  { Icon: ShieldCheck,  label: "يراجع الكود",   color: "text-amber-600 bg-amber-500/10"   },
                  { Icon: Palette,      label: "يراجع التصميم", color: "text-violet-600 bg-violet-500/10" },
                ].map(({ Icon, label, color }, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-muted-foreground/30">→</span>}
                    <div className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg", color.split(" ")[1])}>
                      <Icon className={cn("h-3.5 w-3.5", color.split(" ")[0])} />
                      <span className="font-medium text-foreground/70">{label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {!hasFiles && phase === "planning" && <PlanningSkeleton model={phases.planModel} />}

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
                    {(isBuilding || isImproving) && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                  </button>
                  <button onClick={() => setActiveTab("preview")} disabled={!previewSrc}
                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "preview" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      !previewSrc && "opacity-40 cursor-not-allowed")}>
                    <Eye className="h-3.5 w-3.5" />معاينة
                  </button>
                  <button onClick={() => setActiveTab("design")} disabled={!designReview}
                    className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      activeTab === "design" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
                      !designReview && "opacity-40 cursor-not-allowed")}>
                    <Palette className="h-3.5 w-3.5" />
                    التصميم
                    {designReview && (
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                        designReview.score >= 80 ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : designReview.score >= 60 ? "bg-amber-500/20 text-amber-600"
                        : "bg-red-500/20 text-red-600")}>
                        {designReview.score}
                      </span>
                    )}
                    {highCount > 0 && (
                      <span className="text-[10px] bg-red-500/20 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-md font-bold">
                        {highCount} عالي
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {activeFile && activeTab === "code" && (
                    <Button onClick={() => downloadFile(activeFile, activeContent)} variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 rounded-lg">
                      <Download className="h-3 w-3" />تحميل
                    </Button>
                  )}
                  {phase === "done" && (
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
                    const isDone    = completedFiles.has(path);
                    const isCurrent = activeFile === path && !isDone && isBuilding;
                    const isImpr    = isImproving && activeFile === path;
                    return (
                      <button key={path} onClick={() => setActiveFile(path)}
                        className={cn("flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono whitespace-nowrap transition-all flex-none",
                          activeFile === path ? "bg-background shadow-sm text-foreground border border-border/50" : "text-muted-foreground hover:text-foreground hover:bg-accent/60")}>
                        <FileCode2 className="h-3 w-3" />{path}
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
                  {activeFile
                    ? <Editor height="100%" language={getFileLanguage(activeFile)} value={activeContent}
                        theme="vs-dark"
                        onChange={(val) => { if (val !== undefined && !isBuilding) setFilesMap((prev) => { const m = new Map(prev); m.set(activeFile, val); return m; }); }}
                        options={{ fontSize: 13, fontFamily: "'Fira Code', 'Cascadia Code', monospace", minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", readOnly: isBuilding, smoothScrolling: true, cursorBlinking: "smooth", padding: { top: 12, bottom: 12 } }} />
                    : <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">اختر ملفاً</div>}
                  {isBuilding && <div className="absolute inset-0 bg-background/10 pointer-events-none" />}
                </div>
              )}

              {/* Preview */}
              {activeTab === "preview" && previewSrc && (
                <div className="flex-1 overflow-hidden bg-white">
                  <iframe src={previewSrc} className="w-full h-full border-0"
                    sandbox="allow-scripts allow-same-origin allow-forms" title="معاينة المشروع" />
                </div>
              )}

              {/* ── Design Review Panel ── */}
              {activeTab === "design" && designReview && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4" dir="rtl">
                  {/* Score header */}
                  <div className="flex items-center gap-4 bg-card rounded-2xl border border-border/50 p-4">
                    <ScoreRing score={designReview.score} />
                    <div className="flex-1">
                      <p className="font-semibold text-base">تقييم التصميم البصري</p>
                      <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{designReview.summary}</p>
                      <div className="flex gap-2 mt-2">
                        {highCount > 0 && (
                          <span className="text-[11px] px-2 py-1 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 font-medium border border-red-400/20">
                            {highCount} مشكلة عالية
                          </span>
                        )}
                        {medCount > 0 && (
                          <span className="text-[11px] px-2 py-1 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium border border-amber-400/20">
                            {medCount} متوسطة
                          </span>
                        )}
                        {designReview.issues.length === 0 && (
                          <span className="text-[11px] px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium border border-emerald-400/20">
                            لا توجد مشاكل ✓
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Issues */}
                  {designReview.issues.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">المشاكل والتحسينات</p>
                      {/* Sort: high → medium → low */}
                      {[...designReview.issues]
                        .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]))
                        .map((issue, i) => (
                          <IssueCard key={i} issue={issue} onFix={(fix) => void handleImprove(fix)} />
                        ))}
                    </div>
                  )}

                  {/* Quick actions */}
                  {designReview.issues.length > 0 && (
                    <div className="bg-muted/30 rounded-xl border border-border/40 p-3">
                      <p className="text-xs font-medium mb-2 text-muted-foreground">إصلاح سريع</p>
                      <Button size="sm" className="w-full rounded-xl gap-2 text-xs bg-violet-600 hover:bg-violet-700"
                        disabled={isImproving}
                        onClick={() => void handleImprove(
                          `Fix all these design issues in the CSS: ${designReview.issues.map((i) => i.fix).join(". ")}`
                        )}>
                        {isImproving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                        إصلاح كل المشاكل تلقائياً
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Improve chat bar ── */}
              {activeTab === "code" && !isBuilding && activeFile && (
                <div className="flex-none border-t border-border/50 bg-background">
                  {improveHistory.length > 0 && (
                    <div className="max-h-28 overflow-y-auto px-4 py-2 space-y-1.5 border-b border-border/30 bg-muted/20">
                      {improveHistory.map((h, i) => (
                        <div key={i} className={cn("flex text-xs", h.role === "user" ? "justify-end" : "justify-start")}>
                          <div className={cn("max-w-[80%] px-3 py-1.5 rounded-xl",
                            h.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm"
                            : h.text.startsWith("خطأ") || h.text.startsWith("فشل")
                              ? "bg-destructive/15 text-destructive rounded-bl-sm"
                              : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 rounded-bl-sm")}>
                            {h.file && h.role === "user" && <span className="opacity-60 font-mono text-[10px] block mb-0.5">{h.file}</span>}
                            {h.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex-none">
                      <Wand2 className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium font-mono">{activeFile}</span>
                    </div>
                    <input value={improveInput} onChange={(e) => setImproveInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleImprove(); } }}
                      placeholder="اطلب تحسيناً... مثل: غيّر الألوان، اجعله responsive"
                      disabled={isImproving}
                      className="flex-1 text-sm bg-muted/30 border border-border/60 rounded-xl px-3 py-2 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-violet-500/30 transition-all" />
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
            </>
          )}

          {/* Floating status */}
          {isBuilding && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-primary/90 text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg z-10">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />{statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
