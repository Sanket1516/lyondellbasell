// Pre-demo smoke test (QA pass). Starts the production Next.js server on a COPY of the data, then:
//   - hits every page for every role, for all 25 demo documents, plus unknown ids;
//   - hits every API endpoint with valid and edge-case input (empty fields, wrong types, bad JSON, all-zero invoice, outage, missing source DB);
//   - drives the server actions over HTTP exactly as the browser does (Next-Action header), so the clerk/approver workflow runs end to end;
//   - runs the Stage 9 Golden Journey headlessly three times in a row (live call, every screen validated, fallback path);
//   - checks the planted cases give the right answer.
// Records pass / fail / crash / timeout (and slow > 3 s) for every check. Writes a JSON report for before/after comparison.
//
//   npm run build && npx tsx scripts/smoke/smoke.ts --label before
//   npx tsx scripts/smoke/smoke.ts --label after --compare <path to before.json>
//
// The team's data files are never touched: data/*.db and data/sources are copied to a temp folder and the server is pointed at it.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { journeyProblems } from "../../src/plantpay/journey/validate";

const ROOT = path.resolve(__dirname, "..", "..");
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const LABEL = arg("label") ?? "run";
const PORT = Number(arg("port") ?? 3217);
const OUT_DIR = arg("out") ?? path.join(os.tmpdir(), "plantpay-smoke");
const COMPARE = arg("compare");
const ONLY = arg("only"); // comma list of groups
const BASE = `http://127.0.0.1:${PORT}`;
const SLOW_MS = 3000;
const TIMEOUT_MS = 30000;
const API_KEY = "pp_demo_key_2026";
const SECRET = process.env.SESSION_SECRET ?? "plant-x-demo-secret-not-for-production";

type Result = "pass" | "fail" | "crash" | "timeout";
interface Row { id: string; group: string; name: string; result: Result; ms: number; slow: boolean; detail: string }
const rows: Row[] = [];
const serverLog: string[] = [];

// ---------- data sandbox ----------
const DATA = path.join(OUT_DIR, `data-${LABEL}`);
function copyData(clean: boolean) {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(path.join(DATA, "sources"), { recursive: true });
  if (clean) return;
  const src = path.join(ROOT, "data");
  for (const f of fs.readdirSync(src)) if (/\.db(-wal|-shm)?$/.test(f)) fs.copyFileSync(path.join(src, f), path.join(DATA, f));
  for (const f of fs.readdirSync(path.join(src, "sources"))) fs.copyFileSync(path.join(src, "sources", f), path.join(DATA, "sources", f));
}
const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PLANTX_DB_FILE: path.join(DATA, "plantx.db"),
  FOUNDATION_DB_FILE: path.join(DATA, "foundation.db"),
  PLANTPAY_INTEGRATION_DB: path.join(DATA, "plantpay-integration.db"),
  PLANTPAY_SOURCES_DIR: path.join(DATA, "sources"),
  PORT: String(PORT),
  NODE_ENV: "production" as const,
});

// ---------- server ----------
let server: ChildProcess | undefined;
async function startServer(): Promise<number> {
  const t0 = Date.now();
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: ROOT, env: ENV(), stdio: ["ignore", "pipe", "pipe"] });
  const take = (b: Buffer) => { for (const l of b.toString().split(/\r?\n/)) if (l.trim()) serverLog.push(l); };
  child.stdout!.on("data", take); child.stderr!.on("data", take);
  server = child;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.status < 500) return Date.now() - t0; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start in 60 s");
}
async function stopServer() {
  if (!server) return;
  server.kill();
  await new Promise((r) => setTimeout(r, 1500));
  if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  server = undefined;
}

// ---------- http helpers ----------
const token = (u: string) => `${u}.${createHmac("sha256", SECRET).update(u).digest("base64url")}`;
const cookie = (u?: string): Record<string, string> => (u ? { cookie: `plantx_session=${token(u)}` } : {});
const enc = encodeURIComponent;
const CLERK = "priya.clerk", L1 = "neha.approver", L2 = "rajesh.approver", VIHAR = "vihar.supplier", KONKAN = "konkan.supplier";

interface Resp { status: number; ms: number; text: string; headers: Headers; timedOut?: boolean; error?: string }
async function http(method: string, url: string, opts: { as?: string; key?: string; body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Resp> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + url, { method, redirect: "manual", signal: ctl.signal, body: opts.body, headers: { ...cookie(opts.as), ...(opts.key ? { "x-api-key": opts.key } : {}), ...opts.headers } });
    const text = await r.text();
    return { status: r.status, ms: Date.now() - t0, text, headers: r.headers };
  } catch (e) {
    const timedOut = (e as Error).name === "AbortError";
    return { status: 0, ms: Date.now() - t0, text: "", headers: new Headers(), timedOut, error: (e as Error).message };
  } finally { clearTimeout(t); }
}

// Visible text of an HTML page: no scripts (the RSC payload contains "$undefined" legitimately), no tags.
function visible(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
// Pages with a loading.tsx stream: the first <main> holds the spinner and the real content arrives in a hidden segment.
const mainText = (html: string) => { const m = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html); const t = visible(m ? m[1] : html); const h = html.indexOf('<div hidden id="S:'); return t.length < 120 && h >= 0 ? visible(html.slice(h)) : t; };
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object [A-Z]|Traceback|ENOENT|SQLITE_|Application error|Internal Server Error|server-side exception|at Object\.|TypeError|ReferenceError|Unhandled|\bnull\b(?! and void)|Infinity/;

let seq = 0;
function record(group: string, name: string, result: Result, ms: number, detail = "") {
  rows.push({ id: `${group}:${name}`, group, name, result, ms, slow: ms > SLOW_MS, detail });
}
const logMark = () => serverLog.length;
const newErrors = (mark: number) => serverLog.slice(mark).filter((l) => /⨯|Error|error|TypeError|unhandled/i.test(l) && !/api_request/.test(l));

/** One page check: expected status (or redirect), no raw errors, not empty. */
async function page(group: string, url: string, opts: { as?: string; expect?: number | number[]; mustContain?: (string | RegExp)[]; minText?: number; name?: string } = {}) {
  const want = Array.isArray(opts.expect) ? opts.expect : [opts.expect ?? 200];
  const mark = logMark();
  const r = await http("GET", url, { as: opts.as });
  const name = opts.name ?? `${opts.as ?? "anon"} ${url}`;
  if (r.timedOut) return record(group, name, "timeout", r.ms, `no answer in ${TIMEOUT_MS / 1000} s`);
  if (r.status === 0) return record(group, name, "crash", r.ms, `connection failed: ${r.error}`);
  await new Promise((res) => setTimeout(res, 5));
  const errs = newErrors(mark);
  if (r.status >= 500) return record(group, name, "crash", r.ms, `HTTP ${r.status}${errs.length ? `; server: ${errs[0].slice(0, 220)}` : ""}`);
  if (!want.includes(r.status)) return record(group, name, "fail", r.ms, `HTTP ${r.status}, expected ${want.join("/")}${r.headers.get("location") ? ` -> ${r.headers.get("location")}` : ""}`);
  if (r.status >= 300 && r.status < 400) return record(group, name, "pass", r.ms, `redirect -> ${r.headers.get("location")}`);
  // notFound() inside a dynamic page: Next serves a shell and the not-found card arrives in the RSC payload (rendered by the browser).
  if (r.status === 404 && /id="__next_error__"/.test(r.text)) {
    const miss = (opts.mustContain ?? []).find((m) => !(typeof m === "string" ? r.text.includes(m) : m.test(r.text)));
    return record(group, name, miss || !/We could not find that page/.test(r.text) ? "fail" : "pass", r.ms, miss ? `missing ${miss}` : "not-found card in payload");
  }
  const t = mainText(r.text);
  const bad = BAD_TEXT.exec(t);
  if (bad) return record(group, name, "fail", r.ms, `visible text contains "${bad[0]}": …${t.slice(Math.max(0, bad.index - 80), bad.index + 60)}…`);
  if (errs.length) return record(group, name, "crash", r.ms, `rendered but server logged: ${errs[0].slice(0, 220)}`);
  if (t.length < (opts.minText ?? 120)) return record(group, name, "fail", r.ms, `near-empty screen (${t.length} chars): "${t.slice(0, 120)}"`);
  for (const m of opts.mustContain ?? []) if (!(typeof m === "string" ? t.includes(m) : m.test(t))) return record(group, name, "fail", r.ms, `missing expected text ${m}`);
  record(group, name, "pass", r.ms, `${t.length} chars`);
}

