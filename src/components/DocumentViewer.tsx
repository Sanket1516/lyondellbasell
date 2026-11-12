"use client";
import { useEffect, useRef, useState } from "react";
import type { BBox, PageSize } from "@/lib/extract/types";
import s from "./DocumentViewer.module.css";

/** Shows the original document (PDF pages drawn with pdf.js, or an image) with one highlighted region. */
export function DocumentViewer({ src, kind, pages, highlight }: { src: string; kind: "pdf" | "image"; pages: PageSize[]; highlight: BBox | null }) {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">(kind === "pdf" ? "loading" : "ready");

  useEffect(() => {
    if (kind !== "pdf") return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const res = await fetch(`/api/document?src=${encodeURIComponent(src)}`);
        if (!res.ok) throw new Error("fetch");
        const task = pdfjs.getDocument({ data: await res.arrayBuffer() });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        for (let p = 1; p <= doc.numPages && !cancelled; p++) {
          const page = await doc.getPage(p);
          const vp = page.getViewport({ scale: 2 });
          const canvas = canvases.current[p - 1];
          if (!canvas) continue;
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; destroy?.(); };
  }, [src, kind]);

  return (
    <div className={s.viewer} aria-label="Original document">
      {state === "loading" && <p className={s.status}>Drawing the document…</p>}
      {state === "error" && <p className={s.status} role="alert">The document preview could not be drawn. The extracted fields are still available.</p>}
      {pages.map((pg, i) => (
        <div key={i} className={s.page} style={{ aspectRatio: `${pg.w} / ${pg.h}` }}>
          {kind === "pdf" ? (
            <canvas ref={(el) => { canvases.current[i] = el; }} className={s.canvas} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/document?src=${encodeURIComponent(src)}`} alt="Scanned invoice" className={s.canvas} onError={() => setState("error")} />
          )}
          {highlight && highlight.page === i && (
            <div
              className={s.mark}
              aria-hidden="true"
              style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.w * 100}%`, height: `${highlight.h * 100}%` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
