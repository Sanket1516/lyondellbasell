// "No empty screens": every step must carry real content before it is shown. Used by the page (a step that fails is replaced by its
// pre-computed copy) and by the headless test. Returns a list of problems; an empty list means the screen can be shown.
import type { JourneyData } from "./types";

const empty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
const BAD = /undefined|NaN|\[object|Traceback|\bat Object\.|ENOENT|SQLITE_/;

export function stepProblems(step: number, data: Pick<JourneyData, "steps">): string[] {
  const out: string[] = [];
  const need = (name: string, v: unknown) => { if (empty(v)) out.push(`step ${step}: ${name} is empty`); };
  const s = data?.steps as JourneyData["steps"] | undefined;
  const d = s?.[step as 1];
  if (!d) return [`step ${step}: no data`];
  switch (step) {
    case 1: { const x = s!["1"]; need("counts.total", x.counts?.total); need("sources", x.sources); need("story key", x.story); if (x.sources?.length !== 6) out.push("step 1: expected six sources"); break; }
    case 2: { const x = s!["2"]; need("invoice", x.invoice?.id); need("invoice lines", x.invoice?.lines); need("passport milestones", x.passport?.milestones); break; }
    case 3: { const x = s!["3"]; need("evidence", x.evidence); if (x.evidence?.length !== 6) out.push("step 3: expected evidence from six sources"); need("outage affected checks", x.outage?.affectedChecks); need("outage offline summary", x.outage?.offline?.summary); break; }
    case 4: { const x = s!["4"]; need("checks", x.checks); need("price trio", x.priceTrio); need("normalisation example", x.normalisations); need("quality example", x.qualityCase); need("contract headline", x.validation?.contract?.headline); need("inventory headline", x.validation?.inventory?.headline); break; }
    case 5: { const x = s!["5"]; need("resolutions", x.resolutions); need("rag answers", x.rag); need("tasks", x.tasks); need("fix steps", x.fix?.steps); need("fix events", x.fix?.events); if (x.rag?.some((r) => !r.grounded || !r.citations?.length)) out.push("step 5: an answer has no cited passage"); break; }
    case 6: { const x = s!["6"]; for (const k of ["duplicate", "splitting", "bank", "graph"] as const) { need(`${k} reasons`, x[k]?.reasons); if (x[k]?.label !== "warning, not proof") out.push(`step 6: ${k} is not labelled "warning, not proof"`); } need("splitting invoices", x.splitting?.invoices); need("graph edges", x.graph?.edges); need("bank verification task", x.bank?.task); break; }
    case 7: { const x = s!["7"]; need("suppliers", x.suppliers); if (x.suppliers?.length !== 3) out.push("step 7: expected three suppliers"); if (x.predictions?.length !== 4) out.push("step 7: expected four predictions"); need("factors", x.predictions?.[0]?.factors); need("priority", x.priority?.explanation); break; }
    case 8: { const x = s!["8"]; need("actual path", x.actual); need("stations", x.stations); need("bottlenecks", x.bottlenecks); if (x.actual && x.actual.loops.length === 0) out.push("step 8: the hero invoice shows no rework loop"); break; }
    case 9: { const x = s!["9"]; need("tamper rows", x.tamper); need("passport", x.passport?.milestones); need("checklist", x.checklist); if (x.checklist?.some((c) => empty(c.evidence))) out.push("step 9: a checklist row has no evidence"); if (!x.readyForPayment) out.push("step 9: the passport does not show ready for payment"); break; }
  }
  if (BAD.test(JSON.stringify(d))) out.push(`step ${step}: contains a raw error or placeholder (${BAD.exec(JSON.stringify(d))![0]})`);
  return out;
}

export const journeyProblems = (data: Pick<JourneyData, "steps">): string[] => Array.from({ length: 9 }, (_, i) => stepProblems(i + 1, data)).flat();
