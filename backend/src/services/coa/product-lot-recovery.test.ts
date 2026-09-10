// Unit test (print-based) — ครอบ recoverProductLot ด้วยข้อความจริงที่ pipeline ดูดได้
// รัน: npx ts-node src/services/coa/product-lot-recovery.test.ts
import { recoverProductLot } from "./product-lot-recovery";

let passed = 0;
let failed = 0;

function check(label: string, text: string, product: string | null, lotNo: string | null) {
  const got = recoverProductLot(text);
  for (const [field, actual, expected] of [
    ["product", got.product, product],
    ["lot", got.lotNo, lotNo],
  ] as const) {
    if (actual === expected) {
      passed++;
    } else {
      failed++;
      console.error(`  ✗ ${label} [${field}] got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`);
    }
  }
}

// CIIR1066 — ใบเดียวกันมีทั้งป้ายลูกค้าและป้ายสินค้า ห้ามหยิบผิดฝั่ง
check(
  "CIIR: ป้ายลูกค้าไม่ชนะป้ายสินค้า",
  `Customer Name：
ENEOS
Customer Product Name:  |  Date of Production:13-Dec-2024
Product Name/Grade:  |  CIIR 1066  |  Production Facility:JBC Kashima
LOT No.  |  C4Z13  |  Date of Testing:  |  16-Dec-2024`,
  "CIIR 1066",
  "C4Z13"
);

// Barimite — หัวข้อ/หัวตารางที่ขึ้นต้นด้วย Product ไม่ใช่ป้าย · "Lot#" เป็นป้าย lot จริง
check(
  "Barimite: หัวตารางไม่ใช่ป้าย แต่ Lot# ใช่",
  `PRODUCT INFORMATION
Product Characteristics | Min. Spec.   Max. Spec. | Actual Results
Manufacture Date: | Mar .   13,   2026 | Lot# | 26031301`,
  null,
  "26031301"
);

// RI-015 — "Lot#" ที่ตามด้วยเลขคือหัวคอลัมน์ของแถวข้อมูล ห้ามหยิบค่าวัดข้างๆ มาเป็น lot
check(
  "RI-015: Lot#01 เป็นหัวคอลัมน์ ไม่ใช่ป้าย",
  `Material Code  |  RI-015  |  Customer Material
SIEVE  |  PATTERN  |  Lot#  |  Lot#  |  Lot#
Lot#01  |  60.9  |  38.44  |  32  |  5`,
  "RI-015",
  null
);

// Suzorite — ป้ายมีเลขข้อนำหน้า + lot อยู่ท้ายช่องเดียวกับป้าย (ช่องถัดไปเป็นค่าในตาราง)
check(
  "Suzorite: เลขข้อนำหน้า + lot ท้ายช่องเดียวกัน",
  `TO: Resonac Materials (Thailand) Co., Ltd.
1. GRADE | : SUZORITE MICA 325-HK
LOT NO. 850996 | Traces | 0.30 | 97.20`,
  "SUZORITE MICA 325-HK",
  "850996"
);

// 4A — Messrs; คือผู้รับ ไม่ใช่สินค้า · ค่าอยู่หลังช่องป้าย · lot มี / ติดท้าย
check(
  "4A: ผู้รับ (Messrs) ไม่ใช่สินค้า",
  `Messrs;SHIRAISHI CALCIUM(THAILAND)CO.,LTD.
Date:  |  Name of Product  |  .4APOWDER  |  2025/02/26
LOT No.  |  SPEC  |  34002411172/`,
  "4APOWDER",
  "34002411172"
);

// TXAX — ไม่มีป้ายสินค้าบนใบ (ชื่อลอยบรรทัดแรก) · ชื่อลูกค้าอยู่ท้ายใบ ห้ามหยิบมาเป็นสินค้า
check(
  "TXAX: ไม่มีป้าย = null ไม่ใช่ชื่อลูกค้า",
  `TXAX-A
Date: April 6, 2026
顧客名   Customer:
ロット番号   Lot No. : | 出荷量 | Mass:
A-63045 | 200 kg
株式会社クボタ   Kubota Corporation
Resonac Materials (Thailand) Co., Ltd.`,
  null,
  "A-63045"
);

