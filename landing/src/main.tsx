import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (bundled by Vite into /landing/assets; no font CDN).
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/spline-sans-mono/400.css";
import "lenis/dist/lenis.css";
import "./global.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
