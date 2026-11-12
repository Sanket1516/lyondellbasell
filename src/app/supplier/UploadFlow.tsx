"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Panel, Select, SplitView, useToast } from "@/components/ui";
import { DocumentViewer } from "@/components/DocumentViewer";
import { fmtDate, fmtInr } from "@/lib/format";
import { parseDate, parseNumber } from "@/lib/extract/parse";
import type { BBox, Confidence, ExtractedInvoice, Field } from "@/lib/extract/types";
import { submitInvoice } from "./actions";
import s from "./Upload.module.css";

interface Demo { file: string; label: string }
interface LineVals { itemCode: string; description: string; qty: string; unit: string; unitPrice: string; amount: string }
interface Vals {
  vendorName: string; vendorGstin: string; invoiceNumber: string; invoiceDate: string; poNumber: string;
  lines: LineVals[]; subtotal: string; taxRatePct: string; taxAmount: string; total: string;
}

const money = (n: number | null) => (n === null ? "" : fmtInr(n, 2));
const plain = (n: number | null) => (n === null ? "" : String(n));
const str = (f: Field<string>) => f.value ?? "";

function toVals(x: ExtractedInvoice): Vals {
  return {
    vendorName: str(x.vendorName), vendorGstin: str(x.vendorGstin), invoiceNumber: str(x.invoiceNumber),
    invoiceDate: x.invoiceDate.value ? fmtDate(x.invoiceDate.value) : "", poNumber: str(x.poNumber),
    lines: x.lines.map((l) => ({ itemCode: str(l.itemCode), description: str(l.description), qty: plain(l.qty.value), unit: str(l.unit), unitPrice: money(l.unitPrice.value), amount: money(l.amount.value) })),
    subtotal: money(x.subtotal.value), taxRatePct: plain(x.taxRatePct.value), taxAmount: money(x.taxAmount.value), total: money(x.total.value),
  };
}

const CONF_LABEL: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Check" };

function ConfChip({ c, edited }: { c: Confidence; edited?: boolean }) {
  if (edited) return <span className={`${s.conf} ${s.confEdited}`}>Edited</span>;
  return <span className={`${s.conf} ${s[`conf_${c}`]}`}>{CONF_LABEL[c]}</span>;
}

type Stage = { t: "idle" } | { t: "busy"; label: string } | { t: "review"; source: string; ex: ExtractedInvoice } | { t: "done"; invoiceId: string };

