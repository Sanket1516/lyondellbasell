import "server-only";
import fs from "node:fs";
import path from "node:path";

export const DEMO_DIR = path.join(process.cwd(), "data", "demo-docs");
export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export interface DemoDoc { file: string; label: string }

/** Demo documents on disk, with the label shown in the dropdown (read from each .expected.json). */
export function listDemoDocs(): DemoDoc[] {
  if (!fs.existsSync(DEMO_DIR)) return [];
  return fs
    .readdirSync(DEMO_DIR)
    .filter((f) => /\.(pdf|jpg)$/.test(f))
    .sort()
    .map((file) => {
      try {
        const e = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, file.replace(/\.(pdf|jpg)$/, ".expected.json")), "utf8"));
        const kind = file.endsWith(".jpg") ? "scanned image" : "PDF";
        return { file, label: `${file.replace(/\.(pdf|jpg)$/, "")} · ${e.vendorName} · ${kind}` };
      } catch {
        return { file, label: file };
      }
    });
}

const UPLOAD_NAME = /^[a-f0-9]{16}\.(pdf|jpg|png)$/;

/** Resolve a "demo:<file>" or "upload:<file>" reference to a file path, or undefined if it is not allowed. */
export function resolveSource(src: string): string | undefined {
  const [scheme, name] = [src.slice(0, src.indexOf(":")), src.slice(src.indexOf(":") + 1)];
  if (scheme === "demo" && /^[A-Za-z0-9_.-]+\.(pdf|jpg)$/.test(name) && listDemoDocs().some((d) => d.file === name)) return path.join(DEMO_DIR, name);
  if (scheme === "upload" && UPLOAD_NAME.test(name)) return path.join(UPLOAD_DIR, name);
  return undefined;
}

export const MIME: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png" };
