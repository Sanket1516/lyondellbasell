import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/spline-sans-mono/400.css";
import "@fontsource/spline-sans-mono/500.css";
import "@/styles/tokens.css";

export const metadata: Metadata = {
  title: "Plant X Payables Desk",
  description: "Invoice matching and approval for Plant X accounts payable (prototype, synthetic data).",
};

// Theme before first paint (no flash): ?theme=light|dark, else the saved choice (shared with the landing page), else the system setting.
const THEME_SCRIPT = `(function(){try{var t=new URLSearchParams(location.search).get("theme");if(t!=="light"&&t!=="dark"){try{t=localStorage.getItem("plantpay-landing-theme")}catch(e){t=null}}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