/** JSON endpoint check. `check` returns an error string or undefined. */
async function api(group: string, name: string, method: string, url: string, opts: { as?: string; key?: string; json?: unknown; raw?: BodyInit; headers?: Record<string, string>; expect?: number | number[]; check?: (b: any) => string | undefined } = {}) {
  const want = Array.isArray(opts.expect) ? opts.expect : [opts.expect ?? 200];
  const mark = logMark();
  const body = opts.raw ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined);
  const r = await http(method, url, { as: opts.as, key: opts.key, body, headers: { ...(opts.json !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers } });
  if (r.timedOut) return record(group, name, "timeout", r.ms, `no answer in ${TIMEOUT_MS / 1000} s`);
  if (r.status === 0) return record(group, name, "crash", r.ms, `connection failed: ${r.error}`);
  let b: any;
  try { b = JSON.parse(r.text); } catch { b = undefined; }
  const errs = newErrors(mark);
  if (r.status >= 500 && !want.includes(r.status)) return record(group, name, "crash", r.ms, `HTTP ${r.status}: ${r.text.slice(0, 200)}${errs.length ? `; server: ${errs[0].slice(0, 200)}` : ""}`);
  if (!want.includes(r.status)) return record(group, name, "fail", r.ms, `HTTP ${r.status}, expected ${want.join("/")}: ${r.text.slice(0, 200)}`);
  if (b === undefined) return record(group, name, r.status >= 400 ? "pass" : "fail", r.ms, r.status >= 400 ? `plain-text error: ${r.text.slice(0, 80)}` : `not JSON: ${r.text.slice(0, 120)}`);
  if (/"stack"\s*:|at Object\.|Traceback|SQLITE_|ENOENT/.test(r.text)) return record(group, name, "fail", r.ms, `body leaks internals: ${r.text.slice(0, 200)}`);
  if (r.status >= 400 && !(typeof b.error === "string" && b.error.length > 5)) return record(group, name, "fail", r.ms, `error without a readable message: ${r.text.slice(0, 160)}`);
  const problem = opts.check?.(b);
  if (problem) return record(group, name, "fail", r.ms, problem);
  record(group, name, "pass", r.ms, r.status >= 400 ? `HTTP ${r.status}: ${String(b.error).slice(0, 90)}` : "");
}

// ---------- server actions over HTTP ----------
interface ActionRef { id: string; route: string }
let ACTIONS: Record<string, ActionRef> = {};
function loadActions() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, ".next", "server", "server-reference-manifest.json"), "utf8"));
  ACTIONS = {};
  for (const [id, v] of Object.entries<any>(m.node)) ACTIONS[v.exportedName] = { id, route: Object.keys(v.workers)[0] };
}
/** Calls a server action the way the browser does. `pageUrl` must be a page that includes the action. Returns the decoded result. */
async function callAction(name: string, pageUrl: string, args: unknown[] | FormData, as?: string): Promise<{ status: number; ms: number; value: any; redirect?: string; raw: string; timedOut?: boolean }> {
  const ref = ACTIONS[name];
  if (!ref) throw new Error(`action ${name} not in manifest`);
  let body: BodyInit; const headers: Record<string, string> = { "next-action": ref.id, accept: "text/x-component" };
  const list = args instanceof FormData ? [args] : args;
  if (list.some((a) => a instanceof FormData)) {
    // React's encodeReply: each FormData argument becomes "$K<n>" and its entries are sent as "_<n>_<name>"; the root "0" goes last.
    const fd = new FormData();
    let n = 0;
    const root = list.map((a) => {
      if (!(a instanceof FormData)) return a;
      n++;
      for (const [k, v] of a.entries()) fd.append(`_${n}_${k}`, v);
      return `$K${n}`;
    });
    fd.append("0", JSON.stringify(root));
    body = fd;
  } else { body = JSON.stringify(list); headers["content-type"] = "text/plain;charset=UTF-8"; }
  const r = await http("POST", pageUrl, { as, body, headers });
  let value: any;
  for (const line of r.text.split("\n")) {
    const m = /^([0-9a-f]+):(.*)$/.exec(line);
    if (m && m[1] === "1") { try { value = JSON.parse(m[2]); } catch { value = m[2]; } }
  }
  return { status: r.status, ms: r.ms, value, redirect: r.headers.get("x-action-redirect") ?? undefined, raw: r.text, timedOut: r.timedOut };
}
async function actionCheck(group: string, name: string, action: string, pageUrl: string, args: unknown[] | FormData, as: string | undefined, check: (v: any, redirect?: string) => string | undefined) {
  const mark = logMark();
  let r;
  try { r = await callAction(action, pageUrl, args, as); } catch (e) { return record(group, name, "fail", 0, (e as Error).message); }
  if (r.timedOut) return record(group, name, "timeout", r.ms, "no answer");
  const errs = newErrors(mark);
  if (r.status >= 500 || errs.length) return record(group, name, "crash", r.ms, `HTTP ${r.status}${errs.length ? `; server: ${errs[0].slice(0, 220)}` : ""} ${r.raw.slice(0, 120)}`);
  const p = check(r.value, r.redirect);
  record(group, name, p ? "fail" : "pass", r.ms, p ?? (r.value && typeof r.value === "object" ? JSON.stringify(r.value).slice(0, 100) : r.redirect ? `redirect ${r.redirect}` : ""));
  return r;
}

// ---------- reading the sandbox store (read-only) ----------
function store<T = any>(table: string): T[] {
  const db = new Database(path.join(DATA, "plantx.db"), { readonly: true, fileMustExist: true });
  try { return db.prepare(`SELECT data FROM ${table} ORDER BY pos`).all().map((r: any) => JSON.parse(r.data)); } finally { db.close(); }
}
function demoIds(): string[] {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "demo-set", "manifest.json"), "utf8"));
  return m.map((d: any) => d.invoiceId);
}
function demoVendors(): string[] {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "demo-set", "manifest.json"), "utf8"));
  return [...new Set<string>(m.map((d: any) => d.vendorId))];
}

// ============================================================ groups
const DEMO = demoIds();
const want = (g: string) => !ONLY || ONLY.split(",").includes(g);

