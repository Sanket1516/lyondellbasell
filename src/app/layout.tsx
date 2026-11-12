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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
