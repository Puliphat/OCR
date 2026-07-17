# COA — Test Log (ผลระบบ vs ค่าจริง)

> ไฟล์นี้ไว้จด **ผลที่ระบบตัด** เทียบ **ค่าจริงในเอกสาร** ทีละไฟล์ (user ทยอยบอก)
> เป้า: รวบ pattern ที่ผิด → แก้ทีเดียวถูกทาง (ไม่เดา). อ่าน [DEV-NOTES.md](./DEV-NOTES.md) คู่กัน.

---

## วิธีใช้

**รันเทส 1 ไฟล์:**
```powershell
cd C:\local-repo\OCR\backend
npm run ocr:daemon          # terminal แยก (ถ้ายังไม่ขึ้น) — รอ "OCR daemon ready"
npx ts-node src/scripts/test-coa.ts "C:\path\to\file.pdf"
# ผล: coa-logs/run.log + coa-logs/_last-ocr.txt (OCR ที่ใช้) + _last-ollama.txt (LLM parse)
```
หรือผ่าน UI: `localhost:3000` (ต้อง `npm run dev` ทั้ง backend+frontend)

**จดอะไรต่อแถว (ครบ 6 อย่างนี้ → ฟันธงถูก):**
1. ไฟล์ + พารามิเตอร์ (แถวไหน)
2. **spec ที่พิมพ์จริงในเอกสาร** ← สำคัญสุด: เป็น Min / Max / ≤ / ≥ / ช่วง(range) แบบไหน
3. ค่าวัดจริง (result)
4. ระบบให้ = PASS/FAIL/SKIP + เลข spec/result ที่ระบบโชว์
5. ควรเป็นอะไร
6. ตรงไหม + เดาสาเหตุถ้าผิด

เน้น 2 อาการ: (ก) ขึ้น **FAIL** → จริงหรือปลอม · (ข) **SKIP แต่จริงๆ ควรตัดสินได้**

---

## Context snapshot (resume cold ได้)

- branch: `coa-qwen3-4b-bare-eq-guard` (2 commit: `9e6a132` model+guard, `601d300` header-direction)
- corpus ล่าสุด: **75P / 0F / 36S** (ROUND 6 keep-best, verify _validate/_kb-final.log) · 0 deceptive PASS · 0 FAIL · needsReview 42 · grid→LLM keep-best เปิด (default, rapidocr only)
- model: qwen3:4b (เร็ว 2.4x) · OCR: RapidOCR :8765 / text-layer / Tesseract
- guards (ดูตารางเต็มใน DEV-NOTES): drop-hallucination · spec-recovery · spec-direction(OCR operator) · rotation · symmetric **bare-eq → SKIP** (spec เลขเดี่ยวไม่มีทิศ) · **header-direction** (กู้ทิศจาก geometry, text-layer)
- หลักการ: **honest SKIP > confident wrong** · fix เป็น deterministic เท่านั้น (ไม่เทรน)

**residual ที่รู้แล้ว (เทียบก่อนสรุปว่าเป็นของใหม่):**
- RI-015 (scan): 2 FAIL ปลอม — เอา sieve aperture (0.425/0.15) เป็น result + ปั้น range spec
- scanned bare-eq (SODA Assay/NaCl): SKIP — header-direction เป็น text-layer เท่านั้น ยังไม่ครอบ scan
- PR1950W_4064: layout แตก (spec หลุดจากแถว) → SKIP

---

## ผลต่อไฟล์ (ทยอยเติม)

สถานะ corpus 16 ไฟล์ (✅=เทส+ยืนยันแล้ว · ⬜=รอ user บอกค่าจริง):

| # | ไฟล์ | engine | ระบบให้ (v6) | ค่าจริงตรงไหม | action |
|---|---|---|---|---|---|
| 1 | Lot240521 | rapidocr(rotated) | 2P/3S | ✅ ควร 5P | spec-norm(`-~`,`T5`) + LLM avg-col + pass-guard ดุ |
| 2 | Inolob_T204F | text-layer | 4P/1S | ✅ ถูกหมด | 1S = legit SKIP (user ยืนยัน 2026-06-04) |
| 3 | TR_1099 | text-layer | 3P | ✅ ถูกหมด | user ยืนยัน 2026-06-04 |
| 4 | ZP10 | rapidocr | 1P/3S | ✅ ควร 4P | LLM ทิ้ง result field row 2-4 (OCR มีครบ) |
| 5 | RI-015 | rapidocr | (2 FAIL ปลอม) | ✅ ควร ~9P/2-3S | **LLM map sieve-name→result** (ไม่ใช่ OCR) + grounding ตัด Cu/Zn + OCR `<→A` chem |
| 6 | PR1950W_4063 | rapidocr | 4P/4S | ✅ ควร 7P/1S (หน้า1) | ★ ragged-row → LLM column-shift + OCR drop sparse + multi-page หาย |
| 7 | Barimite200 | text-layer | 5P/2S | ✅ ควร 7P/0S | **LLM ทิ้ง column `Max. Spec.`** (header 2 col Min/Max → ยุบเหลือค่าเดียว) → bare-eq SKIP. result ถูกหมด |
| 8 | SODA_ASH | rapidocr | 2P/4S | ✅ ควร 6P | **LLM column-shift (Unit ว่าง→เลื่อนซ้าย→copy result เป็น spec)** ทั้งใบ. OCR ถูก 100%. 4→bare-eq SKIP · 2→PASS spec ผิด (mild-deceptive) |
| 9 | Suzorite_Mica | text-layer | 0P/3S | ✅ ควร 5P/1S | ★ **transposed table** (item=column แนวนอน, sieve 4 fraction) → LLM ยุบ 6 row เหลือ 3 + เลื่อน spec + ทิ้ง result ทั้งหมด. layout ยากสุด |
| 10 | Z99 | text-layer | 10P/3S | ⬜ | (เคยเช็ค: ถูก 100%) |
| 11 | D-2072 | rapidocr | — | ⬜ | |
| 12 | TXAX-A | text-layer | 4P/1S | ⬜ | |
| 13 | 1F1710 | rapidocr | — | ⬜ | |
| 14 | 4A | rapidocr | 2P/4S | ⬜ | |
| 15 | RB220 | text-layer | 2P | ⬜ | |
| 16 | PR1950W_4064 | text-layer | (layout แตก) | ⬜ | spec หลุดจากแถว → SKIP |

---

## รายละเอียดต่อแถว (จดตรงนี้ตอน user บอก)

<!-- template ต่อไฟล์ — copy บล็อกนี้:
### <ไฟล์>
| พารามิเตอร์ | spec พิมพ์จริง | result จริง | ระบบให้ | ควรเป็น | ตรง? | สาเหตุถ้าผิด |
|---|---|---|---|---|---|---|
| | | | | | | |
-->

### 20260203_Lot240521 (rapidocr, rotated) — user ยืนยัน 2026-06-04

ตารางมีหลาย measurement column + column **Average** แล้วตามด้วย spec. result จริง = Average.
OCR ดิบเลขถูกหมด **ยกเว้น `45 ~T5` ควรเป็น `45 ~ 75`** (อ่าน 7→T) — OCR ผิดจุดเดียว.

| พารามิเตอร์ | spec พิมพ์จริง | result จริง | ระบบให้ | ควรเป็น | ตรง? | สาเหตุถ้าผิด |
|---|---|---|---|---|---|---|
| Sieve Residue on 500 μ | 3 Max | 0.3 | PASS | PASS | ✅ | — |
| Sieve Residue on 350 μ | 15~45 | 42.3 | ✅ PASS (R4) | PASS | ✅ | (เคย SKIP) pass-guard anchor ผิดเพราะ OCR glue ชื่อ → glue-anchor R4 แก้แล้ว |
| Sieve Residue on 150 μ | 45~75 | **56** (avg 56.0) | SKIP | PASS | ❌ | (a) LLM ยก result=58 แทน Average 56.0 (b) OCR `T5` → spec ไม่ parse |
| Sieve Residue under 150 | 20 Max | 1.3 | PASS | PASS | ✅ | — |
| Bulk Density (kg/L) | 270~350 | 329 | SKIP | PASS | ❌ | spec-normalizer ไม่รับ `270 -~350` (`-~` ติดกัน) |

**ต้นเหตุ (เรียงตาม impact):**
1. spec-normalizer เปราะ — `270 -~350` (range ชัด แต่ `-~` ทำ parse พัง) · `45 ~T5` (OCR noise `7→T`)
2. LLM เลือก column ผิด — ยก measurement ตัวสุดท้าย (58) แทน Average (56.0)
3. pass-guard ดุไป — downgrade PASS→SKIP ทั้งที่ค่าถูก

**สรุป:** OCR ไม่ใช่ตัวปัญหาหลัก (ผิดจุดเดียว 7→T). 3/5 row ที่ผิดมาจาก spec-normalizer + LLM column-pick + pass-guard.

> หน้างานอยากเอา SKIP ออก → แก้ 3 ต้นเหตุนี้ SKIP กลายเป็น PASS ถูกต้อง (ไม่ใช่ดันตัดสินมั่ว)

### 20260323_ZP10_Lot.2026021327 (rapidocr) — user ยืนยัน 2026-06-04

OCR ดิบอ่าน result **ครบทุกตัว** (388 / 1.09 / 9.31 / 6.2) แต่ **LLM ทิ้ง field `result` ใน row 2,3,4** (llmRaw ไม่มี key `result` เลย) → result=null → SKIP "result not numeric".

| พารามิเตอร์ | spec จริง | result จริง | ระบบให้ | ควรเป็น | ตรง? | สาเหตุถ้าผิด |
|---|---|---|---|---|---|---|
| Freeness | 350~**750** | 388 | PASS | PASS | ⚠️ | **OCR ผิด** max `750→650` (7→6) · ค่ายังผ่าน |
| Fiber Length | 0.70~1.30 | 1.09 | SKIP | PASS | ❌ | LLM ทิ้ง result (OCR มี `1.09`) |
| Specific Surface Area | 6.00~11.00 | 9.31 | SKIP | PASS | ❌ | LLM ทิ้ง result (OCR มี `9.31`) |
| Moisture content | 4.0~8.0 | **5.2** | SKIP | PASS | ❌ | LLM ทิ้ง result · **OCR ผิด** `5.2→6.2` (5→6) · ผ่าน |

**ต้นเหตุหลัก:** LLM dropped-result column (row 2-4) → SKIP — OCR อ่าน result ครบ. แก้ที่ prompt `ollama-coa.service.ts`.
**ต้นเหตุรอง (OCR ผิดจริง, user ยืนยัน):** 2 digit-confusion `7→6` (750), `5→6` (5.2) — ไม่กระทบผล (ยังผ่าน spec).
**user obs:** "OCR เกือบถูก แต่หน้าเว็บ SKIP เยอะ" → ยืนยันว่าปัญหา SKIP อยู่ stage หลัง OCR.

### 20260409_RI-015_Lot_EC250306801 (rapidocr) — user ยืนยัน 2026-06-04 ★ ไฟล์ยาก 2 ตาราง (rotated)