// 1F1710 — ใบเขียน "Product: N/A" เอง → ห้ามไปเดาจาก Type: และห้ามหยิบป้ายบรรทัดถัดไปเป็นค่า
check(
  "1F1710: ใบบอก N/A เอง = null",
  `Merge Number:  |  1F1710  |  Type:  |  979A
Product:  |  N/A
Reference:  |  16463`,
  null,
  null
);

// PR1950W — ป้ายถูกตัดคนละบรรทัด ทั้งฝั่งลูกค้าและฝั่งสินค้า
check(
  "PR1950W: ป้ายข้ามบรรทัด แยกลูกค้ากับสินค้า",
  `Customer's
Name :  |  Resonac Materials(Thailand) Co.,Ltd.
Product  |  Date  |  Specification
Name  |  PR1950W  |  Mar./10/2026
Lot No.  |  4063-01  |  Date  |  Mar./02/2026`,
  "PR1950W",
  "4063-01"
);

// RB220 — ประโยคที่ขึ้นต้นด้วย batch ไม่ใช่ป้าย · หัวตาราง 4 ช่องห้ามดูดแถวข้อมูลบรรทัดล่าง
check(
  "RB220: ประโยค/หัวตารางไม่ใช่ป้าย lot",
  `batch and in compliance with the product information sheet.
3.
Product | Lapinus® RB220ELS
Batch no. | Fibre length | Results ( micron ) | Limits ( micron )
1 | 4.20 | 3.00 - 5.50`,
  "Lapinus® RB220ELS",
  null
);

// Z99 — "Product" เดี่ยวให้รหัสวัสดุ (ทิ้ง) · Product Description วางค่าไว้บรรทัดถัดไป
check(
  "Z99: รหัสวัสดุแพ้ Product Description",
  `Product | : 130035346
Product Description :
Z99 2-3.5UM ZIR
Batch Number | : Z25J29-8
Ship-to Description | : | Inabata America Corporation`,
  "Z99 2-3.5UM ZIR",
  "Z25J29-8"
);

// ZP10 — หัวจดหมายจีน (中化/sinochem) ต้องไม่กลายเป็น product/lot
check(
  "ZP10: หัวจดหมายไม่ใช่ product/lot",
  `中化
sinochem
Type  |  :ZP10  |  ACCEPT
Box no.  |  :2026021327  |  By : QA Dept.`,
  "ZP10",
  "2026021327"
);

// Suzorite แบบไม่มีเลขต่อท้ายป้าย — ช่องถัดไปเป็นค่าที่วัดได้ ห้ามกลายเป็น lot
check(
  "lot: เลขวัดในตารางไม่ใช่ lot",
  `Lot No. | Traces | 0.30 | 97.20`,
  null,
  null
);

// ป้ายที่อยู่คอลัมน์ขวา ห้ามอ่านบรรทัดล่าง — บรรทัดล่างอ่านได้แต่ช่องแรก ซึ่งเป็นค่าของป้ายอื่น
check(
  "ป้ายคอลัมน์ขวาไม่ดูดค่าใต้ป้ายอื่น (ฝั่ง product)",
  `Lot No. | Name of Product
SHIRAISHI CALCIUM (THAILAND) | 4A POWDER`,
  null,
  null
);
check(
  "ป้ายคอลัมน์ขวาไม่ดูดค่าใต้ป้ายอื่น (ฝั่ง lot)",
  `Weight | Lot No.
12.5 kg | 34002411172`,
  null,
  null
);

// OCR ตก ":" แล้วป้ายกลายเป็นค่าของป้ายข้างๆ (PR1950W ของจริงรอดมาได้เพราะบังเอิญเจอค่าถูกก่อน)
check(
  "ป้ายไม่ใช่ค่า แม้ OCR ตก :",
  `Manuf. | product description
Lot No. | 4063-01 | Date | Mar./02/2026`,
  null,
  "4063-01"
);

// lot ของลูกค้าก็ไม่ใช่ของเรา — veto ฝั่งลูกค้าต้องคุมทั้ง product และ lot
check(
  "lot ใต้ป้ายลูกค้าไม่นับ",
  `Customer's
Lot No. :  |  C-99999`,
  null,
  null
);

