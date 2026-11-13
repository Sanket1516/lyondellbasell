// Builds the landing page (landing/ -> public/landing). If the landing dependencies are not installed, keeps the committed
// build in public/landing so `npm run demo` still works on a fresh clone without network access.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const built = fs.existsSync("public/landing/index.html");
if (!fs.existsSync("landing/node_modules")) {
  if (built) { console.log("landing: dependencies not installed, using the committed build in public/landing (run `npm run landing:install` to rebuild)."); process.exit(0); }
  console.error("landing: no build in public/landing and no dependencies. Run `npm run landing:install` first."); process.exit(1);
}
const r = spawnSync("npm", ["--prefix", "landing", "run", "build"], { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
