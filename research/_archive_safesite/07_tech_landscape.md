# 07 Technology Landscape (options only, no architecture decision)

**TL;DR**
- Sourced from general engineering knowledge, NOT web-verified this session; check versions/licences. [INFERRED]
- Best fit for a 2–3 person team in ~1 night: PWA (offline via service worker + IndexedDB) over native; lightweight classifier + embeddings for duplicates; LLM for classification with human override.
- Offline + voice + multilingual are the hard parts (Q2 max priority).
- Use only fictional data; no internal LYB access.
- Keep AI advisory: human confirms severity (Responsible AI, 10 pts).

| Area | Options | Relation | Difficulty / time | Needs internet? | Limits |
|---|---|---|---|---|---|
| Frontend | PWA (React/Next), React Native, Flutter | Mobile-first, offline | PWA lowest | PWA works offline after load | iOS PWA limits; camera/mic permissions |
| Backend | FastAPI, Express, Django | Role APIs, workflow | Low–med | n/a | — |
| DB | SQLite/Postgres | Reports, actions | Low | n/a | Postgres adds ops |
| Voice-to-text | Browser Web Speech API; Whisper (local/API) | Hands-free reporting | Low–med | Web Speech often cloud-based; Whisper can run local | Noise, accents, Hindi/Marathi accuracy |
| Classification | LLM prompt with fixed taxonomy; or small text classifier | Hazard type/severity | Low (LLM) | LLM API needs net; local models possible | Wrong severity; must be human-reviewed |
| Duplicates | Sentence embeddings + zone/time filter | Flag repeats | Low–med | Local model OK | False merges → flag only |
| Vision/PPE | Pretrained object detection (YOLO-family), VLM | PPE bonus | Med–high | Local/GPU optional | Lighting, angles; advisory only |
| Maps/heatmap | Leaflet/SVG plant-zone map, Chart libs | Heatmap area×shift | Low | n/a | Zone grid is synthetic |
| Offline sync | Service worker, IndexedDB, queued POST, idempotency keys | Offline bonus | Med | Needed only at sync | Conflict handling, photo size |
| Synthetic data | Faker + scripted scenarios | Demo/data rules | Low | No | Must be declared fictional |

Constraints for demo: declare GenAI use (−10 if not); explain every component. Cross-refs: [08](08_constraints_and_risks.md).
