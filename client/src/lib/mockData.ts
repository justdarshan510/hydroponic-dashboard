
export type RootRotSeverity = 'Healthy' | 'Low' | 'Moderate' | 'High' | 'Severe';

export interface PlantData {
  id: number;
  Soil_Moisture_Percent: number;
  Root_Zone_Temp_C: number;
  Substrate_EC_mS_cm: number;
  Substrate_pH: number;
  Days_Since_Planting: number;
  Root_Rot_Severity: RootRotSeverity;
}

export const MOCK_DATA: PlantData[] = Array.from({ length: 100 }).map((_, i) => {
  const severityRoll = Math.random();
  let severity: RootRotSeverity = 'Healthy';
  if (severityRoll > 0.8) severity = 'Severe';
  else if (severityRoll > 0.6) severity = 'High';
  else if (severityRoll > 0.4) severity = 'Moderate';
  else if (severityRoll > 0.2) severity = 'Low';

  return {
    id: i,
    Soil_Moisture_Percent: 40 + Math.random() * 40, // 40-80%
    Root_Zone_Temp_C: 18 + Math.random() * 12, // 18-30C
    Substrate_EC_mS_cm: 1.5 + Math.random() * 2.5, // 1.5-4.0
    Substrate_pH: 5.0 + Math.random() * 2.5, // 5.0-7.5
    Days_Since_Planting: Math.floor(10 + Math.random() * 50),
    Root_Rot_Severity: severity,
  };
});

export const REMEDIAL_MEASURES = {
  'Healthy': {
    title: "No Action Needed",
    actions: [
      "Continue current irrigation and fertilization schedule.",
      "Monitor regularly for early signs of stress.",
      "Maintain optimal environmental conditions."
    ]
  },
  'K Deficiency': {
    title: "Potassium (K) Deficiency Detected",
    actions: [
      "Apply a potassium-rich fertilizer (e.g., Potassium Sulfate or Potassium Nitrate).",
      "Adjust nutrient solution formulation to increase K levels.",
      "Check substrate pH, as low pH can inhibit K uptake.",
      "Ensure proper drainage to prevent root stress."
    ]
  },
  'N Deficiency': {
    title: "Nitrogen (N) Deficiency Detected",
    actions: [
      "Increase Nitrogen concentration in the nutrient feed.",
      "Apply a foliar spray of urea or calcium nitrate for quick uptake.",
      "Verify irrigation frequency to ensure nutrient delivery.",
      "Monitor EC levels to prevent salt buildup."
    ]
  },
  'P Deficiency': {
    title: "Phosphorus (P) Deficiency Detected",
    actions: [
      "Supplement with a phosphorus-heavy fertilizer.",
      "Check root zone temperature; cold roots uptake P poorly.",
      "Adjust pH to 6.0-6.5 range for optimal P availability.",
      "Inspect roots for damage affecting uptake."
    ]
  },
  'Fungal Infection': {
    title: "Fungal Infection Pattern Detected",
    actions: [
      "Remove heavily infected leaves and isolate affected plants to limit spore spread.",
      "Improve airflow, reduce persistent leaf wetness, and sanitize tools, trays, and reservoirs.",
      "Inspect nutrient solution hygiene and consider an approved fungicidal or biological treatment for your crop.",
      "Recheck pH, EC, and root-zone oxygenation because stressed plants are more vulnerable to fungal pressure."
    ]
  },
  'Unknown': {
    title: "Image Could Not Be Reliably Classified",
    actions: [
      "Upload a clear close-up of a single plant leaf under good lighting.",
      "Avoid screenshots, text images, or photos that do not primarily show a leaf.",
      "Train with a ZIP archive that uses class-named folders or filenames for Healthy, K, N, P, or fungal images."
    ]
  },
  // For Severity Levels
  'Low': { title: "Low Root Rot Risk", actions: ["Monitor soil moisture closely.", "Ensure drainage is adequate."] },
  'Moderate': { title: "Moderate Root Rot Risk", actions: ["Reduce irrigation frequency.", "Apply preventative biological fungicide.", "Check for standing water."] },
  'High': { title: "High Root Rot Risk", actions: ["Flush substrate to remove pathogens.", "Apply curative fungicide.", "Increase root zone oxygenation."] },
  'Severe': { title: "Severe Root Rot", actions: ["Quarantine plants immediately.", "Consider culling heavily infected plants.", "Sanitize all irrigation lines.", "Review overall system hygiene."] },
};

export const PREDICT_SEVERITY = (inputs: {
  moisture: number;
  temp: number;
  ec: number;
  ph: number;
  days: number;
}): RootRotSeverity => {
  // Mock logic: High moisture + High temp = Bad
  const riskScore = (inputs.moisture / 100) * 0.4 + (inputs.temp / 40) * 0.3 + (inputs.days / 60) * 0.3;
  
  if (riskScore > 0.75) return 'Severe';
  if (riskScore > 0.60) return 'High';
  if (riskScore > 0.45) return 'Moderate';
  if (riskScore > 0.30) return 'Low';
  return 'Healthy';
};