export function UploadFlow({ demos }: { demos: Demo[] }) {
  const router = useRouter();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>({ t: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [vals, setVals] = useState<Vals | null>(null);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [demo, setDemo] = useState("");
  const [over, setOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(form: FormData, label: string) {
    setError(null);
    setStage({ t: "busy", label });
    try {
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        setError(data?.error ?? "The file could not be read. Please try again.");
        setStage({ t: "idle" });
        return;
      }
      setVals(toVals(data.extraction));
      setEdited(new Set());
      setActive(null);
      setStage({ t: "review", source: data.source, ex: data.extraction });
    } catch {
      setError("The server could not be reached. Check that the app is running and try again.");
      setStage({ t: "idle" });
    }
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    void run(form, file.name);
  }

  function useDemo() {
    if (!demo) return;
    const form = new FormData();
    form.set("demo", demo);
    void run(form, demo);
  }

  function reset() {
    setStage({ t: "idle" });
    setVals(null);
    setError(null);
    setDemo("");
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---------------------------------------------------------------- idle / busy / done
  if (stage.t === "idle" || stage.t === "busy") {
    const busy = stage.t === "busy";
    return (
      <Panel title="Upload invoice">
        <div className={s.uploadGrid}>
          <div
            className={`${s.drop} ${over ? s.dropOver : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) pickFile(e.dataTransfer.files[0]); }}
          >
            <p className={s.dropTitle}>{busy ? `Reading ${stage.label}…` : "Drop a PDF or image of an invoice here"}</p>
            <p className={s.dropHint}>{busy ? "This takes a few seconds for a scanned image." : "PDF, JPG or PNG, up to 10 MB."}</p>
            <input ref={fileRef} id="invoice-file" type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={busy} onChange={(e) => pickFile(e.target.files?.[0])} />
            <label htmlFor="invoice-file" className={`${s.browse} ${busy ? s.browseOff : ""}`}>Choose a file</label>
          </div>
          <div className={s.demoBox}>
            <Select label="Use a demo document" value={demo} onChange={(e) => setDemo(e.target.value)} disabled={busy}>
              <option value="">Select a document…</option>
              {demos.map((d) => <option key={d.file} value={d.file}>{d.label}</option>)}
            </Select>
            <Button variant="primary" onClick={useDemo} disabled={busy || !demo}>Read this document</Button>
            <p className={s.demoNote}>Demo mode: any of these documents can be submitted from this login. The invoice is recorded under the vendor printed on it.</p>
          </div>
        </div>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {toast.node}
      </Panel>
    );
  }

  if (stage.t === "done") {
    return (
      <Panel title="Invoice submitted">
        <p className={s.doneText}>Invoice <span className="mono">{stage.invoiceId}</span> is submitted. Its status is now shown in the list below.</p>
        <div className={s.actions}><Button variant="primary" onClick={reset}>Upload another invoice</Button></div>
        {toast.node}
      </Panel>
    );
  }

  // ---------------------------------------------------------------- review
  const { ex, source } = stage;
  const v = vals!;
  const set = (key: string, apply: (x: Vals) => Vals) => {
    setVals((cur) => (cur ? apply(cur) : cur));
    setEdited((cur) => new Set(cur).add(key));
  };
  const bboxOf = (key: string): BBox | null => {
    const m = key.match(/^line(\d+)\.(\w+)$/);
    if (m) return (ex.lines[Number(m[1]) - 1] as unknown as Record<string, Field<unknown>> | undefined)?.[m[2]]?.bbox ?? null;
    return ((ex as unknown as Record<string, Field<unknown>>)[key])?.bbox ?? null;
  };
  const highlight = active ? bboxOf(active) : null;
  const confOf = (key: string): Confidence => {
    const m = key.match(/^line(\d+)\.(\w+)$/);
    if (m) return ((ex.lines[Number(m[1]) - 1] as unknown as Record<string, Field<unknown>> | undefined)?.[m[2]]?.confidence) ?? "low";
    return ((ex as unknown as Record<string, Field<unknown>>)[key])?.confidence ?? "low";
  };

  const head = (key: "vendorName" | "vendorGstin" | "invoiceNumber" | "invoiceDate" | "poNumber" | "subtotal" | "taxRatePct" | "taxAmount" | "total", label: string, mono = false, hint?: string) => (
    <div className={`${s.row} ${active === key ? s.rowActive : ""}`}>
      <label htmlFor={`f-${key}`} className={s.rowLabel}>{label}</label>
      <input
        id={`f-${key}`}
        className={`${s.input} ${mono ? "mono" : ""} ${confOf(key) === "low" && !edited.has(key) ? s.inputCheck : ""}`}
        value={v[key]}
        onFocus={() => setActive(key)}
        onChange={(e) => set(key, (x) => ({ ...x, [key]: e.target.value }))}
        placeholder={hint}
        inputMode={mono ? "decimal" : undefined}
      />
      <ConfChip c={confOf(key)} edited={edited.has(key)} />
    </div>
  );

  const rowConf = (i: number): Confidence => {
    const cs = (["description", "qty", "unit", "unitPrice", "amount"] as const).map((k) => confOf(`line${i + 1}.${k}`));
    return cs.includes("low") ? "low" : cs.includes("medium") ? "medium" : "high";
  };
  const rowEdited = (i: number) => [...edited].some((k) => k.startsWith(`line${i + 1}.`));
  const cell = (i: number, k: keyof LineVals, label: string, num = false) => (
    <div className={s.lf}>
      <label htmlFor={`l${i + 1}-${k}`} className={s.lfLabel}>{label}</label>
      <input
        id={`l${i + 1}-${k}`}
        className={`${s.cell} ${num ? `${s.cellNum} mono` : ""} ${active === `line${i + 1}.${k}` ? s.cellActive : ""}`}
        value={v.lines[i][k]}
        onFocus={() => setActive(`line${i + 1}.${k}`)}
        onChange={(e) => set(`line${i + 1}.${k}`, (x) => ({ ...x, lines: x.lines.map((l, n) => (n === i ? { ...l, [k]: e.target.value } : l)) }))}
      />
    </div>
  );

  async function submit() {
    setError(null);
    const iso = parseDate(v.invoiceDate);
    if (!iso) return setError("Enter the invoice date as DD-MMM-YYYY, for example 10-Nov-2026.");
    const need = (label: string, t: string): number | null => {
      const n = parseNumber(t);
      if (n === null) { setError(`${label} must be a number.`); return null; }
      return n;
    };
    const lines = [];
    for (const [i, l] of v.lines.entries()) {
      const qty = need(`Line ${i + 1} quantity`, l.qty), unitPrice = need(`Line ${i + 1} rate`, l.unitPrice), amount = need(`Line ${i + 1} amount`, l.amount);
      if (qty === null || unitPrice === null || amount === null) return;
      lines.push({ itemCode: l.itemCode || undefined, description: l.description, qty, unit: l.unit, unitPrice, amount });
    }
    const subtotal = need("Subtotal", v.subtotal), taxRatePct = need("Tax rate", v.taxRatePct), taxAmount = need("Tax amount", v.taxAmount), total = need("Total", v.total);
    if (subtotal === null || taxRatePct === null || taxAmount === null || total === null) return;
    setSubmitting(true);
    const res = await submitInvoice({
      source, vendorName: v.vendorName, vendorGstin: v.vendorGstin, invoiceNumber: v.invoiceNumber, invoiceDate: iso, poNumber: v.poNumber,
      lines, subtotal, taxRatePct, taxAmount, total,
    }).catch(() => ({ ok: false as const, error: "The invoice could not be submitted. Please try again." }));
    setSubmitting(false);
    if (!res.ok) return setError(res.error);
    toast.show(`Invoice ${res.invoiceId} submitted`);
    setStage({ t: "done", invoiceId: res.invoiceId });
    router.refresh();
  }

  const failed = ex.checks.filter((c) => !c.ok);
  const checkCount = v.lines.filter((_, i) => rowConf(i) === "low").length + [ex.vendorName, ex.vendorGstin, ex.invoiceNumber, ex.invoiceDate, ex.poNumber, ex.subtotal, ex.taxRatePct, ex.taxAmount, ex.total].filter((f) => f.confidence === "low").length;

  return (
    <div>
      <div className={s.reviewHead}>
        <div>
          <h2>Check the extracted fields</h2>
          <p className={s.sub}>{ex.fileName}{ex.elapsedMs !== undefined ? ` · read in ${(ex.elapsedMs / 1000).toFixed(1)} s` : ""}. Click a field to see where it came from on the document.</p>
        </div>
        <Button variant="quiet" onClick={reset}>Start over</Button>
      </div>
      {ex.notes.map((n) => (
        <p key={n} className={`${s.note} ${ex.fixture ? s.noteFixture : ""}`} role="note">{n}</p>
      ))}
      <SplitView
        left={<DocumentViewer src={source} kind={ex.kind} pages={ex.pages} highlight={highlight} />}
        right={
          <div className={s.form}>
            <Panel title="Invoice details">
              {head("vendorName", "Vendor")}
              {head("vendorGstin", "Vendor GSTIN", true)}
              {head("invoiceNumber", "Invoice number", true)}
              {head("invoiceDate", "Invoice date", true, "DD-MMM-YYYY")}
              {head("poNumber", "PO number", true)}
            </Panel>
            <Panel title="Line items">
              {v.lines.map((_, i) => (
                <fieldset key={i} className={s.lineBlock}>
                  <legend className={s.lineLegend}>Line {i + 1}</legend>
                  <div className={s.lineTop}>
                    <div className={s.lineCode}>{cell(i, "itemCode", "Item code")}</div>
                    <div className={s.lineDesc}>{cell(i, "description", "Description")}</div>
                    <ConfChip c={rowConf(i)} edited={rowEdited(i)} />
                  </div>
                  <div className={s.lineNums}>
                    {cell(i, "qty", "Quantity", true)}
                    {cell(i, "unit", "Unit")}
                    {cell(i, "unitPrice", "Rate", true)}
                    {cell(i, "amount", "Amount", true)}
                  </div>
                </fieldset>
              ))}
              {v.lines.length === 0 && <p className={s.error}>No line items were found on this document.</p>}
            </Panel>
            <Panel title="Totals">
              {head("subtotal", "Subtotal", true)}
              {head("taxRatePct", "GST rate (%)", true)}
              {head("taxAmount", "GST amount", true)}
              {head("total", "Invoice total", true)}
            </Panel>
            <Panel title={failed.length ? `Checks: ${failed.length} failed` : "Checks: all passed"}>
              <ul className={s.checks}>
                {ex.checks.map((c) => (
                  <li key={c.id} className={c.ok ? "" : s.checkFail}>
                    <span className={s.checkMark}>{c.ok ? "Passed" : "Failed"}</span> {c.label}
                    {!c.ok && <span className={s.checkDetail}> {c.detail}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
            {error && <p role="alert" className={s.error}>{error}</p>}
            <div className={s.actions}>
              <Button variant="primary" onClick={submit} disabled={submitting}>{submitting ? "Submitting…" : "Confirm and submit invoice"}</Button>
              {checkCount > 0 && <span className={s.sub}>{checkCount} field{checkCount === 1 ? "" : "s"} marked Check</span>}
            </div>
          </div>
        }
      />
      {toast.node}
    </div>
  );
}
