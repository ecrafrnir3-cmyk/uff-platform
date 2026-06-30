"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED = [
  "Who should I start this week?",
  "What are the current standings?",
  "Analyze recent transactions",
  "How are the faction standings looking?",
  "What's my team's record?",
];

export default function ChatInterface({ leagueId, teamName }: { leagueId: string; teamName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);

    // Placeholder assistant message
    const assistantPlaceholder: Message = { role: "assistant", content: "" };
    setMessages(prev => [...prev, assistantPlaceholder]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId, messages: nextMessages }),
      });

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "Sorry, I hit an error. Try again." };
          return updated;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.delta?.text ?? parsed?.delta?.content ?? "";
            if (delta) {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: updated[updated.length - 1].content + delta,
                };
                return updated;
              });
            }
          } catch {
            // Ignore parse errors on partial chunks
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: "Connection error. Please try again." };
        return updated;
      });
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [messages, leagueId, streaming]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 120px)", maxHeight: "800px" }}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 px-1 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-6 py-12">
            <div className="text-center">
              <p className="text-3xl mb-2">🔭</p>
              <p className="font-semibold text-lg" style={{ color: "#FFD700" }}>League Assistant</p>
              <p className="text-sm mt-1" style={{ color: "#8888aa" }}>
                I know your league inside and out — standings, matchups, transactions, rules.
              </p>
              <p className="text-xs mt-0.5" style={{ color: "#6b6b8a" }}>
                Chatting as <strong style={{ color: "#d4d4e8" }}>{teamName}</strong>
              </p>
            </div>

            {/* Suggested prompts */}
            <div className="flex flex-col gap-2 w-full max-w-md">
              {SUGGESTED.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={streaming}
                  className="text-left rounded-lg px-4 py-2.5 text-sm transition-opacity hover:opacity-80"
                  style={{ background: "#13132b", border: "1px solid #2a2a40", color: "#d4d4e8" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
              style={
                m.role === "user"
                  ? { background: "#0057FF", color: "#fff", borderBottomRightRadius: "4px" }
                  : { background: "#13132b", border: "1px solid #2a2a40", color: "#f4f4f8", borderBottomLeftRadius: "4px" }
              }
            >
              {m.content || (
                <span className="animate-pulse" style={{ color: "#6b6b8a" }}>Thinking…</span>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="shrink-0 flex items-end gap-2 p-3 rounded-xl mt-2"
        style={{ background: "#13132b", border: "1px solid #2a2a40" }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about standings, trades, start/sit, rules…"
          rows={1}
          disabled={streaming}
          className="flex-1 resize-none text-sm bg-transparent outline-none"
          style={{
            color: "#f4f4f8",
            minHeight: "24px",
            maxHeight: "120px",
            overflow: "auto",
          }}
          onInput={e => {
            const t = e.currentTarget;
            t.style.height = "auto";
            t.style.height = Math.min(t.scrollHeight, 120) + "px";
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || streaming}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "#0057FF", color: "#fff" }}
        >
          {streaming ? "…" : "↑"}
        </button>
      </div>
      <p className="text-center text-xs mt-1.5" style={{ color: "#4a4a6a" }}>
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
