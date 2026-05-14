import React, { useState, useRef } from "react";
import { SendHorizontal, Paperclip, X, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  onUpload?: (file: File) => Promise<void>;
  uploadedFile?: string | null;
  onClearFile?: () => void;
  disabled?: boolean;
  uploading?: boolean;
}

export function ChatInput({
  onSend,
  onUpload,
  uploadedFile,
  onClearFile,
  disabled,
  uploading,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input);
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;
    e.target.value = "";
    await onUpload(file);
  };

  return (
    <div className="space-y-2">
      {uploadedFile && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/8 border border-primary/20 rounded-xl text-sm">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="text-foreground truncate flex-1">{uploadedFile}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-foreground shrink-0"
            onClick={onClearFile}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="relative flex items-end bg-card border border-border rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all overflow-hidden p-2 pl-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all self-end mb-0.5",
            uploading && "text-primary"
          )}
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
          title="Upload PDF"
        >
          {uploading ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          ) : (
            <Paperclip className="h-4.5 w-4.5" />
          )}
        </Button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message the assistant..."
          disabled={disabled || uploading}
          className="w-full max-h-[200px] min-h-[44px] bg-transparent text-foreground placeholder:text-muted-foreground resize-none focus:outline-none py-3 px-2 scrollbar-thin text-[0.95rem] leading-relaxed"
          rows={1}
        />

        <div className="shrink-0 mb-1 ml-1">
          <Button
            size="icon"
            className={cn(
              "h-10 w-10 rounded-xl transition-all duration-200",
              input.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105"
                : "bg-secondary text-muted-foreground"
            )}
            disabled={!input.trim() || disabled || uploading}
            onClick={handleSubmit}
          >
            <SendHorizontal className="h-5 w-5" />
            <span className="sr-only">Send message</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
