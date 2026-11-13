// End-to-end test of the landing page, against the running Next.js server (production build).
//   node landing/e2e/scroll.mjs                      (BASE defaults to http://127.0.0.1:3000)
//   BASE=http://127.0.0.1:3300 node landing/e2e/scroll.mjs
// Uses the installed Microsoft Edge through playwright-core (no browser download). Checks:
//   - the page reaches "ready" and only ever requests its own origin (anything else is aborted and reported);
//   - with the network switched OFF, all 12 chapters render (3D), one screenshot per chapter;
//   - a continuous wheel scroll from top to bottom produces no console errors;
//   - Lite mode renders every chapter; a 900 px wide window renders without horizontal overflow;
//   - the skip link is the first focus stop; every CTA signs in to the right role's page;
//   - writes landing/screens/*.png and a contact sheet. Exit code 1 on any failure.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "screens");
fs.mkdirSync(OUT, { recursive: true });
const EDGE = process.env.EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: fs.existsSync(EDGE) ? EDGE : undefined, channel: fs.existsSync(EDGE) ? undefined : "msedge", headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-unsafe-swiftshader"],
});

async function open(ctx, url, label) {
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    external.push(u);
    return route.abort();
  });
  const t0 = Date.now();
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 45000 });
  const readyMs = Date.now() - t0;
  const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1);
  console.log(`      ${label}: ready in ${readyMs} ms, first contentful paint ${Math.round(fcp)} ms`);
  return { page, errors, external, readyMs, fcp };
}
const chapterIds = async (page) => page.evaluate(() => [...document.querySelectorAll("main > section")].map((s) => s.id));

// ------------------------------------------------------------------ 1. 3D, network off, one screenshot per chapter
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const { page, errors, external, fcp } = await open(ctx, "/?lite=0&fpsguard=0", "3D");
  const mode = await page.evaluate(() => document.documentElement.dataset.mode);
  const renderer = await page.evaluate(() => window.__story?.renderer ?? "");
  ok("3D mode starts", mode === "3d", `renderer: ${renderer}`);
  ok("first contentful paint under 2 s", fcp >= 0 && fcp < 2000, `${Math.round(fcp)} ms`);
  await ctx.setOffline(true);
  const ids = await chapterIds(page);
  ok("12 chapters on the page", ids.length === 12, ids.join(", "));
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate((k) => window.__story.goTo(k, true), i);
    await sleep(1500);
    const shown = await page.evaluate((id) => {
      const el = document.querySelector(`#${id} [data-copy]`) ?? document.querySelector(`#${id}`);
      const st = getComputedStyle(el);
      return st.visibility !== "hidden" && Number(st.opacity) > 0.85;
    }, ids[i]);
    const c = await page.evaluate(() => window.__story.c());
    ok(`chapter ${String(i).padStart(2, "0")} ${ids[i]}: text shown, scene at chapter`, shown && Math.abs(c - i) < 0.05, `c=${c.toFixed(3)}`);
    await page.screenshot({ path: path.join(OUT, `3d-${String(i).padStart(2, "0")}-${ids[i]}.png`) });
  }
  // continuous scroll, top to bottom, measuring frame rate in the page
  await page.evaluate(() => window.__story.goTo(0, true));
  await sleep(600);
  await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); window.__t0 = performance.now(); });
  await page.mouse.move(700, 450);
  let steps = 0;
  for (; steps < 600; steps++) {
    await page.mouse.wheel(0, 140);
    await sleep(40);
    const done = await page.evaluate(() => window.scrollY + innerHeight >= document.documentElement.scrollHeight - 4);
    if (done) break;
  }
  await sleep(1500);
  const fps = await page.evaluate(() => window.__frames / ((performance.now() - window.__t0) / 1000));
  const end = await page.evaluate(() => window.__story.c());
  ok("wheel scroll reaches the last chapter", end > 10.9, `${steps} wheel steps, c=${end.toFixed(2)}, ${fps.toFixed(0)} fps in this headless run`);
  ok("3D: no console errors (network off)", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("3D: no request leaves the server", external.length === 0, external.slice(0, 3).join(", "));
  await ctx.close();
}

