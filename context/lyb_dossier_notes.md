# LYB Dossier — extracted notes

Source: `context/LyondellBasell_Intelligence_Dossier_Nov2026.pdf` (15 pages, data cut-off 11 Nov 2026; latest filing Q3 2026 10-Q/8-K, 30 Oct 2026). Compiled from public sources; unverifiable figures are marked "Data unavailable" in the PDF. Figures US$. Open the PDF for sources/footnotes.

## Corrections to the research brief (dossier says read first)
- 2024 revenue $40.3B as reported **includes closed Refining**; comparable continuing ops = **$33.4B**; 2025 = $30.2B.
- **Five** reporting segments (not four): O&P-Americas, O&P-EAI, Intermediates & Derivatives (I&D), Advanced Polymer Solutions (APS), Technology. Refining was a 6th until 2025 exit.
- **Three** HQs: Houston, London, Rotterdam (no simple Houston/Rotterdam split).
- Ethylene oxide sale: announced 8 Dec 2023 ($700M), **closed Q2 2024** ($293M pre-tax gain).
- Houston refinery ceased operations **Feb 2025** (not end-Q1).
- MoReTec-1 start-up now guided to **2027** (older pages say end-2026).
- Tech stack (Azure DevOps, MuleSoft, Tableau, Terraform) is **not disclosed**; inferred from LYB job postings only.

## Company snapshot
- LyondellBasell Industries N.V. (NYSE: LYB), Dutch N.V.; one of the world's largest polymer producers and leading PE/PP process licensor.
- CEO Peter Vanacker (since 2022, ex-Neste); CFO Agustin Izquierdo (since 1 Mar 2025). ~18,970 employees (end-2025, after 7%/~1,350 cut). 24 sites at end-2025 before May 2026 European sale.
- Largest holder Access Industries (Len Blavatnik) ~20%.
- India entity: Basell Polyolefins India Pvt. Ltd., 101–104 Godrej Two, Vikhroli (East), Mumbai (= hackathon venue). Hosts Digital Technology, SAP, data engineering, process engineering, project controls, procurement roles for global sites.
- Formed Dec 2007 (Basell + Lyondell); Chapter 11 Jan 2009, emerged Apr 2010.
- Strategy (3 pillars, 2023 CMD): (1) grow/upgrade core — exit disadvantaged assets (EO&D, Houston refinery, European O&P, Dutch PO JV, Brindisi PP), grow US Gulf Coast + Middle East JVs; (2) Circular & Low Carbon Solutions — Circulen family: CirculenRecover (mechanical), CirculenRevive (advanced/MoReTec), CirculenRenew (bio-based); (3) performance & culture — Value Enhancement Program ($1.1B recurring EBITDA 2025, target $1.5B by 2028), Cash Improvement Plan ($800M in 2025, target cumulative $1.3B by end-2026). Original $3B-by-2027 target: ~$1.3B unlocked by end-2024, treat as at risk.

## Segments (what they sell)
- O&P-Americas: ethylene, propylene, PE/PP from US ethane/NGL crackers (Q3 2026 feed ~75% ethane). 9M 2026 EBITDA ex-items $2,235M.
- O&P-EAI: Europe/Asia/International olefins, PE, PP + JV income. 9M 2026 $338M.
- I&D: PO & derivatives, oxyfuels (MTBE/ETBE), styrene, acetyls, methanol. 9M 2026 $1,405M (Q3 record $795M).
- APS: PP compounds, engineered plastics, masterbatches (ex-A. Schulman); auto-heavy; Q3 volumes −9%; goodwill fully impaired 2025. 9M 2026 $181M.
- Technology: PE/PP licensing, Avant catalysts. 9M 2026 $121M (FY2025 EBITDA fell 53%).
- Licensing: Spheripol PP >33 Mt/yr; Spherizone >10 Mt/yr; Hostalen ACP HDPE >10 Mt/yr; Lupotech LDPE/EVA; >300 licences; Asia-Pacific & India largest region (77 Spheripol, 52 Lupotech, 43 Hostalen, 22 Spherizone). IOCL chose Hostalen ACP for 500 kt/yr HDPE (Jan 2025).