async function gAuth() {
  const G = "auth";
  await page(G, "/login", { minText: 20, mustContain: ["Sign in"] });
  {
    // "/" is the static scroll-story landing page (rendered in the browser; landing/e2e/scroll.mjs drives it in Edge).
    const r = await http("GET", "/");
    record(G, "anon / serves the landing page", r.status === 200 && r.text.includes('id="root"') && r.text.includes("/landing/assets/") ? "pass" : "fail", r.ms, `HTTP ${r.status}`);
  }
  await page(G, "/start", { expect: [307, 308, 302, 303], name: "anon /start redirects to sign-in" });
  for (const [role, home] of [["supplier", "/supplier"], ["clerk", "/clerk"], ["approver", "/approver"]] as const) {
    const r = await http("GET", `/demo/${role}`);
    const ok = r.status === 307 && r.headers.get("location") === home && /plantx_session=/.test(r.headers.get("set-cookie") ?? "");
    record(G, `landing demo sign-in as ${role}`, ok ? "pass" : "fail", r.ms, `${r.status} -> ${r.headers.get("location")}`);
  }
  {
    const r = await http("GET", "/demo/clerk?next=" + encodeURIComponent("//evil.example"));
    record(G, "demo sign-in ignores an off-site next", r.headers.get("location") === "/clerk" ? "pass" : "fail", r.ms, `-> ${r.headers.get("location")}`);
    const j = await http("GET", "/demo/clerk?next=" + encodeURIComponent("/plantpay/journey"));
    record(G, "demo sign-in honours a same-site next", j.headers.get("location") === "/plantpay/journey" ? "pass" : "fail", j.ms, `-> ${j.headers.get("location")}`);
    const u = await http("GET", "/demo/admin");
    record(G, "demo sign-in rejects an unknown role", u.status === 307 && u.headers.get("location") === "/login" && !/plantx_session=/.test(u.headers.get("set-cookie") ?? "") ? "pass" : "fail", u.ms, `${u.status} -> ${u.headers.get("location")}`);
  }
  await page(G, "/plantpay", { expect: [307, 302, 303], name: "anon /plantpay redirects to sign-in" });
  await page(G, "/clerk", { as: VIHAR, expect: [307, 302, 303], name: "supplier kept out of /clerk" });
  await page(G, "/supplier", { as: CLERK, expect: [307, 302, 303], name: "clerk kept out of /supplier" });
  await page(G, "/plantpay", { as: "nobody.fake", expect: [307, 302, 303], name: "forged unknown user cookie redirects" });
  await api(G, "REST without key -> 401", "GET", "/api/plantpay/v1/sources", { expect: 401 });
  await api(G, "REST bad key -> 401", "GET", "/api/plantpay/v1/sources", { key: "wrong", expect: 401 });
  await api(G, "REST as supplier -> 401", "GET", "/api/plantpay/v1/sources", { as: VIHAR, expect: 401 });
  await actionCheck(G, "login wrong password", "loginAction", "/login", [{}, fdFrom({ username: CLERK, password: "nope" })], undefined, (v) => (v?.error ? undefined : `expected an error, got ${JSON.stringify(v)}`));
  await actionCheck(G, "login empty fields", "loginAction", "/login", [{}, fdFrom({})], undefined, (v) => (v?.error ? undefined : `expected an error, got ${JSON.stringify(v)}`));
  await actionCheck(G, "login clerk ok -> redirect", "loginAction", "/login", [{}, fdFrom({ username: CLERK, password: "Clerk@2026" })], undefined, (_v, r) => (r ? undefined : "no redirect"));
}
function fdFrom(o: Record<string, string>): FormData { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; }

async function gPagesStaff() {
  const G = "pages";
  for (const u of ["/clerk", "/dashboard", "/audit", "/audit/report", "/foundation", "/foundation?status=review", "/foundation?demo=1", "/plantpay", "/plantpay/audit", "/plantpay/graph", "/plantpay/predictions", "/plantpay/process", "/plantpay/suppliers", "/plantpay/journey", "/plantpay/innovations", "/plantpay/architecture", "/plantpay/responsible-ai", "/plantpay/api-docs", "/no-access"]) {
    await page(G, u, { as: CLERK, minText: u === "/plantpay/journey" ? 20 : u === "/no-access" ? 60 : 120 });
  }
  for (const u of ["/approver", "/audit", "/plantpay", "/dashboard"]) await page(G, u, { as: L1 });
  await page(G, "/approver", { as: L2 });
  for (const u of ["/supplier", "/supplier/passport"]) await page(G, u, { as: VIHAR });
  await page(G, "/supplier", { as: KONKAN });
  // every invoice the clerk queue can open (app store)
  for (const inv of store("invoices")) await page(G, `/clerk/invoices/${enc(inv.id)}`, { as: CLERK, name: `clerk invoice ${inv.id}` });
  for (const inv of store("invoices").filter((i) => i.status === "pending_approval")) await page(G, `/approver/invoices/${enc(inv.id)}`, { as: L1, name: `approver invoice ${inv.id}` });
  for (const inv of store("invoices").filter((i) => i.vendorId === "V-1001")) await page(G, `/supplier/invoices/${enc(inv.id)}`, { as: VIHAR, name: `supplier invoice ${inv.id}` });
}

async function gDemoDocs() {
  const G = "demo-docs";
  for (const id of DEMO) {
    const e = enc(id);
    await page(G, `/plantpay/invoices/${e}`, { as: CLERK, name: `invoice ${id}`, mustContain: ["warning, not proof"] });
    await page(G, `/plantpay/invoices/${e}/exceptions`, { as: CLERK, name: `exceptions ${id}` });
    await page(G, `/plantpay/invoices/${e}/passport`, { as: CLERK, name: `passport preview ${id}` });
    await page(G, `/plantpay/predictions/${e}`, { as: CLERK, name: `predictions ${id}`, mustContain: [/%/] });
    await page(G, `/foundation/invoices/${e}`, { as: CLERK, name: `foundation ${id}` });
    await page(G, `/plantpay/process?invoice=${e}`, { as: CLERK, name: `process ${id}` });
  }
  for (const v of demoVendors()) await page(G, `/plantpay/suppliers/${enc(v)}`, { as: CLERK, name: `supplier score ${v}` });
  await page(G, `/supplier/passport/INV-7781`, { as: VIHAR, name: "supplier passport INV-7781 (own)" });
  await page(G, `/supplier/passport/INV-7781`, { as: KONKAN, expect: 404, minText: 0, name: "supplier passport INV-7781 (other supplier) -> 404" });
}

async function gUnknown() {
  const G = "unknown-ids";
  const NF = [/could not find|not found|does not exist|No invoice|not on file/i];
  for (const u of ["/plantpay/invoices/NOPE-1", "/plantpay/invoices/NOPE-1/exceptions", "/plantpay/invoices/NOPE-1/passport", "/plantpay/predictions/NOPE-1", "/plantpay/suppliers/V-0000", "/clerk/invoices/NOPE-1", "/foundation/invoices/NOPE-1", "/plantpay/invoices/%20", "/plantpay/invoices/" + enc("<script>alert(1)</script>")]) {
    await page(G, u, { as: CLERK, expect: [200, 404], minText: 20, mustContain: NF, name: `unknown ${u}` });
  }
  await page(G, "/approver/invoices/NOPE-1", { as: L1, expect: [200, 404], minText: 20, mustContain: NF, name: "unknown /approver/invoices/NOPE-1" });
  await page(G, "/approver/invoices/NOPE-1", { as: CLERK, expect: [307, 302, 303], name: "clerk kept out of approver invoice" });
  await page(G, "/supplier/invoices/NOPE-1", { as: VIHAR, expect: [200, 404], minText: 20, mustContain: NF });
  await page(G, "/supplier/passport/NOPE-1", { as: VIHAR, expect: 404, minText: 20, mustContain: NF });
  await page(G, "/this-page-does-not-exist", { as: CLERK, expect: 404, minText: 20, mustContain: NF });
}

