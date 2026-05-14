import React, { useState } from "react";
import { useSendMessage } from "@workspace/api-client-react";
import type { ChatMessage } from "@workspace/api-client-react/src/generated/api.schemas";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { EmptyState } from "@/components/chat/empty-state";
import { BookOpen, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const MODELS = [
  { id: "FRE-5.5", label: "FRE-5.5", description: "أحدث إصدار" },
  { id: "FRE-5.4", label: "FRE-5.4", description: "إصدار مستقر" },
] as const;

type ModelId = (typeof MODELS)[number]["id"];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelId>("FRE-5.5");
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const sendMessageMutation = useSendMessage();
  const currentModel = MODELS.find((m) => m.id === selectedModel)!;

  const handleSendMessage = (content: string) => {
    if (!content.trim()) return;

    const newMessage: ChatMessage = { role: "user", content };
    const newMessages = [...messages, newMessage];
    setMessages(newMessages);

    sendMessageMutation.mutate(
      { data: { messages: newMessages, model: selectedModel } },
      {
        onSuccess: (response) => {
          if (response?.message) {
            setMessages((prev) => [...prev, response.message]);
          }
        },
        onError: () => {
          toast({
            title: "فشل إرسال الرسالة",
            description: "حدث خطأ في الاتصال بالمساعد. حاول مرة أخرى.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast({
          title: "فشل رفع الملف",
          description: data.error ?? "حدث خطأ غير متوقع.",
          variant: "destructive",
        });
        return;
      }

      setUploadedFile(data.filename);
      setMessages([]);
      toast({
        title: "تم رفع الملف",
        description: `تم تحميل "${data.filename}" بنجاح (${(data.charCount as number).toLocaleString()} حرف).`,
      });
    } catch {
      toast({
        title: "فشل رفع الملف",
        description: "تعذّر الاتصال بالخادم.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleClearFile = async () => {
    try {
      await fetch("/api/upload/clear", { method: "POST" });
    } catch {
      // silently ignore
    }
    setUploadedFile(null);
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2 rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-medium text-sm">{currentModel.label}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl">
              {MODELS.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => setSelectedModel(model.id)}
                  className="flex items-center justify-between gap-3 rounded-lg cursor-pointer"
                >
                  <div>
                    <p className="font-medium text-sm">{model.label}</p>
                    <p className="text-xs text-muted-foreground">{model.description}</p>
                  </div>
                  {selectedModel === model.id && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto relative">
        <div className="max-w-4xl mx-auto w-full h-full flex flex-col">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState />
            </div>
          ) : (
            <ChatMessageList
              messages={messages}
              isTyping={sendMessageMutation.isPending}
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
            onClearFile={handleClearFile}
            disabled={sendMessageMutation.isPending}
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