## Leadership (verify before quoting)
Vanacker CEO · Izquierdo CFO · Kim Foley EVP Global O&P · Aaron Ledet EVP I&D · Torkel Rhenman EVP APS · Jeffrey Kaplan EVP & GC (also Procurement) · Dale Friedrichs EVP Operational Excellence & HSE (leads VEP) · Jim Seward EVP & Chief Innovation Officer · Yvonne van der Laan EVP CLCS · Trisha Conley EVP People & Culture · David Dennison Head of IR (from Mar 2026).

## Digital / technical stack (from LYB job postings — indirect evidence)
- Org: Digital Technology (DT) in "Innovation" division; sub-teams: DT Services, Data Engineering, SAP CoEs (Record-to-Report, Lead-to-Cash), BI-Sustainability, Enterprise Architecture. Hubs: Houston, Rotterdam, London, Mumbai ("Mumbai-470"), Poznań. Hackathon organiser "DTS Bits & Bytes" likely from DT Services. Mumbai = peer delivery centre.
- Cloud: Azure (primary) + AWS; AKS, Azure SQL/MI, Synapse, Data Lake, Data Factory, Function Apps.
- IaC: Terraform (confirmed), Bicep/CloudFormation; ServiceNow integration via GitHub Actions.
- CI/CD: Azure DevOps (confirmed), Git, GitHub Enterprise/Actions, Jenkins, Docker/Kubernetes.
- Integration: MuleSoft (confirmed), Azure Integration Services, Kafka, RabbitMQ, Service Bus, REST/SOAP.
- Data: Snowflake, Databricks, SAP HANA, Informatica/SSIS, historians/IoT.
- BI: Tableau (confirmed), Power BI, Alteryx.
- ERP: SAP ECC → S/4HANA (live for one segment); BTP, SuccessFactors, SAP TM, GTS, Service Cloud.
- Trading: Endur, Allegro, Entrade; ICE/CME/Platts data.
- Ops/AI: ServiceNow ITSM, AppDynamics; LLM integration via **AWS Bedrock / Azure OpenAI**.
- LYBOM (LYB Operating Model): S/4HANA transformation, value streams R2R, Plan-to-Perform, **Source-to-Pay (digital procurement/invoice processing)**, Lead-to-Cash, **Produce-to-Deliver (supply chain)**. Goal: "scalable fixed costs". Mumbai tail-spend roles use AI/digital sourcing tools.
- Not published: architecture docs, engineering blog, public API, carrier/rail/warehouse network data.

## Physical supply chain
US Gulf Coast core (Channelview, La Porte, Bayport, Matagorda, Corpus Christi, Victoria, Mont Belvieu; Clinton IA; Morris IL); exports mostly via Houston Ship Channel. Q3 2026 US crackers ~90% on ~75% ethane; EAI ~70%. Q4 2026 utilisation guide: 85% NA O&P, 60% EU O&P, 75% I&D. Cash Improvement Plan cut trade working capital ~$400M (2025).

## Circular tech
MoReTec: catalytic pyrolysis of mixed post-consumer plastic; pilot Ferrara (2020); MoReTec-1 = 50 kt/yr at Wesseling, DE (€40M EU Innovation Fund), both reactors installed Aug 2026; feed from Source One Plastics JV (Eicklingen). Digital product passport (blockchain) prototype shown at PlastIndia 2023. Mondelez Marabou wrappers 75% recycled content (Jul 2026). Circulen volumes +65% in 2024 to >200 kt.

## Financials
| US$ M | 2023 | 2024 | 2025 |
|---|---|---|---|
| Sales (continuing) | n/a | 33,394 | 30,153 |
| Net income | 2,121 | 1,367 | (738) |
| EBITDA ex-items | 5,222 | 4,336 (4,185 restated) | 2,543 |
| Diluted EPS | 6.46 | 4.15 | (2.34) |

2026: Q1 sales 7,197 / Q2 9,177 / Q3 8,499 (9M 24,873); net income 125 / 559 / 758 (9M 1,442); EBITDA ex-items 615 / 2,127 / 1,512 (9M 4,254). Q2 net income includes $734M pre-tax loss on European sale. Liquidity 30 Sep 2026: $3.2B cash, $7.7B available. Dividend cut 50% on 20 Feb 2026 ($1.37 → $0.69/qtr, saves ~$900M/yr). Ratings: Moody's Baa3, S&P BBB-, Fitch BBB (all stable). Debt ~$12.3B bonds; next maturity $891M Mar 2027. 2026 capex plan ~$1.2B. Cash conversion 95% in 2025. ~85% of 9M 2026 segment EBITDA from US Gulf Coast (O&P-Americas + I&D).