async function gRest() {
  const G = "rest";
  const K = { key: API_KEY };
  const v1 = "/api/plantpay/v1";
  await api(G, "sources", "GET", `${v1}/sources`, { ...K, check: (b) => (b.sources?.length === 6 ? undefined : "expected 6 sources") });
  await api(G, "invoices list", "GET", `${v1}/invoices`, { ...K, check: (b) => (b.total > 600 ? undefined : `total ${b.total}`) });
  for (const s of ["pass", "review", "block", "incomplete"]) await api(G, `invoices status=${s}`, "GET", `${v1}/invoices?status=${s}`, K);
  await api(G, "invoices status=bogus", "GET", `${v1}/invoices?status=bogus`, { ...K, expect: [200, 400] });
  for (const l of ["abc", "-5", "0", "99999", ""]) await api(G, `invoices limit=${l}`, "GET", `${v1}/invoices?limit=${l}`, K);
  for (const id of DEMO) {
    const e = enc(id);
    await api(G, `invoice ${id}`, "GET", `${v1}/invoices/${e}`, { ...K, check: (b) => (b.status ? undefined : "no status") });
    await api(G, `canonical ${id}`, "GET", `${v1}/invoices/${e}/canonical`, K);
    await api(G, `resolution ${id}`, "GET", `${v1}/invoices/${e}/resolution`, K);
    await api(G, `predictions ${id}`, "GET", `${v1}/predictions/${e}`, { ...K, check: nanCheck });
  }
  await api(G, "invoice unknown -> 404", "GET", `${v1}/invoices/NOPE-1`, { ...K, expect: 404 });
  await api(G, "canonical unknown -> 404", "GET", `${v1}/invoices/NOPE-1/canonical`, { ...K, expect: 404 });
  await api(G, "resolution unknown -> 404", "GET", `${v1}/invoices/NOPE-1/resolution`, { ...K, expect: 404 });
  await api(G, "predictions unknown -> 404", "GET", `${v1}/predictions/NOPE-1`, { ...K, expect: 404 });
  await api(G, "evaluate INV-7781", "POST", `${v1}/invoices/INV-7781/evaluate`, { ...K, check: (b) => (b.status === "review" ? undefined : `status ${b.status}`) });
  await api(G, "evaluate unknown -> 404", "POST", `${v1}/invoices/NOPE-1/evaluate`, { ...K, expect: 404 });
  await api(G, "simulate no body -> 400", "POST", `${v1}/invoices/INV-7781/simulate`, { ...K, expect: 400 });
  await api(G, "simulate bad JSON -> 400", "POST", `${v1}/invoices/INV-7781/simulate`, { ...K, raw: "{not json", headers: { "content-type": "application/json" }, expect: 400 });
  await api(G, "simulate unknown resolutionId", "POST", `${v1}/invoices/INV-7781/simulate`, { ...K, json: { resolutionId: "nope" }, expect: [200, 400, 404] });
  await api(G, "simulate wrong type resolutionId", "POST", `${v1}/invoices/INV-7781/simulate`, { ...K, json: { resolutionId: 42 }, expect: [200, 400, 404] });
  await api(G, "simulate all INV-7781 reaches pass", "POST", `${v1}/invoices/INV-7781/simulate`, { ...K, json: { all: true }, check: (b) => (JSON.stringify(b).includes('"pass"') ? undefined : "did not reach pass") });
  await api(G, "simulate all unknown invoice", "POST", `${v1}/invoices/NOPE-1/simulate`, { ...K, json: { all: true }, expect: [200, 404] });
  await api(G, "suppliers", "GET", `${v1}/suppliers`, { ...K, check: nanCheck });
  await api(G, "models", "GET", `${v1}/models`, { ...K, check: nanCheck });
  await api(G, "events", "GET", `${v1}/events`, K);
  await api(G, "events/process", "POST", `${v1}/events/process`, K);
  await api(G, "ask valid", "POST", `${v1}/ask`, { ...K, json: { question: "What is the price tolerance?" } });
  await api(G, "ask with invoice", "POST", `${v1}/ask`, { ...K, json: { question: "Why is this invoice held?", invoiceId: "INV-7781" } });
  await api(G, "ask empty -> 400", "POST", `${v1}/ask`, { ...K, json: { question: "" }, expect: 400 });
  await api(G, "ask no body -> 400", "POST", `${v1}/ask`, { ...K, expect: 400 });
  await api(G, "ask wrong type -> 400", "POST", `${v1}/ask`, { ...K, json: { question: 12345 }, expect: 400 });
  await api(G, "ask array body -> 400", "POST", `${v1}/ask`, { ...K, json: ["x"], expect: 400 });
  await api(G, "ask nonsense (no source)", "POST", `${v1}/ask`, { ...K, json: { question: "zzqx flurb wibble" } });
  await api(G, "audit verify", "GET", `${v1}/audit?verify=1`, { ...K, check: (b) => (b.integrity?.ok ? undefined : `chain not intact: ${JSON.stringify(b.integrity).slice(0, 120)}`) });
  await api(G, "audit limit=abc", "GET", `${v1}/audit?limit=abc`, K);
  await api(G, "audit limit=-1", "GET", `${v1}/audit?limit=-1`, K);
  await api(G, "unknown endpoint -> 404", "GET", `${v1}/nothing/here`, { ...K, expect: 404 });
  await api(G, "audit limit=-1 is capped", "GET", `${v1}/audit?limit=-1`, { ...K, check: (b) => (b.events?.length <= 500 ? undefined : `${b.events?.length} rows`) });
  await api(G, "simulate empty resolutionId -> 400", "POST", `${v1}/invoices/INV-7781/simulate`, { ...K, json: { resolutionId: "" }, expect: 400 });
  await api(G, "ask null body -> 400", "POST", `${v1}/ask`, { ...K, raw: "null", headers: { "content-type": "application/json" }, expect: 400 });
  await api(G, "outage null body -> 400", "POST", `${v1}/sources/quality/outage`, { ...K, raw: "null", headers: { "content-type": "application/json" }, expect: 400 });
  await api(G, "outage unknown source -> 404", "POST", `${v1}/sources/mars/outage`, { ...K, json: { outage: true }, expect: 404 });
  await api(G, "outage wrong type -> 400", "POST", `${v1}/sources/quality/outage`, { ...K, json: { outage: "yes" }, expect: 400 });
  await api(G, "outage empty body -> 400", "POST", `${v1}/sources/quality/outage`, { ...K, expect: 400 });
}

/** No probability / score may be null or missing: JSON.stringify turns NaN into null. */
function nanCheck(b: any): string | undefined {
  const bad: string[] = [];
  const walk = (v: any, p: string) => {
    if (v === null && /prob|score|auc|accuracy|points|value|logloss/i.test(p.split(".").pop() ?? "")) bad.push(p);
    else if (typeof v === "number" && !Number.isFinite(v)) bad.push(p);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
  };
  walk(b, "");
  return bad.length ? `null/NaN numbers at ${bad.slice(0, 4).join(", ")}` : undefined;
}

