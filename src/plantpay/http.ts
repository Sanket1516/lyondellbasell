// REST facade helpers: authenticate (API key or a signed-in clerk/approver session), log every request into the audit trail,
// and turn failures into plain JSON errors. The facade itself lives in src/app/api/plantpay/v1/[...path]/route.ts.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { appendAudit, verifyApiKey } from "./integration";
import type { PlantPayEngine } from "./engine";

export interface Caller { ok: boolean; actor: string; role: string; via: "api_key" | "session" | "none" }

export async function authenticate(req: Request, engine: PlantPayEngine): Promise<Caller> {
  const key = req.headers.get("x-api-key");
  if (key) {
    const v = verifyApiKey(engine.integration, key);
    return v.ok ? { ok: true, actor: `api:${v.name}`, role: "integration", via: "api_key" } : { ok: false, actor: "api:invalid-key", role: "none", via: "none" };
  }
  const user = await getSessionUser();
  if (user && user.role !== "supplier") return { ok: true, actor: user.username, role: user.role, via: "session" };
  return { ok: false, actor: "anonymous", role: "none", via: "none" };
}

export function logRequest(engine: PlantPayEngine, caller: Caller, req: Request, status: number) {
  const u = new URL(req.url);
  appendAudit(engine.integration, { actor: caller.actor, role: caller.role, action: "api_request", detail: `${req.method} ${u.pathname}${u.search} -> ${status}${caller.via === "none" ? " (rejected)" : ""}` });
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