layout: ตารางบน sieve (SIEVE=ชื่อ, PATTERN=spec, Lot#=result) + ตารางล่าง CHEMICAL ANALYSIS (header ธาตุแนวนอน, ค่าอ่านล่างขึ้นบน).
**OCR ดิบตารางบนถูก 100% รวม result** (`0.425|10-45|36.0`, `0.150|50-80|60.0`, `<0.150|0-12|4.0`). ปัญหา = LLM + guard.

**ตารางบน:**
| sieve (ชื่อ) | spec จริง | result จริง | ระบบให้ | ควร | ตรง? | สาเหตุ |
|---|---|---|---|---|---|---|
| 2.000 | 0.0 (eq) | 0.0 | PASS | PASS | ✅ | — |
| 0.85 | 0.0~1.0 | 0.0 | PASS (result=0.85) | PASS | ⚠️ | LLM ใช้ชื่อ sieve เป็น result — บังเอิญผ่าน |
| 0.425 | 10.0~45.0 | 36.0 | **FAIL** (result=0.425) | PASS | ❌ | **LLM เอาชื่อ 0.425 เป็น result** ทิ้ง 36.0 → FAIL ปลอม |
| 0.150 | 50.0~80.0 | 60.0 | **FAIL** (result=0.15) | PASS | ❌ | **LLM เอาชื่อ 0.150 เป็น result** ทิ้ง 60.0 → FAIL ปลอม |
| <0.150 | 0.0~12.0 | 4.0 | SKIP | PASS | ❌ | LLM ทิ้ง result (OCR มี 4.0) |
| Bulk Volume (ml/100g) | 25~40 | 30 | PASS | PASS | ✅ | — |
| Tap Volume (ml/100g) | 20~35 | 26 | PASS | PASS | ✅ | — |
| Acetone extract (%) | <0.20 | N/A | SKIP | SKIP | ✅ | N/A → SKIP ถูก policy (user: text/N/A = SKIP) |

**ตารางล่าง CHEMICAL (Cu Zn Pb Cd Sb As):**
| ธาตุ | spec จริง | result จริง | ระบบให้ | ควร | ตรง? | สาเหตุ |
|---|---|---|---|---|---|---|
| wt% Cu | 57~61 | 60.9 | (ตัดทิ้ง) | PASS | ❌ | **grounding guard false-positive** ตัด row (OCR มี `wt% Cu...60.9`) |
| wt% Zn | 36~40 | 38.44 | (ตัดทิ้ง) | PASS | ❌ | grounding guard ตัด (OCR มี `wt% Zn...38.44`) |
| Pb (ppm) | <50 | 32 | PASS | PASS | ✅ | — |
| Cd (ppm) | <15 | 5 | SKIP | PASS | ❌ | OCR result row จับได้แค่ 4/6 ค่า → Cd=5 หาย |
| Sb (ppm) | <15 | <15 | SKIP (spec not parseable) | PASS | ❌ | **OCR `< → A`** (spec=`A 15`) · result เป็น `<15` เอง (user: ให้ PASS) |
| As (ppm) | <15 | 8 | SKIP (spec not parseable) | PASS | ❌ | OCR `< → A` (spec=`A15`) + result As=8 หาย |

**ต้นเหตุ (เรียง impact):**
1. **LLM column mis-map** — เอาชื่อ sieve เป็น result → 2 FAIL ปลอม + skip (OCR ถูกแล้ว). = บั๊กเดียวกับ ZP10 (LLM พลาด column) แต่หนักกว่าเพราะ layout rotated.
2. **grounding guard false-positive** — ตัด Cu/Zn ทิ้งทั้งที่ OCR มี.
3. **OCR ผิดจริงเฉพาะตารางล่าง:** `< → A` (Sb/As) + result row ขาด Cd/As (จับ 4/6). ตารางบน OCR ไม่พลาด.

**policy ที่ user ยืนยัน:** result เป็น N/A หรือตัวอักษร → **SKIP เก็บไว้ได้** (ไม่ต้องดันตัดสิน). กรณีพิเศษ: result `<15` กับ spec `<15` → user อยากได้ **PASS** (result เป็น bound expression — ตอนนี้ result-normalizer reject เพราะไม่ขึ้นด้วยเลข → ควรรองรับ).

### 20260420_PR1950W_Lot_4063-01_4063-02 (rapidocr) — user ยืนยัน 2026-06-04 ★★ diagnostic ดีสุด: เห็นกลไก LLM column-shift

header ตาราง: `Item | Unit | Treatment Condition | Specification | Test result`.
**กลไกพังหลัก:** row ที่ **Unit/Treatment ว่าง** → OCR ออก cell น้อยกว่า header → **LLM เลื่อน column ซ้าย** เอา spec ไปลง field `unit`/`method` แล้ว**ยืม spec ของ row ข้างเคียง** มาแทน. (ภาพรวมเดียวกับ ZP10/RI-015 แต่ที่นี่ทำ **spec** เพี้ยน ไม่ใช่แค่ result.)

หน้านี้ = lot 4063-01 (หน้า 1 เท่านั้น — ดู multi-page ด้านล่าง):

| # | item | spec จริง | result จริง | ระบบให้ | ควร | ตรง? | สาเหตุ |
|---|---|---|---|---|---|---|---|
| 1 | Appearance | GOOD (text) | Good | SKIP | SKIP | ✅ | text → SKIP ถูก policy |
| 2 | Softening point | 105~115 | 112 | SKIP | PASS | ❌ | **LLM column-shift**: spec 105-115→field `unit`, ยก `10~35` ของ Flow มาเป็น spec → result 112 vs 10-35 = FAIL → fail-guard downgrade SKIP |
| 3 | Flow | 10~35 | 16 | PASS | PASS | ✅ | row เต็ม 5 cell → map ถูก |
| 4 | Gelation time | 30~55 | 40 | PASS (เสี่ยง) | PASS | ⚠️ | LLM column-shift: spec 30-55→field `method`, ใช้ result 40 เป็น spec(min) → บังเอิญผ่าน (40≥40) |
| 5 | Moisture | ≤1.2 | 0.4 | PASS | PASS | ⚠️ | LLM column-shift: spec ≤1.2→field `unit`, ยก `≤5.0` มาเป็น spec → บังเอิญผ่าน (spec ผิด) |
| 6 | Residue sieve(106 μm) | ≤5.0 | 0.4 | SKIP | PASS | ❌ | **OCR drop result** — บรรทัด OCR `Residue on sieve(106 μ m) | ≤5.0` ไม่มี 0.4 |
| 7 | Residue sieve(500 μm) | ≤0.10 | 0.01 | PASS | PASS | ✅ | — |
| 8 | Residue sieve(1mm) | 0 (eq) | 0 | SKIP | PASS | ❌ | **OCR drop** spec+result (0/0) — OCR จับ stray `ACCEPT` มาเป็น result แทน |

**multi-page หาย:** ไฟล์ 2 หน้า = 2 lot (4063-01, 4063-02). pipeline render หน้า 1 เท่านั้น (`pdf.service.convertToImage` หน้า 1) → **หน้า 2 (lot 4063-02) ไม่ถูก process เลย**. user: หน้า 2 ต่างที่ Residue sieve(500μm) ≤0.10 result=`0.02`.

**ทิศทางแก้ multi-page (user เห็นชอบ 2026-06-04):** per-page process แยก — render ทุกหน้า → OCR/LLM/eval แยกต่อหน้า → report ต่อ lot. **ห้ามรวม OCR blob ทุกหน้าส่ง LLM ทีเดียว** (header+item ชื่อซ้ำคนละ lot → LLM งง). **UI ต้องแยกแสดงต่อ lot** (คนละ lot = คนละ report card/section). เคสตารางยาวข้ามหน้า (หายาก): detect header หน้า 2 ซ้ำไหม → ไม่ซ้ำ = merge rows ต่อ. แก้ที่ `pdf.service.ts` (loop ทุกหน้า) + `coa-pipeline.ts` (วน per-page) + `frontend/app/page.tsx` (group by lot).

**ต้นเหตุ (เรียง impact):**
1. **LLM column-shift บน ragged row** (Unit/Treatment ว่าง) — ทำ spec เพี้ยน 3 row (item 2 พังเป็น SKIP, item 4/5 ผ่านแบบ spec ผิด). = บั๊ก LLM ตัวเดียวกับ ZP10/RI-015 (column mapping) แต่หนักกว่า: เพี้ยนทั้ง spec.
2. **OCR drop sparse cell** — item 6 (result), item 8 (spec+result) — OCR ไม่จับ cell ที่ว่าง/จาง.
3. **multi-page ไม่รองรับ** — เสียทั้งหน้า 2.

### 20260422_Barimite200_Lot_26031301 (text-layer) — user ยืนยัน 2026-06-05 ★ 2-column-spec drop

ตารางมี **header 2 column spec แยก: `Min. Spec.` | `Max. Spec.`** (user ยืนยันหัวตาราง). OCR text-layer อ่าน **ครบทั้ง min+max+result** แต่ **LLM ยุบเหลือค่าเดียว (เก็บแค่ column แรก/Min, ทิ้ง Max)** → spec กลายเป็นเลขเดี่ยวไม่มีทิศ → bare-eq guard → SKIP (honest, ไม่ deceptive). **result ถูกหมดทุก row.**

OCR ดิบ (debug.ocrText) มีค่าครบ:
- `PH   Value | 6.0 | 8.0 | 7.2` ← บรรทัดเดียว ครบ min6/max8/result7.2 → LLM ยังทิ้ง 8.0
- Specific Gravity: cell แตก 3 บรรทัด `4.28   g/cm` / `4.32 | g/cm` / `4.301` ← min4.28/max4.32/result4.301

| พารามิเตอร์ | spec จริง (Min~Max) | result จริง | ระบบให้ | ควร | ตรง? | สาเหตุ |
|---|---|---|---|---|---|---|
| Ba SO4 (%) | 93~97 | 93.87 | PASS | PASS | ✅ | range ครบ (`93%~97%`) map ถูก |
| Moisture (%) | 0.2 Max | 0.11 | PASS | PASS | ✅ | — |
| PH Value | **6.0~8.0** | 7.2 | SKIP (spec=`6.0`) | PASS | ❌ | **LLM ทิ้ง Max col `8.0`** → bare-eq SKIP (OCR มีครบบรรทัดเดียว) |
| Mean Particle Size D50 | 11 Max | 10.414 | PASS | PASS | ✅ | — |
| D 100 | 80 Max | 69.11 | PASS | PASS | ✅ | — |
| Specific Gravity | **4.28~4.32** | 4.301 | SKIP (spec=`4.28`) | PASS | ❌ | **LLM ทิ้ง Max col `4.32`** → bare-eq SKIP (OCR cell แตก 3 บรรทัด) |
| 325 Mesh Passing | 95 Min | 98.9 | PASS | PASS | ✅ | — |

**ต้นเหตุเดียว:** **LLM 2-column-spec collapse** — header มี `Min. Spec.`+`Max. Spec.` แยก column แต่ LLM เก็บแค่ column เดียว ทิ้งอีก column. = ตระกูล column-drop เดียวกับ ZP10/RI-015 แต่ทิ้ง **spec-max** (ไม่ใช่ result). bare-eq guard ทำงานถูก (กัน deceptive) — แค่เสีย recoverable PASS 2 ตัว. result ไม่พลาดเลย.

**ทิศแก้ (รอบหน้า, ยังไม่แตะ):** ให้ extraction รู้จัก 2-col spec — (ก) prompt nudge "ถ้าหัวตารางมี Min Spec + Max Spec แยก ให้เก็บทั้งคู่เป็น specMin/specMax" หรือ (ข) deterministic recovery แบบ spec-recovery: bare-eq row ที่ OCR บรรทัด anchor มี 2 เลข spec ก่อน result → กู้เป็น range. ข้อ (ข) ปลอดภัยกว่า (เห็นเลขใน OCR จริง). PH Value (บรรทัดเดียว) กู้ง่าย · Specific Gravity (cell แตก 3 บรรทัด) ต้อง group ข้ามบรรทัดก่อน.

### 20260507_SODA___ASH_Lot_60223 (rapidocr/scan) — user ยืนยัน 2026-06-05 ★ column-shift ทั้งใบ (Unit ว่าง) + OCR ถูก 100%

**OCR ดิบอ่านถูกครบทุก cell** (spec column "Standard" = Min/Max/range ครบ). layout header = `Item | Unit | Standard | Result` (4 col) แต่ **data row ทุกแถว Unit ว่าง** → OCR ออกแค่ 3 cell (`name | spec | result`) → **LLM เลื่อน column ซ้าย**: อ่าน Standard→Unit, Result→Standard, Result หาย → **copy result มาใส่ spec ทุกแถว**. = กลไกเดียวกับ PR1950W_4063 Softening (ragged row) แต่ที่นี่ **systematic ทั้งใบ** เพราะ Unit ว่างหมด.

OCR ดิบ (เทียบ spec ที่ LLM ออก):
```
Assay (Na2C03)        | 99.2 Min.  | 99.56
Sodium chloride(NaCl) | 0.5 Max.   | 0.28
Iron(ⅡI)oxide(Fe203)  | 0.003 Max. | 0.0003 Max.   ← OCR ทำคำ "Max." รั่วเข้า result cell
Insoluble matter ...  | 0.01 Max.  | 0.001 Max.    ← เช่นกัน
Heating loss          | 0.5 Max.   | 0.15
Apparent specific gr. | 0.6~0.8    | 0.78
```

| พารามิเตอร์ | spec จริง | result จริง | ระบบให้ (spec) | ควร | ตรง? | สาเหตุ |
|---|---|---|---|---|---|---|
| Assay (Na2CO3) | 99.2 Min | 99.56 | SKIP (spec=`99.56`) | PASS | ❌ | LLM copy result→spec → bare-eq SKIP |
| Sodium chloride (NaCl) | 0.5 Max | 0.28 | SKIP (spec=`0.28`) | PASS | ❌ | เหมือนกัน |
| Iron(III)oxide (Fe2O3) | 0.003 Max | 0.0003 | **PASS (spec=`0.0003 Max`)** | PASS | ⚠️ | **mild-deceptive**: spec ผิด (0.0003 แทน 0.003), ผ่านบังเอิญ. OCR `Max.` รั่วเข้า result → ไม่ใช่ bare-eq → guard ไม่จับ |
| Insoluble matter in water | 0.01 Max | 0.001 | **PASS (spec=`0.001 Max`)** | PASS | ⚠️ | mild-deceptive เหมือน Fe2O3 (spec 0.001 แทน 0.01) |
| Heating loss | 0.5 Max | 0.15 | SKIP (spec=`0.15`) | PASS | ❌ | bare-eq SKIP |
| Apparent specific gravity | 0.6~0.8 | 0.78 | SKIP (spec=`0.78`) | PASS | ❌ | bare-eq SKIP |

**ต้นเหตุเดียว = LLM column-shift จาก Unit-column ว่าง** (ไม่ใช่ OCR — OCR ถูก 100%). bare-eq guard ดัก 4/6 เป็น honest SKIP (ดี) · 2/6 หลุดเป็น **mild-deceptive PASS** (spec ผิดแต่ verdict บังเอิญถูก เพราะ OCR ทำคำ `Max.` รั่วเข้า result cell → spec ได้ max-bound ปลอม). ★ ถ้า result ของ Fe2O3/Insoluble ตกระหว่าง spec ปลอมกับ spec จริง จะกลายเป็น **FALSE FAIL** — latent risk.

**ทิศแก้ (รอบหน้า):** เคสนี้ OCR สะอาดมาก → deterministic recovery ทำได้แม่น. layout คงที่ `name | <spec มี Min/Max/~> | <result เลขเปล่า>`. recovery: row ที่ spec==result (หรือ spec น่าสงสัย) → ไป OCR anchor line → cell ที่มี token ทิศ (Min/Max/~/range) = spec จริง, เลขเปล่าท้าย = result. แก้ได้ทั้ง 6 row พร้อมกัน. **ตรงรากกว่าแก้ bare-eq guard** (guard แค่กันปลาย). + ต้อง strip คำ `Max.` ที่รั่วเข้า result cell (Fe2O3/Insoluble) ก่อน เพื่อปิด mild-deceptive 2 ตัว. = ตระกูลเดียวกับ PR1950W column-shift → แก้ทีเดียวอาจครอบทั้งคู่.

### 20260507_Suzorite_Mica_325-HK_Lot_850996 (text-layer) — user ยืนยัน 2026-06-05 ★★★ transposed table (ยากสุด)

**layout = ตาราง transposed** — item วางเป็น **column แนวนอน** (Sieve Analysis | Loose Bulk Density | Humidity) ไม่ใช่ row. result อยู่แถวเดียวใต้ `LOT NO. 850996`. **Sieve Analysis แตกเป็น 4 mesh fraction** (+100 / -100/+200 / -200/+325 / -325) แต่ละ fraction มี spec+result ของตัวเอง. text-layer reading order **สลับมั่ว** (PDF horizontal layout → extract by position ได้ลำดับยุ่ง: `12.2 | 0.26` โผล่ก่อน spec, `1～8`+`2.50` หลุดไปคนละที่).

โครงจริง (จาก OCR fragments — ค่าครบแต่กระจาย):
```
Item:    Sieve Analysis(4 fraction)        | Loose Bulk Density | Humidity
spec:    +100=Max1  -100/+200=Max5  -200/+325=1~8  -325=92~100 | 11.0~16.0 | 0.00~0.70
result:  Traces      0.30             2.50           97.20       | 12.2      | 0.26
```

| item / fraction | spec จริง | result จริง | ระบบให้ | ควร | ตรง? |
|---|---|---|---|---|---|
| Sieve +100 | Max 1 | Traces (text) | — | SKIP | (ควร SKIP — result text) |
| Sieve -100/+200 | Max 5 | 0.30 | — | PASS | ❌ |
| Sieve -200/+325 | 1~8 | 2.50 | — | PASS | ❌ |
| Sieve -325 | 92~100 | 97.20 | — | PASS | ❌ |
| Loose Bulk Density | 11.0~16.0 | 12.2 | — | PASS | ❌ |
| Humidity | 0.00~0.70 | 0.26 | — | PASS | ❌ |

ระบบ output จริง = **3 row มั่ว** (ยุบ Sieve 4 fraction เหลือ 1, **เลื่อน spec ทั้งชุด**: `Sieve Analysis`←11.0~16.0(ของ Loose Bulk), `Loose Bulk`←0.00~0.70(ของ Humidity), `Humidity`←92~100(ของ sieve -325), **result=null ทุกตัว**) → 0P/3S.

**ต้นเหตุ = transposed/horizontal table layout** (item เป็น column). ≠ column-shift (SODA/PR1950W ที่ layout ยัง row-based). ที่นี่ orientation หมุน 90° เชิง semantic + sieve มี nested sub-fraction. LLM row-based + text-layer reading-order สลับ → reconstruct column→item ไม่ได้เลย.

**ทิศแก้ (รอบหน้า — ยากสุด, น่าจะต้อง Phase 3):** heuristic row-based เอาไม่อยู่. ต้อง **structural/geometry extraction** — (ก) Docling TableFormer (typed cell-grid → คืน orientation ถูก, อยู่ใน research Phase 3) หรือ (ข) bbox-grid reconstruct จาก token x/y (reconstructTextGrid ใน rapidocr.service.ts ที่ทำค้างไว้) เพื่อกู้ column structure ก่อนส่ง LLM. เป็นหลักฐานชิ้นแข็งสุดว่า **transposed table = ต้อง structural extractor** ไม่ใช่ prompt/guard. defer จนกว่าจะตัดสิน Docling.

---

## FIX ROUND 1 — 2026-06-04 (จากผล grade 6 ไฟล์)

gate = `_validate/verify-4b-only.ts` (real pipeline, corpus 16 ไฟล์, Ollama+daemon up).
**baseline 43P/2F/45S → after 45P/2F/43S** · +2 PASS · 0 regression · 0 new FAIL · 0 deceptive PASS.
typecheck `npx tsc --noEmit` = 0 · unit: spec-norm 43✓ · result-norm 17✓ (ไฟล์ใหม่) · evaluator smoke ✓.

### SHIPPED (deterministic, test-gated, สร้าง deceptive PASS ไม่ได้)

**D1 — spec-normalizer multi-separator** (`spec-normalizer.ts`): range regex แยก `[~\-–—]` ตัวเดียว → `(?:[~\-–—]\s*)+` (≥1 ตัว). รับ `270 -~350`, `270 ~- 350`, `40 ~ - 70`. +4 fixture.
→ **Lot240521 Bulk Density** `329` ∈ `270-350` = **SKIP→PASS** (ตรง ground truth).

**D2 — bound-expression result** (`result-normalizer.ts` + `coa-evaluator.ts` + `result-normalizer.test.ts` ใหม่): result `<15`/`≤0.01`/`>50` → คืน `bound:{op,value}`. evaluator: PASS เฉพาะเมื่อ "ทั้ง bound อยู่ใน spec แบบพิสูจน์ได้" (logically sound — ทุกค่าใน bound เข้า spec → ไม่มีทาง deceptive). indeterminate → SKIP. **ไม่เคย FAIL จาก bound**.
→ **RI-015 Cd** `<15` vs spec `<15` = **SKIP→PASS** (ตรงเคส user ขอ). `<0.150` vs `0-12` (between) → SKIP honest (ถูก).

### HELD — ต้อง user ตัดสิน (gate ตรวจ deceptive PASS เองไม่ได้ → ต้อง grade มือ)

1. **result-recovery** (ZP10 LLM ทิ้ง result field / RI-015 sieve-name→result, 2 FAIL ที่เหลือ): กู้ result จาก OCR แบบ spec-recovery. **ขัด safety note เดิม `spec-recovery.ts:10` ที่จงใจไม่แตะ result** (กัน fabricated verdict). gate corpus ตรวจ deceptive PASS เองไม่ได้ (ไม่มี ground truth ในตัว) → ไม่ unilateral. รอ user เปิดไฟเขียว.
2. **guard-loosening** (`coa-grounding.ts`): grounding ตัด Cu/Zn (RI-015) · pass-guard downgrade Lot240521 350μ (`42.3` ใน `15~45` ถูกอยู่แต่โดน SKIP). เสี่ยง regress 0-deceptive-PASS property. รอ user.
3. **multi-page** (`pdf.service.ts`+`coa-pipeline.ts`+route+`types.ts`+`ResultsCard`): contract เปลี่ยน `CoaReport` → `CoaReport[]` กระทบ FE+BE. งานใหญ่ ต้อง verify UI live กับ user.

### OCR (user ถาม "แก้ OCR ด้วย")
OCR แข็งแรง. error ที่เหลือ = (ก) digit-confusion `7→T`/`750→650`/`5.2→6.2` (ส่วนใหญ่ verdict ยังถูก) (ข) sparse-cell drop (PR1950W item6/8) = daemon ไม่ emit token ของ cell จาง → **แก้ที่ row-grouping ไม่ได้** (recognition-level, ถ้าจะเดา digit = เสี่ยง corrupt ค่าดี). lever จริงอยู่ downstream (ข้อ 1-3 ข้างบน) ไม่ใช่ OCR.

---

## FIX ROUND 2 — 2026-06-04 (LLM bucket — user เลือก, autonomous + Opus review)

**baseline 43P/2F/45S → 50P/0F/40S** · **+7 PASS · −2 deceptive FAIL → honest SKIP (0 FAIL ทั้ง corpus)** · **0 deceptive PASS**.
ยืนยันทุก PASS-flip ตรง OCR/paper. tsc=0 · unit: spec-norm 43 · result-norm 17 · result-recovery 10 · column-shift 8 · needsReview=31.
★ Opus reviewer จับ BLOCKER ใน column-shift เวอร์ชันแรก (overwrite) → redesign เป็น downgrade (ดู R3).

### SHIPPED (deterministic post-process, ไม่แตะ prompt — สถาปัตย์เดียวกับ spec-recovery)

**R1 — result-recovery** (`result-recovery.ts` ใหม่ + wire pipeline หลัง spec-recovery): LLM ทิ้ง field `result` ทั้งที่ OCR มี → กู้แบบ cell-based "เหลือ cell ตัวเลขเดี่ยวตัวเดียวบนบรรทัด row นั้น หลังตัด spec/method/unit/ชื่อ". เติมเฉพาะ result ว่าง + spec มี + anchor unique. กำกวม → ปล่อย (honest SKIP).
→ **ZP10 1P→4P** (Fiber 1.09 / SSA 9.31 / Moisture 6.2) · **D-2072 0P→2P** (Viscosity 6.6 / Solid 27.06). ตรง paper/OCR.

**R2 — decimal-space guard fix** (`coa-grounding.ts` `parseNumTokens`): OCR แทรก space ในทศนิยม (`1. 09`) → guard อ่านเป็น {1,9} → pass-guard downgrade result ที่ recover ถูกแล้วผิด ๆ. normalize `(\d)\.\s+(\d)→$1.$2` ก่อน tokenize. ทำให้ R1 ของ ZP10 ผ่าน pass-guard. (กระทบ grounding/fail/pass-guard ร่วม — corpus ยืนยันไม่ regress: มีแค่ ZP10 ขยับ.)

**R3 — column-shift guard** (`column-shift-recovery.ts` ใหม่, post-eval): ตาราง transposed/rotated `aperture|spec|result` LLM เอา cell ป้าย (ซ้ายสุด) เป็น result. กฎ: result==cell[0] + spec cell ถัดไป + มี standalone-number หลัง spec → **downgrade PASS/FAIL → SKIP+needsReview**. layout ปกติ `name|spec|result` ไม่ fire (cell[0]=ชื่อ).
→ **RI-015 2 deceptive FAIL → honest SKIP** (0.425/0.150). fire เฉพาะ 2 row RI-015 (corpus ยืนยัน 0 collateral).
★ **เดิมออกแบบเป็น overwrite** (เอาเลขหลัง spec มาเป็น result → RI-015 8P). **Opus reviewer จับ**: layout `result|spec|ค่าเพื่อนบ้าน` cell[0] อาจเป็น result จริง (ไม่ใช่ป้าย) → overwrite = **deceptive PASS** (เช่น `12.5|10 Max|8.0` → 8.0 PASS ปลอม). บนบรรทัดเดียวแยกป้าย/result ไม่ออก → **เปลี่ยนเป็น downgrade** (สร้าง verdict ไม่ได้ = ปลอดภัย).
★ **OPT-IN ค้าง user:** auto →PASS เฉพาะ pattern ที่ grade แล้ว (RI-015 36/60/4 รู้ว่าถูก) — ต้อง user เปิด หรือใช้ structural extractor (เช่น Docling) เพราะ flat OCR กู้ทิศ column ไม่ได้ปลอดภัย.

### Scorecard 6 ไฟล์ (หลัง ROUND 1+2) vs กระดาษ
| ไฟล์ | ควร | ตอนนี้ | สถานะ |
|---|---|---|---|
| Inolob | 4P/1S | 4P/1S | ✅ perfect |
| TR_1099 | 3P | 3P | ✅ perfect |
| ZP10 | 4P | **4P/0S** | ✅ perfect (จาก 1P) |
| RI-015 | ~9P | **5P/0F/6S** | ✅ 0 FAIL (2 deceptive FAIL → honest SKIP) · Cd PASS(D2) · 6S = 0.425/0.150(column-shift)+<0.150(bound)+Acetone(N/A)+Sb/As(OCR `<→A`) · ★ OPT-IN ทำ 36/60/4 เป็น PASS ได้ |
| Lot240521 | 5P | 3P/2S | 350μ=pass-guard(defer) · 150μ=OCR `T5` |
| PR1950W_4063 | 7P/1S | 4P/4S | Softening=LLM spec-shift · 106μ/1mm=OCR drop · multi-page |

### ยังเหลือ (รอบหน้า)
- **guard** Lot240521 350μ — pass-guard false-downgrade (OCR glue ชื่อ → anchor ผิด). defer: guard กัน deceptive PASS จริง, 1 row, ไม่ tune แบบ unilateral.
- **LLM spec-shift** PR1950W Softening — spec (ไม่ใช่ result) เลื่อน column. ต่างจาก R3 (result-shift). ยังไม่แตะ.
- **multi-page** — Playwright MCP ไม่ได้ connect (UI verify ไม่ได้) + ต้อง per-page text-layer (PR1950W_4064 text-layer 2 หน้า). Tier B. รอ live session.
- **OCR** Sb/As `<→A`, Lot240521 `T5` — recognition-level, ไม่ fix แบบเดา.

ยังไม่ commit — diff ค้างให้ user รีวิว.

---

## FIX ROUND 3 (2026-06-04, sieve table → PASS — user เลือก "ต้องเป็น PASS เพราะมันถูก")

baseline (R2) 50P/0F/40S → **53P/0F/37S** (RI-015 +4, ที่เหลือ parity, 0 FAIL, no deceptive). 2 commit:

**(a) commit 8cee093 — column-shift ผ่อน claimed filter (ship-safe, pure downgrade):**
- bug: แถว `0.850 | 0.0-1.0 | 0.0` LLM เอา aperture 0.85 (∈0-1) เป็น result → **PASS ปลอม** (ค่าจริง 0.0). guard เดิมพลาดเพราะ result จริง 0.0 = ขอบ spec → ถูก mark "claimed" → ไม่ fire.
- fix: จองแค่ resVal (aperture) ไม่จอง spec bounds → จับได้ → honest SKIP. corpus 50P→49P (ลบ deceptive PASS 1).

**(b) commit 2173cf4 — sieve-table-recovery (gated → PASS) + frontend surface needsReview:**
- `sieve-table-recovery.ts`: SKIP sieve row ที่ result=aperture → overwrite result=หลัง spec → re-eval → promote เฉพาะ PASS. **QUAD GATE**: (1) sieve header (2) ชื่อ row sieve (3) โครง aperture|spec|result (4) ★ aperture ของ candidate เป็น series ลดหลั่น ≥3 ค่าไม่ซ้ำ ★.
- RI-015: 0.425→36, 0.150→60, <0.150→4, 0.850→0 ทั้งหมด PASS (ตรง paper) + needsReview. → 8P/0F/3S.
- ★ Opus review 2 รอบ: รอบแรกเจอ BLOCKER (overwrite version เดิม name-gate กันไม่อยู่ — แถวจริง "Residue on sieve(106μm)" ผ่าน gate ชื่อ → deceptive PASS) → revert + เพิ่ม gate(4). รอบ 2: BLOCKER 1/2/3 (single-row) CLOSED. **residual Finding B**: ตาราง residue หลายแถว layout result-ซ้าย-spec + result เรียงลด ยังเจาะ gate(4) ได้ (uncommon) — แต่ **needsReview amber ดักทุกเคส = surfaced ไม่ใช่เขียวเงียบ** (reviewer สร้าง clean-green deceptive ไม่ได้).
- frontend: pill amber "⚠ ต้องตรวจ" สำหรับ needsReview ทุก status + headline "ผ่าน — แต่มี N รายการต้องตรวจ" (กัน needsReview ออกจาก clean pass). ★ load-bearing — ห้ามแก้ให้ needsReview PASS โชว์เขียวล้วน.

**เหลือ (defer):** RI-015 Sb/As (OCR `≤→A`), Cu/Zn grounding-dropped, 2.000 sieve LLM-dropped (→ ground truth ~9P, ได้ 8P). PR1950W Softening LLM spec-shift. multi-page. auto→PASS ไม่ต้อง review = ต้อง Docling.

---

## FIX ROUND 4 (2026-06-04, guard-loosen Lot240521 350μ — Task #3)

baseline (R3) 53P/0F/37S → **54P/0F/36S** (Lot240521 350μ SKIP→**clean PASS**, ที่เหลือ parity, 0 FAIL, 0 deceptive). commit `87b5242`.

**bug:** `downgradeUngroundedPasses` (pass-guard) anchor PASS row ไปบรรทัด data ของชื่อตัวเอง (token overlap) แล้วเช็คว่า result อยู่บรรทัดนั้นไหม. เคสจริง 350μ: **OCR อ่านชื่อแถวติดกันเป็น token เดียว** `SieveResidueon350ur%)` → token overlap = 0 → anchor หลุดไป **บรรทัด 500μ** (แชร์ `sieve residue on` 3 token) ที่ไม่มี result 42.3 → downgrade PASS ที่ถูก (42.3 ∈ 15~45) ทิ้งเป็น SKIP.

**fix (glue-anchor):** บรรทัดที่มี **cell = ชื่อเต็ม (token ต่อกัน)** → ให้ full anchor credit. ★ match แบบ **exact-cell** ไม่ใช่ substring ทั้งบรรทัด ★.

**★ Opus review (HIGH, แก้ก่อน commit):** เวอร์ชันแรกใช้ `lineAlnum.includes(joinedName)` (substring ทั้ง blob) → reviewer สร้าง repro: บรรทัดแปลก (`xx_sieveresidueon500u_blob 42 45`) ที่ชื่อโผล่เป็น substring + แบกค่ายืม จะได้ full credit แล้ว validate ค่ายืม = **deceptive PASS รอด** (substring ไม่ผูก boundary, tie ขยาย validation-line set). → เปลี่ยนเป็น **exact-cell** (`cell === joinedName`): ชื่อแถว sieve มีเลข aperture ฝัง (350/500/150) เป็น cell เต็มเฉพาะบรรทัดตัวเอง → foreign blob ไม่ match → ปิดช่อง. ถ้าชื่อ glue ปนขยะ → glue ไม่ติด → fall back เดิม (false SKIP = honest, ไม่ใช่ deceptive PASS).

**test:** `coa-pass-guard.test.ts` +2 fixture (glue-name 350μ คง PASS · foreign blob ยกค่ายืม **ยัง downgrade**). ครบ 19 checks ✅ — deceptive item1/borrowed-spec/digit-collision ยังจับครบ. tsc 0.

**เหลือ Lot240521:** 150μ = OCR `45 ~T5` (spec not parseable, recognition-level) → 1S เดียว, defer (ไม่ใช่ downstream). ground truth 5P, ได้ 4P.

---

## FIX ROUND 5 (2026-06-04, Task #4 multi-page — per-page process → report per lot)

**ปัญหา:** pipeline render หน้า 1 อย่างเดียว (`pdf.service.convertToImage` hardcode `getPage(1)`) + text-layer รวมทุกหน้าเป็น blob เดียว (`extractPdfText`) → ไฟล์หลายหน้า/หลาย lot เสียหน้า 2+ หมด หรือ LLM งง (header+item ซ้ำคนละ lot).

**แก้ (structure-preserving refactor):** contract `runCoaPipeline` คืน **`CoaReport[]`** (1 report ต่อหน้า) แทน `CoaReport` เดียว. logic guard/recovery chain ย้ายเข้า `processPage()` **verbatim** (พฤติกรรม single-page ไม่เปลี่ยน).
- `pdf.service.convertToImage` → loop ทุกหน้า, render `<file>.p{N}.png`, คืน `string[]`. destroy ใน `finally` (กัน leak ถ้า render หน้ากลาง throw).
- `pdf-text-extractor.ts` → เพิ่ม `extractPdfTextPerPage` (per-page text-layer, `hasUsableText` ≥300 chars/หน้า), `extractPdfText` เป็น join wrapper (backward-compat).
- `header-direction.ts` → `extractHeaderDirectionHints(filePath, pageNum?)` page-aware (★ ลบ cross-page contamination: เดิม scan ทุกหน้า match by name → hint หน้า N อาจ apply row หน้า 1).
- `coa-pipeline.ts` → split เป็น `ocrImage()` / `extractTextPerPage()` / `processPage()` / `runCoaPipeline()`. fresh `OllamaCoaService` ต่อหน้า (debug.llmRaw แยก). **หน้าว่าง (text.trim()==="") → ข้าม** (pinned); ทุกหน้าว่าง → 1 empty report.
- route → `{ reports: CoaReport[], logFile }` (strip debug ต่อ report). `test-coa.ts` + `_validate/verify-4b-only.ts` loop reports.
- `CoaReport` เพิ่ม `page?: number`.
- **frontend:** `UploadResponse.reports[]`, `page.tsx` map → ResultsCard ต่อ report + header "พบ N lot/หน้า", `ResultsCard` prop `report`+`logFile`+`index`+`total` + lot/page badge (total>1). ★ needsReview amber + warnPass headline คงไว้ per-card.

**Gate (per-file diff vs baseline, ไม่ใช่ตัวเลขรวม — corpus dir มี multi-page อยู่):** baseline **54P/0F/36S** → after **68P/0F/44S**.
- single-page 13 ไฟล์: **parity เป๊ะทุกไฟล์** (Barimite header-direction page-aware ยังได้ 5P/2S เท่าเดิม).
- **0 FAIL ทั้ง corpus** คงไว้.
- multi-page ได้ N report: PR1950W_4063 = 2 (page1 4P/4S **เท่าเดิม** + page2 ใหม่ 3P/4S), PR1950W_4064 = 2 (เดิม blob รวม 0P/7S → 2P/4S + 1P/6S), **1F1710 = 4 หน้า (bonus เจอใหม่ — เดิมเสียหน้า 2-4 เงียบ → 0P → 8P/1S)**.

**Opus review (Tier B, merged diff):** 0 BLOCKER / 0 HIGH. Lens deceptive-PASS + needsReview-UI + contract-seam = clean (per-page split strictly safer สำหรับ header-direction). แก้ 2 MEDIUM ก่อนปิด: (1) `imgs[i] ?? imgs[last]` mask page-misalignment เงียบ → **throw + warn** (anti-deceptive); (2) `pdfDocument.destroy()` ย้ายเข้า `finally` (resource-safety). tsc 0 (BE+FE).

**Live UI (Playwright MCP):** upload PR1950W_4063 → render **2 card แยก lot** (badge Lot 4063-01 / 4063-02, stats + amber needsReview แยกต่อ card, ค่าหน้า 2 ต่างจริง Moisture 0.2 vs 0.4 / Residue 500μm 0.02 vs 0.01). ✅

**เหลือ (defer):** ตารางยาวข้ามหน้า (header หน้า 2 ซ้ำ → merge rows) ยังไม่ทำ (หายาก). PR1950W Softening LLM spec-shift (เดิม). all-blank report โชว์ badge แดง "0 parameters" (cosmetic, pre-existing).

---

## FIX ROUND 6 (2026-06-05, grid→LLM "keep-best" — แก้ column-shift family ที่ flatten ทิ้ง geometry)

**baseline (flat) 68P/0F/44S → keep-best 75P/0F/36S** · **+7P · 0 FAIL · 0 regression** · needsReview 30→42 (+12 grid-won amber). gate = `_validate/verify-4b-only.ts` (real pipeline, corpus 16 ไฟล์). tsc 0.

**ปัญหา (root):** flatten OCR เป็น text แบนก่อนส่ง LLM ทิ้ง column alignment → row ที่ cell กลางว่าง (Unit ว่าง) ยุบซ้าย → LLM map spec/result เลื่อน column (column-shift). เคส SODA (Unit ว่างทั้งใบ → copy result เป็น spec ทุกแถว) + PR1950W (ragged row → spec ยืมแถวข้าง).

**แก้ (keep-best, 2 ไฟล์: `rapidocr.service.ts` + `coa-pipeline.ts`):**
- `reconstructTextGrid` (เดิม uncommitted) — cluster token left-edge (x) เป็น column band ทั้งหน้า, เก็บ cell ว่าง → column ไม่เลื่อน. `extractTextBoth` คืน flat+grid จาก OCR pass เดียว.
- **dual-text:** grid ป้อน **LLM อย่างเดียว** · guard ทุกตัว + `debug.ocrText` ใช้ **flat เดิม** (ไม่แตะ) → guard byte-identical.
- **keep-best orchestrator** (`processPage`): flat ก่อนเสมอ (floor) → ถ้า flat โชว์ **collapse-SKIP** (`hasCollapseSymptom`: reason มี `คนละบรรทัด`/`คอลัมน์ป้าย`/`(bare-eq)`) → ลอง grid challenger → เก็บ grid เฉพาะ `gridBeatsFlat` (0 FAIL + grid PASS count ต่อชื่อ ≥ flat ทุกชื่อ **(multiset)** + เพิ่ม PASS รวม). **anti-regression by construction** — flat เป็น floor, grid ทำดีขึ้นได้ แย่ลงไม่ได้.
- scope: **rapidocr engine เท่านั้น** (text-layer/tesseract ไม่มี token bbox). toggle `COA_GRID_LLM=false` ปิด.

**ผล (เฉพาะ 4 ไฟล์ trigger grid challenger — ตามดีไซน์):**
| ไฟล์ | flat | keep-best | grid ใช้? |
|---|---|---|---|
| SODA | 2P/4S | **6P/0S** | ✓ (ground truth 6P เป๊ะ + spec Fe2O3/Insoluble ที่เคย deceptive แก้ถูก) |
| PR1950W p1 | 4P/4S | **5P/2S** | ✓ (Softening 105~115, Gelation 30~55, Moisture ≤1.2 ถูก) |
| PR1950W p2 | 3P/4S | **5P/2S** | ✓ |
| (1 ไฟล์ collapse) | 2P | 2P | ✗ grid ไม่ชนะ → คง flat |
| **ZP10 · RI-015** | 4P · 8P | **เท่าเดิม** | ไม่ trigger (ไม่มี collapse-SKIP) → ไม่เสีย |

**★ Opus review (Tier B, 2 รอบ) จับ BLOCKER + HIGH → แก้ก่อน ship:**
1. **BLOCKER — pass-guard column-blind:** `downgradeUngroundedPasses` validate PASS แค่ "result value โผล่ที่ไหนสักที่บนบรรทัด flat" ไม่สน column → grid ที่ map ผิด column ได้ค่าบนบรรทัดเดียวกัน = guard ปล่อยผ่าน → keep-best หยิบ grid แทน flat SKIP = **deceptive PASS รอด**. **แก้:** grid-won PASS ที่ flat ยืนยันไม่ได้ (`passKey` = name+min+max+specRaw+result ต่างจาก flat PASS = row ใหม่/ค่าเปลี่ยน) → `needsReview=true` → frontend amber ไม่ใช่เขียวเงียบ (เหมือน sieve-recovery). กัน deceptive เป็น clean-green.
2. **HIGH — gridBeatsFlat duplicate-name collapse:** Set name อย่างเดียว → ตาราง sieve ชื่อซ้ำ (RI-015 "Particle Size"×4) ยุบเหลือ 1 → grid อาจทิ้ง flat PASS เงียบ. **แก้:** `passNameCounts` multiset (grid PASS count ต่อชื่อ ≥ flat ทุกชื่อ).
3. MEDIUM — PASS row ค่าเปลี่ยน (flat ถูก, grid ผิด-แต่-เข้า-spec): ปิดด้วย passKey เดียวกัน (รวม result/spec → ต่าง = needsReview).
- re-review: BLOCKER/HIGH/MEDIUM **CLOSED**. residual: over-flagging amber (honest-direction, รับได้) + grid column-blind ยังพึ่ง needsReview เป็นตาข่าย (auto clean-green ต้อง column-aware guard / Docling — future).

**ตัวร่วมที่ grid ทำพัง (เลยใช้ keep-best ไม่ใช่ blanket):** scan ที่ flat ดีอยู่แล้ว (ZP10 rotated → token x หลัง rotate ทำ global-band เพี้ยน → LLM คว้า digit ผิด 1.09→5; RI-015 multi-table → band ปนตาราง). keep-best กันด้วย floor=flat.

### ROUND 6b — Balanced amber policy (ลดงานหน้างาน) + UI + reason ภาษาคน

**ปัญหา user หน้างาน:** needsReview ("ต้องตรวจ") เยอะไป → คนต้องตรวจซ้ำทุกตัว = ไม่ลดงาน. + reason เป็น jargon อ่านงง + สี amber มืด.

**(a) Balanced amber policy** (`coa-pipeline.ts` `isNearSpecBoundary` + recRes loop): result-recovery (LLM ทิ้ง field result → guard กู้จาก OCR) เดิม flag needsReview ทุกตัว → ปรับเป็น **clean green ถ้าค่าเข้า spec ห่างขอบ**, amber เฉพาะใกล้ขอบ. → ZP10/D-2072 (ค่ากลางช่วง, ground-truth ถูก) = เขียวล้วน. **grid-won/sieve column-remap คง amber เสมอ** (re-read column เสี่ยงกว่า).
- ★ **Opus review จับ HIGH+MEDIUM:** (HIGH) clean-green ไม่มี anchor ว่าเลขกู้คือ result จริง — one-sided `≥min` เลข stray ใหญ่ผ่านสบาย = hide FAIL ได้. **แก้: clean-green เฉพาะ spec ช่วง 2 ด้าน (between) ค่ากลางช่วง · one-sided + ช่วงยุบ (≈eq) → amber เสมอ.** (MEDIUM) `isNearSpecBoundary` tolAbs floor หล่น (1e-9) → ช่วงยุบ/bound=0 พลาด → แก้: degenerate span (`span ≤ |res|*1e-3`) → amber.

**(b) UI** (`ResultRow.tsx` + `results.css`): needsReview PASS → pill **เขียว "PASS"** + **⚠ amber pulse-scale** (เต้นโต-เล็ก 1.5s) + ขอบซ้ายเหลือง → "ผ่าน แต่เหลือบยืนยัน" ไม่ตกใจว่าพัง. ★ invariant คง: header เหลือง warnPass + นับ reviewCount + `prefers-reduced-motion` guard. ไม่ใช่เขียวล้วน.

**(c) reason ภาษาคน** (evaluator/grounding/column-shift/sieve): jargon → ประโยคหน้างานเข้าใจ + ลงท้าย "เทียบกับใบจริง". sieve: "ค่าผลนี้ระบบอ่านจากตารางร่อนตะแกรงให้เอง" · bare-eq: "ระบบอาจอ่านค่าผลสลับมาเป็นเกณฑ์" ฯลฯ. ★ คง keyword **"สลับ"/"ทิศหาย"** ใน collapse reasons + อัป `COLLAPSE_SKIP_RE = /สลับ|ทิศหาย/` (เดิม match `คนละบรรทัด|คอลัมน์ป้าย|(bare-eq)`) → grid challenger trigger เหมือนเดิม.

**(d) สี** (`tokens.css`): `--warn #b45309→#e0820e` (สว่างขึ้น) · `--warn-soft→#fff6da` · ⚠ icon `#f59e0b` จี๊ด.

**Gate:** A/B keep-best **75P/0F/36S · 0 FAIL · decisions เหมือนเดิมเป๊ะ** (SODA 2→6, PR1950W 4→5/3→5, 1 คง flat — keyword regex ไม่ regress) · ZP10 = 4P clean ไม่มี ⚑. unit tests ผ่านหมด (fail/pass-guard, column-shift 10, sieve 23, spec-norm 43, result-recovery 10, evaluator). tsc BE+FE 0.

**ถัดไป (user เลือก):** avg-column extractor — ตารางมีคอลัมน์ Average/Mean (Lot240521: 54/56/58/**56.0**avg, 4b หยิบ 58 มั่ว) → ดึงคอลัมน์ avg deterministic (grid รู้ตำแหน่งคอลัมน์).

---

## FIX ROUND 7 (2026-06-06, avg-column extractor — ดึงคอลัมน์ Average/Mean เป็น result แบบ deterministic)

**baseline (avg OFF) 87P/0F/32S → avg ON 88P/0F/31S** · **+1P · 0 FAIL · 0 regression** · needsReview 35→35. gate = `_validate/verify-4b-only.ts` (real pipeline, corpus 16 ไฟล์ / 21 page-reports). tsc 0. unit tests ครบ (avg 13, struct-grid 20, spec-norm 43, result-rec 10, col-shift 10, sieve 23, result-norm 17, pass/fail/grounding-guard, spec-recovery — ผ่านหมด).

**ปัญหา (root):** บาง COA ลงค่าวัดหลายตัว (per-sample) แล้วตามด้วยคอลัมน์ **Average/Mean** — spec เทียบกับ "ค่าเฉลี่ย" ไม่ใช่ค่าวัดเดี่ยว. qwen3:4b หยิบไม่นิ่ง: Lot240521 row 150μ (วัด 54/56/58, avg **56.0**) โมเดลหยิบ **58** (ตัวสุดท้าย). prompt สั่ง "ใช้ Avg ถ้ามี" อยู่แล้ว (`ollama-coa.service.ts:88,97`) แต่ 4b ไม่เชื่อฟัง → root = structural ไม่ใช่ prompt.

**แก้ (deterministic, 1 module ใหม่ `avg-column-recovery.ts` + wire ใน `coa-pipeline.ts`):**
- `recoverAverageColumn(items, gridText)` — อ่าน **column-aware grid** (rapidocr `reconstructTextGrid` หรือ pdfplumber, ทั้งคู่ใช้ `|` + global column band): หา header cell ที่ตรง `^(average|mean|avg\.?)$` → band นั้น = result column. อ่าน cell ของแต่ละ data row; ถ้าเป็นเลขเดี่ยว = result จริง. join grid row ↔ LLM item ด้วย **spec text** (cell ขวาถัด avg = distinctive, LLM copy verbatim) + name-key fallback. override เฉพาะตอน avg เป็นเลข **และต่างจาก** ค่า LLM.
- **★ ABSTAIN by construction ★** — ไม่มี header "Average/Mean" ที่ชัด → no-op (ไฟล์ส่วนใหญ่ไม่โดนแตะ). ต้องมี ≥2 data row ที่ avg-cell เป็นเลข (กัน coincidence). spec-key ชนกัน (สอง row spec เดียว ค่า avg ต่าง) → key นั้น abstain, fall back name-key.
- **apply ใน flat path** (`processPage` ส่ง `gridText` → `runExtractionPass` หลัง result-recovery, ก่อน evaluate; avg = ค่าทางการ ทับค่าวัดเดี่ยว). toggle `COA_AVG_COLUMN=false` ปิด.
- **needsReview policy (เหมือน grid-won):** override ที่เปลี่ยนค่า → PASS row ขึ้น **amber เสมอ (spatial = column inferred)** · structural → balanced. กัน corrected value เป็น clean-green เงียบ.

**ผล (2 ไฟล์ trigger — ตามดีไซน์):**
| ไฟล์ | row | LLM | avg จริง | ผล |
|---|---|---|---|---|
| Lot240521 | Sieve 150μ | 58 | **56.0** | result แก้ถูก · ยังคง SKIP (spec OCR `45 ~T5`, คนละเรื่อง — defer) |
| 1F1710 p3 | Fiber Length | 0.990 | **1.090** | SKIP→**PASS ⚑** (avg จริง, 1.090∈spec) |

**★ ตรวจ deceptive-PASS ของ flip 1F1710 (SKIP→PASS) — พิสูจน์กับใบจริง:** layout DuPont = **double min/max** → `Property|UoM|Avg|Min|Max|Std|Aim||Min|Max` (Batch=`Avg/Min/Max/Std`, Specification=`Min/Max` 2 คอลัมน์ขวาสุด). row จริง: `Fiber Length|mm|1.090|0.990|1.180|0.069|1.170||0.920|1.420`.
- **bug 1 (result):** LLM หยิบ **Batch-Min 0.990** แทน **Avg 1.090** → avg-recovery แก้ถูก (1.090 = avg จริง). baseline: result 0.990 = specMin 0.990 เป๊ะ → pass-guard "ค่าผลตรงขอบเกณฑ์" → SKIP (guard ถูกที่ระแวง — LLM collapse batch-min ลงทั้ง result+spec). หลัง override result≠bound → guard ไม่ยิง → PASS ถูกต้อง.
- **safety:** avg-recovery แตะแค่ **result** ไม่แตะ spec → PASS = "avg จริง เทียบ spec-as-read". deception ใดๆ = spec-misread ซึ่ง **pre-existing** (baseline ใช้ spec เดียวกัน) + flag **amber**. ∴ ไม่สร้าง deceptive PASS ใหม่. avg ∈ [batchMin,batchMax] เสมอ (นิยามค่าเฉลี่ย) ⊂ real spec ปกติ → verdict ถูก.

**★ FINDING ใหม่ (pre-existing, แยก fix — flag user):** 1F1710 (DuPont double-min/max) **spec อ่านผิดทั้งใบ** — โชว์ Batch Min/Max แทน Specification จริง: Fiber Length spec `0.990~1.180` (จริง `0.920~1.420`), Canadian Std Freeness `217~248.5` (จริง `160~360`), Percent Moisture `5.4~9.5` (จริง `5.0~11.0`). **result ถูกหมด, spec ผิด** (clean-green PASS แต่ spec ที่โชว์ผิด). ค่า avg ∈ batch ⊂ real spec → verdict ไม่พลิก **แต่เสี่ยง deceptive ถ้า real spec แคบกว่า batch + avg หลุด** (edge). ทิศแก้: structural-grid parser รับ layout 2 คู่ Min/Max (เลือกคู่ใต้ header "Specification") — ROUND ถัดไป.

**เหลือ (defer):** Lot240521 150μ spec OCR `45 ~T5` (7→T, recognition-level). 1F1710 spec double-min/max (FINDING บน). ตารางยาวข้ามหน้า.

---

## FIX ROUND 8 (2026-06-06, Specification-column recovery — DuPont "double Min/Max" spec-misread จาก FINDING ROUND 7)

**baseline (R7 avg-on) 88P/0F/31S → spec-column ON 88P/0F/31S** · **verdict counts เป๊ะเท่าเดิม · 0 FAIL · 0 regression** · gate = real pipeline corpus 16 ไฟล์ / 21 page-reports (`_validate/_spec-on.log` vs `_avg-on.log`). spec-column ยิง **เฉพาะ 1F1710** (3 page-reports) — ไม่มีไฟล์อื่นโดน gate. tsc 0. unit test ใหม่ `spec-column-recovery.test.ts` 17/17 ผ่าน (avg-column 13 คงผ่าน).

**ปัญหา (= FINDING ROUND 7):** 1F1710 (DuPont fiber/freeness) layout มี **2 กลุ่ม Min/Max** ต่อแถว — กลุ่มซ้ายใต้ header **Batch** (`Avg|Min|Max|Std`) + กลุ่มขวาใต้ **Specification** (`Min|Max`). qwen3:4b อ่าน Min/Max **กลุ่มแรกที่เจอ** = Batch → รายงาน batch spread เป็น spec ทั้งใบ (Fiber `0.990~1.180` แทนจริง `0.920~1.420`, Freeness `217~248.5` แทน `160~360`, Moisture `5.4~9.5` แทน `5.0~11.0`). **result ถูก, spec ผิด** → spec ที่โชว์ผิด + latent deceptive-PASS risk ถ้า real spec แคบกว่า batch.

**แก้ (deterministic, module ใหม่ `spec-column-recovery.ts` + wire ใน `coa-pipeline.ts` รันท้ายสุดก่อน evaluate):**
- `recoverSpecificationColumn(items, gridText)` — header-anchored, **ไม่เดาตำแหน่ง**:
  - **GATE** — abstain เว้นแต่ grid มีทั้ง keyword `Specification` **และ** header row ที่มี ≥2 `Min` + ≥2 `Max` (signature double-group). ไม่มี layout อื่นใน corpus เข้า gate นี้ → no-op ทุกที่
  - **BANDS** — Spec pair = `Min`/`Max` **ขวาสุด** (Batch อยู่ซ้าย, Spec อยู่ขวา), บังคับ minCol < maxCol
  - **READ** — อ่าน band นั้นต่อ data row; cell เพี้ยน (OCR `S.000`) → NaN → **reject ทั้งแถว ไม่ fall-through ไปคอลัมน์ข้าง** (ช่องที่ fabricated spec จะหลุดเข้ามา)
  - **AGREE** — รวม (min,max) ต่อชื่อข้าม block/หน้า, override เฉพาะ modal pair ที่ ≥2 reads + เสียงข้างมากเด็ดขาด (เสมอ → abstain). fuzzy name-pool ดูดชื่อ OCR garble (`Caadian` ↔ `Canadian`)
- **★ SAFETY ★** แตะแค่ **spec** (specRaw/specMin/specMax) ไม่แตะ result · assert spec เฉพาะ ≥2-block agreement ไม่งั้นคงค่า LLM · flag **needsReview (amber) ทุกแถว DuPont** ทั้งที่ override และไม่ override (spatial grid = column inferred → ห้าม clean-green). toggle `COA_SPEC_COLUMN=false`.

**ผล 1F1710 (3 data pages):** spec แก้ถูกเมื่อหน้านั้น OCR ให้ ≥2 block (Freeness→`160~360`, Fiber→`0.92~1.42`, Moisture→`5~11`), verdict คง **9P/0F/0S** (ไม่เปลี่ยนจาก R7).

**★ ทำไม spec-misread นี้สร้าง deceptive PASS ไม่ได้ (พิสูจน์):** batch Min/Max = ค่า min/max ของ lot เอง → **avg ∈ [batchMin, batchMax] เสมอ** (นิยามค่าเฉลี่ย). batch มัก **แคบกว่า** real spec (217~248.5 ⊂ 160~360) → ผ่าน batch ก็ผ่าน real spec แน่ → batch-as-spec ให้ได้แค่ false-FAIL (เป็นไปไม่ได้เพราะ avg อยู่ใน batch) ไม่ใช่ false-PASS. ∴ ปลอดภัยกว่าที่กลัวไว้.

**residual (honest abstain, safe):** บางหน้า OCR ให้ block เดียว → module abstain → spec ยังโชว์ batch range (เช่น report 3: Freeness `217~248.5`, Fiber `0.99~1.18`). verdict ยังถูก (avg ∈ batch) + amber flag → คนตรวจเจอ. ไม่ override จากหลักฐาน block เดียว = ดีไซน์ (honest > guess).

## FIX ROUND 9 (2026-06-10, junk metadata-row filter + bare-number spec-col routing — เก็บ SKIP ค้าง 2 กลุ่ม)

**baseline (R8+HQ) 126P/0F/25S → คาด 128P/0F/14S** (+2P verified, −11 junk SKIP) · 0 FAIL · 0 regression. 2 fix deterministic:

**(a) `metadata-row-filter.ts` (+ hook ใน `coa-pipeline.ts` หลัง grounding ก่อน spec-recovery):** ตัด row ที่ LLM ดึงมาเป็น item ทั้งที่เป็น metadata ของใบ — dual gate ต้องครบคู่: (1) ชื่อ match pattern `^lot\s*[mn]umber` / `^pr[ao]duction\s*date` / `^accept$` / `^item$` (รองรับ OCR garble จริง: Lot mumber, Lotmumber, Praduction) + (2) **ไม่มี spec ที่ parse ได้** (เช็คผ่าน normalizeSpecFromCandidate — row ชื่อ match แต่มี spec จริง → ห้าม drop). ผลจริง: 1F1710 p4 ตัด 9 junk (Lot number ×4 + Production Date ×4 + ACCEPT), PR1950W_4064 ตัด header `Item` ×2. unit test 27 cases.

**(b) `parse-structural-grid.ts` bare-number spec-col routing:** เคส 4064 `Residue on sieve(1mm)` spec พิมพ์ `0` เลขเปล่า → classifySpec ข้าม → SKIP "อ่านเกณฑ์ไม่ได้" ทั้งที่ 4063 (scanned เส้นทาง LLM) อ่านแถวเดียวกันได้ PASS. fix: resolveSpecCol (คอลัมน์ที่ classifySpec hit มากสุด) + specColDirection — ทิศต้อง **unanimous** (upper ล้วน เช่น ≤1.2/≤5/≤0.1 → bare 0 → specMax=0 · มี hit ต่างฝ่ายแม้ตัวเดียว → mixed → abstain คง SKIP). range ไม่นับทิศ. ออกทาง grid challenger → ผ่าน keep-best gate + amber ⚠ เสมอ (ไม่ clean-green). unit test +fixture 4064.

**verify:** tsc 0 · filter 27/27 · grid 26/26 · evaluator fixtures เดิม · live: 1F1710 32P/0F/10S→**32P/0F/1S** (เหลือ Fiber Length `601` digit-scramble — HQ challenger ลองแล้ว 12P ไม่ชนะ 14P → คง best, gate ทำงานถูก) · 4064 6P/3S×2→**7P/0F/1S×2** (Residue 1mm → PASS ⚠, เหลือ Appearance legit) · sentinel 4063 **7P/1S×2 เป๊ะเดิม**.

**เหลือ (รอ user บอกค่ากระดาษ):** 1F1710 Fiber Length ตัวจริง (ระบบอ่าน 601) · RI-015 Particle Size 0/1/0 ตรงขอบ + `(udd)qd` 50/32 ppm (ชื่อ garble) · grade 7 ไฟล์ที่ยังไม่มี ground truth (Z99, D-2072, TXAX-A, 1F1710, 4A, RB220, PR1950W_4064).

---

## FULL CORPUS RE-RUN (2026-06-10) — verify หลัง ROUND 9 + เคลียร์ contradiction Z99/Suzorite

gate = `_validate/verify-4b-only.ts` (real pipeline, daemon :8765 + Ollama qwen3:4b). log = `_validate/_run-0610.log`.
**ผลรวม: 128P / 0F / 12S · rows=140 · 0 deceptive · needsReview=51.**

per-file (vs ground-truth 8 กลุ่มจาก session 06-09):

| กลุ่ม | ไฟล์ | จริง 06-10 | ground-truth | สถานะ |
|---|---|---|---|---|
| A1 | Z99 | **13P/0F/0S** | 13P | ✅ จบ (probe Jun-9 `1P/6S` = stale/คนละ config, ของจริง clean) |
| A2 | Suzorite | 5P/0F/1S | 5P + Traces(text)SKIP | ✅ จบ |
| A3 | PR1950W_4064 | 7P/0F/1S ×2 | all PASS + Appearance(text) | ✅ จบ |
| B4 | Barimite200 | 7P/0F/0S | 7P (PH max 8, SG max 4.32 กู้แล้ว) | ✅ จบ |
| B5 | 4A | 3P/0F/0S | LOI 1.8≤3.5 PASS + logistics ตัดทิ้ง | ✅ จบ |
| — | 1F1710 (4 หน้า) | 32P/0F/1S | เกือบหมด | ✅ เหลือ p4 Fiber `601` digit-scramble (รอกระดาษ) |
| C6 | RI-015 | 8P/0F/3S | — | 🟡 ยังคา (ดูล่าง) |
| D7 | RB220 (1 หน้า) | 2P/0F/0S | — | ⬜ รอค่ากระดาษ |

**★ Z99/Suzorite contradiction RESOLVED:** milestone 06-05 บอก structural-grid fixed · vault ground-truth 06-09 บอกยังพัง · full re-run 06-10 ยืนยัน **ของจริงจบแล้วทั้งคู่** (Z99 13P, Suzorite 5P/1S). ค่าใน vault 06-09 = state เก่าก่อน R7.

### งานที่เหลือจริง (2 อัน)

**1) RI-015 Cu/Zn drop ★ bug จริง ★ (group C6)** — grounding guard false-positive:
- ✅ Particle results 36/60/4 = PASS แล้ว
- ❌ **wt%Cu 60.9 (spec 57~61) + wt%Zn 38.44 (spec 36~40) หายจาก output** ทั้งที่อยู่ใน llmRaw → `coa-grounding.ts` ตัด row ทิ้ง false-positive. ต้องไล่ว่าทำไม guard drop 2 row นี้
- ⚠️ Particle 2.000 → SKIP (`result=0 spec อ่านเป็น 0.0-1.0` เพี้ยน — ground-truth = bare-eq "0.0" result 0.0 ควร PASS)
- ⚠️ chem names garble `(udd)qd/sv/qs` (Pb/Cd/Sb/As) แต่ verdict ถูก — recognition-level, defer
- **เสี่ยง/effort:** Tier B — grounding guard = load-bearing (กัน 0-deceptive). ห้าม loosen แบบ unilateral. ต้อง root-cause + gate corpus (0 regression) + Opus review. ไม่ใช่ one-liner

**2) RB220 (group D7)** — รอ ground-truth หน้างาน:
- ระบบได้ `Fibre length 200 ∈ 180~280 PASS` + `Shotcontent 0.07 spec=0.5 PASS`
- ground-truth note: result มี 2 col Min/Max (200/250) LLM จับแค่ Min → **ยังไม่มีค่ากระดาษยืนยัน**
- block จนกว่า user บอกค่าจริง — แก้เองไม่ได้

---

## FIX ROUND 10 (2026-06-10, transposed-table grounding — RI-015 Cu/Zn false-drop)

baseline (R9 full re-run) **128P/0F/12S → 129P/0F/12S** · **RI-015 8P→10P** (Cu/Zn กู้คืน) · 0 FAIL · 0 deceptive. gate = `_validate/verify-4b-only.ts` (`_run-0610-grounding2.log`). tsc 0 · unit `coa-grounding.test.ts` 13/13.

**bug (RI-015 group C6):** ตาราง chem เป็น transposed (items-as-columns), ชื่อ/spec/result คนละบรรทัด:
```
L31 ชื่อ:   ANALYSIS | wt%Cu  | wt% Zn1 | ...
L32 spec:   Pattern  | 57-61  | 36-40   | ...
L33 result: Lot#01   | 60.9   | 38.44   | ...
```
`dropUngroundedItems` ตัด Cu/Zn ทิ้ง (false-positive): name path พัง (token cu/wt < 3), co-location พัง (spec+result คนละบรรทัด). LLM ดึงครบ — guard ลบ.

**แก้ (`coa-grounding.ts` path 3 `isTransposedGrounded`):** pipe-block (บรรทัด `|`-delimited ติดกัน ≥2) → grounded เมื่อ result+spec อยู่ **column เดียวกัน คนละบรรทัด** ใน block.

**★ Opus review (Tier B) จับ HIGH+MEDIUM → แก้ก่อน ship:**
1. **HIGH name-blind:** path 3 เดิม ground จากเลข align อย่างเดียว → fabricate (LLM อ่านเลข Zn ตั้งชื่อ "Gold") รอด. **แก้: name-in-block precondition** — ชื่อ row ต้องโผล่ใน block นั้น (`nameSignal` token ≥2 รับ symbol ธาตุ).
2. **MEDIUM digit-loose:** `numberMatches` (`423↔42.3`) ฝั่ง keep หลวม. **แก้: `cellHasValue` exact-value** (ตรงหลัก `valuePresent` ของ pass-guard).

**★ regression ที่ tightening แลกมา (user เลือก accept = tight):** 1F1710 p4 **14P→13P** — Percent Moisture batch สุดท้าย ชื่อ OCR garble ("Moislure") → name-blind row ที่เดิม path 3 เก็บด้วยเลขล้วน → ตอนนี้ name precondition ตัด. = **deceptive-keep hole ที่ Opus เตือนพอดี** (row จริงโดนลูกหลง). user เลือก tight ตามหลัก "0 deceptive > recall" — Moisture ยังโชว์ PASS อีก 4 batch ในหน้าเดียวกัน, ที่หาย = ตัวที่ 5 ชื่อพัง.

**generalize:** deterministic/structural — จับโครง (pipe-block + column-align + name-in-block) ไม่ hardcode ค่า. เอกสารอื่นโครงเดียวกัน = ทำงานเหมือนกัน. layout ใหม่ที่ไม่เข้าเกณฑ์ → abstain (path 3 ไม่ยิง) → fall back honest SKIP.

**เหลือ RI-015 (defer):** Particle 2.000 → SKIP (result=0 spec อ่าน `0~1` ยืมแถวข้าง ไม่ใช่ bare-eq `0.0`, result ตรงขอบ) · Pb โดน pass-guard transposed-blind downgrade (คนละ guard, มิลด์ honest SKIP). RB220 รอค่ากระดาษ.

## FIX ROUND 11 (2026-06-10, RI-015 2.000 missing-row recovery — SKIP+amber)

final gate `_run-0610-final.log`: **101P/0F/11S · 0 deceptive** · **RI-015 10P/0F/4S** (2.000 แสดงเป็น SKIP+amber). tsc 0 · unit sieve 27/27. หมายเหตุ: RB220 + PR1950W_4064 ×2 ออก 0P รอบนี้เพราะ Ollama connection หลุด (ชนกับ UI ใช้พร้อมกัน) ไม่ใช่ code — run ก่อน RB220 = 2P ปกติ. 1F1710 p4 oscillate 13↔14 จาก LLM nondeterminism.

**bug (user UI):** RI-015 sieve `2.000 | 0.0 | 0.0` — LLM ทิ้งทั้งแถว (spec+result เป็น 0.0 → มองเป็นว่าง) → ไม่ขึ้น UI เลย. ground-truth ควร PASS (0 retained).

**แก้ (`sieve-table-recovery.ts` `recoverMissingSieveRows` + wire `coa-pipeline.ts` หลัง recoverSieveTableResults):**
- parse OCR sieve block (`<aperture>|<spec>|<result>`) เติมแถวที่ items ไม่มี
- **scope แคบ = เฉพาะ bare-eq (min===max) + result==ค่า** → range row (0.425 ฯลฯ) ไม่ถูกแตะ (กัน add ซ้ำ — เวอร์ชันกว้างเคย add "36" dup จาก OCR-glue spec `10.045.0`)
- GATE: isSieveTable + apertures ลดหลั่น ≥3 (อ่าน OCR ตรง ไม่ใช่ LLM ปั้น)
- insert **บนสุดกลุ่ม sieve** (splice firstSieveIdx ไม่ append ท้าย — user: 2.000 ต้องอยู่แถวแรก)

**★ Opus review (Tier B) จับ BLOCKER → final:**
- เดิม promote bare-eq → PASS = override anti-deceptive SKIP ของ evaluator (`coa-evaluator.ts:160`). worst case: real `0.5 Max` ยุบ → `_|0.5|0.5` → PASS ปลอม
- **final (user): ทุกแถวที่ recover = SKIP+needsReview เสมอ ไม่ promote PASS เลย** — เป้าแค่ "แสดงบน UI" (user: "0 0 ไม่ต้องให้ pass แล้ว...แค่แสดงก็โอเค") → ไม่มีทาง override evaluator
- + dedup null guard (`E.result != null` — กัน Number(null)===0 suppress แถว 0/0 จริง)

**generalize:** จับ pattern (sieve table + bare-eq drop) ไม่ hardcode — เอกสารอื่น sieve ที่ LLM ทิ้งแถว bare-eq กู้ได้เหมือนกัน.

---

## FIX ROUND 12 (2026-06-10, perf: UI โหลดช้า)

user: RI-015 โหลดนาน/ค้างที่ UI. สาเหตุ 3 ชั้น:
1. **Ollama crash ค้าง** (connection forcibly closed ช่วงท้าย gate + UI พร้อมกัน) — restart หาย. คือตัว "ค้าง" จริง
2. **`keep_alive: 0` ตกค้าง** ใน `ollama-coa.service.ts` — ของเดิมตั้งให้ typhoon-ocr-3b (7.5GB) แต่ติดมากับ call qwen3:4b → unload+reload model ทุก LLM call (scanned = 2-4 call/ไฟล์) → แก้เป็น `"10m"`
3. **ไม่มี cache** — กดไฟล์เดิมซ้ำ = rerun pipeline เต็ม → เพิ่ม in-memory sha256 cache ใน `coa.routes.ts` (ตั้งใจไม่ persist: restart backend = cache ใส → เทสหลังแก้ code ไม่โดนผลเก่าหลอก)

verify: tsc 0 · RI-015 เดี่ยว **45.5s ผลเป๊ะเดิม 10P/0F/4S** (2.000 recover ✓, HQ 11P ไม่ชนะขาด→คง best ✓). keep_alive ไม่แตะ accuracy (แค่ residency). ยังเหลือ (defer): gate HQ challenger ไม่ให้ยิงเมื่อชนะไม่ได้ — ต้องแยก SKIP ชนิด OCR-fixable vs structural, ค่อยทำถ้ายังช้า.

## FIX ROUND 13 (2026-07-14, perf: upload รอนาน — cold model reload + HQ challenger เผาเปล่า)

user: upload แล้วรอผลนานผิดปกติ. วัดจริงจาก log timestamps: text-layer 51s · scanned 114s · scanned+HQ 262s, แต่ warm re-run = 16.5s / 67s → ตัวถ่วงคือ **cold start ไม่ใช่ pipeline**. สาเหตุ 3 จุด:

1. **qwen3 โดน evict จาก VRAM หลัง idle เกิน keep_alive 10m** → upload แรกเจอ ~37s model reload "ระหว่าง user รอ". **แก้ (`ollama-coa.service.ts` `warmup()` + `startOllamaKeepWarm()`, เรียกจาก `index.ts`):** ping 1 token ทุก 8 นาที + warm ทันทีตอน start. ★ options ต้องตรง `parseCoa` (num_ctx 8192) — Ollama restart runner ถ้า options ต่าง = warm ทิ้งเปล่า. ปิดด้วย `OLLAMA_KEEP_WARM=false`. CLI/test-coa ไม่แตะ (batch warm เองตามธรรมชาติ)
2. **HQ challenger ยิงทั้งที่ชนะไม่ได้** (defer จาก ROUND 12) — gate เดิม `skip > 0` ทำ PR1950W (SKIP เดียว = Appearance spec="body" result="Powderwithoutforeign", text ล้วนทั้งเอกสาร) เผา ~35s/หน้า re-OCR v5-server + LLM รอบใหม่ แล้วแพ้ keep-best 100%. **แก้ (`coa-pipeline.ts` `skipMayBenefitFromHq`):** ยิง HQ เฉพาะเมื่อมี SKIP ที่ spec/result มี digit หรือฝั่งใดฝั่งหนึ่งว่าง (= OCR อ่านเพี้ยน/ตกมีโอกาสจริง). "" นับเป็นว่าง (conservative → HQ ยังลอง)
3. **HQ engine lazy-load ตอน request แรก** (~5-8s บวกเพิ่ม). **แก้ (`ocr_server.py`):** preload ใน daemon thread ตอน start. ปิดด้วย `COA_OCR_HQ_PRELOAD=false`

**gate (corpus16, daemon+Ollama ครบ, รันเทียบบนเครื่องเดียวกันวันเดียวกัน):**
- baseline (code เดิม stash ไว้): **125P/0F/16S** rows=141 needsReview=52
- ใหม่: **126P/0F/15S** rows=141 needsReview=51 · **0 FAIL · 0 deceptive**
- **4A: `[hq-ocr] ✓ HQ ชนะ 2P→3P` — critical case ยังยิงและยังชนะ** (LoI spec "%98" มี digit → ผ่าน filter)
- PR1950W p2 +1P มาจาก LLM drift (flat ต่างกันก่อนถึง HQ — อาการเดียวกับ 1F1710 p4 oscillate ROUND 11) ไม่ใช่ gate ใหม่; SKIP แถวนั้น (`Residue on sieve(1mm)` min=0) มี digit → gate ใหม่ยิง HQ ตามปกติ
- RI-015 9P/0F/5S เท่ากันทั้งสอง run (delta vs ROUND 11 คือ env drift ไม่ใช่ round นี้)
- หมายเหตุ baseline ≠ 129P ของ ROUND 10 = LLM drift ข้ามวัน/เครื่อง — เทียบ apples-to-apples แล้วเท่านั้น

**perf ที่วัดได้:** PR1950W smoke 67s→**32.5s** (ผลเป๊ะเดิม) · cold-start 37s หายจาก path ที่ user รอ · tsc 0 · unit 47/47+4F(expected)

**generalize:** filter จับ "ชนิดของ SKIP" (numeric-fixable vs structural-text) ไม่ hardcode ชื่อ field/ไฟล์ — เอกสารใหม่ที่ SKIP เพราะ visual-check row ข้าม HQ เหมือนกัน, SKIP เพราะเลขเพี้ยนยังได้ HQ เต็มๆ. keep-best ชั้นนอกไม่แตะ = ต่อให้ filter พลาดยิง HQ ฟรี ก็แค่ช้า ไม่มีทาง regress ผล.

## FIX ROUND 14 (2026-07-17, LAN-ready OCR daemon — path→bytes contract, ย้าย daemon ข้ามเครื่องได้)

user: จะแยก OCR daemon (+Ollama) ไปรันเครื่อง LAN แยกเพื่อ offload backend. **Root cause ที่ block:** `rapidocr.service.ts` ส่ง `{ path: abs }` → daemon `os.path.exists(path)` เปิดไฟล์จาก **disk ของ daemon เอง** → รูป (PNG ที่ backend render + temp rotation) อยู่บน disk เครื่อง backend → daemon คนละเครื่องหาไฟล์ไม่เจอ → HTTP 500 → pipeline fall back Tesseract **เงียบ** (corpus เพี้ยนไม่รู้ตัว). (Ollama = 0 code, ส่ง text อยู่แล้ว — งานนี้แก้ OCR ฝั่งเดียว)

**แก้ (transport-only, ~10 บรรทัด/ฝั่ง):**
1. `rapidocr.service.ts` `ocrTokens`: อ่านไฟล์ → `fs.readFileSync().toString("base64")` → ส่ง `{ path, image_b64, hq }` (path เก็บไว้ log/error เท่านั้น) + axios `maxBodyLength/maxContentLength: Infinity` (กัน base64 ใหญ่ชน default limit)
2. `ocr_server.py` `resolve_image(req)`: มี `image_b64` → `base64.b64decode` → ส่ง **bytes** เข้า `eng()` (RapidOCR 3.x LoadImage รับ bytes); ไม่มี b64 → fall back อ่าน `path` เดิม (= same-machine back-compat, `render_and_test.py` ที่ยังส่ง `{path}` ใช้ได้)
3. `ocr_server.py` bind `127.0.0.1` → **`0.0.0.0`** (env `OCR_BIND_HOST` override, default 0.0.0.0 = รับ LAN ทันทีตอน deploy)

**gate (corpus16, daemon code ใหม่ + Ollama ครบ, เครื่องเดียววันเดียว):**
- **126P/0F/15S** rows=141 needsReview=51 · **0 FAIL · 0 deceptive** = **ตรง baseline ROUND 13 เป๊ะทุกตัว**
- byte-identical เพราะ `eng(path)` vs `eng(bytes)` decode เป็น ndarray ตัวเดียวกัน (cv2 imread vs imdecode พิกเซลเท่ากัน) → OCR output ไม่ขยับ. ไม่มี Tesseract fallback เงียบ (log สะอาด) · tsc 0 · py_compile 0

**generalize:** contract เปลี่ยนจาก "daemon อ่าน disk" → "backend ส่งเนื้อรูปมา" = ตัด coupling ระหว่าง daemon กับ filesystem เครื่อง backend. path field เก็บไว้ = backward compat ไม่ต้องแก้ dev harness. **ค้าง (ไม่ใช่ blocker OCR):** `/ocr/restart` (`coa.routes.ts:65`) spawn python local → ข้ามเครื่องใช้ไม่ได้ (backend spawn daemon เครื่อง LAN ไม่ได้) → deploy LAN ต้อง start daemon เองบนเครื่องนั้น; UI restart button กลายเป็น no-op เงียบ (frontend `.catch` อยู่แล้ว ไม่ crash).
