# T1 — Foundation, design system, auth, seed store

**Read first:** `CLAUDE.md`, `plan/tickets/00_PLAN.md` (§3 decisions, §7 UI rules).
**Depends on:** nothing. **Delivers core item:** 1 (separate logins).
**Estimate:** one session.

## Goal
A running Next.js app with the three role logins, the visual identity, the app shell and the data layer that every later ticket builds on. No business logic yet.

## In scope
1. **Scaffold** `src/` as a Next.js (App Router) + TypeScript project. Scripts: `dev`, `build`, `start`, `test`, `seed`, `reset`. One command to run: `npm run dev`.
2. **Design system** in `src/styles/tokens.css` and a small component set (no UI kit): AppShell (left rail + top bar), Button, Input, Select, Table (sticky header, numeric alignment), StatusChip (approve/flag/block/pending/paid), Badge (age), Card/Panel (flat, hairline), Tabs, Modal, Toast, EmptyState, SplitView, Timeline. Fonts: IBM Plex Sans and IBM Plex Mono (self-hosted, so no network needed on stage). Tokens exactly per plan §7.
3. **Auth**: `/login` with username and password, signed session cookie, role guards on route groups `/supplier`, `/clerk`, `/approver`. Demo accounts panel on the login page (click to fill):
   - `vihar.supplier` (Supplier, Vihar Chem Supplies)
   - `konkan.supplier` (Supplier, Konkan Packaging Works)
   - `priya.clerk` (AP Clerk)
   - `neha.approver` (Approver L1, Finance Manager)
   - `rajesh.approver` (Approver L2, Finance Controller)
   Passwords are fictional and shown on the panel. Logout works. Wrong role → friendly "no access" page.
4. **Data layer**: typed repository with in-memory state persisted to `data/state.json`; `reset` restores from `data/seed/` (seed files are created in T2, so use an empty placeholder). Provide types for Vendor, PO, GR, Contract, DeliveryNote, UomRule, Invoice, Finding, Task, AuditEvent, User.
5. **Header controls**: role badge, user name, and a discreet "Reset demo data" action in a footer menu (clerk and approver only).
6. Placeholder landing page per role (empty state, real copy), so navigation is testable.

## Out of scope
Any matching, extraction, dashboards or real data. No registration, password reset or admin screens.

## Acceptance criteria
- [ ] `npm run dev` starts; `npm run build` passes with zero type errors.
- [ ] Each of the 5 demo users can log in; each lands on its own role home; direct URL access to another role's route is blocked.
- [ ] Design review: screenshot of login, supplier home and clerk home reviewed against plan §7 (no gradients, no emoji icons, Plex fonts, tabular numerals, 4px radii).
- [ ] Contrast of text and status chips ≥ 4.5:1; keyboard tab order and focus rings visible.
- [ ] App works fully offline (no CDN/font/network requests; check the network tab).
- [ ] Types for all entities exist and compile.
- [ ] `README.md` "How to run" is filled in.

## Tester checklist (Lokesh / Utkarsh)
Log in as each user; try wrong password; try cross-role URLs; resize to 1366×768 and 1920×1080; tab through the login form; confirm no external requests; confirm the reset control appears only for clerk/approver.

## Handoff
Write `plan/handoffs/T1_handoff.md` (what exists, run commands, component list, open issues). Update `project-state/00_START_HERE.md`.
