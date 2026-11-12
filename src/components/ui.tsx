"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import s from "./ui.module.css";

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(" ");

export function Button({ variant = "default", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "quiet" }) {
  return <button {...p} className={cx(s.btn, variant === "primary" && s.btnPrimary, variant === "quiet" && s.btnQuiet, className)} />;
}

export function Input({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>{label}</label>
      <input id={id} className={s.input} {...p} />
    </div>
  );
}

export function Select({ label, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>{label}</label>
      <select id={id} className={s.input} {...p}>{children}</select>
    </div>
  );
}

export interface Column<T> { header: string; render: (row: T) => ReactNode; numeric?: boolean }

export function Table<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>{columns.map((c) => <th key={c.header} className={c.numeric ? s.right : undefined}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.header} className={c.numeric ? cx(s.right, "mono") : undefined}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type ChipKind = "approve" | "flag" | "block" | "pending" | "paid";
const CHIP_LABEL: Record<ChipKind, string> = { approve: "Approve", flag: "Flag", block: "Block", pending: "Pending", paid: "Paid" };

/** Colour, shape and text all carry the status, so it never depends on colour alone. */
export function StatusChip({ kind, label }: { kind: ChipKind; label?: string }) {
  return <span className={cx(s.chip, s[kind])}>{label ?? CHIP_LABEL[kind]}</span>;
}

export function Badge({ days }: { days: number }) {
  return <span className={s.badge}>{days}d</span>;
}

export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.panel}>
      {title && (
        <header className={s.panelHead}>
          <h2>{title}</h2>
          {action}
        </header>
      )}
      <div className={s.panelBody}>{children}</div>
    </section>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className={s.tabs} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={cx(s.tab, t.id === value && s.tabActive)} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={s.backdrop} onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={s.modal} onClick={(e) => e.stopPropagation()}>
        <header className={s.panelHead}><h2>{title}</h2></header>
        <div className={s.panelBody}>{children}</div>
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className={s.toast} role="status">{msg}</div> : null;
  return { show: setMsg, node };
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function SplitView({ left, right }: { left: ReactNode; right: ReactNode }) {
  return <div className={s.split}><div>{left}</div><div>{right}</div></div>;
}

export function Timeline({ items }: { items: { when: string; title: string; detail?: string }[] }) {
  return (
    <ol className={s.timeline}>
      {items.map((i, n) => (
        <li key={n} className={s.timelineItem}>
          <div className={s.timelineWhen}>{i.when}</div>
          <div>{i.title}</div>
          {i.detail && <div style={{ color: "var(--ink-soft)" }}>{i.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
