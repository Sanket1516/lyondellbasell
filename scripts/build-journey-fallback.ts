// Writes src/plantpay/journey/fallback.json: the pre-computed journey the page shows when a live call fails.
// Run after `npm run seed:sources` and `npm run train:models`: npm run journey:fallback
import fs from "node:fs";
import path from "node:path";
import { buildJourney } from "../src/plantpay/journey/build";
import { plantpay } from "../src/plantpay/runtime";

const j = buildJourney(plantpay());
j.mode = "fallback";
delete j.ms;
const file = path.join(process.cwd(), "src", "plantpay", "journey", "fallback.json");
fs.writeFileSync(file, JSON.stringify(j, null, 1));
console.log(`Wrote ${file} (${Math.round(fs.statSync(file).size / 1024)} KB, built ${j.builtAt}, hero ${j.hero}).`);
