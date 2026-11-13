// Checks that Log out is visible and works for every staff/supplier role on short screens (laptop and projector heights).
//   BASE=http://127.0.0.1:3300 node landing/e2e/logout-check.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "screens");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await chromium.launch({ executablePath: fs.existsSync(EDGE) ? EDGE : undefined, channel: fs.existsSync(EDGE) ? undefined : "msedge", headless: true });
let failed = 0;
for (const vp of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  for (const role of ["clerk", "approver", "supplier"]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/demo/${role}`);
    const btn = page.getByRole("button", { name: "Log out" });
    const box = await btn.boundingBox();
    const inView = !!box && box.y >= 0 && box.y + box.height <= vp.height;
    if (role === "clerk" && vp.height === 720) await page.screenshot({ path: path.join(OUT, "logout-clerk-1280x720.png") });
    await btn.click();
    await page.waitForURL("**/login");
    const back = await (await ctx.request.get(`${BASE}/${role}`, { maxRedirects: 0 })).status();
    const ok = inView && back >= 300 && back < 400;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${role} at ${vp.width}x${vp.height}: Log out ${inView ? `visible at y=${Math.round(box.y)}` : "NOT visible"}; after click on /login; /${role} now ${back}`);
    await ctx.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
