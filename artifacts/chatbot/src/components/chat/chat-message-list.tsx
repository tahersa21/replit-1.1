import React, { useRef, useEffect } from "react";
import type { ChatMessage as ChatMessageType } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { User, Sparkles } from "lucide-react";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isTyping: boolean;
}

export function ChatMessageList({ messages, isTyping }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div className="flex-1 px-4 py-8 space-y-6 md:px-8">
      {messages.map((message, index) => (
        <ChatMessage key={index} message={message} />
      ))}
      
      {isTyping && (
        <div className="flex items-start gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="bg-card border border-border/50 text-card-foreground rounded-2xl rounded-tl-sm px-5 py-4 shadow-sm shadow-black/5">
            <div className="flex gap-1 items-center h-5">
              <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-type"></div>
              <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-type"></div>
              <div className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-type"></div>
            </div>
          </div>
        </div>
      )}
      
      <div ref={bottomRef} className="h-4" />
    </div>
  );
}

function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === "user";

  return (
    <div 
      className={cn(
        "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div className={cn("flex max-w-[85%] gap-4", isUser ? "flex-row-reverse" : "flex-row")}>
        <div 
          className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-1",
            isUser 
              ? "bg-secondary text-secondary-foreground" 
              : "bg-primary/10 text-primary border border-primary/20"
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </div>
        
        <div 
          className={cn(
            "px-5 py-3.5 shadow-sm text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap",
            isUser 
              ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-primary/10" 
              : "bg-card border border-border/50 text-card-foreground rounded-2xl rounded-tl-sm shadow-black/5"
          )}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
