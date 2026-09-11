// print-based test (ไม่มี test runner ในโปรเจกต์): npx ts-node minmax-column-recovery.test.ts
import { RawCoaItem } from "./ollama-coa.service";
import { OcrToken } from "./rapidocr.service";
import { recoverMinMaxColumns } from "./minmax-column-recovery";

// พิกัดจริงจาก RapidOCR ของ HG-PP#180 (dump-tokens.ts) — สูงเฉลี่ย 50px ต่อบรรทัด
const tk = (text: string, x: number, x2: number, y: number): OcrToken => ({
  text, score: 0.99, x, x2, y, y1: y - 25, y2: y + 25,
});

const HGPP: OcrToken[] = [
  tk("Spec", 1085, 1180, 1178),
  tk("Results", 1412, 1547, 1213),
  tk("Item", 736, 821, 1217),
  tk("Min", 976, 1053, 1255),
  tk("Max", 1205, 1291, 1255),
  tk("Chemical Analysis", 219, 577, 1334), tk("Fe", 741, 813, 1333),
  tk("42.0%", 953, 1075, 1330), tk("一", 1217, 1273, 1332), tk("42.4%", 1456, 1561, 1332),
  tk("S", 760, 795, 1410),
  tk("46.0%", 952, 1074, 1406), tk("一", 1229, 1268, 1413), tk("51.6%", 1455, 1561, 1406),
  tk("Si02", 734, 821, 1485),
  tk("一", 996, 1033, 1488), tk("6.0%", 1192, 1295, 1483), tk("5.1%", 1473, 1561, 1484),
  tk("Size Distribution", 213, 587, 1562), tk("+150μm", 689, 871, 1562),
  tk("一", 996, 1034, 1562), tk("0%", 1188, 1263, 1558), tk("0.0%", 1473, 1561, 1561),
  tk("mn+", 689, 871, 1639),
  tk("一", 996, 1033, 1640), tk("20.0%", 1166, 1288, 1635), tk("0.8%", 1473, 1561, 1636),
  tk("-75μ血", 689, 871, 1715),
  tk("80.0%", 949, 1074, 1712), tk("99.2%", 1450, 1560, 1713),
];

// สิ่งที่ qwen3:4b ให้มาจริงบนใบนี้ — เกณฑ์กับผลสลับกันทุกแถว
const swapped = (): RawCoaItem[] => [
  { name: "Fe", specMin: "42.4", specMax: "42.4", result: "42" },
  { name: "S", specMin: "51.6", specMax: "51.6", result: "46" },
  { name: "Si02", specMin: "5.1", specMax: "5.1", result: "6" },
  { name: "+150μm", specMin: "0", specMax: "0", result: "0" },
  { name: "mn+", specMin: "0.8", specMax: "0.8", result: "20" },
  { name: "-75μ血", specMin: "99.2", specMax: "99.2", result: "80" },
];

let passed = 0;
let failed = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  ok ? passed++ : failed++;
}
const shape = (it: RawCoaItem) => `${it.specMin ?? "-"}~${it.specMax ?? "-"} ผล ${it.result}`;

// 1. เคสจริงเต็มใบ: อ่านคอลัมน์ใหม่จากพิกัด → เกณฑ์/ผลกลับมาตรงใบทุกแถว
{
  const items = swapped();
  const res = recoverMinMaxColumns(items, HGPP);
  check("แก้ครบ 6 แถว", res.fixed.length, 6);
  check("Fe คุมด้านต่ำ", shape(items[0]), "42.0~- ผล 42.4");
  check("S คุมด้านต่ำ", shape(items[1]), "46.0~- ผล 51.6");
  check("Si02 คุมด้านสูง", shape(items[2]), "-~6.0 ผล 5.1");
  check("+150μm คุมด้านสูง", shape(items[3]), "-~0 ผล 0.0");
  check("mn+ คุมด้านสูง", shape(items[4]), "-~20.0 ผล 0.8");
  check("-75μ血 แถวที่ OCR ไม่เก็บขีด", shape(items[5]), "80.0~- ผล 99.2");
  check("ปักธงว่าเกณฑ์มาจากช่องบนใบ", items[0].specFromCell, true);
  check("ล้าง specRaw ให้ทิศมาจากคอลัมน์", items[0].specRaw, null);
}