// ใบ TIMREX มี 2 ป้าย — Product Description เป็นรหัสบรรจุ (ตัดข้ามบรรทัดด้วย) ชื่อการค้าต้องชนะ
check(
  "TIMREX: ชื่อการค้าชนะรหัสบรรจุ",
  `Product | 130043577
Product Description | 250-1500_PW_PAB_20_1000KG_D
E
Prod.Commercial Desc. | TIMREX FC 250-1500 COKE`,
  "TIMREX FC 250-1500 COKE",
  null
);

// ใบไทยแบบสแกน — ป้ายเป็นภาษาไทย และ OCR อ่าน "ชื่อ" เพี้ยนเป็น "ซื่อ" — ต้องยังหยิบได้
check(
  "ไทย: ป้ายไทย + พยัญชนะตัวหน้าที่ OCR อ่านผิด",
  `ใบรับรองผลการวิเคราะห์ (CERTIFICATE OF ANALYSIS)
ซื่อผลิตภัณฑ์ : แคลเซียมคาร์บอเนต ชนิดเคลือบผิว
เลขที่ล็อตการผลิต : TH-260910-01  |  วันที่ผลิต : 10/09/2569`,
  "แคลเซียมคาร์บอเนต ชนิดเคลือบผิว",
  "TH-260910-01"
);

// ป้ายไทยที่ผูกท้ายคำเฉยๆ เคยดึงชื่อลูกค้า/ผู้ผลิต/หัวตารางมาเป็นชื่อสินค้า (opus-reviewer จับ 6/6 เคส)
check(
  "ไทย: ป้ายลูกค้าไม่ชนะป้ายสินค้า แม้อยู่บรรทัดบน",
  `ผู้รับสินค้า : บริษัท ลูกค้าไทย จำกัด
ชื่อผลิตภัณฑ์ : แคลเซียมคาร์บอเนต
เลขที่ล็อต : TH-01`,
  "แคลเซียมคาร์บอเนต",
  "TH-01"
);

check(
  "ไทย: ชื่อบริษัทผู้ผลิตไม่ใช่ชื่อสินค้า",
  `บริษัทผู้ผลิตสินค้า : บริษัท เรโซแนค ประเทศไทย จำกัด
ชื่อผลิตภัณฑ์ : ซิลิกาเจล`,
  "ซิลิกาเจล",
  null
);

check(
  "ไทย: หัวตาราง 'รายการสินค้า' ไม่ใช่ป้าย",
  `รายการสินค้า  |  หน่วย  |  เกณฑ์  |  ผลตรวจ
ความชื้น  |  %  |  ≤ 0.5  |  0.32`,
  null,
  null
);

check(
  "ไทย: 'มาตรฐานผลิตภัณฑ์' ไม่ใช่ป้ายชื่อสินค้า",
  `มาตรฐานผลิตภัณฑ์ : มอก. 2560-2562
ชื่อผลิตภัณฑ์ : ผงแคลเซียม`,
  "ผงแคลเซียม",
  null
);

check(
  "ไทย: ค่าที่ OCR อ่านเละเหลือแต่สระ/วรรณยุกต์ ไม่ใช่ชื่อ",
  `ชื่อผลิตภัณฑ์ : ่้๊๋ ั ิ`,
  null,
  null
);

check(
  "ไทย: ประโยคที่มีคำว่าล็อตอยู่กลาง ไม่ใช่ป้าย lot",
  `สินค้าล็อตนี้ผ่านการตรวจ  |  QC-99123`,
  null,
  null
);

// ใบอังกฤษ/ญี่ปุ่นต้องเดินทางเดิมเป๊ะ — ป้ายไทยที่เพิ่มห้ามแตะ
check(
  "ป้ายไทยไม่กินใบอังกฤษ",
  `Product Name/Grade:  |  CIIR 1066
Date of Production: 13-Dec-2024`,
  "CIIR 1066",
  null
);

// ─── สรุป ─────────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
if (failed === 0) {
  console.log(`PASS  ทุก test ผ่าน (${passed} cases)`);
  process.exit(0);
} else {
  console.error(`FAIL  ${failed}/${passed + failed} cases ไม่ผ่าน`);
  process.exit(1);
}
