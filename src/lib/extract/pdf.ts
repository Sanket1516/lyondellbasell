// Reads the text layer of a PDF with pdf.js, keeping page coordinates. Node only.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PageSize, TextItem } from "./types";

export async function readPdfItems(data: Uint8Array): Promise<{ items: TextItem[]; pages: PageSize[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, "legacy", "build", "pdf.worker.mjs")).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(data), // pdf.js takes ownership of the buffer, so pass a copy
   
    verbosity: 0,
    standardFontDataUrl: pathToFileURL(path.join(root, "standard_fonts") + path.sep).href,
  });
  const doc = await task.promise;
  const items: TextItem[] = [];
  const pages: PageSize[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      pages.push({ w: vp.width, h: vp.height });
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        const t = raw.transform as number[];
        const size = Math.hypot(t[2], t[3]) || raw.height || 10;
        const [vx, vy] = vp.convertToViewportPoint(t[4], t[5]);
        items.push({ str: raw.str, x: vx, y: vy - size * 0.82, w: raw.width * vp.scale, h: size, base: vy, page: p - 1 });
      }
    }
  } finally {
    await task.destroy();
  }
  return { items, pages };
}
