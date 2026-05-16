import React, { useState, useRef } from "react";
import type { ChatMessage } from "@workspace/api-client-react";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { EmptyState } from "@/components/chat/empty-state";
import { BookOpen, ChevronDown, Hammer } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

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