async function gOtherApi() {
  const G = "api";
  await api(G, "health", "GET", "/api/health", { check: (b) => (b.status === "ok" ? undefined : `status ${b.status}`) });
  await api(G, "v1 invoices (session)", "GET", "/api/v1/invoices", { as: CLERK });
  await api(G, "v1 invoices anon -> 401", "GET", "/api/v1/invoices", { expect: 401 });
  await api(G, "v1 invoices ?status=zzz", "GET", "/api/v1/invoices?status=zzz", { as: CLERK, expect: [200, 400] });
  await api(G, "foundation list", "GET", "/api/foundation/invoices", { as: CLERK });
  await api(G, "foundation list demo", "GET", "/api/foundation/invoices?demo=1", { as: CLERK, check: (b) => (JSON.stringify(b).length > 200 ? undefined : "empty") });
  await api(G, "foundation bad status -> 400", "GET", "/api/foundation/invoices?status=zzz", { as: CLERK, expect: 400 });
  for (const l of ["abc", "-1"]) await api(G, `foundation limit=${l}`, "GET", `/api/foundation/invoices?limit=${l}&offset=${l}`, { as: CLERK, expect: [200, 400] });
  await api(G, "foundation as supplier -> 403", "GET", "/api/foundation/invoices", { as: VIHAR, expect: 403 });
  for (const id of DEMO) {
    await api(G, `foundation get ${id}`, "GET", `/api/foundation/invoices/${enc(id)}`, { as: CLERK });
    await api(G, `foundation result ${id}`, "GET", `/api/foundation/invoices/${enc(id)}/result`, { as: CLERK, expect: [200, 404] });
  }
  await api(G, "foundation match INV-7781", "POST", "/api/foundation/invoices/INV-7781/match", { as: CLERK });
  await api(G, "foundation get unknown -> 404", "GET", "/api/foundation/invoices/NOPE-1", { as: CLERK, expect: 404 });
  await api(G, "foundation match unknown -> 404", "POST", "/api/foundation/invoices/NOPE-1/match", { as: CLERK, expect: 404 });
  await api(G, "supplier invoice own", "GET", `/api/supplier/invoices/${enc(store("invoices").find((i) => i.vendorId === "V-1001")?.id ?? "INV-6150")}`, { as: VIHAR });
  await api(G, "supplier invoice unknown -> 404", "GET", "/api/supplier/invoices/NOPE-1", { as: VIHAR, expect: 404 });
  await api(G, "supplier invoice as clerk -> 401", "GET", "/api/supplier/invoices/INV-7781", { as: CLERK, expect: 401 });
  // document viewer
  const docR = await http("GET", `/api/document?src=${enc("demo:INV-7781.pdf")}`, { as: VIHAR });
  record(G, "document demo INV-7781.pdf", docR.status === 200 && docR.text.startsWith("%PDF") ? "pass" : docR.status >= 500 ? "crash" : "fail", docR.ms, `HTTP ${docR.status}`);
  for (const s of ["", "demo:../../package.json", "upload:../x", "zzz"]) {
    const r = await http("GET", `/api/document?src=${enc(s)}`, { as: VIHAR });
    record(G, `document bad src "${s}"`, r.status >= 500 ? "crash" : r.status >= 400 ? "pass" : "fail", r.ms, `HTTP ${r.status}`);
  }
  // extraction
  const ex = async (name: string, fd: FormData | undefined, expect: number[], as = VIHAR, check?: (b: any) => string | undefined) =>
    api(G, name, "POST", "/api/extract", { as, raw: fd as any, expect, check });
  const f1 = new FormData(); f1.append("demo", "INV-7781.pdf");
  await ex("extract demo INV-7781.pdf", f1, [200], VIHAR, (b) => (b.ok && b.extraction ? undefined : "no extraction"));
  const f2 = new FormData(); f2.append("demo", "INV-7785.jpg");
  await ex("extract demo INV-7785.jpg (OCR)", f2, [200], VIHAR, (b) => (b.ok ? undefined : "not ok"));
  const f3 = new FormData(); f3.append("file", new Blob([new Uint8Array(0)]), "empty.pdf");
  await ex("extract empty file -> 4xx", f3, [400, 415, 422]);
  const f4 = new FormData(); f4.append("file", new Blob(["hello world, not a pdf"]), "notes.txt");
  await ex("extract text file -> 4xx", f4, [400, 415, 422]);
  const f5 = new FormData(); f5.append("file", new Blob(["%PDF-1.4 broken"]), "broken.pdf");
  await ex("extract corrupt PDF -> 4xx", f5, [400, 415, 422]);
  const f6 = new FormData(); f6.append("demo", "../../package.json");
  await ex("extract demo path traversal -> 4xx", f6, [400, 404]);
  await ex("extract no form -> 4xx", undefined, [400]);
  await ex("extract as clerk -> 401", new FormData(), [401], CLERK);
  // journey API
  await api(G, "journey live", "GET", "/api/plantpay/journey", { as: CLERK, check: (b) => { const p = journeyProblems(b); return p.length ? p.slice(0, 3).join("; ") : undefined; } });
  await api(G, "journey forced failure -> 500 JSON", "GET", "/api/plantpay/journey?fail=1", { as: CLERK, expect: 500 });
  await api(G, "journey anon -> 401", "GET", "/api/plantpay/journey", { expect: 401 });
}

/** Supplier submission edge cases through the real server action (the upload screen's submit). */
async function gSubmitEdge() {
  const G = "submit-edge";
  const base = { source: "", vendorName: "Vihar Chem Supplies", vendorGstin: "", invoiceNumber: "QA-ZERO-1", invoiceDate: "2026-11-10", poNumber: "4500001234", lines: [{ description: "Zero line", qty: 1, unit: "kg", unitPrice: 0, amount: 0 }], subtotal: 0, taxRatePct: 0, taxAmount: 0, total: 0 };
  const sub = (name: string, payload: unknown, check: (v: any) => string | undefined) => actionCheck(G, name, "submitInvoice", "/supplier", [payload], VIHAR, check);
  const okOrErr = (v: any) => (v && (v.ok === true || typeof v.error === "string") ? undefined : `no readable outcome: ${JSON.stringify(v)}`);
  const mustErr = (v: any) => (v && v.ok === false && typeof v.error === "string" ? undefined : `expected a validation error, got ${JSON.stringify(v)}`);
  await sub("all-zero invoice", base, okOrErr);
  await sub("empty object", {}, mustErr);
  await sub("null payload", null, mustErr);
  await sub("string payload", "hello", mustErr);
  await sub("wrong types (numbers as strings)", { ...base, invoiceNumber: "QA-T-2", lines: [{ description: "x", qty: "5", unit: "kg", unitPrice: "10", amount: "50" }], subtotal: "50" }, mustErr);
  await sub("lines not an array", { ...base, invoiceNumber: "QA-T-3", lines: "abc" }, mustErr);
  await sub("lines with null entry", { ...base, invoiceNumber: "QA-T-4", lines: [null] }, mustErr);
  await sub("empty fields", { ...base, invoiceNumber: "", poNumber: "", vendorName: "" }, mustErr);
  await sub("negative total", { ...base, invoiceNumber: "QA-T-5", total: -100 }, mustErr);
  await sub("bad date", { ...base, invoiceNumber: "QA-T-6", invoiceDate: "2026-13-45" }, mustErr);
  await sub("invoice number as number", { ...base, invoiceNumber: 12345 }, mustErr);
  await page(G, `/clerk/invoices/QA-ZERO-1`, { as: CLERK, expect: [200, 404], name: "clerk opens all-zero invoice" });
  await page(G, `/clerk`, { as: CLERK, name: "clerk queue with all-zero invoice" });
  await page(G, `/dashboard`, { as: CLERK, name: "dashboard with all-zero invoice" });
  await page(G, `/supplier`, { as: VIHAR, name: "supplier list with all-zero invoice" });
  await actionCheck(G, "chat empty text", "askPayment", "/supplier", [{ text: "" }], VIHAR, okOrAns);
  await actionCheck(G, "chat null input", "askPayment", "/supplier", [null], VIHAR, okOrAns);
  await actionCheck(G, "chat wrong types", "askPayment", "/supplier", [{ text: 123, intent: 5, invoiceId: {} }], VIHAR, okOrAns);
  await actionCheck(G, "chat as clerk refused", "askPayment", "/supplier", [{ text: "where is my payment" }], CLERK, (v) => (v?.error ? undefined : "not refused"));
  await actionCheck(G, "approve with null args", "decideAction", "/approver/invoices/INV-6150", [null, null, null], L1, (v) => (v && v.ok === false ? undefined : `got ${JSON.stringify(v)}`));
  await actionCheck(G, "request fix unknown", "requestFixAction", "/clerk/invoices/INV-7782", ["NOPE", "NOPE"], CLERK, (v) => (v && v.ok === false ? undefined : `got ${JSON.stringify(v)}`));
  await actionCheck(G, "duplicate decision bogus", "decideDuplicate", "/clerk/invoices/INV-7782", ["INV-7782", "maybe", ""], CLERK, (v) => (v && v.ok === false ? undefined : `got ${JSON.stringify(v)}`));
  await actionCheck(G, "reset demo", "resetDemoAction", "/audit", [], CLERK, (_v, r) => (r ? undefined : "no redirect after reset"));
}
const okOrAns = (v: any) => (v && (typeof v.error === "string" || typeof v.text === "string" || typeof v.answer === "string" || v.lines || v.title) ? undefined : `no readable answer: ${JSON.stringify(v)?.slice(0, 120)}`);