// 2. ไม่มี token = ไม่มีพิกัดให้ยืนยัน → ห้ามเดา
{
  const items = swapped();
  check("ไม่มี token → ไม่แตะ", recoverMinMaxColumns(items, undefined).fixed.length, 0);
  check("ค่าเดิมอยู่ครบ", shape(items[0]), "42.4~42.4 ผล 42");
}

// 3. ไม่มีหัว Results → ไม่รู้ว่าช่องไหนคือผล → ถอย
{
  const noRes = HGPP.filter((t) => t.text !== "Results");
  check("ขาดหัว Results → ไม่แตะ", recoverMinMaxColumns(swapped(), noRes).fixed.length, 0);
}

// 4. หัว Min/Max 2 ชุด (ตาราง DuPont) → ปล่อยให้ spec-column-recovery จัดการ
{
  const dupont = [...HGPP, tk("Min", 1600, 1660, 1255), tk("Max", 1700, 1760, 1255)];
  check("Min/Max 2 ชุด → ไม่แตะ", recoverMinMaxColumns(swapped(), dupont).fixed.length, 0);
}

// 5. หัวเรียง Results ไว้ซ้ายสุด = คนละทรง (เกณฑ์อยู่หลังผล) → ถอย
{
  const flipped = HGPP.map((t) => (t.text === "Results" ? tk("Results", 300, 430, 1213) : t));
  check("Results อยู่ซ้ายของ Min → ไม่แตะ", recoverMinMaxColumns(swapped(), flipped).fixed.length, 0);
}

// 6. ชื่อที่ไม่มีบนใบ → จับคู่แถวไม่ได้ → ปล่อยผลเดิมของ LLM
{
  const items: RawCoaItem[] = [{ name: "Moisture", specMin: "1", result: "2" }];
  check("ชื่อไม่ตรงแถวไหน → ไม่แตะ", recoverMinMaxColumns(items, HGPP).fixed.length, 0);
}

// 7. เลขที่ตกคร่อมระหว่างคอลัมน์ Max กับ Results → พิสูจน์ไม่ได้ว่าเป็นช่องไหน ทั้งแถวถูกทิ้ง
{
  const straddle = HGPP.map((t) =>
    t.text === "42.4%" ? tk("42.4%", 1320, 1400, 1332) : t
  );
  const items = [{ name: "Fe", specMin: "42.4", specMax: "42.4", result: "42" }];
  check("เลขคร่อมช่อง → ไม่แตะแถวนั้น", recoverMinMaxColumns(items, straddle).fixed.length, 0);
}

// 8. ช่องผลเป็นขีด (ไม่มีค่าให้ตัดสิน) → ไม่สร้างแถวเทียม
{
  const noResult = HGPP.filter((t) => t.text !== "42.4%");
  const items = [{ name: "Fe", specMin: "42.4", specMax: "42.4", result: "42" }];
  check("ไม่มีค่าผลในแถว → ไม่แตะ", recoverMinMaxColumns(items, noResult).fixed.length, 0);
}

// 9. ค่าที่ LLM อ่านถูกอยู่แล้ว → ไม่นับเป็นการแก้ (ธงต้องไม่ขึ้นเปล่า ๆ)
{
  const items: RawCoaItem[] = [{ name: "Fe", specMin: "42.0", specMax: null, result: "42.4" }];
  check("ค่าตรงอยู่แล้ว → ไม่รายงานว่าแก้", recoverMinMaxColumns(items, HGPP).fixed.length, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
