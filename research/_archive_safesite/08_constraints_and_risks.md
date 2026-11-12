# 08 Constraints & Risks

**TL;DR**
- App is NOT an emergency channel; must direct imminent danger to emergency response. [INFERRED – ASK MENTOR for site number/process]
- Top AI risks: wrong severity, false reassurance, false duplicates, poor voice/OCR in noise/accents — all need human review.
- Privacy: photos of people, GPS/location, identity of reporter; DPDP Act applies in India (S11).
- Q2 constraints (gloves, noise, offline, restricted phones, multilingual) are first-class requirements.
- Hackathon-relevant: even with fake data, show controls (RBAC, confidence, override, audit trail, declared AI).

## Operational safety
- Reporting ≠ emergency response; show "Immediate danger? Stop work, alert, call emergency" first. [INFERRED]
- Humans decide severity and safety actions; AI never closes or downgrades a report. [INFERRED]
- Reports don't replace permit-to-work/process-safety controls; La Porte shows procedure/training gaps (S5).
## Workplace reality (Q2 CONFIRMED – maximise)
Gloves (large targets, voice, one-tap), noise (text fallback, visual confirmation), poor connectivity (offline queue), restricted phones (designated zones, shared kiosk/QR at area entrance [ASSUMPTION]), shifts, low light (flash, quality prompt), languages EN/HI/MR [ASSUMPTION], shared devices (no persistent login leak), contractor access via site-issued code.
## Cybersecurity
RBAC (3 roles), least privilege, session timeout on shared devices, image access control, retention policy [ASSUMPTION], IT/OT separation — app must not touch control systems. [INFERRED]
## Privacy/compliance
- DPDP Act: employment-purpose processing (s.7(i) "legitimate use") may not need consent but must be limited to what is necessary; unrelated uses need a lawful basis; rules notified 14 Nov 2025, with some provisions phased to May 2027 per one source — verify (S11). [VERIFIED-secondary]
- Blurring faces in photos / avoid capturing people unless needed [INFERRED]. Anonymous/confidential option addresses fear of blame (S7).
- Indian OSH Code: hazardous-process risk assessment duties retained; contract-labour threshold >50 workers (S9); enforcement status [UNKNOWN – verify].
## AI risks
| Risk | Control (show in demo) |
|---|---|
| Misclassification | Confidence shown; human override; log both |
| Severity under-call | Rule-based floor on keywords (e.g. "leak", "fire"), safety-manager review |
| False duplicate | Flag/link only, never auto-merge |
| Poor ASR | Editable transcript; text fallback |
| Hallucinated summary | Show source text beside summary |
| Bias/language | Test with EN/HI/MR samples |
| Explainability | "Why" field (matched keywords/similar report) |
Cross-refs: [01](01_problem_breakdown.md), [07](07_tech_landscape.md).
