import React, { useState, useRef, useEffect } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    
    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
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

  return (
    <div className="relative flex items-end bg-card border border-border rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-all overflow-hidden p-2 pl-4">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Message the assistant..."
        disabled={disabled}
        className="w-full max-h-[200px] min-h-[44px] bg-transparent text-foreground placeholder:text-muted-foreground resize-none focus:outline-none py-3 pr-2 scrollbar-thin text-[0.95rem] leading-relaxed"
        rows={1}
      />
      
      <div className="shrink-0 mb-1 ml-2">
        <Button 
          size="icon" 
          className={cn(
            "h-10 w-10 rounded-xl transition-all duration-200",
            input.trim() ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105" : "bg-secondary text-muted-foreground"
          )}
          disabled={!input.trim() || disabled}
          onClick={handleSubmit}
        >
          <SendHorizontal className="h-5 w-5" />
          <span className="sr-only">Send message</span>
        </Button>
      </div>
    </div>
  );
}
