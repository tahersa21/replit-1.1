import React from "react";
import { BookOpen } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="h-16 w-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center ring-8 ring-primary/5 mb-2">
        <BookOpen className="h-8 w-8" />
      </div>
      
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">How can I help you today?</h2>
        <p className="text-muted-foreground">
          I'm ready to answer your questions based on the provided knowledge document. 
          Feel free to ask for summaries, specific details, or explanations.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full mt-4">
        <div className="p-4 bg-card border border-border/50 rounded-xl text-sm text-left shadow-sm">
          <p className="font-medium text-foreground mb-1">Summarize the document</p>
          <p className="text-muted-foreground text-xs">Get a quick overview of the key points.</p>
        </div>
        <div className="p-4 bg-card border border-border/50 rounded-xl text-sm text-left shadow-sm">
          <p className="font-medium text-foreground mb-1">Find specific details</p>
          <p className="text-muted-foreground text-xs">Ask a direct question to locate facts.</p>
        </div>
      </div>
    </div>
  );
}