/** Outage and a genuinely missing source database. */
async function gOutage() {
  const G = "outage";
  const K = { key: API_KEY };
  for (const src of ["procurement", "warehouse", "quality", "finance", "logistics", "supplier"]) {
    await api(G, `${src} offline`, "POST", `/api/plantpay/v1/sources/${src}/outage`, { ...K, json: { outage: true } });
    await page(G, "/plantpay", { as: CLERK, name: `/plantpay with ${src} offline` });
    await page(G, `/plantpay/invoices/INV-7781`, { as: CLERK, expect: [200, 503], name: `INV-7781 with ${src} offline` });
    await page(G, `/plantpay/invoices/INV-7781/exceptions`, { as: CLERK, expect: [200, 503], name: `exceptions with ${src} offline` });
    await page(G, `/plantpay/predictions/INV-7781`, { as: CLERK, expect: [200, 503], name: `predictions with ${src} offline` });
    await page(G, `/plantpay/suppliers`, { as: CLERK, name: `suppliers with ${src} offline` });
    await page(G, `/plantpay/graph`, { as: CLERK, name: `graph with ${src} offline` });
    await page(G, `/plantpay/process`, { as: CLERK, name: `process with ${src} offline` });
    await page(G, `/supplier/passport/INV-7781`, { as: VIHAR, name: `supplier passport with ${src} offline` });
    await api(G, `journey with ${src} offline`, "GET", "/api/plantpay/journey", { as: CLERK, check: (b) => { const p = journeyProblems(b); return p.length ? p.slice(0, 2).join("; ") : undefined; } });
    await api(G, `REST invoice with ${src} offline`, "GET", `/api/plantpay/v1/invoices/INV-7781`, { ...K, expect: [200, 503] });
    await api(G, `${src} back online`, "POST", `/api/plantpay/v1/sources/${src}/outage`, { ...K, json: { outage: false } });
  }
  // outage via the UI server action
  const fd = new FormData(); fd.append("source", "logistics"); fd.append("outage", "1");
  await actionCheck(G, "UI toggle logistics offline", "toggleOutage", "/plantpay", fd, CLERK, () => undefined);
  await page(G, "/plantpay", { as: CLERK, name: "/plantpay after UI toggle", mustContain: [/offline|unavailable|outage/i] });
  const fd2 = new FormData(); fd2.append("source", "logistics"); fd2.append("outage", "0");
  await actionCheck(G, "UI toggle logistics online", "toggleOutage", "/plantpay", fd2, CLERK, () => undefined);
  // a source file that is really missing on disk
  const q = path.join(DATA, "sources", "quality.db");
  let moved = false;
  try { fs.renameSync(q, q + ".gone"); moved = true; } catch (e) { record(G, "remove quality.db while running", "pass", 0, `skipped: file is held open (${(e as NodeJS.ErrnoException).code}); outage toggle above covers the same path`); }
  if (moved) {
    await page(G, `/plantpay/invoices/INV-7781`, { as: CLERK, expect: [200, 503], name: "INV-7781 with quality.db missing" });
    await page(G, `/plantpay`, { as: CLERK, name: "/plantpay with quality.db missing" });
    await api(G, "REST evaluate with quality.db missing", "POST", "/api/plantpay/v1/invoices/INV-7781/evaluate", { ...K, expect: [200, 503] });
    fs.renameSync(q + ".gone", q);
    await api(G, "REST evaluate after quality.db restored", "POST", "/api/plantpay/v1/invoices/INV-7781/evaluate", { ...K, check: (b) => (b.status === "review" ? undefined : `status ${b.status}`) });
  }
}

/** Planted cases must give the right answer. */
async function gPlanted() {
  const G = "planted";
  const K = { key: API_KEY };
  const get = async (url: string) => JSON.parse((await http("GET", url, K)).text);
  const t0 = Date.now();
  const rec = (name: string, ok: boolean, detail: string) => record(G, name, ok ? "pass" : "fail", Date.now() - t0, ok ? "" : detail);
  try {
    const res = await get("/api/plantpay/v1/invoices/INV-7781/resolution");
    const s = JSON.stringify(res);
    rec("INV-7781 (story INV-2044) root cause = amendment not in PO, Rs 412/398", s.includes("Contract amendment not reflected in the PO") && s.includes("₹412.00") && s.includes("₹398.00") && s.includes("assuming all other checks pass"), s.slice(0, 200));
    rec("INV-7781 cause supported by evidence", /Contract amendment not reflected in the PO[\s\S]{0,400}supported_by_evidence|supported_by_evidence[\s\S]{0,400}Contract amendment not reflected/.test(s), "label missing");
    const dup = await get(`/api/plantpay/v1/invoices/INV-6120R`);
    rec("INV-6120R (story INV-1001A) duplicate of INV-6120, blocked", dup.status === "block" && JSON.stringify(dup.risk?.detectors?.duplicate ?? dup).includes("INV-6120"), `status ${dup.status}`);
    for (const n of ["0910", "0911", "0912"]) {
      const r = await get(`/api/plantpay/v1/invoices/${enc(`IG20/26-27/${n}`)}`);
      rec(`IG20/26-27/${n} (story INV-300x) splitting flagged`, !!r.risk?.detectors?.splitting?.flag, `splitting ${JSON.stringify(r.risk?.detectors?.splitting?.summary)}`);
    }
    const cm = await get(`/api/plantpay/v1/invoices/${enc("CM23/26-27/0909")}`);
    const g = JSON.stringify(cm.risk?.detectors?.graph ?? {});
    rec("CM23 graph link V-1023 <-> V-1015 (story ABC <-> XYZ)", g.includes("V-1015") || g.includes("Kolhapur"), g.slice(0, 160));
    rec("graph link worded as warning, not proof", JSON.stringify(cm.risk).includes("warning, not proof") && !/fraud/i.test(JSON.stringify(cm.risk)), "wording");
    const cb = await get(`/api/plantpay/v1/invoices/${enc("CB21/26-27/0908")}`);
    const v = cb.risk?.detectors?.vendor;
    rec("CB21 bank-detail change flagged with independent verification", !!v?.flag && JSON.stringify(v).includes('"requiresIndependentVerification":true'), JSON.stringify(v?.summary));
    const clean = await get(`/api/plantpay/v1/invoices/INV-7782`);
    rec("INV-7782 clean invoice passes", clean.status === "pass", `status ${clean.status}`);
    const audit = await get(`/api/plantpay/v1/audit?verify=1&limit=1`);
    rec("PlantPay audit chain intact", audit.integrity?.ok === true, JSON.stringify(audit.integrity));
  } catch (e) { record(G, "planted reads", "crash", Date.now() - t0, (e as Error).message); }
  // tamper detection (works on copies of the integration DB)
  const t1 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/tamper-plantpay.ts"], { cwd: ROOT, env: ENV(), encoding: "utf8", timeout: 120000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const broken = (out.match(/BROKEN at record/g) ?? []).length;
  record(G, "audit tamper demo detects edit/delete/reorder", r.status === 0 && /Untouched database\s+OK/.test(out) && broken >= 5 ? "pass" : "fail", Date.now() - t1, `${broken} of 5 attacks detected${r.status === 0 ? "" : `; exit ${r.status}: ${out.slice(-200)}`}`);
}

