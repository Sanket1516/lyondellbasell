"use client";
// Last-resort boundary for a failure in the root layout itself. It replaces the whole document, so it carries its own html/body and
// inline styles (the app stylesheet may be what failed).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0d1117", fontFamily: "system-ui, sans-serif", color: "#e6edf3", padding: 16 }}>
        <div role="alert" style={{ maxWidth: 520, background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 28 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>The app could not be loaded</h1>
          <p style={{ color: "#8b949e", lineHeight: 1.5, margin: "0 0 18px" }}>Nothing was changed. Try again in a moment.</p>
          <button type="button" onClick={() => reset()} style={{ font: "inherit", background: "#2f81f7", color: "#fff", border: 0, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>Try again</button>
          {error.digest && <p style={{ marginTop: 16, fontSize: 12, color: "#8b949e" }}>Reference {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
