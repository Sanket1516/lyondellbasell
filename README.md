# <PROJECT TITLE — TBD>

LYB Mumbai Hackathon 2026 · 12–13 Nov 2026

## Team
- Sanket — team leader & builder (Claude Code)
- Lokesh — tester (Google Antigravity)
- Utkarsh — tester (OpenAI Codex)

## How to run
Requires Node 20+.

```
npm install
npm run dev          # http://localhost:3000, redirects to /login
npm run build        # production build with type check
npm start            # serve the production build
npm test             # unit tests (vitest)
npm run reset        # restore data/state.json from data/seed/
```

Demo accounts (fictional, also shown on the login page):

| Username | Password | Role |
|---|---|---|
| vihar.supplier | Vihar@2026 | Supplier, Vihar Chem Supplies |
| konkan.supplier | Konkan@2026 | Supplier, Konkan Packaging Works |
| priya.clerk | Clerk@2026 | AP Clerk |
| neha.approver | ApproverL1@2026 | Approver L1 |
| rajesh.approver | ApproverL2@2026 | Approver L2 |

Optional: set `SESSION_SECRET` in `.env` to change the cookie signing key.

## Prompt order
01 → (answer questions) → 02 → team picks one → 03 → loop 04 + 05 → 06 when switching or sleeping → 08 if ahead → 07 after code freeze.
