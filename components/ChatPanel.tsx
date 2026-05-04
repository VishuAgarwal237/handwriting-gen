"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Send, Sparkles } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Props = { latex: string };

const SUGGESTIONS = [
  "Walk me through problem 2 step by step.",
  "Which problem was hardest, and why?",
  "Quiz me on the concepts behind these problems.",
  "Summarize what I need to study for the exam."
];

export function ChatPanel({ latex }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const send = async (text: string) => {
    if (!text.trim() || streaming || !latex) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, latex })
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        setMessages([...next, { role: "assistant", content: `Error: ${err}` }]);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      setMessages([...next, { role: "assistant", content: "" }]);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages([...next, { role: "assistant", content: acc }]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stream error";
      setMessages((cur) => [...cur, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-4 pb-3 border-b border-border/60 flex items-center gap-2">
        <span className="size-2 rounded-full bg-emerald-400/80" />
        <div className="text-sm font-semibold text-foreground">Tutor chat</div>
        <Badge variant="outline" className="ml-1 normal-case tracking-normal">
          grounded on LaTeX
        </Badge>
      </div>

      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="px-5 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center pt-8 pb-2">
              <Sparkles className="size-5 mx-auto text-primary mb-2" />
              <div className="text-xs text-muted-foreground mb-3">Try asking…</div>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    className="rounded-full text-[11px] h-7"
                    onClick={() => send(s)}
                    disabled={!latex || streaming}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              {!latex && (
                <div className="mt-5 text-[11px] text-muted-foreground">
                  Generate the homework first to enable chat.
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                  m.role === "user"
                    ? "bg-primary/20 border border-primary/30 text-foreground"
                    : "glass text-foreground"
                )}
              >
                <article className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                  </ReactMarkdown>
                </article>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <form
        className="border-t border-border/60 p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={latex ? "Ask about your homework…" : "Generate the homework first"}
          disabled={!latex || streaming}
          className="flex-1"
        />
        <Button type="submit" disabled={!latex || streaming || !input.trim()}>
          <Send className="size-4" />
          Send
        </Button>
      </form>
    </div>
  );
}
