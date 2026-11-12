import { authenticate, json, logRequest } from "@/plantpay/http";
import { buildJourney } from "@/plantpay/journey/build";
import { plantpay } from "@/plantpay/runtime";

export const dynamic = "force-dynamic";

/**
 * Golden Journey data: all nine screens, built on a throw-away sandbox copy of the demo data (the live data is never changed).
 * `GET /api/plantpay/journey` is also the "Reset journey" call: every call starts from the exact same state.
 * Add `?fail=1` to force an error, which the page answers by switching to its pre-computed fallback (used for rehearsal and tests).
 */
export async function GET(req: Request) {
  const engine = plantpay();
  const caller = await authenticate(req, engine);
  if (!caller.ok) { logRequest(engine, caller, req, 401); return json({ error: "Sign in as an AP clerk or approver to run the journey." }, 401); }
  try {
    if (new URL(req.url).searchParams.get("fail") === "1") throw new Error("Forced failure for the fallback rehearsal.");
    return json(buildJourney(engine));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "The journey could not be built." }, 500);
  }
}
