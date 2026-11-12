# 07 Tech Landscape (options only)

**TL;DR**
- Evidence: OCR/LLM comparison blogs — no rigorous head-to-head benchmark found (S11); stack facts below are general knowledge [INFERRED], verify versions.
- Reported pattern: hybrid — deterministic text extraction for digital PDFs, OCR for scans, LLM for messy/unknown layouts, deterministic rules for matching (S11).
- OCR engines don't output structured invoice fields themselves; structure is built on top (S11).
- Matching/duplicate logic should be rule-based and explainable; AI extraction needs confidence + human review.
- LYB stack mentions (D): Azure, Azure OpenAI, Power BI, ServiceNow, MuleSoft, Snowflake — for architecture-slide alignment, not a decision.

| Tech | Role in P2P | OSS/Commercial | Complexity | Prototype fit | Limits |
|---|---|---|---|---|---|
| React/Next, Tailwind | UI, roles, dashboards | OSS | Low | High | — |
| FastAPI / Node-Express | APIs, matching engine | OSS | Low | High | — |
| PyMuPDF, pdfplumber | Text/table from digital PDFs | OSS | Low | High | Scans need OCR |
| Tesseract / EasyOCR / PaddleOCR | OCR for images | OSS | Med | Med | Tables weak (Tesseract), setup heavier (Paddle) (S11) |
| OpenCV | Preprocess scans | OSS | Low–med | Med | — |
| LLM structured extraction (JSON schema) | Messy layouts | Commercial/API (Azure OpenAI etc.) | Low–med | High | Cost, hallucination → validate vs schema |
| Rule-based 3-way match | Core decisions | Own code | Low | High | Needs tolerance config |
| Fuzzy matching (e.g. rapidfuzz) | Vendor/item names, duplicates | OSS | Low | High | False positives |
| Anomaly detection (ML) | Outlier prices | OSS | Med | Low (needs data) | Synthetic data only |
| Confidence scoring | Review routing | Own | Low | High | Calibration |
| SQLite/Postgres/MySQL/Mongo | Data | OSS | Low | SQLite/Postgres | — |
| Recharts/Chart.js/Power BI | Dashboards | OSS/commercial | Low | High | Power BI not needed in demo |
| ERP integration (S/4HANA, Ariba APIs, REST, webhooks) | Concept for pilot | Commercial | High | Low (no access) | No real SAP access |
| Local/Vercel/Render/Azure | Hosting | mixed | Low | Local = safest for live demo | Network risk |
Synthetic data: invoices as generated PDFs/images, PO/GR/vendor CSV. Declare GenAI. Cross-refs: [08](08_constraints_and_risks.md).
