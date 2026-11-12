// Runs the process-mining twin on the live integration DB. The analysis is cached until the number of workflow events changes.
import type { PlantPayEngine } from "./engine";
import { analyse, type ProcessAnalysis } from "./processMining";
import { allWorkflowEventsByInvoice } from "./workflowEvents";

const cache = new WeakMap<PlantPayEngine, { key: string; value: ProcessAnalysis }>();

export function processTwin(engine: PlantPayEngine): ProcessAnalysis {
  const k = engine.integration.prepare("SELECT COUNT(*) n, COALESCE(MAX(id), 0) m FROM workflow_events").get() as { n: number; m: number };
  const key = `${k.n}/${k.m}/${engine.today}`;
  const hit = cache.get(engine);
  if (hit?.key === key) return hit.value;
  const value = analyse(allWorkflowEventsByInvoice(engine.integration), `${engine.today}T18:00:00.000Z`);
  cache.set(engine, { key, value });
  return value;
}
