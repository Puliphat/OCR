import { evaluateCoa, formatReport } from "./coa-evaluator";

// Mock: Inolob T204F (single "Specification" column with ranges + "White")
const inolob = evaluateCoa({
  filename: "20260305_Inolob_T204F.pdf",
  product: "POLYTETRAFLUOROETHYLENE INOLUB T204F",
  lotNo: "4303L5204S",
  items: [
    { name: "Colour",            unit: "-",        specRaw: "White",   result: "White" },
    { name: "Bulk Density",      unit: "g/l",      specRaw: "275-425", result: "387" },
    { name: "Partical Size D50", unit: "μm",       specRaw: "2-6",     result: "3.47" },
    { name: "Melt Flow Rate",    unit: "g/10 min", specRaw: "2-4",     result: "2.12" },
    { name: "Melting point",     unit: "°C",       specRaw: "326-330", result: "328.86" },
  ],
});

// Mock: TR_1099 (separate Min/Max cols + Avg result)
const teijin = evaluateCoa({
  filename: "20260306_TR_1099.pdf",
  product: "TWARON® PULP 1099",
  lotNo: "100027797",
  items: [
    { name: "Fiber length av. (LL)",   unit: "mm",     specMin: "0.90", specMax: "1.35", result: { avg: 1.00, min: undefined, max: undefined, raw: "1.00" } },
    { name: "Specific Surface Area",   unit: "m2/g",   specMin: "9.00", specMax: "13.00", result: { avg: 11.15, raw: "11.15" } },
    { name: "Moisture content",        unit: "%(m/m)", specMin: "4.0",  specMax: "8.0",   result: { avg: 6.5, raw: "6.5" } },
  ],
});

// Mock: TXAX-A (≤, ~, equal text)
const txax = evaluateCoa({
  filename: "20260513_TXAX-A.pdf",
  product: "TXAX-A (Potassium Hexatitanate)",
  lotNo: "A-63045",
  items: [
    { name: "Color",           specRaw: "Light Yellow Color", result: "Light Yellow Color" },
    { name: "Chemical Formula", specRaw: "K2Ti6O13",          result: "K2Ti6O13" },
    { name: "Median Diameter", unit: "μm",  specRaw: "40.0 ~ 70.0", result: "54.1" },
    { name: "pH",                          specRaw: "7.0 ~ 9.0",   result: "7.7" },
    { name: "Moisture Content", unit: "%", specRaw: "≦ 0.2",       result: "0.09" },
    { name: "Bulk Density",     unit: "g/cm3", specRaw: "0.33 ~ 0.53", result: "0.43" },
  ],
});

// Mock: D-2072 (mix of ± and ≥)
const d2072 = evaluateCoa({
  filename: "20260513_D-2072.pdf",
  product: "CS-2402-02",
  lotNo: "D-2072",
  items: [
    { name: "Viscosity",            specRaw: "7 ± 3",   result: "6.6" },
    { name: "Solid Content",        unit: "%",    specRaw: "26.0 ± 2.0",  result: "27.06" },
    { name: "Shear Strength (Room)",specRaw: "120 ± 30", result: "124.9" },
    { name: "Heat Resistance",      specRaw: "≥ 50",     result: "136.5" },
  ],
});

// Mock failing case
const failing = evaluateCoa({
  filename: "synthetic-failing.pdf",
  items: [
    { name: "Should Fail (over max)",   specRaw: "0-10",    result: "11" },
    { name: "Should Fail (under min)",  specRaw: "10-20",   result: "9.99" },
    { name: "Should Fail (above le)",   specRaw: "≤ 5",     result: "5.01" },
    { name: "Should Fail (below ge)",   specRaw: "≥ 50",    result: "49.9" },
  ],
});

for (const r of [inolob, teijin, txax, d2072, failing]) {
  console.log(formatReport(r));
}