// ------------------------------------------------------------------ 2. Lite mode, network off
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const { page, errors, external } = await open(ctx, "/?lite=1", "Lite");
  await ctx.setOffline(true);
  ok("Lite mode starts", (await page.evaluate(() => document.documentElement.dataset.mode)) === "lite");
  ok("Lite mode has no WebGL canvas", (await page.locator("canvas").count()) === 0);
  const ids = await chapterIds(page);
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate((k) => window.__story.goTo(k, true), i);
    await sleep(1100);
    await page.screenshot({ path: path.join(OUT, `lite-${String(i).padStart(2, "0")}-${ids[i]}.png`) });
  }
  ok("Lite: no console errors (network off)", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("Lite: no request leaves the server", external.length === 0, external.slice(0, 3).join(", "));
  await ctx.close();
}

// ------------------------------------------------------------------ 3. 900 px wide window (3D)
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 1 });
  const { page, errors } = await open(ctx, "/?lite=0&fpsguard=0", "900px");
  for (const i of [0, 4, 6, 7, 11]) {
    await page.evaluate((k) => window.__story.goTo(k, true), i);
    await sleep(1400);
    await page.screenshot({ path: path.join(OUT, `narrow-${String(i).padStart(2, "0")}.png`) });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok("900 px: no horizontal overflow", overflow <= 0, `${overflow}px`);
  ok("900 px: no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ------------------------------------------------------------------ 4. keyboard and the call-to-action deep links
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await open(ctx, "/?lite=1", "keyboard");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  ok("first Tab stop is the skip link", first === "Skip to the live demo", first);
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  ok("focus is visible", ring !== "none", ring);
  const links = await page.evaluate(() => [...document.querySelectorAll("#live-demo a[href^='/demo/']")].map((a) => ({ href: a.getAttribute("href"), text: a.querySelector("span")?.textContent })));
  ok("four demo buttons", links.length === 4, links.map((l) => l.text).join(", "));
  await ctx.close();
  const want = { "/demo/clerk?next=%2Fplantpay%2Fjourney": "/plantpay/journey", "/demo/supplier": "/supplier", "/demo/clerk": "/clerk", "/demo/approver": "/approver" };
  for (const l of links) {
    const c2 = await browser.newContext();
    const p = await c2.newPage();
    const resp = await p.goto(BASE + l.href, { waitUntil: "domcontentloaded" });
    const url = new URL(p.url());
    const body = await p.locator("body").innerText();
    const target = want[l.href];
    ok(`"${l.text}" opens ${target} signed in`, url.pathname === target && resp?.status() === 200 && !/Sign in to/i.test(body.slice(0, 400)), `${resp?.status()} ${url.pathname}`);
    await c2.close();
  }
}

await browser.close();

// ------------------------------------------------------------------ contact sheets
async function sheet(prefix, title, file) {
  const shots = fs.readdirSync(OUT).filter((f) => f.startsWith(prefix) && f.endsWith(".png")).sort();
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#05070d;color:#e8edf5;font:14px/1.4 "Segoe UI",sans-serif;padding:28px}
    h1{font-size:20px;margin:0 0 18px;font-weight:600} .g{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
    figure{margin:0} img{width:100%;display:block;border-radius:6px;border:1px solid #1f2a3d} figcaption{margin-top:6px;color:#a3aec0;font-size:12px}
  </style><h1>${title}</h1><div class="g">${shots.map((s) => `<figure><img src="${s}"><figcaption>${s.replace(".png", "")}</figcaption></figure>`).join("")}</div>`;
  const htmlFile = path.join(OUT, `${file}.html`);
  fs.writeFileSync(htmlFile, html);
  const b = await chromium.launch({ executablePath: fs.existsSync(EDGE) ? EDGE : undefined, headless: true });
  const p = await b.newPage({ viewport: { width: 1800, height: 1000 } });
  await p.goto("file:///" + htmlFile.replace(/\\/g, "/"));
  await p.waitForLoadState("load");
  await p.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: true });
  await b.close();
  fs.rmSync(htmlFile);
}
await sheet("3d-", "PlantPay landing · 3D mode · one frame per chapter (1440×900, network off)", "contact-sheet");
await sheet("lite-", "PlantPay landing · Lite mode (1440×900, network off)", "contact-sheet-lite");

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
fs.writeFileSync(path.join(OUT, "e2e-report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 1));
process.exit(failed.length ? 1 : 0);
