"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { routeEvent } from "@/lib/dispatch";
import { readSseStream } from "@/lib/sse";
import type { StreamEvent, TimelineItem } from "@/lib/types";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

const SUGGESTIONS = [
  "Qual o clima em São Paulo?",
  "Como está o tempo no Recife?",
  "Vai chover no Rio de Janeiro?",
];

type Phase = "idle" | "thinking" | "tool" | "writing";

function newId() {
  return crypto.randomUUID();
}

function prettyJson(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function parseWeather(content: string) {
  try {
    const data = JSON.parse(content) as {
      city?: string;
      temp_c?: number;
      condition?: string;
    };
    return {
      city: data.city ?? "",
      temp_c: data.temp_c,
      condition: data.condition ?? "",
    };
  } catch {
    return null;
  }
}

function cityFromArgs(args: Record<string, unknown>) {
  const city = args.city;
  return typeof city === "string" ? city : "";
}

export function Chat() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const draftId = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const runId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, phase]);

  function renderChat(payload: StreamEvent) {
    if (payload.event === "on_chat_model_start") {
      setPhase((current) => (current === "tool" ? "writing" : "thinking"));
      return;
    }

    if (payload.event === "on_chat_model_stream") {
      const token = payload.data?.chunk?.content ?? "";
      if (!token) return;

      setPhase("writing");

      if (!draftId.current) {
        const id = newId();
        draftId.current = id;
        setItems((prev) => [
          ...prev,
          { id, kind: "assistant", text: token, streaming: true },
        ]);
        return;
      }

      const id = draftId.current;
      setItems((prev) =>
        prev.map((item) =>
          item.id === id && item.kind === "assistant"
            ? { ...item, text: item.text + token }
            : item,
        ),
      );
      return;
    }

    if (payload.event === "on_chat_model_end") {
      const output = payload.data?.output;
      const calls = output?.tool_calls ?? [];
      const content = output?.content ?? "";

      if (calls.length) {
        setPhase("tool");
        setItems((prev) => [
          ...prev,
          ...calls
            .filter((call) => call.name)
            .map((call) => ({
              id: newId(),
              kind: "tool_call" as const,
              name: call.name as string,
              args: call.args ?? {},
              status: "running" as const,
            })),
        ]);
      }

      if (content) {
        const id = draftId.current;
        if (id) {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id && item.kind === "assistant"
                ? { ...item, text: content, streaming: false }
                : item,
            ),
          );
        } else {
          setItems((prev) => [
            ...prev,
            { id: newId(), kind: "assistant", text: content, streaming: false },
          ]);
        }
      }

      draftId.current = null;
    }
  }

  function renderTool(payload: StreamEvent) {
    if (payload.event === "on_tool_start") {
      setPhase("tool");
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "tool_call" && item.name === payload.name
            ? { ...item, status: "running" }
            : item,
        ),
      );
      return;
    }

    if (payload.event === "on_tool_end") {
      const content =
        payload.data?.output?.content ??
        JSON.stringify(payload.data?.output ?? {}, null, 2);

      setItems((prev) => [
        ...prev.map((item) =>
          item.kind === "tool_call" && item.name === payload.name
            ? { ...item, status: "done" as const }
            : item,
        ),
        {
          id: newId(),
          kind: "tool_result" as const,
          name: payload.name ?? "tool",
          content,
        },
      ]);
      setPhase("writing");
    }
  }

  function dispatch(payload: StreamEvent) {
    const renderer = routeEvent(payload);
    if (renderer === "chat") renderChat(payload);
    else renderTool(payload);
  }

  function newChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    runId.current += 1;
    draftId.current = null;
    setItems([]);
    setInput("");
    setBusy(false);
    setPhase("idle");
  }

  async function send(message: string) {
    if (!message || busy) return;

    const thisRun = ++runId.current;
    const controller = new AbortController();
    abortRef.current = controller;

    setInput("");
    setBusy(true);
    setPhase("thinking");
    draftId.current = null;
    setItems((prev) => [...prev, { id: newId(), kind: "user", text: message }]);

    try {
      const res = await fetch(`${API_URL}/agent/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      await readSseStream(res.body, (payload) => {
        if (thisRun !== runId.current) return;
        dispatch(payload);
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (thisRun !== runId.current) return;
      const text =
        err instanceof Error ? err.message : "Falha ao falar com o agent";
      setItems((prev) => [...prev, { id: newId(), kind: "error", text }]);
    } finally {
      if (thisRun !== runId.current) return;
      setBusy(false);
      setPhase("idle");
      draftId.current = null;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(input.trim());
  }

  const lastTool = [...items].reverse().find((item) => item.kind === "tool_call");
  const lastCity =
    lastTool && lastTool.kind === "tool_call"
      ? cityFromArgs(lastTool.args)
      : "";

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.12),_transparent_70%)]" />

      <header className="sticky top-0 z-10 w-full border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
        <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
              <CloudIcon />
            </span>
            <div>
              <p className="text-sm font-medium tracking-tight">Agent clima</p>
              <p className="text-[11px] text-zinc-500">Previsão na hora</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge busy={busy} phase={phase} />
            <button
              type="button"
              onClick={newChat}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-zinc-300 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-100"
            >
              <PlusIcon />
              Novo chat
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-4">
        <div className="flex flex-1 flex-col gap-3 py-6">
          {items.length === 0 && (
            <EmptyState onPick={(text) => void send(text)} />
          )}
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
          {busy &&
            !items.some((item) => item.kind === "assistant" && item.streaming) && (
              <LiveStatus phase={phase} city={lastCity} />
            )}
          <div ref={bottomRef} />
        </div>
      </main>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 border-t border-white/5 bg-zinc-950/90 backdrop-blur-md"
      >
        <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Qual o clima em São Paulo?"
            disabled={busy}
            className="h-11 flex-1 rounded-xl border border-white/10 bg-zinc-900 px-3.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-11 rounded-xl bg-sky-500 px-4 text-sm font-medium text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ busy, phase }: { busy: boolean; phase: Phase }) {
  if (!busy) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
        pronto
      </span>
    );
  }

  const label =
    phase === "tool"
      ? "consultando"
      : phase === "writing"
        ? "respondendo"
        : "pensando";

  return (
    <span className="flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
      {label}
    </span>
  );
}

function LiveStatus({ phase, city }: { phase: Phase; city: string }) {
  const label =
    phase === "tool"
      ? city
        ? `Consultando o clima em ${city}…`
        : "Consultando o clima…"
      : phase === "writing"
        ? "Escrevendo a resposta…"
        : "Pensando na melhor forma de responder…";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
      <Spinner />
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        <ProgressDots phase={phase} />
      </div>
    </div>
  );
}

function ProgressDots({ phase }: { phase: Phase }) {
  const steps = [
    { key: "thinking", label: "Entender" },
    { key: "tool", label: "Clima" },
    { key: "writing", label: "Responder" },
  ] as const;

  const order: Phase[] = ["thinking", "tool", "writing"];
  const current = Math.max(0, order.indexOf(phase));

  return (
    <p className="mt-1 flex gap-2 text-[11px] text-zinc-500">
      {steps.map((step, index) => (
        <span
          key={step.key}
          className={index <= current ? "text-sky-400" : "text-zinc-600"}
        >
          {step.label}
          {index < steps.length - 1 ? " ·" : ""}
        </span>
      ))}
    </p>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-300">
        <CloudIcon className="h-6 w-6" />
      </span>
      <div>
        <p className="text-base font-medium text-zinc-200">
          Como está o tempo aí?
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Pergunte por uma cidade e acompanhe a consulta ao vivo.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-200"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function ItemCard({ item }: { item: TimelineItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-sky-500 px-3.5 py-2 text-sm text-zinc-950">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === "tool_call") {
    const city = cityFromArgs(item.args);
    const running = item.status === "running";

    return (
      <article className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              running
                ? "bg-sky-500/15 text-sky-300"
                : "bg-emerald-500/15 text-emerald-300"
            }`}
          >
            {running ? <Spinner /> : <CheckIcon />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-100">
              {running
                ? city
                  ? `Consultando o clima em ${city}…`
                  : "Consultando o clima…"
                : city
                  ? `Clima consultado em ${city}`
                  : "Consulta concluída"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {running ? "Isso leva alguns segundos." : "Dados recebidos."}
            </p>
            <TechDetails
              title="Detalhes da chamada"
              body={prettyJson({ name: item.name, args: item.args })}
            />
          </div>
        </div>
      </article>
    );
  }

  if (item.kind === "tool_result") {
    const weather = parseWeather(item.content);

    return (
      <article className="overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/15 via-zinc-900 to-zinc-900">
        {weather?.temp_c != null ? (
          <div className="flex items-center gap-4 px-4 py-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-400/15 text-sky-200">
              <CloudIcon className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-sky-300/80">
                {weather.city || "Agora"}
              </p>
              <p className="text-4xl font-semibold tracking-tight text-white">
                {weather.temp_c}°
                <span className="ml-1 text-lg font-normal text-sky-200/80">
                  C
                </span>
              </p>
              <p className="text-sm capitalize text-zinc-300">
                {weather.condition}
              </p>
            </div>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-zinc-300">{item.content}</p>
        )}
        <div className="border-t border-white/5 px-4 py-2">
          <TechDetails title="JSON da tool" body={prettyJson(item.content)} />
        </div>
      </article>
    );
  }

  if (item.kind === "error") {
    return (
      <article className="rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2 text-sm text-red-300">
        {item.text}
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
      <p className="text-sm leading-6 text-zinc-200">
        {item.text}
        {item.streaming && (
          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-sky-400" />
        )}
      </p>
    </article>
  );
}

function TechDetails({ title, body }: { title: string; body: string }) {
  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-zinc-500 select-none hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
        <ChevronIcon />
        {title}
      </summary>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-2.5 font-mono text-[11px] leading-5 text-zinc-400">
        {body}
      </pre>
    </details>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l4 4 10-10" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 transition group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CloudIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.2A3.5 3.5 0 0 0 7 18Z"
      />
    </svg>
  );
}