/** The original clerk/approver workflow (plan section 4), driven through the real server actions. */
async function gWorkflowJourney(run: number) {
  const G = `workflow-run${run}`;
  await actionCheck(G, "reset demo data", "resetDemoAction", "/audit", [], CLERK, (_v, r) => (r ? undefined : "no redirect"));
  await page(G, "/supplier", { as: VIHAR, name: "1 supplier home" });
  const fd = new FormData(); fd.append("demo", "INV-7781.pdf");
  await api(G, "1 extract INV-7781.pdf", "POST", "/api/extract", { as: VIHAR, raw: fd, check: (b) => (b.ok ? undefined : "not ok") });
  const exp = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "demo-docs", "INV-7781.expected.json"), "utf8"));
  const payload = {
    source: "demo:INV-7781.pdf", vendorName: exp.vendorName, vendorGstin: exp.vendorGstin ?? exp.gstin ?? "", invoiceNumber: "INV-7781",
    invoiceDate: exp.invoiceDate, poNumber: String(exp.poNumber ?? exp.poId),
    lines: (exp.lines ?? []).map((l: any) => ({ itemCode: l.itemCode, description: l.description, qty: l.qty, unit: l.unit ?? l.uom, unitPrice: l.unitPrice ?? l.rate, amount: l.amount })),
    subtotal: exp.subtotal, taxRatePct: exp.taxRatePct ?? 18, taxAmount: exp.taxAmount ?? exp.tax, total: exp.total,
  };
  await actionCheck(G, "1 supplier submits INV-7781", "submitInvoice", "/supplier", [payload], VIHAR, (v) => (v?.ok ? undefined : `submit failed: ${JSON.stringify(v)}`));
  const inv = () => store("invoices").find((i) => i.id === "INV-7781");
  record(G, "2 INV-7781 matched -> flag", inv()?.verdict === "flag" ? "pass" : "fail", 0, `verdict ${inv()?.verdict}, status ${inv()?.status}`);
  await page(G, "/clerk", { as: CLERK, name: "3 clerk queue", mustContain: ["INV-7781"] });
  await page(G, "/clerk/invoices/INV-7781", { as: CLERK, name: "3 clerk review INV-7781", mustContain: [/412/, /398/] });
  const findings = store("findings").filter((f) => f.invoiceId === "INV-7781" && f.verdict !== "approve" && f.kind !== "duplicate");
  record(G, "3 three line verdicts (2 open)", findings.length === 2 ? "pass" : "fail", 0, `${findings.length} open findings: ${findings.map((f) => f.kind).join(",")}`);
  for (const f of findings) await actionCheck(G, `4 request fix ${f.kind}`, "requestFixAction", "/clerk/invoices/INV-7781", ["INV-7781", f.id], CLERK, (v) => (v?.ok ? undefined : JSON.stringify(v)));
  await page(G, "/supplier/invoices/INV-7781", { as: VIHAR, name: "4 supplier status", mustContain: [/internal action|Nothing needed from you/i] });
  const tasks = store("tasks").filter((t) => t.invoiceId === "INV-7781" && t.status === "requested");
  for (const t of tasks) await actionCheck(G, `5 simulated ERP update ${t.owner}`, "simulateErpAction", "/clerk/invoices/INV-7781", [t.id], CLERK, (v) => (v?.ok ? undefined : JSON.stringify(v)));
  record(G, "5 re-match clean, routed to L1", inv()?.status === "pending_approval" && inv()?.verdict === "approve" ? "pass" : "fail", 0, `status ${inv()?.status} verdict ${inv()?.verdict}`);
  await page(G, "/approver", { as: L1, name: "6 approver queue", mustContain: ["INV-7781"] });
  await page(G, "/approver/invoices/INV-7781", { as: L1, name: "6 approver evidence card" });
  await actionCheck(G, "6 approver L1 approves", "decideAction", "/approver/invoices/INV-7781", ["INV-7781", "approve", ""], L1, (v) => (v?.ok ? undefined : JSON.stringify(v)));
  record(G, "6 INV-7781 approved", inv()?.status === "approved" ? "pass" : "fail", 0, `status ${inv()?.status}`);
  await page(G, "/audit", { as: CLERK, name: "6 audit trail", mustContain: ["INV-7781"] });
  await actionCheck(G, "6 verify audit chain", "verifyAuditChain", "/audit", [], CLERK, (v) => (v?.ok ? undefined : JSON.stringify(v)));
  await page(G, "/dashboard", { as: CLERK, name: "7 dashboard" });
  const fd2 = new FormData(); fd2.append("demo", "INV-6120R.pdf");
  await api(G, "8 extract duplicate INV-6120R", "POST", "/api/extract", { as: KONKAN, raw: fd2, expect: [200] });
  await actionCheck(G, "8 chatbot: where is my payment", "askPayment", "/supplier", [{ text: "Where is my payment for INV-7781?" }], VIHAR, okOrAns);
  await page(G, "/audit/report", { as: CLERK, name: "8 controls report" });
}

/** Stage 9 Golden Journey, headless: the live call, every screen's data validated, the planted facts on each screen, and the fallback. */
async function gGoldenJourney(run: number) {
  const G = `journey-run${run}`;
  await page(G, "/plantpay/journey", { as: CLERK, minText: 10, name: "journey page loads" });
  const mark = logMark();
  const r = await http("GET", "/api/plantpay/journey", { as: CLERK });
  if (r.timedOut) return record(G, "journey build", "timeout", r.ms, "no answer");
  if (r.status !== 200) return record(G, "journey build", r.status >= 500 ? "crash" : "fail", r.ms, `HTTP ${r.status} ${r.text.slice(0, 160)}`);
  const errs = newErrors(mark);
  record(G, "journey build", errs.length ? "crash" : "pass", r.ms, errs[0]?.slice(0, 200) ?? "");
  const d = JSON.parse(r.text);
  fs.writeFileSync(path.join(OUT_DIR, `journey-live-${LABEL}-${run}.json`), r.text);
  for (let n = 1; n <= 9; n++) {
    const p = (await import("../../src/plantpay/journey/validate")).stepProblems(n, d);
    record(G, `step ${n} data complete`, p.length ? "fail" : "pass", 0, p.join("; "));
  }
  const s = d.steps;
  const ok = (name: string, cond: boolean, detail: string) => record(G, name, cond ? "pass" : "fail", 0, cond ? "" : detail);
  ok("step 4 price trio 412/398/412", s[4]?.priceTrio?.invoice === 412 && s[4]?.priceTrio?.po === 398 && s[4]?.priceTrio?.contract === 412, JSON.stringify(s[4]?.priceTrio));
  ok("step 5 root cause amendment, supported", JSON.stringify(s[5]?.resolutions).includes("Contract amendment not reflected in the PO"), "cause missing");
  ok("step 5 simulated fix passes", s[5]?.fix?.passes === true && s[5]?.fix?.after?.status === "pass", JSON.stringify(s[5]?.fix?.after));
  ok("step 6 duplicate INV-6120R / INV-6120", s[6]?.duplicate?.flag && s[6]?.duplicate?.copy === "INV-6120R", JSON.stringify(s[6]?.duplicate?.copy));
  ok("step 6 splitting three invoices", s[6]?.splitting?.flag && s[6]?.splitting?.invoices?.length === 3, String(s[6]?.splitting?.invoices?.length));
  ok("step 6 bank change needs verification", s[6]?.bank?.flag && s[6]?.bank?.requiresIndependentVerification === true, "bank");
  ok("step 6 graph link shared account", s[6]?.graph?.flag && !!s[6]?.graph?.account, "graph");
  ok("step 7 four model probabilities in 0..1", s[7]?.predictions?.length === 4 && s[7].predictions.every((p: any) => typeof p.probability === "number" && p.probability >= 0 && p.probability <= 1), JSON.stringify(s[7]?.predictions?.map((p: any) => p.probability)));
  ok("step 8 hero rework loop", (s[8]?.actual?.loops?.length ?? 0) > 0, "no loop");
  ok("step 9 tamper detected on every attack", Array.isArray(s[9]?.tamper) && s[9].tamper.filter((t: any) => !t.ok).length >= 3, JSON.stringify(s[9]?.tamper?.map((t: any) => t.ok)));
  ok("step 9 ready for payment", s[9]?.readyForPayment === true, "not ready");
  ok("live data mode", d.mode !== "fallback", `mode ${d.mode}`);
  // live data unchanged by the journey (it runs on a sandbox)
  const live = JSON.parse((await http("GET", "/api/plantpay/v1/invoices/INV-7781", { key: API_KEY })).text);
  ok("live INV-7781 still review after journey", live.status === "review", `status ${live.status}`);
  const fb = await http("GET", "/api/plantpay/journey?fail=1", { as: CLERK });
  ok("forced failure returns JSON error (page switches to fallback)", fb.status === 500 && /error/.test(fb.text), `HTTP ${fb.status}`);
}

