# LYB Mumbai Hackathon 2026 — Project Guide

## 1. Project context
- Event: LYB Mumbai Hackathon 2026 (LyondellBasell, Mumbai, 12–13 Nov 2026).
- Problem statement: announced Day 1 at 11:00 AM. NOTE: the Round 2 statements PDF is already in `data/` and summarised in `context/problem_statements.md` (4 options: Circular Plastics Exchange, SafeSite, Order-to-Delivery Control Tower, Smart Procure-to-Pay). Team chose PS4: Smart Procure-to-Pay Assistant (SafeSite research archived in research/_archive_safesite/).
- **Golden rule: ONE app, ONE golden user journey.**
- Synthetic data only. No real LYB data, credentials or systems. Never commit secrets (`.env` is git-ignored; use `.env.example`).
- **Locked scope (PS4):** only the 5 core items + 3 listed bonus items (duplicates, chatbot, controls report). Prototype demo on predefined documents, not a full website. Stack: Next.js + TypeScript + CSS Modules. No runtime AI in the decision path. UI must not look AI-generated. Plan and tickets: plan/tickets/00_PLAN.md, T1-T5.
- Scoring/rules (see `context/problem_statements.md`): working prototype 20 pts, impact 15 pts; GenAI use must be declared (undeclared = −10); every member must be able to explain all code.

## 2. Team, roles, workflow
- **Sanket** — team leader & builder (Claude Code).
- **Lokesh** — tester (Google Antigravity).
- **Utkarsh** — tester (OpenAI Codex).

Workflow:
1. Sanket builds **one ticket per fresh session** (`prompts/04`).
2. Lokesh/Utkarsh test **every** ticket (`prompts/05`) and **never edit feature code** — test and report only.
3. Merge to `main` only after **PASS**. `main` must always run.

## 3. Timeline
- Day 1 (12 Nov) at venue: 11:00–17:30 (safety briefing 10:00).
- Overnight build.
- Code freeze ~06:00 Day 2 (13 Nov).
- Report at venue 09:00 Day 2.
- Presentations 13:30 (10 min per team); awards 17:00.

## 4. Project memory protocol
<!-- TODO: paste "Part A" of prompts/06_CONTEXT_HANDOFF_PROMPT.md here WORD FOR WORD,
     including the NEXT_AGENT_PROMPT.md rule. prompts/06 did not exist at setup time,
     so it could not be copied. Do not paraphrase. -->
**[PENDING — Part A of prompts/06 not yet available.]**

## 5. Where things live
| Folder | Purpose / created by |
|---|---|
| `context/` | Reference docs: LYB dossier PDF + extracted notes (`lyb_dossier_notes.md`, `problem_statements.md`) |
| `prompts/` | The 01–08 prompt files (01 kickoff, 02 options, 03 plan, 04 build, 05 test, 06 handoff, 07 post-freeze, 08 if ahead) |
| `data/` | Organiser-provided data (problem-statement PDF); `.gitkeep` otherwise |
| `research/` | Research output (prompt 01) |
| `solutions/` | Candidate solutions (prompt 02) |
| `plan/tickets/` | Build tickets (prompt 03, built via 04) |
| `plan/handoffs/` | Session handoffs (prompt 06) |
| `plan/testing/` | Test reports (prompt 05) |
| `plan/bugs/` | Bug reports from testers |
| `project-state/` | Current state; start at `00_START_HERE.md` |
| `pitch/` | Pitch/slides/architecture diagram (prompt 07) |
| `landing/` | Landing page |
| `src/` | App code (at the venue) |

## 6. Company context
Read `context/LyondellBasell_Intelligence_Dossier_Nov2026.pdf` before researching LYB; don't re-search facts already in it. A condensed version is in `context/lyb_dossier_notes.md`.
