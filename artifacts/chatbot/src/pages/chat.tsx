import React, { useState, useRef, useEffect } from "react";
import { useSendMessage } from "@workspace/api-client-react";
import type { ChatMessage } from "@workspace/api-client-react/src/generated/api.schemas";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { EmptyState } from "@/components/chat/empty-state";
import { BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { toast } = useToast();
  
  const sendMessageMutation = useSendMessage();

  const handleSendMessage = (content: string) => {
    if (!content.trim()) return;

    const newMessage: ChatMessage = { role: "user", content };
    const newMessages = [...messages, newMessage];
    
    setMessages(newMessages);

    sendMessageMutation.mutate(
      { data: { messages: newMessages } },
      {
        onSuccess: (response) => {
          if (response?.message) {
            setMessages((prev) => [...prev, response.message]);
          }
        },
        onError: (error) => {
          toast({
            title: "Failed to send message",
            description: "There was an error communicating with the assistant. Please try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden">
      <header className="flex-none px-6 py-4 border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="h-10 w-10 bg-primary text-primary-foreground rounded-xl flex items-center justify-center shadow-sm">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-tight">Knowledge Assistant</h1>
            <p className="text-sm text-muted-foreground leading-tight">Ask questions based on your document</p>
          </div>
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
            disabled={sendMessageMutation.isPending} 
          />
          <p className="text-xs text-center text-muted-foreground mt-3">
            AI can make mistakes. Consider verifying important information.
          </p>
        </div>
      </div>
    </div>
  );
}
