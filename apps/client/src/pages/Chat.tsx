import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, isSubscriptionRequiredError, CHAT_DAILY_LIMIT, type ChatMessage } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

export function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaReached, setQuotaReached] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<ChatMessage[]>("/chat").then(({ data }) => setMessages(data));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setError(null);

    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);

    try {
      const { data } = await api.post<ChatMessage>("/chat", { content: optimistic.content });
      setMessages((prev) => [...prev, data]);
    } catch (err) {
      if (isSubscriptionRequiredError(err)) setQuotaReached(true);
      setError(apiErrorMessage(err, "Le coach n'a pas pu répondre."));
    } finally {
      setSending(false);
    }
  }

  const messagesToday = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return messages.filter((m) => m.role === "user" && new Date(m.createdAt) >= startOfDay).length;
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Discuter avec le coach</h1>
        {user && !user.isPremium && (
          <span className="text-xs text-zinc-500">
            {Math.max(0, CHAT_DAILY_LIMIT - messagesToday)}/{CHAT_DAILY_LIMIT} messages restants
          </span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
        {messages.length === 0 && (
          <p className="text-zinc-500">Posez une question à votre coach IA : ajustement de séance, conseils, motivation...</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`animate-fade-in-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user" ? "bg-rose-500 text-black" : "bg-zinc-900 text-zinc-100"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="animate-fade-in flex justify-start">
            <div className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          <p>{error}</p>
          {quotaReached && (
            <Link to="/abonnement" className="mt-1 inline-block font-semibold text-rose-300 hover:underline">
              Passer à Premium →
            </Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={quotaReached}
          placeholder={quotaReached ? "Quota quotidien atteint" : "Écrivez votre message..."}
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-rose-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || quotaReached}
          className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-black transition-all duration-150 hover:scale-[1.03] hover:bg-rose-400 active:scale-[0.97] disabled:opacity-50 disabled:hover:scale-100"
        >
          {sending ? "..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
