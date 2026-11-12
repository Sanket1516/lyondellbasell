"use client";
// Last-resort boundary for a failure in the root layout itself. It replaces the whole document, so it carries its own html/body and
// inline styles (the app stylesheet may be what failed).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f4fb", fontFamily: "system-ui, sans-serif", color: "#14162b", padding: 16 }}>
        <div role="alert" style={{ maxWidth: 520, background: "#fff", border: "1px solid #e3e5f2", borderRadius: 12, padding: 28 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>The app could not be loaded</h1>
          <p style={{ color: "#565b78", lineHeight: 1.5, margin: "0 0 18px" }}>Nothing was changed. Try again in a moment.</p>
          <button type="button" onClick={() => reset()} style={{ font: "inherit", background: "#4f46e5", color: "#fff", border: 0, borderRadius: 8, padding: "9px 16px", cursor: "pointer" }}>Try again</button>
          {error.digest && <p style={{ marginTop: 16, fontSize: 12, color: "#6b7090" }}>Reference {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
