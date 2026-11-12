// Material criticality master data (synthetic): how badly production or safety is hurt if the material is not available.
// 1.0 = production stops (process chemistry and gases), 0.7 = critical spares and reagents, 0.5 = maintenance consumables,
// 0.3 = packaging and handling, 0.2 = general and logistics services. Master data, not a model output.
const TIERS: Record<string, number> = {
  "AX-40": 1, "C-12": 1, "SOL-55": 1, "PP-GR": 1, "RES-PF": 1, "PE-MB": 0.9, "TIO2": 0.9, "ZN-ST": 0.9, "CAL-CO3": 0.8, "N2-47": 1, "AR-47": 0.9, "CO2-22": 0.8,
  "SEAL-MS": 0.7, "PMP-IMP": 0.7, "BRG-6205": 0.7, "BV-2SS": 0.7, "FL-2": 0.6, "GSK-2P": 0.6, "KF-500": 0.7, "PH-PR": 0.6, "BUF-3": 0.5, "FUS-10A": 0.6, "CBL-4C": 0.6,
  "GRS-EP2": 0.5, "LUB-68": 0.6, "ANT-FRZ": 0.5, "CLN-IPA": 0.4, "FLT-OIL": 0.5, "BLT-V38": 0.5, "BOLT-M16": 0.4, "ABR-DSC": 0.3, "GLV-NIT": 0.4, "HLM-SF": 0.5,
  "DR-200": 0.4, "CTN-5P": 0.3, "WRAP-500": 0.3, "BAG-25": 0.4, "PAL-WD": 0.3, "LBL-RL": 0.3, "TAPE-48": 0.2, "STRP-PP": 0.2, "FRT-20": 0.4, "DET-1": 0.1,
};
export const criticalityOf = (materialCode: string): number => TIERS[materialCode] ?? 0.4;
