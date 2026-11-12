"use client";
import { useRef, useState, useTransition } from "react";
import { Button, Panel } from "@/components/ui";
import type { ChatAnswer } from "@/lib/chatbot";
import { askPayment } from "./chat-actions";
import s from "./Chat.module.css";

const CHIPS = [
  { intent: "status", label: "Where is my payment?" },
  { intent: "why_held", label: "Why is it on hold?" },
  { intent: "needs", label: "What do you need from me?" },
  { intent: "due", label: "When will I be paid?" },
  { intent: "late", label: "Which invoices are late?" },
];

export function PaymentChat({ invoiceIds }: { invoiceIds: string[] }) {
  const [invoice, setInvoice] = useState("");
  const [text, setText] = useState("");
  const [log, setLog] = useState<ChatAnswer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  function ask(input: { intent?: string; text?: string }) {
    setError(null);
    start(async () => {
      const r = await askPayment({ ...input, invoiceId: invoice || undefined }).catch(() => ({ error: "That did not go through. Try again." }));
      if ("error" in r) setError(r.error);
      else setLog((l) => [...l, r]);
      setTimeout(() => end.current?.scrollIntoView({ block: "nearest" }), 0);
    });
  }

  return (
    <Panel title="Where is my payment?">
      <p className={s.source}>Answers come from your invoice records. Nothing here is generated, and it only reads your own invoices.</p>
      <div className={s.row}>
        <label className={s.pick}>Invoice
          <select value={invoice} onChange={(e) => setInvoice(e.target.value)}>
            <option value="">All my open invoices</option>
            {invoiceIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
      </div>
      <div className={s.chips} role="group" aria-label="Common questions">
        {CHIPS.map((c) => <button key={c.intent} type="button" className={s.chip} disabled={pending} onClick={() => ask({ intent: c.intent })}>{c.label}</button>)}
      </div>
      <div className={s.log} aria-live="polite">
        {log.length === 0 && <p className={s.empty}>Pick a question above, or type one below.</p>}
        {log.map((a, n) => (
          <div key={n} className={s.turn}>
            <p className={s.q}>{a.question}</p>
            <div className={s.a}>
              {a.lines.map((l, i) => <p key={i}>{l}</p>)}
              {a.basedOn.length > 0 && <p className={s.based}>Read from: {a.basedOn.join(", ")}</p>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {error && <p role="alert" className={s.err}>{error}</p>}
      <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (text.trim()) { ask({ text }); setText(""); } }}>
        <label className="sr-only" htmlFor="chat-q">Your question</label>
        <input id="chat-q" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="e.g. Why is INV-7781 on hold?" />
        <Button type="submit" disabled={pending || !text.trim()}>Ask</Button>
      </form>
    </Panel>
  );
}
