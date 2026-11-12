# T1 handoff — Foundation, design system, auth, seed store

## What exists
- Next.js 15 (App Router) + TypeScript project at the repo root; app code in `src/`. CSS Modules + tokens (`src/styles/tokens.css`, values per plan §7).
- Fonts: IBM Plex Sans (400/500/600) and Plex Mono (400/500) via `@fontsource`, bundled locally. No CDN requests.
- Auth: `/login` (server action, signed HMAC cookie `plantx_session`, 12 h). Role guards in `src/app/{supplier,clerk,approver}/layout.tsx` via `requireRole()` in `src/lib/guard.ts`. Wrong role goes to `/no-access`; anonymous goes to `/login`. Demo accounts panel on the login page fills the form on click.
- Data layer: `src/lib/types.ts` (all entity types), `src/lib/store.ts` (in-memory state persisted to `data/state.json`, `loadSeed()` reads `data/seed/<collection>.json`, `resetState()`). `data/state.json` is git-ignored. `data/seed/` is empty for now (T2 fills it).
- Shell: `AppShell` (top bar with role and name, left rail, "Demo controls" > "Reset demo data" for clerk and approver only).
- Components in `src/components/ui.tsx`: Button, Input, Select, Table, StatusChip, Badge, Panel, Tabs, Modal, useToast, EmptyState, SplitView, Timeline.
- Placeholder home per role with empty states.

## Run commands
`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run reset` (alias `seed`). See README.

## Verified
- `npm run build`: passes, zero type errors. `npm test`: 1 test passes (session token signing and tampering).
- HTTP checks against `next start`: anonymous `/` and `/clerk` redirect to `/login`; each role gets 200 on its own route and a redirect to `/no-access` on the other two; Reset link present for clerk, absent for supplier; the login page references no external URLs.

## Not verified (tester please check)
- Visual design review screenshots (login, supplier home, clerk home) were not taken in this session.
- Contrast ratios were chosen from the plan palette but not measured with a tool; keyboard tab order and focus rings not checked in a browser.
- The real login form submit (server action) and the wrong-password message were not exercised through a browser; the HTTP checks used cookies signed with the same secret.
- Reset action clicked in a browser.

## Notes and open issues
- `typescript` is pinned to 5.9: TS 7 broke Next's `@/` alias resolution.
- `tsconfig` uses `baseUrl: "."` with `@/* -> src/*`.
- Role home pages are placeholders; nav has one item per role until T3/T4/T5 add screens.
- The memory-protocol placeholder in CLAUDE.md section 4 is still pending (not part of T1).
