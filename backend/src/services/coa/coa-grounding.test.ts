// Print-based regression test — รัน: npx ts-node src/services/coa/coa-grounding.test.ts
// ยืนยัน: dropUngroundedItems ตัด row ที่ LLM ปั้น (ไม่มีใน OCR) ออก แต่ไม่แตะ row จริง
import { dropUngroundedItems } from "./coa-grounding";
import { RawCoaItem } from "./ollama-coa.service";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}

// ★ เคสจริง 1F1710 ★ — เอกสารเป็น pulp COA (Canadian Std Freeness) แต่ LLM ปั้น metal COA
const PULP_OCR = [
  "INNOVATIVE FIBERS",
  "Batch Property Data",
  "Canadian Std Freeness (ml)  Avg 241.417  Spec 160.000 - 360.000",
  "Fiber Length (mm)  Avg 1.090  Spec 0.920 - 1.420",
  "Percent Moisture (%)  Avg 8.100  Spec 5.000 - 11.000",
].join("\n");

const hallucinated: RawCoaItem[] = [
  { name: "Tin (Sn)", method: "DUPONT Method", specRaw: "0.5", result: "0.42" },
  { name: "Iron (Fe)", method: "DUPONT Method", specRaw: "1.0", result: "0.98" },
  { name: "Manganese (Mn)", method: "DUPONT Method", specRaw: "0.5", result: "0.46" },
];
const r1 = dropUngroundedItems(hallucinated, PULP_OCR);
check("1F1710: drop ทั้ง 3 hallucinated row", r1.kept.length === 0 && r1.dropped.length === 3, `(kept=${r1.kept.length})`);

// row จริงที่อยู่ในเอกสาร → ต้องเก็บไว้ครบ
const realRows: RawCoaItem[] = [
  { name: "Canadian Std Freeness", specMin: "160.000", specMax: "360.000", result: "241.417" },
  { name: "Fiber Length", specMin: "0.920", specMax: "1.420", result: "1.090" },
  { name: "Percent Moisture", specMin: "5.000", specMax: "11.000", result: "8.100" },
];
const r2 = dropUngroundedItems(realRows, PULP_OCR);
check("row จริงทั้ง 3 ไม่โดน drop", r2.kept.length === 3 && r2.dropped.length === 0, `(dropped=${r2.dropped.length})`);

// name เพี้ยน (OCR อ่านชื่อพัง) แต่ result+spec ตรงทั้งคู่ → เก็บ (number grounding ต้องครบทั้งคู่)
const garbledName: RawCoaItem[] = [
  { name: "C@n@d1@n 5td Fr33n3ss", specMin: "160.000", specMax: "360.000", result: "241.417" },
];
const r3 = dropUngroundedItems(garbledName, PULP_OCR);
check("name เพี้ยนแต่ result+spec ตรงทั้งคู่ → เก็บ", r3.kept.length === 1, `(kept=${r3.kept.length})`);

// ★ critical (เคส Tin/Iron จริง) ★ result บังเอิญตรงเลขใน OCR แต่ name+spec ไม่มี → ต้อง drop
const coincidental: RawCoaItem[] = [
  { name: "Lead (Pb)", specRaw: "0.5", result: "241.417" }, // result ชนค่าจริง แต่ชื่อ+spec ไม่มี
];
const r3b = dropUngroundedItems(coincidental, PULP_OCR);
check("result บังเอิญตรงเลขเดียว (name+spec ไม่มี) → drop", r3b.kept.length === 0 && r3b.dropped.length === 1, `(kept=${r3b.kept.length})`);

// ★ co-location (เคส Tin จริง) ★ result ตรงบรรทัด 1 (241.417), spec ตรงบรรทัด 3 (8.100) แต่คนละบรรทัด → drop
const crossLine: RawCoaItem[] = [
  { name: "Zinc (Zn)", specRaw: "8.100", result: "241.417" }, // ทั้งคู่มีใน OCR แต่คนละบรรทัด
];
const r3c = dropUngroundedItems(crossLine, PULP_OCR);
check("result/spec คนละบรรทัด → drop (co-location)", r3c.kept.length === 0 && r3c.dropped.length === 1, `(kept=${r3c.kept.length})`);

// name สั้น "tin" ต้องไม่ ground จาก substring คำอื่น ("Testing" ใน OCR)
const shortName: RawCoaItem[] = [
  { name: "Tin (Sn)", specRaw: "0.5", result: "0.42" }, // 0.5/0.42 ไม่มีใน OCR + "tin" ไม่ใช่ทั้งคำ
];
const r3d = dropUngroundedItems(shortName, PULP_OCR + "\nTesting Printing Continuous");
check("name สั้น 'tin' ไม่ ground จาก 'Testing' → drop", r3d.kept.length === 0, `(kept=${r3d.kept.length})`);

// digits-only fallback: result อ่านทศนิยมหาย (8100 จาก 8.100) + spec ตรง → เก็บ
const decimalLost: RawCoaItem[] = [
  { name: "Zzz Unknown Param", specMin: "5.000", specMax: "11.000", result: "8100" },
];
const r4 = dropUngroundedItems(decimalLost, PULP_OCR);
check("digits-only fallback (8100 ↔ 8.100) + spec ตรง → เก็บ", r4.kept.length === 1, `(kept=${r4.kept.length})`);

// mixed: 2 จริง + 1 ปั้น → เก็บ 2 ตัด 1
const mixed: RawCoaItem[] = [
  { name: "Fiber Length", specMin: "0.920", specMax: "1.420", result: "1.090" },
  { name: "Lead (Pb)", specRaw: "0.5", result: "0.41" }, // ปั้น — ไม่มีใน OCR
  { name: "Percent Moisture", specMin: "5.000", specMax: "11.000", result: "8.100" },
];
const r5 = dropUngroundedItems(mixed, PULP_OCR);
check("mixed: เก็บ 2 จริง ตัด 1 ปั้น", r5.kept.length === 2 && r5.dropped.length === 1, `(kept=${r5.kept.length}, dropped=${r5.dropped.map((d) => d.name).join("/")})`);

// guard: OCR ว่าง → ไม่ตัดอะไร (ไม่มีข้อมูลให้ ground, อย่าลบมั่ว)
const r6 = dropUngroundedItems(realRows, "");
check("OCR ว่าง → ไม่ drop (ปล่อยผ่าน)", r6.kept.length === 3 && r6.dropped.length === 0);

console.log(failures === 0 ? "\nALL PASS ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
