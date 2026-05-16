import React, { useState, useRef } from "react";
import type { ChatMessage } from "@workspace/api-client-react";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { EmptyState } from "@/components/chat/empty-state";
import { BookOpen, ChevronDown, Hammer, KeyRound, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const STORAGE_KEY_FM = "user_api_key_freemodel";
const STORAGE_KEY_XY = "user_api_key_xynera";

function loadKeys() {
  return {
    freemodel: localStorage.getItem(STORAGE_KEY_FM) ?? "",
    xynera: localStorage.getItem(STORAGE_KEY_XY) ?? "",
  };
}

function saveKeys(keys: { freemodel: string; xynera: string }) {
  if (keys.freemodel.trim()) {
    localStorage.setItem(STORAGE_KEY_FM, keys.freemodel.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_FM);
  }
  if (keys.xynera.trim()) {
    localStorage.setItem(STORAGE_KEY_XY, keys.xynera.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY_XY);
  }
}

type ModelEntry = { id: string; label: string; description: string };
type ModelGroup = { group: string; color: string; models: ModelEntry[] };
type Provider = "freemodel" | "xynera";

// ── Per-provider model lists ─────────────────────────────────────────────────
const PROVIDER_MODEL_GROUPS: Record<Provider, ModelGroup[]> = {
  freemodel: [
    {
      group: "OpenAI",
      color: "bg-emerald-500",
      models: [
        { id: "gpt-5.5",       label: "GPT-5.5",       description: "أحدث إصدار" },
        { id: "gpt-5.4",       label: "GPT-5.4",       description: "إصدار مستقر" },
        { id: "gpt-5.4-mini",  label: "GPT-5.4 Mini",  description: "أسرع وأخف" },
        { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "متخصص بالكود" },
      ],
    },
    {
      group: "Anthropic",
      color: "bg-orange-400",
      models: [
        { id: "claude-opus-4-7",          label: "Claude Opus 4.7",   description: "الأقوى" },
        { id: "claude-sonnet-4-6",        label: "Claude Sonnet 4.6", description: "متوازن" },
        { id: "claude-haiku-4-5-20251001",label: "Claude Haiku 4.5",  description: "الأسرع" },
      ],
    },
  ],
  xynera: [
    {
      group: "OpenAI",
      color: "bg-emerald-500",
      models: [
        { id: "gpt-5.5",      label: "GPT-5.5",      description: "الأحدث" },
        { id: "gpt-5.4",      label: "GPT-5.4",      description: "مستقر" },
        { id: "gpt-5.2",      label: "GPT-5.2",      description: "" },
        { id: "gpt-5.1",      label: "GPT-5.1",      description: "" },
        { id: "gpt-5",        label: "GPT-5",        description: "" },
        { id: "gpt-4.1",      label: "GPT-4.1",      description: "" },
        { id: "gpt-5-mini",   label: "GPT-5 Mini",   description: "خفيف وسريع" },
        { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", description: "خفيف" },
        { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", description: "أرخص" },
      ],
    },
    {
      group: "Anthropic",
      color: "bg-orange-400",
      models: [
        { id: "claude-opus-4-7",   label: "Claude Opus 4.7",    description: "الأقوى" },
        { id: "claude-4-6-sonnet", label: "Claude 4.6 Sonnet",  description: "متوازن وسريع" },
        { id: "claude-4-5-sonnet", label: "Claude 4.5 Sonnet",  description: "جيل سابق مستقر" },
        { id: "claude-4-5-haiku",  label: "Claude 4.5 Haiku",   description: "الأسرع" },
      ],
    },
    {
      group: "Google",
      color: "bg-blue-500",
      models: [
        { id: "gemini-3-1-pro", label: "Gemini 3.1 Pro",  description: "سياق 2M متعدد الوسائط" },
        { id: "gemini-3-flash",  label: "Gemini 3 Flash",  description: "جيل 3 سريع" },
      ],
    },
  ],
};

const PROVIDERS: { id: Provider; label: string; color: string; description: string }[] = [
  { id: "freemodel", label: "FreeModel", color: "bg-emerald-500", description: "api.freemodel.dev" },
  { id: "xynera",    label: "Xynera",    color: "bg-violet-500",  description: "www.xynera.vip" },
];

function getDefaultModel(provider: Provider): string {
  return PROVIDER_MODEL_GROUPS[provider][0].models[0].id;
}

function modelExistsInProvider(modelId: string, provider: Provider): boolean {
  return PROVIDER_MODEL_GROUPS[provider].some((g) => g.models.some((m) => m.id === modelId));
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<Provider>("freemodel");
  const [selectedModel, setSelectedModel] = useState(getDefaultModel("freemodel"));
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [uploadedFileType, setUploadedFileType] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const [showSettings, setShowSettings] = useState(false);
  const [apiKeys, setApiKeys] = useState(loadKeys);
  const [draftKeys, setDraftKeys] = useState(loadKeys);
  const [showFmKey, setShowFmKey] = useState(false);
  const [showXyKey, setShowXyKey] = useState(false);

  const openSettings = () => { setDraftKeys(loadKeys()); setShowSettings(true); };
  const saveSettings = () => {
    saveKeys(draftKeys);
    setApiKeys(draftKeys);
    setShowSettings(false);
    toast({ title: "تم الحفظ", description: "تم حفظ مفاتيح API بنجاح." });
  };

  const currentApiKey = apiKeys[selectedProvider] || undefined;

  const modelGroups = PROVIDER_MODEL_GROUPS[selectedProvider];
  const allModels = modelGroups.flatMap((g) => g.models);
  const currentModel = allModels.find((m) => m.id === selectedModel) ?? allModels[0];
  const currentProvider = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const currentModelGroup = modelGroups.find((g) => g.models.some((m) => m.id === selectedModel));

  const handleProviderChange = (provider: Provider) => {
    setSelectedProvider(provider);
    // Keep current model if it exists in the new provider, otherwise switch to default
    if (!modelExistsInProvider(selectedModel, provider)) {
      setSelectedModel(getDefaultModel(provider));
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || isStreaming) return;

    const userMsg: ChatMessage = { role: "user", content };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          model: selectedModel,
          provider: selectedProvider,
          ...(currentApiKey ? { apiKey: currentApiKey } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) throw new Error("Stream request failed");

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
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) {
              toast({ title: "خطأ في المساعد", description: parsed.error, variant: "destructive" });
              break;
            }
            if (parsed.text) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + parsed.text };
                return updated;
              });
            }
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast({ title: "فشل إرسال الرسالة", description: "حدث خطأ في الاتصال. حاول مرة أخرى.", variant: "destructive" });
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "فشل رفع الملف", description: data.error ?? "حدث خطأ غير متوقع.", variant: "destructive" });
        return;
      }
      setUploadedFile(data.filename);
      setUploadedFileType(file.type);
      setMessages([]);
      toast({ title: "تم رفع الملف", description: `تم تحميل "${data.filename}" بنجاح (${(data.charCount as number).toLocaleString()} حرف).` });
    } catch {
      toast({ title: "فشل رفع الملف", description: "تعذّر الاتصال بالخادم.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleClearFile = async () => {
    try { await fetch("/api/upload/clear", { method: "POST" }); } catch { /* ignore */ }
    setUploadedFile(null);
    setUploadedFileType(null);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden">
      {/* ── API Key Settings Dialog ─────────────────────────────────────────── */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-md rounded-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <KeyRound className="h-4 w-4" />
              مفاتيح API
            </DialogTitle>
            <DialogDescription className="text-right">
              أدخل مفتاح API الخاص بك للمنصة المختارة. يُحفظ محلياً في متصفحك فقط.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* FreeModel */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                FreeModel API Key
              </Label>
              <div className="relative">
                <Input
                  type={showFmKey ? "text" : "password"}
                  placeholder="fm-xxxxxxxxxxxxxxxx"
                  value={draftKeys.freemodel}
                  onChange={(e) => setDraftKeys((k) => ({ ...k, freemodel: e.target.value }))}
                  className="pr-3 pl-10 rounded-xl font-mono text-sm"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowFmKey((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showFmKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">احصل على مفتاحك من api.freemodel.dev</p>
            </div>

            {/* Xynera */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 rounded-full bg-violet-500 inline-block" />
                Xynera API Key
              </Label>
              <div className="relative">
                <Input
                  type={showXyKey ? "text" : "password"}
                  placeholder="xy-xxxxxxxxxxxxxxxx"
                  value={draftKeys.xynera}
                  onChange={(e) => setDraftKeys((k) => ({ ...k, xynera: e.target.value }))}
                  className="pr-3 pl-10 rounded-xl font-mono text-sm"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowXyKey((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showXyKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">احصل على مفتاحك من www.xynera.vip</p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={saveSettings} className="flex-1 rounded-xl">حفظ المفاتيح</Button>
              <Button variant="outline" onClick={() => setShowSettings(false)} className="rounded-xl">إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <header className="flex-none px-6 py-4 border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-semibold text-lg leading-tight">Knowledge Assistant</h1>
              <p className="text-sm text-muted-foreground leading-tight">
                {uploadedFile ? uploadedFile : "Ask questions based on your document"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Builder link */}
            <Link href="/builder">
              <Button variant="outline" size="sm" className="flex items-center gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all">
                <Hammer className="h-3.5 w-3.5" />
                <span className="font-medium text-sm">وكيل البناء</span>
              </Button>
            </Link>

            {/* API Key settings */}
            <Button
              variant="outline"
              size="sm"
              onClick={openSettings}
              className={`flex items-center gap-1.5 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all ${currentApiKey ? "border-emerald-400/60 text-emerald-600" : ""}`}
              title="إعداد مفتاح API"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span className="font-medium text-sm hidden sm:inline">{currentApiKey ? "Key ✓" : "API Key"}</span>
            </Button>

            {/* Provider selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all">
                  <span className={`h-2 w-2 rounded-full ${currentProvider.color}`} />
                  <span className="font-medium text-sm">{currentProvider.label}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 rounded-xl p-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">المنصة</p>
                {PROVIDERS.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    className="flex items-center justify-between gap-3 rounded-lg cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${p.color}`} />
                      <div>
                        <p className="font-medium text-sm">{p.label}</p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      </div>
                    </div>
                    {selectedProvider === p.id && <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex items-center gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all">
                  <span className={`h-2 w-2 rounded-full animate-pulse ${currentModelGroup?.color ?? "bg-emerald-500"}`} />
                  <span className="font-medium text-sm">{currentModel.label}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-xl p-1 max-h-[70vh] overflow-y-auto">
                {modelGroups.map((group, gi) => (
                  <div key={group.group}>
                    {gi > 0 && <div className="my-1 border-t border-border/40" />}
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${group.color}`} />
                      {group.group}
                    </p>
                    {group.models.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => setSelectedModel(model.id)}
                        className="flex items-center justify-between gap-3 rounded-lg cursor-pointer"
                      >
                        <div>
                          <p className="font-medium text-sm">{model.label}</p>
                          {model.description && <p className="text-xs text-muted-foreground">{model.description}</p>}
                        </div>
                        {selectedModel === model.id && <span className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto relative">
        <div className="max-w-4xl mx-auto w-full h-full flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6"><EmptyState /></div>
          ) : (
            <ChatMessageList
              messages={messages}
              isTyping={isStreaming && messages[messages.length - 1]?.role === "assistant" && messages[messages.length - 1]?.content === ""}
            />
          )}
        </div>
      </main>

      <div className="flex-none p-4 pb-6 bg-gradient-to-t from-background via-background to-transparent pt-10">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            onSend={handleSendMessage}
            onUpload={handleUpload}
            uploadedFile={uploadedFile}
            uploadedFileType={uploadedFileType}
            onClearFile={handleClearFile}
            disabled={isStreaming}
            uploading={uploading}
          />
          <p className="text-xs text-center text-muted-foreground mt-3">
            AI can make mistakes. Consider verifying important information.
          </p>
        </div>
      </div>
    </div>
  );
}
