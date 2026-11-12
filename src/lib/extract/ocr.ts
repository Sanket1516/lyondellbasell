// OCR for scanned invoice images with Tesseract.js. Fully offline: the English model ships in node_modules. Node only.
import path from "node:path";
import sharp from "sharp";
import type { PageSize, TextItem } from "./types";

interface OcrWord { text: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface OcrLine { words: OcrWord[]; bbox: { x0: number; y0: number; x1: number; y1: number } }

export async function readImageItems(buf: Buffer, timeoutMs = 15000): Promise<{ items: TextItem[]; pages: PageSize[] }> {
  // Normalise: honour EXIF rotation, greyscale, and make sure the text is large enough for the model.
  const base = sharp(buf).rotate();
  const meta = await base.metadata();
  const scale = (meta.width ?? 0) < 1400 ? 1400 / (meta.width ?? 1400) : 1;
  const png = await base.greyscale().normalise().resize({ width: Math.round((meta.width ?? 1400) * scale) }).png().toBuffer();
  const info = await sharp(png).metadata();
  const W = info.width ?? 1, H = info.height ?? 1;

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    langPath: path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"),
    cacheMethod: "none",
    gzip: true,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      worker.recognize(png, {}, { blocks: true }),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("OCR timed out")), timeoutMs); }),
    ]);
    const lines: OcrLine[] = [];
    for (const b of result.data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) lines.push(l as unknown as OcrLine);
    const items: TextItem[] = [];
    for (const l of lines) {
      const lh = Math.max(1, l.bbox.y1 - l.bbox.y0);
      const centre = (l.bbox.y0 + l.bbox.y1) / 2;
      for (const w of l.words) {
        if (!w.text.trim()) continue;
        items.push({ str: w.text, x: w.bbox.x0, y: l.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: lh, base: centre, page: 0 });
      }
    }
    return { items, pages: [{ w: W, h: H }] };
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
