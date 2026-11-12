// Renders each of the nine journey screens to HTML from the pre-computed data and checks the visible text: every screen draws,
// shows its feature content, and never shows a raw error or placeholder.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Screen from "@/app/plantpay/journey/Screens";
import fallback from "./fallback.json";
import { JOURNEY_STEPS, type JourneyData } from "./types";

const data = fallback as unknown as JourneyData;
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const MUST: Record<number, RegExp[]> = {
  1: [/Source health/, /Architecture/, /Story key/, /Intact/],
  2: [/What the supplier sees/, /Invoice uploaded/, /INV-7781/],
  3: [/Take Logistics DB offline/, /Restore Logistics DB/, /weighbridge/],
  4: [/Contract \(amended\)/, /₹412/, /₹398/, /Unit normalisation/, /Quality check applied/],
  5: [/Root cause/, /Counterfactual/, /assuming all other checks pass/, /Ask why/, /Tasks routed/, /Re-match passes/],
  6: [/Duplicate/, /Splitting/, /Bank-account change/, /Graph link/, /warning, not proof/],
  7: [/Relationship strength/, /Model A/, /Model B/, /Model C/, /Model D/, /AUC/],
  8: [/Expected/, /Actual/, /rework loop/, /Bottleneck/],
  9: [/Tampering detected/, /Ready for payment/, /Process-Mining Twin/, /Hash-Chained Audit Trail/],
};

describe("journey screens render", () => {
  for (let n = 1; n <= JOURNEY_STEPS; n++) {
    it(`step ${n} draws real content with no raw errors`, () => {
      const t = text(renderToStaticMarkup(createElement(Screen, { step: n, data, onJump: () => undefined })));
      expect(t.length).toBeGreaterThan(400);
      expect(t).not.toMatch(/undefined|NaN|\[object|Traceback|ENOENT|SQLITE_|Error:/);
      for (const re of MUST[n]) expect(t, `step ${n} should show ${re}`).toMatch(re);
    });
  }
  it("the closing screen lists every feature in the checklist", () => {
    const t = text(renderToStaticMarkup(createElement(Screen, { step: 9, data, onJump: () => undefined })));
    for (const c of data.steps[9].checklist) expect(t).toContain(c.feature);
    expect(data.steps[9].checklist).toHaveLength(18);
  });
});