## Divestitures / closures
EO&D to INEOS (closed Q2 2024, $700M) · Houston refinery shut Feb 2025 (~400 jobs; ~40 Mt/yr Scope 3 removed) · four European O&P sites (Berre, Münchsmünster, Carrington, Tarragona) to AEQUITA/"Velogy", closed 1 May 2026, $734M loss · Dutch PO JV (Maasvlakte) closure · Brindisi PP closing 2026 · Houston plastic-waste sorting facility $74M impairment (Q2 2026).

## Competitors
Dow, ExxonMobil Chemical, SABIC, INEOS, BASF, Borealis/Borouge, Sinopec & Chinese majors, Chevron Phillips/Braskem/Formosa, Reliance Industries (India). Moat: US ethane feedstock advantage, licensing toll-gate, PO/TBA scale, circular first-mover (MoReTec unproven). Exposures: feedstock, packaging demand, auto (APS), gasoline cracks, Middle East (~6 Mt PE offline until ≥2027, record +$0.30/lb April PE contract increase), China overcapacity, European energy costs.

## ESG, safety, risk
- 2030 targets revised 23 Feb 2026: Scope 1+2 reduction 42% → **32%** vs 2020; recycled/renewable polymers 2 Mt → **800 kt**/yr; ≥50% renewable electricity unchanged.
- **La Porte (27 Jul 2021):** ~164,000 lb acetic acid/methyl iodide release; contractors removed pressure-retaining bolts from plug valve; 2 killed, ~30 hospitalised, ~$40M damage; CSB (May 2023): no procedure/training for the task.
- EPA/DOJ flaring decree (Oct 2021): $3.4M penalty, ~$50M upgrades on 21 flares. Texas Clean Air Act suit vs Equistar (Apr 2025); TCEQ agreed order (May 2025).
- Vulnerabilities: Gulf Coast concentration/hurricanes, windfall dependence (normalisation "non-linear"), asset reliability (Bayport outage), European rump, auto cycle, licensing capex cycle, leverage one notch above high-yield, S/4HANA migration execution risk (order-to-cash disruption).

## Hackathon playbook (dossier's suggestions, not organiser hints)
Judges = LYB staff, likely Digital Technology.
| LYB priority | Pitch angle | Stack to mention |
|---|---|---|
| Cash Improvement Plan / fixed costs | Automate finance/procurement/IT-ops (invoice exception triage, tail spend) | S/4HANA, ServiceNow, Power BI/Tableau |
| Value Enhancement Program | Predictive maintenance / anomaly detection on historian/IoT | Data Factory, Databricks, Snowflake |
| Operating-rate discipline | Demand/price signal dashboard → recommended run rates | Snowflake, Power BI, ICE/Platts |
| Circular & Low Carbon | Recycled-content traceability / digital product passport; MoReTec feed-quality scoring | Azure, ledger, ESG reporting |
| Safety core value | Permit-to-work / live-equipment checklist assistant (La Porte) | Mobile + LLM (Azure OpenAI) |
| LYBOM / S/4HANA | Data-migration quality checker, process mining L2C/S2P | SAP BTP, MuleSoft |
| Sustainability reporting | Scope 1/2 tracking to 32%; renewable-power tracker | IT Sustainability roles (Mumbai) |

Facts for a pitch: Spheripol >33 Mt/yr, APAC & India largest licensee region · US crackers ~90% on ~75% ethane, O&P-Americas $2.2B EBITDA in 9M · Cash Improvement Plan $1.3B target → frame in cash/fixed-cost terms · MoReTec-1 50 kt/yr, feed quality is critical.
Mentor questions: LYBOM sequencing / next value stream live? · which plant data already landed in Azure/Snowflake/Databricks? · DT Mumbai run vs build split? · GenAI (Azure OpenAI/Bedrock) pilot or production?

## Event logistics (from participant guide via dossier)
Report by 09:00 both days (cut-off 09:30). Bring government photo ID, college ID, laptop, charger, adapters. Day 1: safety briefing 10:00, hacking 11:00–17:30. Day 2: hacking 10:00–12:00, presentations 13:30–15:30, awards 17:00. No photos/videos by participants. Business formals/casuals. Visitors escorted; inform an organiser before leaving premises. Contact: lybmumbaihackathon@lyondellbasell.com; reception +91 22 6916 1111.