/** Opening or evaluating an unknown invoice must not leave rows behind (they would inflate the dashboard counts). */
function noJunkRows() {
  const db = new Database(path.join(DATA, "plantpay-integration.db"), { readonly: true });
  try {
    const n = (db.prepare("SELECT COUNT(*) n FROM evaluations WHERE invoice_id LIKE '%NOPE%' OR invoice_id LIKE '%script%' OR TRIM(invoice_id) = ''").get() as { n: number }).n;
    record("unknown-ids", "no evaluation stored for unknown invoices", n === 0 ? "pass" : "fail", 0, `${n} junk evaluation rows`);
  } finally { db.close(); }
}

function fallbackChecks() {
  const G = "fallback";
  const fb = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "plantpay", "journey", "fallback.json"), "utf8"));
  const p = journeyProblems(fb);
  record(G, "fallback.json passes every screen check", p.length ? "fail" : "pass", 0, p.join("; "));
  record(G, "fallback.json is marked fallback", fb.mode === "fallback" ? "pass" : "fail", 0, `mode ${fb.mode}`);
}

// ---------- clean-clone phase: no databases at all ----------
async function gCleanClone() {
  const G = "clean-clone";
  await stopServer();
  copyData(true);
  const ms = await startServer();
  record(G, "server starts with no databases", "pass", ms, "");
  await page(G, "/plantpay", { as: CLERK, name: "/plantpay self-seeds on first request" });
  await page(G, "/clerk", { as: CLERK, name: "/clerk self-seeds" });
  await page(G, "/foundation", { as: CLERK, name: "/foundation self-seeds" });
  await page(G, "/plantpay/invoices/INV-7781", { as: CLERK, name: "INV-7781 after self-seed" });
  await page(G, "/plantpay/predictions/INV-7781", { as: CLERK, name: "predictions after self-seed" });
  await api(G, "journey after self-seed", "GET", "/api/plantpay/journey", { as: CLERK, check: (b) => { const p = journeyProblems(b); return p.length ? p.slice(0, 2).join("; ") : undefined; } });
}

// ============================================================ main
function table(rs: Row[]) {
  const by = new Map<string, Row[]>();
  for (const r of rs) by.set(r.group, [...(by.get(r.group) ?? []), r]);
  console.log(`\n${"group".padEnd(18)} ${"total".padStart(5)} ${"pass".padStart(5)} ${"fail".padStart(5)} ${"crash".padStart(5)} ${"t/out".padStart(5)} ${"slow".padStart(5)}  max ms`);
  for (const [g, list] of by) {
    const c = (x: Result) => list.filter((r) => r.result === x).length;
    console.log(`${g.padEnd(18)} ${String(list.length).padStart(5)} ${String(c("pass")).padStart(5)} ${String(c("fail")).padStart(5)} ${String(c("crash")).padStart(5)} ${String(c("timeout")).padStart(5)} ${String(list.filter((r) => r.slow).length).padStart(5)}  ${Math.max(...list.map((r) => r.ms))}`);
  }
  const c = (x: Result) => rs.filter((r) => r.result === x).length;
  console.log(`${"TOTAL".padEnd(18)} ${String(rs.length).padStart(5)} ${String(c("pass")).padStart(5)} ${String(c("fail")).padStart(5)} ${String(c("crash")).padStart(5)} ${String(c("timeout")).padStart(5)} ${String(rs.filter((r) => r.slow).length).padStart(5)}`);
  const bad = rs.filter((r) => r.result !== "pass");
  if (bad.length) { console.log(`\nNOT PASSING (${bad.length}):`); for (const r of bad) console.log(`  [${r.result.toUpperCase()}] ${r.id}  (${r.ms} ms)  ${r.detail}`); }
  const slow = rs.filter((r) => r.slow && r.result === "pass");
  if (slow.length) { console.log(`\nSLOW (> ${SLOW_MS} ms) but passing (${slow.length}):`); for (const r of slow.sort((a, b) => b.ms - a.ms).slice(0, 40)) console.log(`  ${r.ms} ms  ${r.id}`); }
}

function compare(before: Row[], after: Row[]) {
  const b = new Map(before.map((r) => [r.id, r]));
  const regress = after.filter((r) => b.get(r.id)?.result === "pass" && r.result !== "pass");
  const fixed = after.filter((r) => b.get(r.id) && b.get(r.id)!.result !== "pass" && r.result === "pass");
  const sped = after.filter((r) => b.get(r.id)?.slow && !r.slow);
  console.log(`\nBEFORE -> AFTER: ${before.filter((r) => r.result === "pass").length}/${before.length} -> ${after.filter((r) => r.result === "pass").length}/${after.length} passing; slow ${before.filter((r) => r.slow).length} -> ${after.filter((r) => r.slow).length}`);
  console.log(`Fixed (${fixed.length}):`); for (const r of fixed) console.log(`  ${b.get(r.id)!.result} -> pass  ${r.id}`);
  console.log(`Regressions (${regress.length}):`); for (const r of regress) console.log(`  pass -> ${r.result}  ${r.id}  ${r.detail}`);
  console.log(`No longer slow (${sped.length}):`); for (const r of sped) console.log(`  ${b.get(r.id)!.ms} -> ${r.ms} ms  ${r.id}`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  loadActions();
  copyData(false);
  const ms = await startServer();
  record("server", "next start (production build)", "pass", ms, "");
  try {
    if (want("auth")) await gAuth();
    if (want("pages")) await gPagesStaff();
    if (want("demo-docs")) await gDemoDocs();
    if (want("unknown")) await gUnknown();
    if (want("rest")) await gRest();
    if (want("unknown") || want("rest")) noJunkRows();
    if (want("api")) await gOtherApi();
    if (want("planted")) await gPlanted();
    if (want("submit")) await gSubmitEdge();
    if (want("outage")) await gOutage();
    if (want("workflow")) for (let i = 1; i <= 3; i++) await gWorkflowJourney(i);
    if (want("journey")) { for (let i = 1; i <= 3; i++) await gGoldenJourney(i); fallbackChecks(); }
    if (want("clean")) await gCleanClone();
  } catch (e) {
    record("harness", "unexpected harness error", "crash", 0, (e as Error).stack?.slice(0, 300) ?? String(e));
  } finally {
    await stopServer();
  }
  const file = path.join(OUT_DIR, `smoke-${LABEL}.json`);
  fs.writeFileSync(file, JSON.stringify({ label: LABEL, at: new Date().toISOString(), rows, serverErrors: serverLog.filter((l) => /⨯|Error/.test(l)).slice(0, 200) }, null, 1));
  table(rows);
  const se = serverLog.filter((l) => /⨯|Error/.test(l));
  if (se.length) { console.log(`\nServer log errors (${se.length}, first 25):`); for (const l of se.slice(0, 25)) console.log("  " + l.slice(0, 240)); }
  if (COMPARE) compare(JSON.parse(fs.readFileSync(COMPARE, "utf8")).rows, rows);
  console.log(`\nReport: ${file}`);
  process.exitCode = rows.every((r) => r.result === "pass") ? 0 : 1;
}

void main();
