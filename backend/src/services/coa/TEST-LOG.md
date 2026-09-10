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

## FIX ROUND 15 (2026-07-21, perf profile upload + HQ speculative prefetch — opt-in สำหรับ LAN)

user: upload หน้างานยังรอนาน (10-20s+) — โปรไฟล์แยก step หา bottleneck จริง (งานค้างจาก ROUND 13 ที่ถูก interrupt ก่อนวัด)

**Profile จริง (PR1950W 2 หน้า scanned, warm ทุกอย่าง, pre-change = 46.6s):**
- render PDF→PNG 1.0s (2%) · OCR default mobile 8.0s (17%, fast-path ไม่หมุน) · grid geometry 2.3s (5%)
- **LLM qwen3:4b ×3 calls = 26.3s (56%) = คอขวดหลัก** (flat p1 + flat p2 + HQ re-parse)
- **HQ challenger 18.6s (40%): re-OCR v5-server 11.8s + LLM 8.4s — จบด้วย ✗ แพ้ keep-best ทุกครั้งบนไฟล์นี้**
- rotation correction = จ่ายเฉพาะไฟล์หมุนจริง (×3 OCR) — ไฟล์ตั้งตรง fast-path อยู่แล้ว ไม่ใช่จุดต้องแก้
- OCR ล้วนต่อหน้า scanned (mobile/v4): ~4.5-8s แปรตามความหนาแน่น token (RI-015 119 toks = 7.8s ช้าสุด)

**ทำ: speculative HQ prefetch (`coa-pipeline.ts` อย่างเดียว, ~20 บรรทัด)** — ยิง `extractTextBoth(hq)` ทุกหน้า scanned ล่วงหน้าตอน LLM เริ่ม parse เก็บ promise ใน Map ส่งเข้า `processPage`; HQ branch `await (prefetch ?? re-OCR เดิม)`. ผลวัด: จุดรอ HQ-OCR 11.8s → **0s** (ผลรออยู่แล้ว), total 46.6→41.8s

**แต่พบผลข้างเคียงบนเครื่องเดียว (single box):** onnxruntime (CPU ทุก core) ชนกับ Ollama ระหว่าง generate → LLM ช้าลง ~2s/call + speculation ที่ทิ้ง (ไฟล์สะอาด) ค้างใน daemon lock ทำ request ถัดไปต่อคิว → ไฟล์สะอาด Lot240521: ON 21.6/29.8s vs OFF 17.4/16.9s = **net ขาดทุนเมื่อไฟล์ส่วนใหญ่สะอาด** → **ตัดสิน: default OFF (opt-in `COA_OCR_HQ_SPECULATE=true`) — เปิดเมื่อย้าย daemon ไปเครื่อง LAN ตามแผน (CPU ไม่ชน = ได้ -11.8s เต็มฟรี)**. default path = code เดิมเป๊ะ (วัดยืนยัน 16.2s)

**gate (corpus16, เครื่องเดียววันเดียว 2026-07-21):**
- baseline (pre-change): **126P/0F/15S** rows=141 needsReview=51 = ตรง ROUND 14 เป๊ะ
- after (speculation ON ระหว่าง gate): 124P/0F/15S rows=139 — ต่าง 2 จุด (PR1950W p2 sieve-1mm PASS↔SKIP, 1F1710 p4 ±2 rows) → **rerun แยก 2 ไฟล์ ×3 reps ×2 โหมด (ON/OFF): 6/6 รอบตรงกันเป๊ะทุกแถว** = flip เป็น Ollama run-to-run variance (prefix-cache ตามลำดับไฟล์ก่อนหน้า — sieve row เดียวกัน flip บน code เก่าในวันเดียวกันด้วย) ไม่ใช่ผลของ patch. **0 FAIL · 0 deceptive ทุก run** · tsc 0

**generalize + เหลือ (เรียง impact):**
1. **LLM 56% = คอขวดโครงสร้าง** — จะลดต้องเปลี่ยน model/prompt/hardware = accuracy A/B (user ตัดสิน)
2. **บั๊ก keep-best พบใหม่ (ยังไม่แก้ — เปลี่ยน verdict):** HQ ชนะจริง 7P>6P บน PR1950W p2 แต่โดน reject เพราะ PASS-preservation เทียบชื่อ item แบบ strict — v5 อ่าน "Residue on sieve(106m)" vs mobile "(106 μ m)" = คนละ string → นับเป็น "PASS เดิมหาย". แก้ = normalize ชื่อก่อนเทียบ (strip space/μ) → HQ ที่จ่ายเวลาไปแล้วได้ผลตอบแทนจริง. ต้องผ่าน gate เต็มก่อน
3. sha256 cache (d1dd822) กันไฟล์ซ้ำอยู่แล้ว — pain จริงคือไฟล์ใหม่ file แรกของวัน (cold model 36.5s ถ้า keep-warm ไม่ทำงาน เช่น CLI)

## FIX ROUND 16 (2026-07-21, live progress UI — pipeline บอกขั้นที่กำลังทำให้หน้าเว็บ)

user: หลอด progress เดิมเดาไม่ได้ว่าใกล้เสร็จยัง → ให้ backend รายงานขั้นจริง + วินาที

**ทำ:** (1) `coa-pipeline.ts` เพิ่ม `ProgressFn` callback (optional — CLI/corpus ไม่ส่ง = พฤติกรรมเดิมเป๊ะ) จุด emit: render / ocr(page,pages) / parse(page,pages) / hq / eval. (2) `coa.routes.ts` progress Map + `GET /progress/:jobId` (TTL 10 นาที กวาด orphan); FE ส่ง jobId มากับ form. (3) FE: `ProgressPanel.tsx` ใหม่ — checklist 4 ขั้น + "หน้า n/N" + badge HQ + หลอด % monotonic (น้ำหนักตาม profile ROUND 15) + นาฬิกาวิ่ง + hint "ปกติ ~20 วิ". Playwright ยืนยันบน PR1950W จริง: OCR หน้า 2/2 → AI อ่านตาราง + badge ตรวจซ้ำละเอียดสูง โชว์ถูกจังหวะ

**gate (corpus16, วันเดียวกับ ROUND 15):** 123P/0F/14S — ต่างจาก baseline เช้า (126P) เฉพาะ 3 ไฟล์ variance เดิม: RI-015 **+1P**, PR1950W p2 sieve row (flip พิสูจน์แล้ว 6/6), 1F1710 p4 แกว่ง 14/13/11/12P ภายในวันเดียวบน CLI path ที่ callback = undefined (code ไม่ต่าง) = Ollama drift ไม่ใช่ regression. **0 FAIL · 0 deceptive ทุก run** · BE tsc 0 · FE lint 0 + build ผ่าน

## FIX ROUND 17 (2026-07-25, result เป็น "ช่วง Min|Max" — ใบที่ไม่มีคอลัมน์ result เดี่ยว [RB220])

user: "min max ด้านซ้ายต้องอยู่ในกรอบ min max ด้านขวา = ผ่าน · หลุดกรอบต้อง FAIL" + "เช็คด้วยว่าอ่านค่ามาตรงไหม"

**โครงที่แก้ (RB220 / Rockwool-Lapinus, text-layer):** ฝั่งผลแตกเป็น 2 คอลัมน์ เทียบฝั่งเกณฑ์ที่แตกเป็น 2 คอลัมน์
```
Batch no. | Fibre length | Results ( micron ) | Limits ( micron )
Min. | Max. | Min. | Max.
72700403 | 200,00 | 250,00 | 180 | 280
72700403 | Shot > 63 μm | 0,07 | 0,28 | 0.5      ← ฝั่ง Limits มีแค่ Max
```
เดิมได้ PASS แต่ **บังเอิญถูก** — ดูแค่ Min (200 / 0.07) ค่า Max หายทั้งใบ

**ราก 2 ชั้น:**
1. `result-normalizer.ts` object `{min,max}` ที่ไม่มี `avg` → **เฉลี่ย** แล้วเทียบเป็นจุดเดียว = ช่องทาง deceptive PASS ตรง ๆ (result [0.4,0.6] vs spec ≤0.5 → avg 0.5 → PASS ทั้งที่ max หลุด)
2. qwen3:4b map โครงนี้พลาด **ทุกรัน**: `result:"200,00"` + `resultMin:"250,00"` · แถว shot เอา 0,28 ไปเป็น `specRaw` → พึ่ง LLM ไม่ได้

**ทำ:**
- `result-normalizer.ts` — `{min,max}` ครบคู่ ไม่มี avg → `interval` (ห้ามเฉลี่ย). `min==max` → จุดเดียวตามปกติ
- `coa-evaluator.ts` — `resultMin/resultMax` เข้า `CoaItemInput`; `evaluateInterval()` เทียบ **ทั้งช่วง**: between `rMin≥sMin && rMax≤sMax` · le/lt `rMax≤(<)spec` · ge/gt `rMin≥(>)spec` → **หลุดขอบใดขอบหนึ่ง = FAIL** (user decision). `result` ที่คืนออก = "ขอบที่ตัดสิน" (binding) → guard/margin-green/decimal-risk ที่คิดบนเลขเดี่ยวยังทำงานถูกทาง. spec bare-eq (ทิศหาย) → SKIP เหมือน path เดิม · ขอบ result ตรงขอบ spec พอดี → SKIP (anti-fabricated-PASS เดิม)
- `result-minmax-recovery.ts` (ใหม่, deterministic) — กู้จาก header เอง: group-header ต้องมี cell `Results…` ซ้ายกว่า cell `Limits/Specification…` + บรรทัดถัดไปเป็น `Min./Max.` ล้วน ≥3 ช่องและเริ่มด้วย Min,Max + data line มี cell ตัวเลขล้วน ≥ จำนวน sub-header → **align จากขวา** (ตัด batch no./เลขในชื่อแถวทิ้งเอง). ไม่ครบ → no-op
- `spec-normalizer.ts` — `以下` → le, `以上` → ge (ใบญี่ปุ่น 試験成績表; `合格` อยู่ใน JUDGMENT_TAIL แล้ว)
- `evaluator.test.ts` — fixture RB220 + 9 interval edge case + KGP-H65 7 แถว, expected-status check **18/18 ตรง**

**★ prompt ต้องคืนเป็นเดิม (บทเรียนของรอบนี้) ★** — ลองสอน LLM ด้วย field `resultMin/resultMax` + rule 4 บรรทัด → gate ได้ **104P/0F/15S rows=119** (หาย 22 rows: 1F1710 p4 เหลือ 3P จาก ~11) = prompt ยาวขึ้นทำ 4b คายแถวหายทั้ง corpus. deterministic recovery ไม่ต้องพึ่ง LLM อยู่แล้ว → **revert prompt ทั้งก้อน** (diff เหลือแค่ 3 บรรทัด type ใน `RawCoaItem`)

**gate (corpus16, เครื่องเดียว รันติดกัน 2026-07-25) — apples-to-apples ผ่าน `git stash`:**
| | PASS | FAIL | SKIP | rows | needsReview |
|---|---|---|---|---|---|
| baseline (โค้ดเดิม) | 114 | 0 | 14 | 128 | 38 |
| after (โค้ดใหม่) | **114** | **0** | **14** | **128** | 41 |

**status เท่ากันเป๊ะ 21/21 ไฟล์-หน้า · 0 FAIL · 0 deceptive ทั้งสองรัน · BE tsc 0**
- `[result-minmax]` ยิง **1 ครั้งทั้ง corpus** (RB220 เท่านั้น) = abstain ทำงานจริง
- needsReview +3 = RB220 +2 (interval PASS ตั้ง amber ให้คนยืนยันคอลัมน์ Min/Max — ตั้งใจ) + Barimite +1 (**drift**: LLM อ่าน `325 Mesh Passing` เป็น 95 ในรันหนึ่ง 98.9 ในอีกรัน → flat 5P vs 6P → keep-best flag "grid PASS ที่ flat ยืนยันไม่ได้" ต่าง 1 แถว; verdict สุดท้าย 7P/0F/0S เท่ากัน)
- rows=128 (ไม่ใช่ 141 ของ ROUND 15/16) เกิดกับ **baseline ด้วย** → drift ระหว่าง 21→25 ก.ค. ไม่ใช่ของ patch นี้ (1F1710 p1 คาย 0 items ทั้ง 2 รัน)

**RB220 ค่าที่อ่านได้ vs ใบจริง (ตามที่ user สั่งเช็คค่า ไม่ใช่แค่ verdict):**
| แถว | text-layer ใบจริง | ระบบอ่าน | verdict |
|---|---|---|---|
| Fibre length | `200,00 \| 250,00 \| 180 \| 280` | result 200–250 · spec 180~280 | PASS (⊆) |
| Shotcontent | `0,07 \| 0,28 \| 0.5` | result 0.07–0.28 · spec ≤0.5 | PASS (0.28≤0.5) |

ตรงทุกตัวเลข ไม่มีการยืมเลขข้ามคอลัมน์

**ใบญี่ปุ่น KGP-H65 (関西マテック wollastonite) — ยังทำไม่ได้ 1P/1F/5S, FAIL เป็น FAIL ปลอม (ใบระบุ 合格 ทั้ง 7 แถว):**
1. flat LLM map ผิดเกือบทุกแถว — `13.0±3.0` → อ่านเป็น 13.0~3.0 (min3/max13) → result 13.3 FAIL ปลอม · D90/化学成分 เอา result ไปเป็น specMin · 嵩密度 ชื่อกลายเป็น `g/ml`. เพราะ text-layer ญี่ปุ่น flatten เป็น **1 cell ต่อบรรทัด** + D50/D90 ซ้ำ 2 ชุด (LMS-30 / S3500)
2. **deterministic structural grid อ่านถูกแล้ว** (5.5~7.5 / 10~16 / 0.17~0.29 ตรงใบ + ชื่อ 嵩密度 ถูก) แต่ keep-best reject: flat มี PASS ชื่อ `g/ml` ที่ grid ไม่มี → นับเป็น "PASS เดิมหาย" = **บั๊กเดียวกับ ROUND 15 item 2** (เทียบชื่อ strict) โผล่ซ้ำ
3. `coa-grounding.ts:33` `nameTokens` regex `[^a-z฀-๿]` = latin + **ไทย** เท่านั้น → ชื่อ CJK กลายเป็นค่าว่าง → grounding ตัด 5 แถวที่ถูกต้อง (D90 ×2, SiO2+CaO, Fe2O3) ว่า hallucination
→ แก้ = grounding รองรับ CJK + keep-best normalize ชื่อ (ได้ทั้ง 106μm case เดิม) — ทั้งคู่เป็น core guard ต้องผ่าน gate เต็ม (ยังไม่ทำ)

## FIX ROUND 18 (2026-07-25, ใบญี่ปุ่น 試験成績表 ทำได้ + ปลดล็อกบั๊ก keep-best ของ ROUND 15)

user: "มีเคสที่เป็นภาษาจีนด้วย อันนี้ทำได้ไหม" (ไฟล์จริง = **ญี่ปุ่น** ไม่ใช่จีน: `20260527_ KGP-H65 Lot 25110901.pdf`, 関西マテック ウォラストナイト KGP-H65, text-layer 574 chars ไม่ต้อง OCR) → "แก้เลย ทั้ง 3 จุด"

**ก่อนแก้: 1P/1F/5S และ FAIL เป็น FAIL ปลอม** (ใบระบุ 合格 ทั้ง 7 แถว) — 3 blocker + 1 ที่เจอเพิ่มระหว่างทาง:

1. **`coa-grounding.ts` ทิ้งอักษร CJK** — `nameTokens` regex `[^a-z฀-๿]` = latin + **ไทย** เท่านั้น → ชื่อ 粒度/嵩密度/化学成分 กลายเป็นค่าว่าง → name-grounding พังทันที, number co-location ก็พัง (spec/result คนละบรรทัดใน flat) → **ตัด 5 แถวที่ถูกต้องว่า hallucination**
   **แก้:** เพิ่ม CJK class `぀-ヿ一-鿿` ใน `nameTokens` / `nameSignal` / `blockNorm` / `anchorTokens` / `lineCells` + ยอมรับ token ยาว ≥2 เมื่อมี CJK (คำ CJK 2 ตัว = คำเต็ม เช่น 粒度, dense พอที่จะไม่ชนบังเอิญ) + name-grounding ยอม substring ≥2 สำหรับ CJK (ocrWords เป็น latin-only, คำ CJK ไม่มีช่องว่างให้ตัดเป็น word)
2. **keep-best PASS-preservation เทียบชื่อแบบ strict** — deterministic structural grid อ่านถูกอยู่แล้ว (5.5~7.5 / 10~16 / 0.17~0.29 + ชื่อ 嵩密度 ถูก) แต่ถูก reject เพราะ flat มี PASS ชื่อ `g/ml` (หยิบ unit มาเป็นชื่อ) ที่ grid ไม่มี → นับว่า "PASS เดิมหาย" = **บั๊กเดียวกับ ROUND 15 item 2** (v5 `Residue on sieve(106m)` vs mobile `(106 μ m)`)
   **แก้:** `passNameCounts` (multiset ต่อชื่อ) → `preservesPasses()` จับคู่ **1:1 greedy** (= multiset โดยธรรมชาติ, ชื่อซ้ำ RI-015 ×4 ยังนับแยกแถว) ด้วยเกณฑ์ `passNameKey` (ยุบ space + μ/µ + วรรคตอน, คง latin/digit/CJK) **หรือ** `passValueKey` = `result|min|max` (แถวเดียวกันที่ incumbent อ่านชื่อผิด — ครบชุด 3 ค่าจึงบังเอิญตรงข้ามแถวได้ยาก)
3. **flat LLM map ผิดเกือบทุกแถว** (`13.0±3.0` → อ่านเป็น 13.0~3.0 → min3/max13 → result 13.3 = FAIL ปลอม · D90/化学成分 เอา result ไปเป็น specMin) เพราะ text-layer ญี่ปุ่น flatten เป็น **1 cell ต่อบรรทัด** + D50/D90 ซ้ำ 2 ชุด (LMS-30 / S3500)
   **แก้: ไม่แตะ prompt** (ดู ROUND 17 gotcha) — พอ (1)+(2) เข้าที่ grid ที่อ่านถูกก็ชนะ keep-best แล้วทับ flat ทั้งใบ = flat ยังผิดเหมือนเดิมแต่ไม่ถูกใช้ = architecture เดิมทำงานตามที่ออกแบบ (flat = floor, challenger ชนะเมื่อดีกว่าจริง)
4. **(เจอเพิ่ม) `parse-structural-grid.ts:classifySpec` ไม่รู้จัก `以下`/`以上`** — spec-normalizer รองรับแล้ว (ROUND 17) แต่ grid parser คัด cell ทิ้งก่อนถึง → `50以下`/`94以上`/`0.5以下` กลายเป็น specRaw=null → 4 แถว SKIP "อ่านเกณฑ์ไม่ได้"
   **แก้:** เพิ่ม 2 บรรทัด — `^(NUM)\s*(以下|以上)$` → 以下 = specMax, 以上 = specMin

**ผล KGP-H65: 7P/0F/0S — ตรงใบทุกแถว** (D50 5.5~7.5/6.5 · D90 ≤50/29 · D50 10~16/13.3 · D90 ≤70/62 · 嵩密度 0.17~0.29/0.23 · SiO2+CaO ≥94/96.85 · Fe2O3 ≤0.5/0.40) — 4 แถว one-sided ติด ⚑ ตาม amber policy เดิม

**gate (corpus16, เครื่องเดียววันเดียว 2026-07-25, เทียบ baseline โค้ดเดิมที่รันไว้ก่อนหน้า):**
| | PASS | FAIL | SKIP | rows | needsReview |
|---|---|---|---|---|---|
| baseline (โค้ดเดิม) | 114 | 0 | 14 | 128 | 38 |
| after (ROUND 17+18) | **126** | **0** | 16 | 142 | 53 |

**+12 PASS · 0 FAIL · 0 deceptive** · BE tsc 0 · evaluator fixture 18/18 · fail-guard/sieve/column-shift/spec-normalizer ผ่านครบ (27/10/47)
- **1F1710 p2: 3P→12P** และ **p4: 11P→14P** · **PR1950W_4063 p2: 6P→7P = บั๊ก ROUND 15 item 2 ที่ค้างไว้ ปลดล็อกแล้ว** (HQ/grid ที่ชนะจริงได้ใช้งานแล้ว)
- **TXAX-A 4P/1S→4P/2S ไม่ใช่การถอย** — ไฟล์นี้เป็นญี่ปุ่นอยู่แล้ว (色相/結晶相/メジアン径/かさ密度): baseline grounding ตัดแถว `色相` ทิ้งเพราะ CJK, หลังแก้แถวกลับมาเป็น honest SKIP (`spec=淡黄色` ไม่ใช่ตัวเลข) = rows +1 ไม่เสีย PASS
- **RI-015 10P→9P = drift ต้นทาง ไม่ใช่ keep-best** — baseline อ่าน `spec=10.0~45.0` (PASS) รอบนี้ OCR/LLM ให้ `spec=10.0~4.0` → fail-guard downgrade เป็น honest SKIP+⚑ (scanned file, spec ต่างตั้งแต่ต้นทาง — การเลือก report ไม่เกี่ยว)
- 126P = ระดับเดียวกับ baseline ประวัติศาสตร์ ROUND 15 (126P/0F/15S rows=141) ที่ drift หายไปช่วง 21→25 ก.ค.

**pre-existing ที่ไม่ได้แตะ (ยืนยันด้วยการ stash โค้ดรอบนี้ออกแล้วรัน = fail เหมือนกันเป๊ะ):** `coa-pass-guard.test.ts` fail 6 เช็ค ทั้งหมดเป็นเคส "ควร downgrade PASS ที่ยกเลขข้ามแถวแต่ไม่ downgrade" (`downgraded=0`) — pass-guard อ่อนกว่าที่ test คาด. ไม่อยู่ในสโคปรอบนี้ ต้องตามแยก

## FIX ROUND 19 (2026-07-25, pass-guard ที่ตายอยู่ + LLM ตกไปรัน CPU ทั้ง session)

user: "ไล่ปรับต่อได้เลยถ้ายังไม่ดี ดู performance ของมันด้วยนะ" → 2 แกน: ปิด 6 fail ที่ค้างจาก ROUND 18 + วัด/แก้ perf

### (A) pass-guard: sub-row scan ไม่มีขอบเขต = guard ตายสนิท

6 เช็คที่ fail ใน `coa-pass-guard.test.ts` มาจาก **สาเหตุเดียว** — fallback "sub-row check" ใน `downgradeUngroundedPasses`
ไล่ดู 8 บรรทัดถัดจากบรรทัด anchor โดยหยุดแค่เมื่อเจอ `^\d+\s*|` (เลขลำดับ item ถัดไป) เท่านั้น

บน COA จริงบรรทัดถัดไปคือ **แถวอื่น** ไม่ใช่ sub-row → และ "ค่าที่ LLM ยกข้ามแถวมา" ก็อยู่บรรทัดแถวอื่นนั่นแหละ
→ sub-row check เจอค่าตรงพอดีทุกครั้ง → validate ผ่าน → **deceptive PASS รอด 100%** (guard ทำงานเฉพาะเคสที่ค่ายืมไม่อยู่ใน 8 บรรทัดถัดไป = แทบไม่มี)

**แก้ — 2 ด่าน** (`coa-grounding.ts`):
1. **บรรทัด anchor ต้องเป็น header ล้วน** — ไม่มีเลขของตัวเองนอก cell แรก (cell แรก = ช่องชื่อ/เลขลำดับ)
   - D-2072 `3 | Shear Strength (kgf/cm²)*` = header จริง (spec/result อยู่ sub-row bullet ข้างล่าง) → เข้า sub-row ได้
   - `Sieve Residue on 500μ | 0.3 | 3 Max. | Success` มีค่าครบในบรรทัดตัวเอง → ค่าของแถวนี้ต้องอยู่บรรทัดนี้ ห้ามไปหาที่อื่น
   - บรรทัดไม่มี delimiter (แยก cell ไม่ได้) → ถือว่าเป็น data line ถ้ามีเลขของตัวเอง (conservative)
2. **บรรทัด sub-row ต้องเป็น continuation** — bullet (`- Room Temperature`) / label ที่แชร์ token กับชื่อแถวนี้ / เลขล้วน. เจอชื่อ item อื่น → หยุด

**เคสจริงที่แก้รอบแรกแล้วพัง (สำคัญ):** ด่าน 2 อย่างเดียวทำ D-2072 Shear Strength 2 แถวกลายเป็น false SKIP (4P→2P)
เพราะ sub-row จริงของมัน (`- Room Temperature`) ไม่แชร์ token กับชื่อแถว (`Shear Strength (kgf/cm²)*`) เลย
→ ตัวแยกที่ถูกไม่ใช่ label แต่คือ **บรรทัด anchor มีค่าของตัวเองหรือเปล่า** = ที่มาของด่าน 1

**fixture ใหม่ 2 เคส** (เคสนี้หลุดเพราะไม่มี coverage): D-2072 OCR ตัวจริง (header + bullet sub-row → คง PASS ทั้ง 2)
และ header + บรรทัดถัดไปเป็น item อื่นที่แบกค่ายืม (→ ยัง downgrade) · `coa-pass-guard.test.ts` **21→23 เช็ค ผ่านหมด**

### (B) perf: LLM ตกไปรัน CPU ทั้ง session (11x ช้ากว่า)

โปรไฟล์ต่อ stage (เติม timing ลง `_validate/verify-4b-only.ts` ผ่าน ProgressFn ตัวเดียวกับที่ UI ใช้) ชี้ว่า **parse = 85%** ของเวลาทั้ง pipeline
`ollama ps` ยืนยัน: `qwen3:4b size_vram=0` (CPU) ทั้งที่ VRAM ว่าง 6.7/8.1 GB — วัด throughput ได้ **8.6 tok/s**

**2 ชั้นซ้อนกัน** (`ollama-coa.service.ts`):
1. `gpuDisabled` เป็น module-global **latch ถาวรทั้ง process** และ regex retriable รวมคำว่า `timeout` ด้วย
   → GPU timeout **ครั้งเดียว** = ทุก LLM call ที่เหลือวิ่ง CPU ตลอดกาล (server ที่รันยาว = ช้าไปทั้งวันจน restart)
   **แก้:** latch เฉพาะ hard-crash (`cuda|llama runner|runner process|terminated|out of memory`) · timeout = "call นี้ช้า" ไม่ใช่ "GPU ใช้ไม่ได้" → retry CPU รอบนั้นแล้วจบ
2. Ollama 0.32.3 **reuse runner ตามชื่อ model โดยไม่สน `num_gpu` ที่ต่างกัน** → CPU runner ที่ `num_gpu:0` สร้างไว้รับ call ถัดไปทั้งหมด แม้ call นั้นไม่ได้ขอ CPU (ยืนยันด้วยการยิงเองหลายครั้งแบบไม่ส่ง num_gpu — ยังได้ 8.6 tok/s จนกด unload ถึงหาย)
   **แก้:** หลัง CPU attempt สำเร็จและไม่ได้ latch → `releaseRunner()` ยิง `keep_alive:0` ปล่อย runner ทิ้ง (fire-and-forget)

**วัดจริงหลังแก้:** 8.6 → **94.4 tok/s** (11x) · vram 0 → 3.87 GB

หลักฐานที่ตรงกันจาก corpus run: ไฟล์ก่อน 1F1710 timeout เร็วปกติ (Z99 15.8s · TXAX 7.4s) ไฟล์หลังจากนั้นช้าทั้งแถบ (4A 163s · PR1950W_4064 **199s**)

### gate (corpus16, เครื่องเดียววันเดียว)
| | PASS | FAIL | SKIP | rows | needsReview | TOTAL | avg/file |
|---|---|---|---|---|---|---|---|
| baseline ROUND 18 | 126 | 0 | 16 | 142 | 53 | — | — |
| ระหว่างทาง (CPU latch + sub-row ด่าน 2 อย่างเดียว) | 112 | 0 | 14 | 126 | 37 | 1120s | 70.0s |
| **after ROUND 19** | **126** | **0** | **12** | 138 | 53 | **329s** | **20.6s** |

**PASS เท่าเดิม · SKIP ลด 4 · 0 FAIL · 0 deceptive · needsReview เท่าเดิมเป๊ะ (ไม่ over-flag)** · BE tsc 0 · 14 test suite ผ่านครบ
- ต่างจาก baseline แค่ 2 จุด: **RI-015 9P/5S→11P/3S** (ดีขึ้น) · **1F1710 p4 14P/2S→12P/0S** = ตัวแกว่งประจำ corpus (เคยวัดได้ 11–14P บนโค้ดเดียวกัน) · อีก 19 ไฟล์-หน้า **เท่ากันเป๊ะ**
- **D-2072 4P/1S = เท่า baseline** → sub-row fix ไม่กินของจริง
- perf: **3.4x** โดยรวม · 1F1710 521s→83.7s (p4 กลับมา 12P จาก 0P ที่เคย timeout) · PR1950W_4064 199s→13.3s (15x) · parse stage 948s→167s
- stage mix ใหม่: parse 51% · hq 28% · ocr 17% · render/read 4% (เดิม parse กิน 85%)

---

## FIX ROUND 20 (2026-07-25) — margin-green ตกหล่นบน grid-won + junk row + วัด perf จนถึงเพดาน

### (A) เช็ค 1F1710 ก่อน: ไม่ใช่บั๊ก

ค้างมาหลายรอบว่า "p1 = 0P ทุกครั้ง" — เปิด PNG ที่ render ไว้ดูของจริงแล้วพบว่า **หน้านั้นคือ Disclaimer Statement**
(customer/order/BOL + ข้อความปฏิเสธความรับผิด) ไม่มีตารางทดสอบเลย → 0 items = พฤติกรรมถูกต้อง ไม่ต้องแก้

อีกจุดที่ดูน่าสงสัย: p2/p3/p4 ให้ค่าเดียวกันเป๊ะทุก batch (241.417 / 1.090 / 8.100) — เทียบใบจริงแล้ว
**ซ้ำจริงในเอกสาร** (DuPont รายงานค่า statistical ของทั้ง merge, batch C31554582/86/87/90/91 ใช้ตัวเลขชุดเดียวกัน)
→ 12P ต่อหน้าเป็นของจริง ไม่ใช่ broadcast

### (B) margin-green ไม่เคยได้ทำงานกับแถวที่ grid ชนะ (ordering)

`applyMarginGreen` ถูกเรียกท้าย `runExtractionPass` — แต่ธง `needsReview=true` ของ keep-best ปักใน `runFlatGridBest`
ซึ่งเกิด **หลังจากนั้น** → แถว grid-won ไม่เคยผ่าน gate G0–G4 เลยสักครั้ง
`isNearSpecBoundary` ตี one-sided spec (`≤max` / `≥min`) เป็น amber **เสมอ** ไม่ว่าค่าจะห่างขอบแค่ไหน
เช่น PR1950W_4064 `Moisture 0.5 vs ≤1.2` (ห่างขอบ = 140% ของค่า) ยังติด "ต้องตรวจ"

ที่ยืนยันว่าเป็นลำดับพลาดจริง ไม่ใช่นโยบาย: `coa-evaluator.ts:314` เขียนกำกับ interval path ไว้เองว่า
*"PASS: ธง amber ไว้ก่อน … margin-green ใน pipeline จะเคลียร์ให้เองถ้าค่าห่างขอบพอและคอลัมน์เชื่อได้"*

**แก้:** เรียก `applyMarginGreen` ซ้ำหลังปักธงใน keep-best. CLEAR-ONLY อยู่แล้ว + G0 กัน `spatial`
(column inferred) ไว้ → เคลียร์ได้เฉพาะ structural/scanned-vector ที่ geometry ยืนยันคอลัมน์

### (C) junk row "Certificate of Compliance"

ชื่อหัวเอกสารหลุดมาเป็นรายการทดสอบ (PR1950W_4063 p2) → เพิ่ม pattern `/^certificate\s+of\s+/i`
ใน `metadata-row-filter.ts` (ยังต้องผ่านเงื่อนไข "ไม่มี spec" ตามเดิม) + 3 fixture → 27→30 cases

### (D) perf: ลองแล้ว 2 ทาง — ทั้งคู่ไม่คุ้ม เก็บผลวัดไว้กันลองซ้ำ

**1. HQ OCR speculate (JIT ต่อหน้า)** — ย้าย prefetch จาก "ยิงทุกหน้าพร้อมกันตอนเริ่มไฟล์" เป็น
"ยิงหน้านั้นตอนเริ่ม process" (daemon มี lock เดียว → ยิงรวดเดียวทำให้หน้าที่ต้องใช้ HQ จริงไปต่อท้ายคิว)
แล้วเปิด default เพราะคิดว่าสมมติฐานเดิม ("OCR แย่ง CPU กับ LLM") ตายไปแล้วตอน LLM ขึ้น GPU (ROUND 19)

**วัดจริง: ช้าลง 329s → 340s** · hq 93s→49s (prefetch ทำงานจริง) แต่ **ocr +18s · parse +33s**
→ HQ engine (v5-server) กิน CPU จนเบียด Ollama เอง (LLM อยู่ GPU ก็ยังใช้ CPU tokenize/sample)
และเบียด default OCR ของไฟล์ถัดไป. ไฟล์ที่ใช้ HQ จริงเร็วขึ้น (4A 26.6→17.7s · D-2072 21.8→17.9s)
แต่ไฟล์ที่ prefetch ทิ้งเปล่าช้าลงมากกว่า → **คง opt-in** (คุ้มเฉพาะ daemon คนละเครื่อง/LAN), เก็บโครง JIT ไว้

**2. ยิง LLM ขนานข้ามหน้า** — วัด Ollama ตรงๆ: 2 request ขนาน 3.9s vs serial 4.7s = **เร็วขึ้นแค่ 17%**
(GPU saturated อยู่แล้ว ไม่ใช่ 2x) → แปลงเป็น pipeline จริงได้ ~5% แลกกับ log interleave +
race บน `gpuDisabled` latch/`releaseRunner` → **ไม่ทำ**

**เพดานปัจจุบัน:** parse 55% = GPU saturated · hq 26% = ซ่อนใต้ parse ไม่ได้บนเครื่องเดียว ·
ocr 16% = ลดได้ก็ต่อเมื่อยอมแลก accuracy (เปลี่ยน model tier / ลด render scale) → ไม่แตะ

### gate (corpus16)
| | PASS | FAIL | SKIP | rows | needsReview | TOTAL |
|---|---|---|---|---|---|---|
| ROUND 19 | 126 | 0 | 12 | 138 | 53 | 329s |
| JIT speculate (ทดลอง) | 126 | 0 | 12 | 138 | 53 | 340s |
| margin-green fix | 126 | 0 | 12 | 138 | **43** | 346s |
| **ROUND 20 (+junk filter)** | **126** | **0** | **11** | **137** | **43** | 333s |

**PASS เท่าเดิม · 0 FAIL · 0 deceptive · needsReview −19%** · verdict ต่อไฟล์เหมือน ROUND 19 ทุกไฟล์
ยกเว้น PR1950W_4063 p2 (7P/0F/1S → 7P/0F/0S) ที่ SKIP หายเพราะ junk row ถูกกรอง ไม่ใช่ verdict เปลี่ยน
BE tsc 0 · 14 test suite ผ่านครบ · เวลา 329/340/346/333s อยู่ในแถบ run-to-run noise เดียวกัน (±5%)

---

## FIX ROUND 21 (2026-07-26) — corpus 16→17 (KGP-H65) + ป้ายแยกแถวใต้ชื่อกลุ่ม merged

### ที่มา: ใบที่ 17 ไม่เคยผ่าน gate เลย

`20260527_ KGP-H65 Lot 25110901.pdf` (関西マテック 試験成績表) ถูกเพิ่มเข้า `uploads` วันที่ 27 พ.ค.
หลัง corpus ถูกล็อกไว้ที่ 16 ไฟล์ → **ไม่เคยถูกตรวจสักรอบ** จนกระทั่งรอบนี้. เพิ่มเข้า `_validate/corpus.txt` แล้ว

**ผลรอบแรก (ก่อนแก้อะไร): 7P/0F/0S — ตรงใบจริงทั้ง 7 แถว** และตรงกับตรา 合格 ที่ QA ญี่ปุ่นประทับครบทุกแถว
- `以下` / `以上` ได้ทิศถูกทุกแถว (`classifySpec` รองรับอยู่แล้ว) — อ่านผิดทิศแค่แถวเดียว เช่น 96.85 เทียบ `≤94`
  แทน `≥94` จะกลายเป็น FAIL ปลอมทันที
- flat text อ่านได้แค่ **1P** (ตาราง merged-cell ทำคอลัมน์ยุบ) → **structural grid กู้เป็น 7P** = ใบที่พิสูจน์ว่า grid challenger จำเป็น

### ปัญหาที่เจอ: ชื่อแถวซ้ำจนแยกไม่ออก

ผลออกมาเป็น `粒度(μm)` ซ้ำ 4 แถว + `化学成分(%)` ซ้ำ 2 แถว เพราะตัวแยกแถวจริง (**D50 / D90 / SiO2+CaO / Fe2O3**)
อยู่ในคอลัมน์ที่ 2 ใต้ชื่อกลุ่มที่เป็น merged cell — parser หยิบแค่ col0. ค่าถูกหมดแต่คนอ่านแยกไม่ออกว่าแถวไหนคืออะไร

**แก้:** `resolveSubLabelCol` — หา "คอลัมน์ป้ายแยกแถว" แล้วผนวกเข้าชื่อ (`粒度(μm) D50`). gate 5 ชั้น + `structural` เท่านั้น
พร้อมกันนั้นเพิ่ม CJK header keyword (`試験項目|検査項目|規格値|実測値|測定値|合否判定|備考|品名`) ใน `isHeaderRow`
— ใบญี่ปุ่นเว้นวรรคระหว่างตัวอักษร (`試 験 項 目`) ต้อง strip whitespace ก่อนเทียบ

### ★ 2 regression ที่ gate จับได้ (unit test ไม่จับ — fixture ตอนนั้นสะอาดกว่าของจริง) ★

**1. metadata row ที่ col0 ว่าง ≠ merged group.** gate แรกเช็คแค่ "col0 มีแถวว่าง" — grid จริงของ PR1950W_4064
มีบรรทัดหัวเอกสาร (`| No. 4064-08 Date Apr./06/2026 | …`) ที่ col0 ว่างเหมือนกัน → ป้าย activate → คอลัมน์ Unit
ถูกดูดเข้าชื่อ (`Softening point ℃`) และ header `Item` กลายเป็น `Item Unit` **จนรอด metadata-filter (`^item$`)
ไปโผล่เป็น SKIP ปลอม** → 7P/0F/1S เป็น 7P/0F/2S ทั้ง 2 หน้า
**แก้:** แถว merged จริงต้อง "col0 ว่าง **และมี spec ในแถวนั้น**" = แถวข้อมูลที่สืบชื่อจากด้านบนจริง ๆ

**2. scanned-vector ต่อป้ายไม่ได้.** PR1950W_4063 (สแกน) ผ่าน `parseStructuralGrid` เหมือนกันแต่ cell มาจาก
token OCR ที่ map ลง column band — เลื่อนได้ → ได้ชื่อมั่ว `Softening point 125℃ mm` ทั้งที่แถวนั้นคือ **Flow**
**แก้:** `parseStructuralGrid` รับ `source` param — ป้ายทำงานเฉพาะ `structural` (เส้นตารางจริงจาก pdfplumber)

บทเรียนเดิมซ้ำรอบที่ 2 (ROUND 19 เป็น D-2072): **unit fixture ที่เราแต่งเองสะอาดกว่าของจริงเสมอ — corpus gate
คือด่านที่จับ ไม่ใช่ unit test.** ทั้ง 2 เคสกลายเป็น fixture ถาวรแล้ว (`parse-structural-grid.test.ts` 26→40 เช็ค)

### gate (corpus **17**)
| | PASS | FAIL | SKIP | rows | needsReview | TOTAL |
|---|---|---|---|---|---|---|
| ROUND 20 (16 ไฟล์) | 126 | 0 | 11 | 137 | 43 | 333s |
| ป้าย+CJK header รอบแรก (17) | 135 | 0 | 16 | 151 | 48 | 356s |
| gate แคบลง #1 (17) | 134 | 0 | 14 | 148 | 51 | 403s |
| **ROUND 21 (17 ไฟล์)** | **134** | **0** | **12** | **146** | **49** | 361s |

ต่างจาก ROUND 20 แค่ 2 จุด: **+KGP-H65 7P/0F/0S** (ของใหม่) และ **1F1710 p4 12P→13P** (ตัวแกว่งประจำ corpus,
เคยวัดได้ 11–14P บนโค้ดเดียวกัน) · อีก 20 ไฟล์-หน้า **เท่ากันเป๊ะ** · 0 FAIL · 0 deceptive · BE tsc 0 · 14 suite ผ่านครบ

---

## ROUND 22 — structural = ตัวเลข extract ไม่ใช่ recognize → เลิกกัน OCR risk ที่ไม่มีจริง

**ต้นเรื่อง:** user อัพ KGP-H65 ผ่าน UI จริง → เห็น 4/7 แถวติดธง ⚠ ทั้งที่ค่าตรงใบจริงทุกแถวและตรงตรา
合格 ของ QA เอง → "ค่าที่มาจากการกู้แม่นมาก ไม่ต้องตรวจซ้ำ ให้เป็น PASS เลยก็ได้"

**ขุดจาก log จริงก่อนแก้** (ธงไม่ได้มาจาก "การกู้" อย่างที่ tooltip เขียน):

| แถว | spec | result | ตัวบล็อก margin-green |
|---|---|---|---|
| 粒度 D90 | ≤50 | 29.0 | **G3'** decimal-shift (29 = integer → กลัวเป็น 290) |
| 粒度 D90 | ≤70 | 62.0 | **G2** margin 12.9% < 30% |
| SiO2+CaO | ≥94 | 96.85 | **G2** margin 2.9% |
| Fe2O3 | ≤0.5 | 0.40 | **G2** margin 25% |

**ราก:** `gridSource="structural"` ตั้งได้เฉพาะหน้า `engine="text-layer"` เท่านั้น (`extractTextPerPage`)
= ตัวเลข **ดึงจาก text layer ของ PDF ตรงๆ ไม่ผ่าน OCR** + คอลัมน์ยืนยันด้วย ruling line ของ pdfplumber.
แต่ G2/G3'/G4 ทั้งชุดออกแบบมากัน **ความพังของ OCR** (digit scramble / ทศนิยมหาย / คอลัมน์เดา) —
path นี้ไม่มีความเสี่ยงนั้นเลย → กันของที่ไม่มีอยู่จริง → ธงเฟ้อ (KGP 4/7 แถว) → คนเลิกเชื่อธง

**แก้ (`coa-pipeline.ts`):** keep-best flag site ใช้ `structuralPassNeedsAmber` แทน `isNearSpecBoundary`
เฉพาะ `isStructural` — เขียวได้ทุกแถว **ยกเว้นค่าตรงขอบ spec พอดี** (`res === min || res === max` —
กู้ผิด 1 หลักพลิก verdict ทันที). ★ ไม่แตะ path อื่น: `spatial` / `scanned-vector` (คอลัมน์เดา หรือเลขมาจาก
OCR) ยัง amber เสมอ · guard-driven amber (sieve-recovery, DuPont spec-column, boundary-promote,
downgrade ทุกตัว) ไม่ถูกแตะเพราะแก้ที่ flag site ไม่ได้แก้ `applyMarginGreen` ★

**FE bug พ่วง (`ResultRow.tsx`):** `title={row.reason || "ต้องตรวจ — …"}` → แถว PASS สะอาด (`reason` ว่าง)
ตกมาโชว์ tooltip "ต้องตรวจ" ด้วย = บอกให้ตรวจทั้งที่ไม่ต้อง (และเป็นเหตุที่ user เข้าใจว่าธงมาจาก "การกู้").
fallback ยิงเฉพาะ `isReview` แล้ว

### gate (corpus 17)
| | PASS | FAIL | SKIP | rows | needsReview | TOTAL |
|---|---|---|---|---|---|---|
| ROUND 21 | 134 | 0 | 12 | 146 | 49 | 361s |
| **ROUND 22** | **133** | **0** | **11** | **144** | **41** | 333s |

**needsReview 49 → 41 (−16%)** · KGP-H65 `needsReview +0 · clean-green +7` = 4 ธงหายครบ ตรงเป้า
verdict ต่าง −1P/−1S/−2rows = **1F1710 p4 drift ล้วน** (band 11–14P เดิม) — พิสูจน์ว่าไม่ใช่ผลของ patch:
flag loop รัน **หลัง** `gridBeatsFlat` ตัดสินไปแล้ว และ `needsReview` ไม่มี consumer ไหนอ่านไปเปลี่ยน status
(`summarize` นับจาก status · `applyMarginGreen` clear-only) → patch เปลี่ยน status ไม่ได้เชิงโครงสร้าง

**41 ธงที่เหลือ = ของจริงล้วน:** boundary-exact 4 (D50 3.5/2~3.5, AL2O3 0.5/0~0.5, MGO, Residue) ·
DuPont spec-column 27 (1F1710 9 หน้า × 3 — spec มาจาก spatial) · sieve-reconstruct 2 · interval-result 2 ·
one-sided บนไฟล์ scan 6 · 0 FAIL · 0 deceptive · BE+FE tsc 0 · 14 suite ผ่านครบ

---

## ROUND 23 — ถอด Tesseract + cross-page reconciliation (DuPont)

### 23a) ถอด Tesseract fallback ทิ้ง (commit 61e5989)

user: "ไม่ได้ใช้แล้วลบไปเลย ถ้า daemon ล่มให้เตือนที่หน้าเว็บ"

Tesseract วิ่งเฉพาะตอน RapidOCR daemon ล่ม และสิ่งที่มันคืนมาคือ **เลขที่อ่านออกแต่ผิด** (`7 ± 3`→`743`,
เลข bleed ข้ามแถว, multi-column ยุบ) ซึ่งไหลเข้า evaluator แล้วออกมาเป็น PASS/FAIL = failure mode
ที่แย่ที่สุดของระบบนี้. **พังดังๆ ดีกว่าอ่านผิดเงียบๆ**

- `ocrImage` โยน error พร้อม code ที่ FE branch ได้: `OCR_DAEMON_DOWN` (daemon ล่ม → รีสตาร์ตช่วยได้)
  vs `OCR_EMPTY_RESULT` (daemon ขึ้นอยู่แต่ไฟล์โล่ง → รีสตาร์ตไปก็เท่าเดิม) — อย่าบอกให้รีสตาร์ตของที่ทำงานอยู่
- FE มีกลไก restart+poll+re-upload อยู่แล้ว แต่เดิม trigger จาก `ocrEngine === "tesseract"` ของ **ผลที่สำเร็จ**
  ซึ่งตอนนี้เกิดไม่ได้ → ย้ายมา trigger จาก error code · unwrap `response.data.error` (axios ให้แค่ "status code 500")
- ถอด dep `tesseract.js` + env ที่ตายแล้ว (`USE_RAPIDOCR`, `RAPIDOCR_REQUIRED`) + แก้ docs ทุกที่ที่เขียนว่ามี fallback
- `ImageProcessingService.preprocess` **คงไว้** — RapidOCR rotation path ใช้อยู่
- ✔ ทดสอบจริงผ่าน browser: kill daemon → หน้าเว็บขึ้น "OCR daemon ไม่ทำงาน" → สั่ง restart เอง → daemon ขึ้น
  → ยิงไฟล์เดิมซ้ำอัตโนมัติ → 4 PASS

### 23b) DuPont cross-page reconciliation — "เคสพิเศษ" ที่ user ขอ

**Grade ใบจริงก่อน (1F1710 = DuPont multi-batch, 11 บล็อกใน 4 หน้า):**
คอลัมน์คือ `Property | UoM | [Batch] Avg Min Max Std | [Specification] Aim Min Max`
ทุกบล็อกเป็น Lot 26011A เดียวกัน → ค่าซ้ำเป๊ะทั้งใบ (ไม่ใช่ parser ปั่นซ้ำ):

| property | Avg | Batch Min~Max | **Spec Min~Max** |
|---|---|---|---|
| Canadian Std Freeness | 241.417 | 217.000~248.500 | **160.000~360.000** |
| Fiber Length | 1.090 | 0.990~1.180 | **0.920~1.420** |
| Percent Moisture | 8.100 | 5.400~9.500 | **5.000~11.000** |

→ spec ที่ pipeline กู้มา **ตรงกับ Specification จริงทั้ง 3 รายการ** · ตรากับ "ACCEPT By: QA Dept."

**แต่ปล่อยเขียวเฉยๆ ไม่ได้** — log รอบเก่าจับได้ว่า **หน้า 3 อ่าน Percent Moisture เป็น 5.400~9.500
= คอลัมน์ Batch ไม่ใช่ Specification** (หน้า 2/4 อ่าน 5.000~11.000 ถูก). spec แคบกว่าจริง = deceptive-FAIL รออยู่
→ ธงตัวนี้ทำงานถูกแล้ว การ "ยกเว้นทั้ง layout" จะกลบเคสนี้พอดี

**เคสพิเศษที่เขียนแทน (`reconcileDupontSpecs`):** เอกสารซ้ำบล็อกเดิมหลายหน้า → **ให้หน้ายันกันเอง**
- โหวตด้วย **จำนวนหน้า** ไม่ใช่จำนวนแถว (บล็อกซ้ำในหน้าเดียวไม่ควรหนักกว่าหน้าอื่น)
- band ที่ชนะต้องมาจาก **≥2 หน้า** และมากกว่าอันดับสองจริง — เสมอ = abstain ทั้งกลุ่ม
- แถวที่ตรง band ที่ชนะ → **เคลียร์ธง** (หลักฐานที่หน้าเดียวไม่มี)
- แถวที่ต่าง → **แก้ spec เป็น band ที่ชนะ + evaluate ใหม่ + คงธงไว้** (หน้านี้เคยพลาดมาแล้ว)
- จับกลุ่มชื่อด้วย `lev ≤ 3` — OCR ให้ `Freeness`/`Freencss`/`Frceness`/`Sid Frceness` มาจริง
- ★ no-op เมื่อ: ไฟล์หน้าเดียว · ไม่มีเสียงข้างมาก · แถวที่ไม่ได้ปัก `specDupont` ★

### gate (corpus 17)
| | PASS | FAIL | SKIP | rows | needsReview | TOTAL |
|---|---|---|---|---|---|---|
| ROUND 22 | 133 | 0 | 11 | 144 | 41 | 333s |
| **ROUND 23** | **133** | **0** | **11** | **144** | **14** | 350s |

**per-file เท่ากันเป๊ะทั้ง 22 ไฟล์-หน้า** (ต่างแค่เวลา) — verdict ไม่ขยับเลยแม้แต่แถวเดียว
`[dupont-xpage] clean-green 27 แถว · แก้ spec 0 แถว` (รอบนี้ทุกหน้าอ่าน Specification ถูกหมด → ไม่มีอะไรต้องแก้;
path แก้ spec มี fixture คุมไว้แทน) · **needsReview 41 → 14 (−66%)**

**14 ธงที่เหลือ:** ติดขอบพอดี 5 · spatial keep-best บนไฟล์สแกน 5 · sieve reconstruct 2 · result เป็นช่วง 2
· 0 FAIL · 0 deceptive · BE+FE tsc 0 · 14 suite ผ่าน (`spec-column-recovery` 17→27 เช็ค)

---

## ROUND 24 (2026-08-03) — "อยู่ในกรอบ min/max = ผ่าน" + pdf-grid ล้มต้องดังไม่ใช่เงียบ

**โจทย์จากหน้างาน (user):** ธง "ต้องตรวจ" ยังเยอะเกินจะใช้จริง — ค่าที่ระบบกู้/อ่านมาแล้ว
**ตกในกรอบ min/max รวมค่าติดขอบและใกล้ขอบ = ผ่าน ไม่ต้องให้คนตรวจซ้ำ · หลุดกรอบเมื่อไรถึงเป็น FAIL**
(guard ที่ลด FAIL→SKIP เมื่อจับได้ว่าค่าน่าจะอ่านเพี้ยน = user สั่งคงไว้)

### (ก) ตัดธง — verify ค่ากับใบจริงก่อนตัดทุกแถว
ก่อนแตะโค้ด render ใบจริงด้วย pymupdf 150dpi แล้วเทียบทีละแถว: **ค่าที่ปักธงถูกตรงใบ 12/12**
(Z99 D50 3.5 ใน 2.0–3.5 · AL2O3 0.50 ใน 0.00–0.50 · MGO 0.00 ใน 0.00–0.10 · Lot240521 0.3 vs "3 Max"
+ 1.3 vs "20 Max" ตรา Success · D-2072 Shear-Heat 136.5 ≥50 ตรา O · RB220 200–250 ใน 180–280
+ Shot 0.07–0.28 ≤0.5 · PR1950W_4064 ทั้ง 2 หน้า) → ตัดได้โดยไม่เดา

แก้ 4 จุด:
1. `structuralPassNeedsAmber` → `false` (structural = คอลัมน์ยืนยันด้วย ruling line + ตัวเลขจาก text layer)
2. boundary-promote (SKIP→PASS ตรงขอบ geometry) → `needsReview=false`, reason "อยู่ในเกณฑ์ ผ่าน"
3. **ลบ** flag block ของ result-recovery + avg-column override ทั้งก้อน พร้อม `isNearSpecBoundary`/`REL_TOL` ที่กลายเป็น orphan
4. `evaluateInterval` PASS → `needsReview: !!review` (เดิม `pass ? true`) — override decision ROUND 17

### (ข) pdf-grid ล้มแล้วเงียบ = ผลตกโดยไม่มีใครรู้
`extractPdfGridPerPage` เดิม fail-soft คืน `[]` ทุกกรณี → ไม่มี grid challenger → เหลือ flat LLM ล้วน.
**หลักฐานจาก log จริง 31 ก.ค. 2026 (โค้ดเดียวกับวันนี้ commit ล่าสุด 26 ก.ค.):** ใบ text-layer ร่วงพร้อมกันทั้งชุด
— PR1950W_4064 p1 `1P/6S` p2 `0P/7S` · Suzorite `0P/3S` · KGP-H65 `6P/1S` (วันนี้ = 7P/1S, 7P/1S, 5P/1S, 7P/0S)
→ **โยน `PDF_GRID_DOWN`** เมื่อ spawn ไม่ขึ้น / exit ≠ 0 / stdout ไม่ใช่ JSON / script แจ้ง error
(★ `source:"none"` = ไม่มีตารางบนหน้านั้น ยังถือว่าปกติ ไม่โยน ★) + FE branch ข้อความเฉพาะเหมือน `OCR_DAEMON_DOWN`
ยืนยัน: `OCR_PY_PYTHON` ชี้ path ผิด → หยุดจริงพร้อมบอกทางแก้ · `pdf_table.py` กับ corpus ทั้ง 17 ไฟล์ exit 0 หมด
(6 ไฟล์คืน `source=none` = ไม่โยนผิด)

### gate (corpus 17)
| | PASS | FAIL | SKIP | rows | needsReview | TOTAL |
|---|---|---|---|---|---|---|
| ROUND 23 | 133 | 0 | 11 | 144 | 14 | 350s |
| **ROUND 24** | **133** | **0** | **11** | **144** | **4** | 372s |

**per-file verdict IDENTICAL ทั้ง 22 ไฟล์-หน้า** (diff ว่าง) · 0 FAIL · 0 แถวที่หลุด min/max แล้วไม่เป็น FAIL
· BE+FE tsc 0 · unit 14 suite ผ่าน · `net -35 บรรทัด` (ก่อนรวมส่วน pdf-grid)
**4 ธงที่เหลือ:** RI-015 ×2 (เป็น SKIP อยู่แล้ว) · PR1950W_4063 p2 ×2 (spatial — คงไว้ตั้งใจ)

**บั๊กที่เจอระหว่างทาง ยังไม่แก้:** PR1950W_4063 **หน้า 2** ชื่อแถวเพี้ยน — `Softening point` โผล่ 2 ครั้ง
(ตัวที่ 2 ที่จริงคือ `Flow` result 16 spec 10~35) · `Gelation time` ซ้ำ (ตัวที่ 2 คือ `Moisture` 0.2 vs ≤1.2)
· หน้า 2 หายแถว `Appearance`. ค่ากับ spec จับคู่ถูก verdict จึงไม่ผิด แต่ชื่อรายการผิด = map เข้าระบบ QC จะผิดแถว
→ **เหตุผลที่คงธง spatial ไว้**

---

## ROUND 25 (2026-08-03) — ชื่อแถวเพี้ยนบน scanned-vector (PR1950W_4063 หน้า 2)

**อาการ:** หน้า 2 ได้ `Softening point` 2 แถว (ตัวที่ 2 ที่จริงคือ `Flow` result 16 spec 10~35),
`Gelation time` 2 แถว (ตัวที่ 2 คือ `Moisture` 0.2), หายแถว `Appearance` — **ค่ากับ spec จับคู่ถูก
verdict จึงไม่ผิด แต่ชื่อรายการผิด** = ส่งเข้าระบบ QC แล้วลงผิดรายการ

### วินิจฉัย (debug-mantra)
1. **repro** 3 รอบตรงกัน (gate ×2 + HTTP upload) — deterministic
2. **ไม่ใช่ OCR** — flat text ของหน้า 2 มีชื่อครบทุกแถว ถูกต้อง 100%
3. **gridText (scanned-vector) ต่างหากที่ชื่อหาย 3 แถว** — cell col0 ว่างสลับแถว
4. **วัดพิกัด token จริง** (probe ชั่วคราว): ข้อความทุกแถวเริ่มที่ x≈230 เท่ากันหมด แต่เส้นคอลัมน์แรก
   จาก vector geometry อยู่ที่ **303px** → เหลื่อมกัน ~73px

| token | x span | cx | vs edge 303 |
|---|---|---|---|
| `Softening point` | 230–414 | 322 | ✓ col 0 |
| `Residue on sieve(106μm)` | 232–540 | 386 | ✓ col 0 |
| `Flow` | 228–294 | **261** | ✗ นอกกรอบ |
| `Moisture` | 230–340 | **285** | ✗ นอกกรอบ |
| `Appearance` | 230–376 | **303** | ✗ abstain (ตรงเส้นพอดี) |

`buildScannedGrid` ตัดสินคอลัมน์ด้วย **จุดกึ่งกลาง token** → ชื่อยาวรอด ชื่อสั้นตกนอกกรอบ.
ไม่ได้เพี้ยนแค่คอลัมน์ชื่อ — `°℃ A` ยุบ Unit+Treatment เป็นช่องเดียวแล้วช่องถัดไปว่าง = **ทั้งหน้าเลื่อน**
★ หน้า 1 พังเหมือนกันเป๊ะ แต่ผลถูกเพราะ keep-best เลือก flat ทับ — หน้า 2 grid ดันชนะเลยโผล่ ★

5. **ตัวที่ทำให้ "ชื่อว่าง" กลายเป็น "ชื่อผิด"** = section carry ใน `parse-structural-grid.ts`
   (`const base = col0 ? col0 : section` — จำชื่อแถวล่าสุดไว้ให้แถวลูกของ merged group ยืม)

### แก้
`carrySection = source === "structural"` — scanned-vector ไม่ยืมชื่อแถวบน (เหตุผลเดียวกับที่ ROUND 21
ปิด `resolveSubLabelCol` บน path นี้: cell ที่สร้างจาก token OCR + เส้นเวกเตอร์ที่เหลื่อมกับภาพ เชื่อไม่ได้).
col0 ว่าง = ไม่รู้ชื่อ → แถวถูกทิ้ง (บรรทัด `if (!base && !mesh) continue`) → grid แพ้ flat → หน้า 2 ใช้ flat
ที่อ่านถูกอยู่แล้ว. **ไม่แตะ path structural** (carry ยังทำงานให้ KGP-H65/mesh row ตามเดิม)

fixture ถาวร 3 เช็ค ใน `parse-structural-grid.test.ts` (ใช้ grid จริงของ p2 ที่เหลื่อม): ไม่มีชื่อซ้ำ ·
แถวชื่อหายต้องหายไปเลยไม่ใช่ชื่อผิด · structural ยังยืมชื่อได้ → 40→43 เช็ค

### gate (corpus 17)
| | PASS | FAIL | SKIP | rows | needsReview |
|---|---|---|---|---|---|
| ROUND 24 | 133 | 0 | 11 | 144 | 4 |
| **ROUND 25** | **133** | **0** | **12** | **145** | **2** |

**diff per-file เปลี่ยนไฟล์เดียว** = PR1950W_4063 p2 `7P/0F/0S → 7P/0F/1S` (แถว `Appearance` กลับมาเป็น
honest SKIP เหมือนหน้า 1 เพราะ spec เป็นข้อความ) · อีก 21 หน้าเหมือนเดิมเป๊ะ · PASS ไม่ตก · 0 FAIL
· 0 แถวที่หลุด min/max แล้วไม่เป็น FAIL · BE tsc 0 · unit 14 suite ผ่าน
**ธงเหลือ 2 จาก 144 แถว** (RI-015 ×2 ซึ่งเป็น SKIP อยู่แล้ว) — จาก 14 เมื่อเช้า

## ROUND 26 (2026-09-07) — text-layer ที่ decode ไม่ออก → LLM แต่งเลข + PASS ที่เทียบกับตัวเอง

หน้างานแจ้ง "อ่านเลขจากตารางผิดเป็นเลขคล้ายๆ กัน เช่น 7 เป็น 1" ส่งมา 10 ใบใหม่
(`Desktop\new format\`). เดาแรกคือ OCR หรือ LLM — **ผิดทั้งคู่**

### เห็นอะไร
รัน 10 ใบผ่าน pipeline แล้วเทียบกับใบต้นฉบับ (render PNG อ่านด้วยตา) — ไม่มีใบไหนที่
LLM ได้ text ถูกแล้วตอบเลขผิด. เปลี่ยน model ไม่ช่วย

`CIIR1066` (ENEOS/JAPAN BUTYL) ฝัง font ที่ไม่มี ToUnicode map → pdfjs ถอดได้แต่ตัวอักษร
**เลื่อนรหัส 29 ตำแหน่ง** และตัวเลขเลื่อนไปตกที่ control char เลยถูกทิ้งหมด:

```
CERTIFICATE OF ANALYSIS  →  &(57,),&$7(2)$1$/<6,6
MOONEY ML 1+8 @ 125°C    →  0221(<0/#Υ          ("1+8" หายไป)
39  39  38  |  34 - 42   →  (ว่างเปล่าทั้งแถว)
```

text-layer นี้ยาว 1428 chars ผ่านด่าน `>= 300` สบาย → LLM ได้ตารางที่มีแต่ชื่อรายการ
ไม่มีเลขสักตัว → **แต่งเลขขึ้นมาเอง** (ออกมา 1.8/1.9 ทั้งที่ใบเขียน 39/0.03/1.27/42.7)
product ได้ `3URGXFW` lot ได้ `0` — นี่คือ "7 เป็น 1" ที่หน้างานเห็น

`TIMREX FC` (Imerys) ไม่มีคอลัมน์ Specification เลย (`Characteristics | Methods |
Analysis Results | Unit`). 9 แถวเป็น honest SKIP ถูกแล้ว แต่ **3 แถวที่ค่าเป็น `< 0.01`
กลับได้ PASS** เพราะโมเดล copy ค่าผลมาเป็น spec → `evalBoundResult` เทียบ `<0.01` กับ
`<0.01` แล้วผ่านอย่างถูกต้องทางคณิตศาสตร์ — deceptive บนใบที่ไม่เคยมีเกณฑ์

### แก้
**1. `pdf-text-extractor.ts` — `looksDecodable()`** เพิ่มเข้าไปใน `hasUsableText` (AND กับเกณฑ์
300 chars เดิม): อักขระนอกชุดที่ COA ใช้จริงเกิน 10% → ไม่เชื่อ · มีตัวเลขอยู่แต่ไม่มี token ไหน
อ่านเป็นจำนวนได้เลย → ไม่เชื่อ. ทั้งสองข้อ = decode พัง ไม่ใช่ใบที่ไม่มีค่าวัด

วัดก่อนตั้งเกณฑ์ (ทั้ง corpus 17 + 10 ใบใหม่): `CIIR1066` อักขระเพี้ยน **38.8%** / จำนวนที่อ่านได้
**0 ตัว** — ใบสุขภาพดีที่ใกล้ที่สุดคือ `KGP-H65` ที่ 0.3% และ 8 ตัว. ห่างกัน 2 order of magnitude

**2. `coa-evaluator.ts` — `suppressCopiedSpec()`** ตัดสิน **ระดับใบ** ไม่ใช่รายแถว: แถวที่มีทั้ง
spec และ result ≥3 แถว และเกิน 60% ของแถวเหล่านั้นมี spec ซ้ำกับ result → ทั้งใบถือว่าไม่มี
คอลัมน์เกณฑ์ → downgrade เฉพาะแถว PASS ที่ซ้ำเป็น SKIP

★ GOTCHA ที่จ่ายไปแล้ว: ทำเป็น guard **รายแถว** ก่อน (spec == result → SKIP) → corpus ตก
125P→121P เพราะจับ 12 แถวที่ตรงกันโดยชอบธรรม — `RI-015` Sb spec `<15` ผลก็ `<15` จริงบนใบ,
`4A`/`SODA` Residue on sieve `0` vs `0`. สัญญาณจริงของใบไม่มีเกณฑ์คือ **ทั้งใบซ้ำ** (TIMREX 12/12)
ไม่ใช่แถวเดียวซ้ำ (RI-015 1/14)

### ไม่แก้ (ข้อจำกัดที่รู้ตัว)
`HG-PP#180` — text-layer เป็น OCR ญี่ปุ่นขยะที่เครื่องสแกนฝังมา (`42,0。/0`, `5Ь196`) ผ่านด่าน
395 chars. วัดทุก signal แล้ว **แยกจากใบสุขภาพดีไม่ได้**: จำนวนที่อ่านได้ 28% ขณะที่ `KGP-H65`
(7P/0F/0S) อยู่ที่ 26%, อักขระเพี้ยน 1.9% vs 0.3%. ตั้งด่านจับตัวนี้ = `KGP-H65` พังทันที
ผลปัจจุบันคือ 0P/4S = SKIP ทั้งใบ ไม่ได้ตอบเลขผิด → ยอมรับได้ตามหลัก honest SKIP

`Kemolit KF-3` แถว `Retention on 60 mesh` — ใบต้นทางพิมพ์ spec ว่า `<0.0` เอง ผล `0.000`
(Remarks ใต้ตารางเขียน "complies with specification") → ระบบตอบ FAIL. รอ user ยืนยันกับ
supplier ก่อนตัดสินว่าควรเป็นอะไร

### gate (corpus 17)
| | PASS | FAIL | SKIP | rows | needsReview | deceptive |
|---|---|---|---|---|---|---|
| ก่อนแก้ (วัดวันเดียวกัน) | 125 | 0 | 13 | 138 | 3 | 0 |
| **ROUND 26** | **126** | **0** | **14** | **140** | **3** | **0** |

guard ใหม่ **ไม่ยิงในคลังเลยสักแถว** (0 hits) · ไฟล์ที่เปลี่ยนเส้นทาง text-layer→OCR ในคลัง = 0
· ต่างจาก baseline แค่ `1F1710` p4 ที่แกว่งประจำ (ROUND 19 จดไว้ว่า 11–14P จาก Ollama
prefix-cache) · BE `npx tsc -p .` = 0 · `evaluator.test.ts` 29 เช็คผ่าน

⚠️ ตัวเลขชุดนี้ต่ำกว่า ROUND 25 (133P) เพราะ `backend/uploads/` สะสมไฟล์อัปซ้ำเป็น 155 ไฟล์
และ `RI-015` มี **2 เวอร์ชันที่ checksum ต่างกัน** — คลังที่ stage รอบนี้จึงไม่ใช่ชุดเดียวกับ
ROUND 25. before/after ข้างบนใช้ไฟล์ชุดเดียวกันเป๊ะ จึงเทียบกันได้

### ผลกับ 10 ใบหน้างาน
| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `CIIR1066` p1 | `3URGXFW`/lot `0` · 0P/3S (เลขแต่ง) | `CIIR 1066`/lot `C4Z13` · 2P/2S |
| `CIIR1066` p2 | `3URGXFW`/lot `0` · 0P/0S | `CIIR 1066`/lot `C4Z14` · **8P/1S** |
| `TIMREX FC` | 3P/9S (3 PASS ปลอม) | **0P/12S** |
| อีก 8 ใบ | — | เท่าเดิมทุกใบ |

ค่าที่ได้กลับมาตรงกับใบจริงทุกตัว (`CHLORINE 1.26` ใน `1.18~1.34`, `MH 42.3` ใน `37.0~51.0`,
`ts2 1.7` ใน `0.5~3.5`) — หน้า 1 ยังเก็บได้ไม่ครบ (4 จาก 9 แถว) แต่ไม่มีเลขปลอมเหลือแล้ว

## ROUND 27 (2026-09-07) — ตรวจ 10 ใบหน้างานทีละแถวเทียบใบจริง แล้วปิด 5 ช่องว่าง

ต่อจาก ROUND 26 ที่ดูใบจริงแค่ 4 จาก 10 ใบ — รอบนี้ render ทุกหน้าเป็น PNG อ่านด้วยตา
บันทึก ground truth ครบ 100 แถวก่อนเปิดผลรัน (กัน anchoring) แล้วเทียบทีละแถว

### สิ่งที่วัดได้ก่อนแก้
ระบบตอบ 62P/1F/36S จาก 99 แถว · ใบจริงมี 100 แถว (74 ตัดสินได้ · 19 ใบไม่มีเกณฑ์ · 6 ข้อความล้วน)
**deceptive PASS = 0** — ทุก PASS ค่าตรงใบ (รันซ้ำ 2 รอบยืนยัน)

รันซ้ำเจอ drift ตัวใหญ่: `CIIR1066` p1 ได้ 9 แถวรอบหนึ่ง 4 แถวอีกรอบ — LLM ไม่คืน field `result`
ให้ 7 แถวท้าย → `result-recovery` กู้ได้แค่ 2 → grounding ตัด `MH ML ts2 t'50 t'90` ทิ้งว่า
hallucination ทั้งที่ OCR อ่านครบ (`MH | dN·m | 42.7 | 43.0 | 42.4 | 37.0 | 51.0`)

### แก้ 5 จุด
| ไฟล์ | อาการที่แก้ |
|---|---|
| `coa-evaluator.ts` | แถวข้อความล้วน (`Colour` White · `Foreign Particles` Absent · `色相` 淡黄色 · `結晶相` K2Ti6O13) เคยเป็น SKIP เสมอ → เกณฑ์ตรงกับผลแบบตรงตัว = PASS. **ไม่ตรง = SKIP ไม่ใช่ FAIL** เพราะ `TSC APPEARANCE` พิสูจน์แล้วว่า OCR ตัดข้อความคนละท่อนได้ระหว่างรอบ |
| `spec-normalizer.ts` | operator ต่อท้ายเลขแบบใบญี่ปุ่นแนวตั้ง: `0.5≧` = ไม่เกิน 0.5 (ทิศกลับกับ `≧0.5`) — `TAIHEIYO` Shot Content/Moisture |
| `coa-grounding.ts` | LLM ไม่คืน result แต่เกณฑ์อยู่ครบในบรรทัดเดียวที่มีชื่อรายการนำหน้า → เก็บแถวไว้ให้ recovery เติมทีหลัง (บั๊ก drift ข้างบน) |
| `spec-recovery.ts` | ช่อง `-` = เกณฑ์ว่าง (ไม่ใช่เกณฑ์ที่อ่านได้) + ตัดช่องว่างท้ายบรรทัดก่อนมองหาเกณฑ์ — `FRICSTAR` `Sb - Antimony` ที่ text-layer อ่าน `70.7 \| ≥ 69.0 \| -` ครบแต่ LLM ตอบ specRaw `-` |
| `transposed-label-recovery.ts` (ใหม่) | ตารางรายการเรียงแนวนอน (`TAIHEIYO CMF`): ป้าย `(wt%)` นำหน้าบรรทัดค่า ทำให้ LLM จับคู่เลื่อน 1 ช่อง → `SiO2` ได้ 13.2 ทั้งที่ใบเขียน 41.7. จับคู่ใหม่ตามตำแหน่งช่อง |

★ `transposed-label-recovery` แตะเฉพาะแถวที่ **ไม่มีเกณฑ์จริง** (min/max ว่าง หรือ min=max ที่ LLM
copy มาจากค่าผล — ทั้งคู่เป็น SKIP อยู่แล้ว) → เปลี่ยนได้แค่ตัวเลขที่โชว์ สร้างหรือพลิก verdict ไม่ได้เลย
เงื่อนไขยิง: ค่าของแถวต้องตรงช่องตัวเองหรือช่องถัดไปรวมกัน ≥60% (พิสูจน์ว่ามาจากบรรทัดค่าเดียวกัน) ★

### gate (corpus 17 — dir เดียวกับ ROUND 26)
| | PASS | FAIL | SKIP | rows | needsReview | deceptive |
|---|---|---|---|---|---|---|
| ก่อนแก้ (วัดวันเดียวกัน) | 125 | 0 | 13 | 138 | 3 | 0 |
| **ROUND 27** | **129** | **0** | **11** | **140** | **3** | **0** |

+4 PASS อธิบายได้ครบ: `Inolob_T204F` Colour (White=White) +1 · `TXAX-A_A-63045` 色相+結晶相 +2 ·
`1F1710` p4 `Percent Moisture` +1 = LLM drift (ROUND 19 จดไว้ว่าหน้านี้แกว่ง 11–14P) ซึ่งพา
`By: QA Dept.` โผล่มาเป็น SKIP ด้วย = +2 rows. ยืนยันว่าไม่ใช่ code: รันชุด 4 จุดแรกได้ 13P/1S
เท่า baseline เป๊ะ และ `transposed-label` **ยิง 0 ครั้งทั้งคลัง**

BE `npx tsc -p .` = 0 · unit 15 suite ผ่านหมด (เพิ่ม `transposed-label-recovery.test.ts` 21 เช็ค)

### ผลกับ 10 ใบหน้างาน
| ไฟล์ | ก่อน | หลัง |
|---|---|---|
| `FRICSTAR` | 3P/1S | **4P/0S** |
| `Kemolit KF-3` | 10P/1F/1S | **11P/1F/0S** |
| `TXAX-A` p1, p2 | 4P/2S ต่อหน้า | **6P/0S ต่อหน้า** |
| `TSC Zeolite` | 7P/1S | **8P/0S** |
| `TAIHEIYO CMF` | 3P/10S · `SiO2`=13.2 (ใบเขียน 41.7) | **5P/8S** · ค่าเคมีตรงใบทุกตัว |
| รวม | 62P/1F/36S | **71P/1F/27S** |

ตรวจทุก PASS เทียบใบจริงอีกรอบหลังแก้: ตรงทั้ง 71 แถว — **deceptive = 0**

### ยังไม่แก้ (รู้ตัว)
`HG-PP#180` 0P/4S — text-layer ขยะจากสแกนเนอร์ แยกจากใบดีไม่ได้ (ROUND 26 วัดแล้ว) ·
`Kemolit` `Retention on 60 mesh` FAIL — ใบพิมพ์เกณฑ์ `<0.0` เอง รอ user ถาม supplier ·
`TIMREX FC` 0P/12S ถูกต้อง ใบไม่มีคอลัมน์เกณฑ์ · ชื่อที่ OCR อ่านเพี้ยนแต่ค่าถูก (`t'90`→`06 .4`) ·
product ที่หยิบผิดช่อง (`TXAX-A` ได้ชื่อลูกค้า Resonac · `HG-PP` lot ขาด `.2`)

## ROUND 28 (2026-09-08) — ปิด 3 ช่องที่เหลือจากการเทียบใบจริง (A1–A3)

รอบนี้ให้ Fable ช่วยไล่หาว่าจะปรับตรงไหนให้แม่นขึ้นกับใบหน้างานที่ layout สลับ แล้วเลือกทำ 3 ข้อ

### A1 — จับ text-layer ที่สแกนเนอร์ฝังมา ด้วยสัดส่วนพื้นที่ภาพ
`HG-PP#180` ผ่านด่าน 300 chars + `looksDecodable` มาตลอด (ROUND 26 ยอมแพ้เพราะทุก signal ทับกับใบดี)
สัญญาณที่แยกได้จริงคือ **ภาพคลุมเต็มหน้า** — สแกนเนอร์วางภาพ 1 รูปเต็มหน้าแล้วซ้อน text ล่องหนไว้บน
ส่วน PDF ที่ export จาก Word/Excel ไม่มีภาพเต็มหน้า

วัดทั้ง 27 หน้า (corpus 17 + หน้างาน 10) ด้วย pdfjs operator list:

| | ตัวอักษร | ภาพคลุมหน้า |
|---|---|---|
| `HG-PP#180` | 291 | **1.00** |
| `KGP-H65` (ใบดีที่เคยพัง gate) | 353 | 0.008 |
| ใบ text-layer อื่นทั้งหมด | 457–1343 | 0.009–0.017 |

ห่างกัน ~60 เท่า → `pdf-text-extractor.ts:largestImageCoverage` + เกณฑ์ 0.8 AND กับด่านเดิม
**คลังเปลี่ยน route 0 หน้า** · `HG-PP` 0P/4S (แถวขยะล้วน) → **4P/0F/2S จากแถวจริง**

### A2 — เกณฑ์ที่ OCR ทำพัง 2 ทาง (ทำเป็น 2 โมดูล คนละหน้าที่)
**`spec-bound-grounding.ts`** — ขอบเกณฑ์ที่ไม่ได้อยู่ในบรรทัดของแถวตัวเอง = ยืมมาจากแถวอื่น
(`HG-PP` `Fe`: ใบเขียน `42.0% | - | 42.4%` แต่ LLM ข้ามช่องว่างไปหยิบ `46.0` ของแถว `S` มาเป็นขอบบน
→ PASS ด้วยเกณฑ์ `42–46` ที่ไม่มีบนใบ) ★ ตัดได้เฉพาะเมื่อ **เห็นช่องว่างบนใบ** (`-`/`—`/`一`) เท่านั้น ★
ไม่มีช่องว่าง = อาจเป็น OCR อ่านขอบไม่ครบ → ตัดแล้วเกณฑ์จะหลวมกว่าใบจริง = ปล่อยค่าเกินให้ผ่าน

**`spec-pair-recovery.ts`** — เกณฑ์สองช่องที่ขีดกลางหาย (`34 | 42`) LLM เก็บมาข้างเดียวเป็นเลขเปล่า
อ่าน header ของใบเองว่าช่องไหนคือค่าผล (`Avg.|Max.|Min.` ก่อน `Specification`) ช่องท้ายที่เหลือ 2 ช่องจึงเป็นเกณฑ์
gate 3 ชั้น: ต้องเหลือ 2 ช่องพอดี · ค่าผลต้องสอดคล้อง role (max ≥ avg ≥ min) · ค่าที่ LLM เก็บมาต้องเป็นขอบใดขอบหนึ่ง

★ GOTCHA ที่จ่ายไปแล้ว: guard แรกนับตัวเลขด้วย regex ทั้งบรรทัด → เลขในชื่อสาร (`SiO2` → `2`) ถูกนับ
เป็นหลักฐานว่าขอบอยู่ในแถว → ไม่ยิงเลย. แก้เป็นนับเฉพาะช่องที่เป็นตัวเลขล้วน

### A3 — แถวข้อความที่ OCR ตัดเกณฑ์กับผลคนละท่อน
`TXAX-A` `色相` ใบเขียน `淡黄色` + `Light Yellow Color` ทั้งช่องเกณฑ์และช่องผล แต่ OCR ตัดเป็น 4 บรรทัด
→ LLM หยิบท่อนญี่ปุ่นเป็นเกณฑ์ ท่อนอังกฤษเป็นผล → เทียบไม่ตรง → SKIP (แกว่งคนละรอบ)
`text-row-recovery.ts`: ท่อนไหนโผล่ **2 ครั้ง** ในบล็อกของแถว = ท่อนนั้นอยู่ทั้งสองช่องจริง → PASS

### gate (corpus 17 — dir เดียวกับ ROUND 26/27)
| | PASS | FAIL | SKIP | rows | deceptive |
|---|---|---|---|---|---|
| ROUND 27 (ก่อนแก้) | 129 | 0 | 11 | 140 | 0 |
| **ROUND 28** | **129** | **0** | **11** | **140** | **0** |

guard ใหม่ทั้ง 3 ตัว **ยิง 0 ครั้งทั้งคลัง** · BE `npx tsc -p .` = 0 · unit 18 suite ผ่านหมด (เพิ่ม 3 suite: 8+7+7 เช็ค)

### ผลกับ 10 ใบหน้างาน
| ไฟล์ | ROUND 27 | ROUND 28 |
|---|---|---|
| `HG-PP#180` | 0P/4S (แถวขยะ) | **4P/2S จากแถวจริง** |
| `CIIR1066` p1 | 7P/2S | **8P/1S** (`MOONEY` ได้ `34~42`) |
| `TSC Zeolite` | 7P/1S–8P/0S (แกว่ง) | **8P/0S** |
| อีก 9 หน้า | — | เท่าเดิม |

### ⚠️ ความไม่เสถียรที่วัดได้ (ยังไม่แก้ — รอ user เคาะ)
`TAIHEIYO CMF` (สแกน + หน้าหมุน + ตารางแนวนอน) รัน 3 รอบได้ 5P/5P/**3P**
รอบที่ตกคือ LLM ตัดชื่อ `Shot Content (wt%)` เป็น 2 แถว (`Shot` + `Content`) แล้วจับคู่ค่าผิด →
แถว `Shot` ได้ **PASS ด้วย result `0.5` ที่ไม่มีบนใบ** (ใบเขียน 0.37) = deceptive PASS
ที่มา: trailing `≧` ของ ROUND 27 ทำให้ `0.5≥` parse ได้ ซึ่งเดิม parse ไม่ออกเลยจบเป็น SKIP
ทางแก้ที่เสนอ: รวมแถวที่ชื่อถูก OCR ตัด (Fable ข้อ A5) — แก้ที่รากมากกว่าเพิ่ม guard รายแถว
ซึ่ง ROUND 26 พิสูจน์แล้วว่าทำคลังตก (125→121P)

## ROUND 29 (2026-09-09) — PASS ที่นั่งตรงขอบของเกณฑ์ขอบเดียว

ปิดของค้างจาก ROUND 28: `TAIHEIYO CMF` รอบที่ตกได้ **PASS ด้วยค่าผล `0.5` ที่ไม่มีบนใบ** (ใบเขียน 0.37)

### สิ่งที่ไม่ใช่ต้นเหตุ (ตัดออกก่อนแก้)
บันทึก ROUND 28 เดาไว้ว่าเป็น "LLM ตัดชื่อ `Shot Content (wt%)` เป็น 2 แถว" แล้วเสนอให้รวมชื่อ (Fable A5)
เปิด JSON ของรอบที่ตกจริง (`run3`) แล้วไม่ใช่แค่ชื่อขาด — **ทั้งบล็อก Analysis เลื่อนยกแถว**:

| ชื่อแถวที่ LLM คาย | spec | result |
|---|---|---|
| `Bulk Density` | `Spec` | 0.34 |
| `Analysis` | 0.37 | 0.37 |
| `Moisture` | 0.10 | 0.10 |
| `Shot` | `0.5≥` | **0.5** |
| `Content` | `1=` | 1 |

คำว่า `Spec` กับ `Analysis` กลายเป็น**ชื่อแถว** และ 4 แถวท้ายเอา token เดียวกันใส่ทั้งช่องเกณฑ์และช่องผล
→ รวม `Shot`+`Content` เป็นแถวเดียวก็ยังได้ (spec,result) ที่ขัดกัน 2 คู่ กู้ `1≧`/`0.37` ไม่ได้อยู่ดี
**A5 เป็นเรื่องจำนวนแถว/การแสดงผล ไม่ใช่ตัวปิด deceptive PASS** — ไม่ทำในรอบนี้

### ต้นเหตุจริง — guard เดิมครอบแค่ช่วง ไม่ครอบขอบเดียว
`coa-evaluator.ts` มี anti-fabricated-PASS guard มาตั้งแต่ต้น: would-be-PASS ที่ค่าผลตรงขอบเป๊ะ = ลายนิ้วมือของ
"โมเดลยกช่องเดียวไปใส่สองคอลัมน์" → SKIP. แต่เงื่อนไขเขียนไว้ `spec.op === "between"` เท่านั้น
`Shot` เป็น `le 0.5` (ขอบเดียว) ผล 0.5 → หลุด guard → PASS

### สิ่งที่แก้
1. `coa-evaluator.ts` — `spec.op` เป็น `le`/`ge` แล้วค่าผลตรงขอบเป๊ะ → เข้า guard เดียวกัน **ยกเว้นเกณฑ์ที่ทิศ
   มาจากตำแหน่งคอลัมน์** (`spec-normalizer.ts` ปักธง `dirFromColumn` ให้เลขเปล่าใน Min/Max)
2. `sieve-table-recovery.ts` — ตัวกู้แถว sieve เช็ค `within` แบบ range เท่านั้น (`min != null && max != null`)
   พอ guard ใหม่ทำให้ขอบเดียวเป็น SKIP แถว sieve ที่เกณฑ์เป็น `1.0 Max.` แล้วผลตรง 1.0 เลย **ไม่ถูก promote
   ทั้งที่ HEAD เคย promote** — comment เหนือบรรทัดนั้นเขียนเจตนาไว้ชัดว่า sieve เอาผลมาจากคนละช่องกับเกณฑ์
   จึงถือ boundary coincidence เป็นของจริงได้ → ขยาย `within` ให้รับขอบเดียวด้วย (reviewer จับได้, reproduce แล้ว)
3. `evaluator.test.ts` — เดิมเป็น suite เดียวใน 18 ตัวที่**ไม่มี `process.exit`** พิมพ์ `MISMATCH` แล้วยัง exit 0
   → fixture ทั้งไฟล์ไม่เคยเป็น gate จริง. เติม exit code (ยืนยันด้วยการทุบ expectation แล้วได้ exit 1)

**วัดก่อนเขียนโค้ด** (นับจาก log ของ ROUND 28 ไม่ต้องรัน LLM): PASS ที่นั่งตรงขอบเดียวมี **5 แถวในคลัง — เป็น
`Residue on sieve(1mm)` เกณฑ์ `0` ทั้งหมด (เลขเปล่า)** และใน 10 ใบหน้างานมี **1 แถวเดียวคือ `Shot` ที่เป็นของปลอม**
→ เส้นแบ่ง "เกณฑ์บอกทิศเอง vs ทิศเดาจากคอลัมน์" คิดค่าเสียหาย 0 แถว

ไม่แตะ trailing-operator ของ ROUND 27 — parser ถูกแล้ว (`1≥`/0.37 กับ `0.5≥`/0.10 เป็น PASS จริงบนใบเดียวกัน)

### ★ live proof — guard ไม่ได้แค่ตัดแถว แต่ปลดล็อก challenger ★
`tai-after-1.log` คือรอบที่บล็อกพังแบบเดียวกับ `run3` เกิดซ้ำจริงวันนี้ (1 ใน 5 รอบ):
`[eval] SKIP Shot min=- max=0.5 result=0.5` → flat เหลือ 2P → `[keep-best] ✓ grid ชนะ 2P→4P` →
`[hq-ocr] ✓ HQ ชนะ 4P→5P` → รายงานจบที่ `Shot Content (wt%) PASS result=0.37 spec=1≥` ตรงใบ

**ถ้าไม่มี guard**: flat = 3P รวม `Shot 0.5` ปลอม · `preservesPasses` ต้องหา PASS ของ challenger ที่ตรงกับ
`passNameKey "shot"` หรือ `passValueKey "0.5||0.5"` — grid ให้ `shotcontentwt`/`0.1||0.5`, HQ ให้ `0.37||1`
ไม่มีตัวไหน match → **challenger ตกทั้งคู่ ใบออกไป 3P พร้อม deceptive PASS**

⚠️ ตามมาด้วยข้อควรระวัง: **"guard ตัด PASS ได้อย่างเดียว" ไม่จริงที่ระดับ pipeline** — SKIP ที่เพิ่มขึ้นไป
trigger `keep-best`/`hq-ocr` (`coa-pipeline.ts` เงื่อนไข `summary.skip > 0`) ได้ ดังนั้นห้ามใช้ monotonicity
เป็นข้อพิสูจน์ว่า PASS ที่เพิ่มคือ drift — ต้องยืนยันด้วยจำนวนครั้งที่ guard ยิงจริงต่อแถว

### gate
| | PASS | FAIL | SKIP | rows |
|---|---|---|---|---|
| baseline วันนี้ (HEAD 03c4845, dir เดียวกัน) | 128 | 0 | 10 | 138 |
| ROUND 29 (guard อย่างเดียว) | 129 | 0 | 11 | 140 |
| **ROUND 29 (+ sieve within)** | **128** | **0** | **10** | **138** |

รันชุดสุดท้าย (guard + sieve) ได้ **เท่ากับ baseline ทุกไฟล์ทุกหน้า ไม่มีบรรทัดต่างเลย** — 129P ของรันกลางคือ
`1F1710` p4 แกว่ง (13P→14P) ตัวเดิมที่จดไว้ตั้งแต่ ROUND 16

guard ใหม่ยิง **0 ครั้งใน corpus 17** — นับต่อแถวจาก log ทั้ง 2 รัน: บรรทัด `ค่าผลตรงขอบเกณฑ์พอดี` มี 7
เท่ากันทั้ง baseline และ after และเป็น `between` ทั้งหมด · ยิงเฉพาะ `TAIHEIYO` (2 ใน 6 รอบวันนี้)
· `npx tsc -p .` = 0 · unit 18 suite ผ่าน (evaluator +10 เช็ค + exit code)

### ผลกับใบจริง
- `TAIHEIYO CMF` รัน **5 รอบติด ได้ 5P/0F/8S เท่ากันทุกรอบ** ค่าตรงใบทุกแถว (`Shot Content (wt%)` = 0.37 เกณฑ์ `1≥`)
- 10 ใบหน้างาน (รันหลังแก้ครบ): **75P/1F/25S** — `1F` คือ `Kemolit` `Retention on 60 mesh` ที่ใบพิมพ์เกณฑ์
  `<0.0` เอง (ของค้างเดิม). ต่างจากรันก่อนแก้ sieve 1 แถวที่ `TAIHEIYO` (5P→4P) **ไม่ใช่ผลของ sieve**
  (`sieve-recovery` ยิง 0 ครั้งทั้ง 2 รัน) แต่เพราะ **HQ engine ล่มกลางรัน**:
  `onnxruntime.capi.onnxruntime_pybind11_state.Fail: [ONNXRuntimeError] : 1 : FAIL : bad allocation`
  → `[hq-ocr] HQ OCR thin/failed — คง best` (ROUND 31 แยกสตริงนี้เป็น `HQ engine ล้ม` กับ `HQ OCR thin`)
  → หยุดที่ grid 4P และ `Shot Content (wt%)` ได้ spec `1=`
  (OCR อ่าน `≧` เป็น `=`) → **honest SKIP ค่าผล 0.37 ถูกต้อง** ไม่ใช่ deceptive
  ⚠️ ของใหม่ที่ต้องจำ: v5-server HQ engine กิน RAM จนล้มได้เมื่อรันไฟล์ติดกันยาว — ที่หน้างานถ้า HQ ล้ม
  ผลจะตกไปเป็น SKIP เงียบๆ (ปลอดภัย แต่ recall หาย) ยังไม่ได้ตามต่อในรอบนี้
- replay แถวที่จับไว้จาก `run3` เข้า evaluator ตัวปัจจุบัน: `Shot` เปลี่ยนจาก `PASS result=0.5` เป็น
  `SKIP ค่าผลตรงขอบเกณฑ์พอดี` (fixture พินไว้แล้ว)

### รอยต่อที่รู้ตัวว่าไม่สมมาตร (ตั้งใจ)
- ข้อยกเว้น **กว้างกว่าคำว่า "เลขเปล่าใน Min/Max"**: `normalizeSpecFromCandidate` ปัก `dirFromColumn` ทุกครั้งที่
  LLM เติม `specMin`/`specMax` แม้จะมี `specRaw` เลขเปล่ามาด้วย ซึ่ง `spec-normalizer.ts:193` บอกว่า qwen3 ทำบ่อย
  → **ถ้าเปลี่ยน prompt/model แล้วมันเปลี่ยนช่องที่เติม บั๊ก TAIHEIYO กลับมาได้เงียบๆ** — มี fixture
  `specRaw เลขเปล่า + คอลัมน์ Max` พินเส้นแบ่งนี้ไว้แล้ว ถ้ารอบหน้าจะเปลี่ยนใจ จะเห็นที่ fixture ไม่ใช่ที่ใบหน้างาน
- `spec-recovery.ts` สังเคราะห์ `"<v> Min./Max."` จากทิศที่มันเดาจาก header → หน้าตาเหมือนเกณฑ์ที่บอกทิศเอง
  ถ้ามีแถวแบบนั้นนั่งตรงขอบ จะโดน SKIP ด้วย. ปล่อยไว้เพราะทั้งคลังยังไม่มีสักแถว และ SKIP คือทางที่ปลอดภัย
- `evaluateInterval` ยังเช็ค boundary เฉพาะ `between` — ช่องว่างเชิงความสม่ำเสมอ ยังไม่มีเคสจริงมากระตุ้น

### ยังไม่ทำ (ตามที่ Fable เสนอ)
A5 รวมชื่อแถวที่ OCR ตัด (ต้องมี veto คำ header ก่อน ไม่งั้นจะไปรวม `Chemical`+`SiO2`) · A6 product/lot · A4 header-driven parser

---

## ROUND 30 (2026-09-09) — product/lot: ชื่อลูกค้าถูกเอามาเป็นชื่อสินค้า

งานที่ Fable จดไว้เป็น A6 · ทำก่อน A5 เพราะ ROUND 29 พิสูจน์แล้วว่า A5 เป็นเรื่องจำนวนแถว/การแสดงผล
ส่วนหัวรายงานที่ผิดคือ **confident wrong ตรงจุดที่คนหน้างานใช้ยืนยันว่าจับใบถูกกับของถูก**

### วัดก่อนเขียนโค้ด (ไม่เรียก LLM สักครั้ง)
1. อ่าน product/lot ล่าสุดต่อไฟล์จาก `backend/coa-logs/*.json` ที่มีอยู่แล้ว → **ผิด 7 ใน 17 ใบ**
2. ดูดข้อความ 34 หน้า (corpus 17 + 10 ใบหน้างาน) ด้วย `_validate/_dump-text.ts` ตัวใหม่ — text extraction
   ไม่ผูกกับ Ollama เลย → ได้ fixture ของจริงไว้ให้คะแนนฟังก์ชัน pure ก่อนแตะ pipeline
3. ⚠️ gate เดิม **ไม่พิมพ์ product/lot** → `128P/0F/10S` พิสูจน์อะไรกับงานนี้ไม่ได้เลย ต้องเติมบรรทัด
   `header:` ใน `verify-4b-only.ts` ก่อน ไม่งั้นรันครบ 30 นาทีแล้วยังไม่รู้ว่าดีขึ้นหรือแย่ลง

### อาการจริงจาก log (คอลัมน์กลางคือสิ่งที่ LLM คายออกมา)
| ใบ | LLM ให้ | ที่ถูกบนใบ |
|---|---|---|
| `TXAX-A` | `Resonac Materials (Thailand) Co., Ltd.` | ไม่มีป้ายสินค้าบนใบ (ชื่อลอยบรรทัดแรก) |
| `PR1950W` | `RESONAC` (หัวจดหมาย) | `Product`/`Name PR1950W` |
| `ZP10` | product `中化` · lot `sinochem` | `Type :ZP10` · `Box no. :2026021327` |
| `4A` | `MesSrSiSHIRAISHI CALCIUM(THAILAND)CO.,LTD.` | `Name of Product .4APOWDER` |
| `1F1710` p2 | `Canadian Std Freeness` (ชื่อแถวในตาราง) | ใบเขียน `Product: N/A` เอง |
| `1F1710` p4 | lot `C31554649` (เลข batch) | `Lot number 26011A` |
| `RI-015` | lot `01` | ใบอธิบายเองว่า lot = OF NUMBER + เลขต่อท้าย |

### ที่แก้
- **`product-lot-recovery.ts` (ใหม่)** — หา product/lot จากป้ายบนใบ: `Product Name/Grade`, `Trade Name`,
  `Name of Product`, `品名`, `Lot No.`, `Batch No`, `ロット番号` ฯลฯ · ค่าอยู่ท้ายป้ายในช่องเดียวกัน
  (`LOT NO. 850996`) หรือช่องถัดไป หรือบรรทัดล่าง (ใบญี่ปุ่น) · **ไม่มีป้าย = null**
- **`coa-pipeline.ts`** — เรียกที่เดียวหลังเลือก candidate เสร็จ ให้หัวรายงานมีเจ้าของเดียว ไม่ขึ้นกับว่า
  flat/grid/HQ ตัวไหนชนะ (`lotFrom` ใน `parse-structural-grid.ts` เลยกลายเป็นทางตายโดยพฤตินัย ไม่ได้ถอด)
- **`verify-4b-only.ts`** — พิมพ์ `header: product=… · lot=…` ต่อหน้า

**เส้นแบ่งที่ทำให้ veto ทำงานได้จริง:** ดูที่ **ป้าย** ไม่ใช่รูปทรงของค่า — `Resonac Materials (Thailand)
Co., Ltd.` เป็นข้อความที่อยู่บนใบจริงๆ การเช็คว่า "ค่านี้มีบนใบไหม" จึงจับไม่ได้ ต้องดูว่ามันนั่งใต้ป้ายอะไร
(`Customer`/`顧客名`/`Consignee`/`Ship-to`/`Messrs`) แล้วตัดทิ้งทั้งป้าย

### กับดักที่ fixture พินไว้ (เจอจริงทุกอันตอนวัด ไม่ใช่เคสสมมติ)
- `Customer Product Name:` กับ `Product Name/Grade:` อยู่ใบเดียวกัน (CIIR) → ป้ายที่มีคำว่า customer แพ้เสมอ
- `PRODUCT INFORMATION` / `Product Characteristics` (Barimite) = หัวข้อกับหัวตาราง ไม่ใช่ป้าย → เทียบเป๊ะทั้งช่อง
- `Product | : 130035346` (Z99) = รหัสวัสดุ → ตัวเลขล้วน ≥5 หลักไม่ใช่ชื่อ ให้ `Product Description` ชนะ
- `Product: N/A` (1F1710) = ใบตอบเองว่าไม่มี → ห้ามหล่นไปเดาจาก `Type: 979A`
- `Lot#01 | 60.9 | 38.44` (RI-015) = หัวคอลัมน์ของแถวข้อมูล → `Lot#` รับเฉพาะช่องที่เป็น `Lot#` เดี่ยวๆ
- `LOT NO. 850996 | Traces | 0.30 | 97.20` (Suzorite) — ถ้าเลขไม่ได้ต่อท้ายป้ายมาด้วย ช่องถัดไปคือค่าที่วัดได้
  → lot ห้ามเป็นเลขทศนิยมสั้น (`0.30`/`38.44`) แต่ยังรับรหัสยาวที่มีจุดได้ (HG-PP = `080312.2`)
- `batch and in compliance with…` (RB220) = ประโยค ไม่ใช่ป้าย → ป้ายยาวเกิน 30 ตัวอักษรไม่นับ
- ป้ายถูกตัดคนละบรรทัด (PR1950W): `Product`/`Name | PR1950W` ต่อกันได้ แต่ `Customer's`/`Name : | Resonac…`
  ก็ต่อแบบเดียวกัน → ต่อแล้วค่อยแยกว่าอันไหนของลูกค้า

### gate
| | PASS | FAIL | SKIP | rows |
|---|---|---|---|---|
| ROUND 29 (baseline) | 128 | 0 | 10 | 138 |
| ROUND 30 รันที่ 1 | 128 | 0 | 10 | 138 |
| ROUND 30 รันที่ 2 | 129 | 0 | 11 | 140 |
| **ROUND 30 หลังรีวิว (ตัวจริง)** | **128** | **0** | **10** | **138** |

รันที่ 1 กับรันหลังรีวิว **เท่ากับ baseline ทุกบรรทัด** (diff ว่าง) · รันที่ 2 ต่างที่ `1F1710` p4 เท่านั้น
(13P→14P) = ตัวแกว่งเดิมที่จดไว้ตั้งแต่ ROUND 16 ไม่ใช่ผลของ ROUND 30 — โมดูลนี้แตะแค่ `report.product`/
`report.lotNo` สร้างแถวไม่ได้ · `npx tsc -p .` = 0 · unit **19 suite** ผ่าน (ตัวใหม่ 34 เช็ค)
⚠️ `tsc -p .` กิน `src/**` เท่านั้น → 2 ไฟล์ใน `_validate/` ของรอบนี้อยู่นอก typecheck แต่ถูก**รันจริง**
(ข้อความ 34 หน้า + log ทั้งสามไฟล์คือผลของมัน) ซึ่งเป็นหลักฐานที่แข็งกว่า typecheck

**หัวรายงานหลังแก้:** corpus 22 หน้า product 16 ค่า/6 null · lot 19 ค่า/3 null · 10 ใบหน้างาน 12 หน้า
product 8 ค่า/4 null · lot 12 ค่า/0 null — **ทุกค่าตรงกับป้ายบนใบเท่าที่ระบบอ่านออก** (วัดกับข้อความที่ดูดได้
ซึ่งเป็นสิ่งที่โมดูลอ่านเอง จึงยังไม่ใช่การเทียบกับใบจริงทุกช่อง) · เปิดภาพใบจริงยืนยันแยก 3 ใบที่คาใจ:
`FRICSTAR` (ดูด้านล่าง) · `D-2072` ใบพิมพ์ `PRODUCT NAME : CS-2402-B2` กับ `Lot No. D-2072` **ไม่ได้สลับกัน
ชื่อไฟล์ต่างหากที่ตั้งตาม lot** · `RI-015` ใบพิมพ์ `Material Code RI-015` + `Description Lead-free Brass
Chips` และมี NOTE บอกเองว่า lot = `OF NUMBER` + เลขต่อท้าย (`EC2503068`+`01`) ซึ่งเป็นกติกาเฉพาะเจ้านี้ →
lot เป็น null ถูกแล้ว

⚠️ 2 ช่องที่ต้องอ่านด้วยความระวัง: `SODA ASH` = `Soda ash 1ight..25Kg4P` **นับเป็น "อ่านได้ตามใบ" ไม่ใช่
"ถูก"** (OCR อ่าน light เป็น 1ight ตั้งแต่ต้นทาง ไม่ใช่ขอบเขต A6) · `Z99` = `Z99 2-3.5UM ZIR` มาจาก
**บรรทัดแรกของคำอธิบายที่ยาว 2 บรรทัด** (บรรทัดล่างคือ `OXIDE_PW_PAB_50_40_RES`) — ค่ายาวข้ามบรรทัดจะได้
เฉพาะบรรทัดแรกเสมอ ตรงกับที่หน้างานเรียกใบนี้ว่า Z99 2-3.5UM แต่ไม่ใช่ข้อความเต็มบนใบ

**หน้าที่เป็น null ไม่ได้ทำให้หน้าอื่นในไฟล์เดียวกันเสีย lot ไป** — ไล่ทุกไฟล์หลายหน้าแล้ว หน้าเดียวที่ lot
เป็น null คือ `1F1710` p1 ซึ่ง LLM เดิมก็ให้ null อยู่แล้ว (p2–p4 ยังได้ `26011A` ครบ)

### opus-reviewer จับได้ 1 blocker + 3 ข้อ (แก้ครบก่อน commit สุดท้าย)
1. **blocker — fallback บรรทัดล่างไม่สนใจว่าป้ายอยู่คอลัมน์ไหน** อ่านช่องแรกของบรรทัดล่างเสมอ → ป้ายที่อยู่
   คอลัมน์ขวาไปหยิบค่าที่อยู่ใต้ป้ายอื่น. แถว `Lot No. | Name of Product` + `SHIRAISHI CALCIUM (THAILAND) |
   4A POWDER` ให้ product = **ชื่อลูกค้า** — บั๊กตัวเดียวกับที่ ROUND 30 มาแก้ แต่คราวนี้เป็นกฎ deterministic
   ที่เงียบกว่าเดิม. บนใบจริง `PR1950W` ป้าย `product description` (คอลัมน์ที่ 2) รับ `"Lot No."` เป็นค่า
   ไปแล้ว รอดเพราะบังเอิญเจอ `PR1950W` ก่อนเท่านั้น → **จำกัด fallback ให้ใช้ได้เฉพาะป้ายช่องแรก + ป้ายชั้นแน่ชัด**
2. **ค่าที่เป็นป้ายเสียเอง ไม่ถูกปฏิเสธ** — สแกนที่ OCR ตก `:` ทำให้ `"Lot No."`/`"Grade"` หลุดเป็นค่าได้
   → ปฏิเสธค่าที่ `labelKey` ของมันตรงกับป้ายตัวใดตัวหนึ่ง
3. **veto ฝั่งลูกค้าไม่เคยคุม lot** — `得意先ロット番号` (คำว่า 得意先 อยู่ใน list อยู่แล้ว) จะได้ lot ของลูกค้ามา
4. **คำกล่าวอ้างในบันทึกไม่จริง 1 จุด** — `FC-250-1500` ได้ `250-1500_PW_PAB_20_1000KG_D` ซึ่ง**ขาดกลางคำ**
   (ใบเขียน `…KG_DE` ตัว `E` ตกไปบรรทัดล่าง) จะเขียนว่า "ไม่มีช่องไหนผิดใบ" ไม่ได้ → แก้ที่รากด้วยการให้
   `Prod.Commercial Desc.` (ชื่อการค้า `TIMREX FC 250-1500 COKE`) ชนะ `Product Description` (รหัสบรรจุ)

ทั้ง 4 ข้อวัดแล้วบนข้อความ 34 หน้า: ข้อ 1–3 ไม่เปลี่ยนผลสักหน้า · ข้อ 4 เปลี่ยนหน้าเดียวคือ FC และดีขึ้น
fixture ใหม่ 5 ตัวถูกทุบทดสอบแล้วว่าตกจริงถ้าถอด guard ออก (ได้ `product="SHIRAISHI CALCIUM (THAILAND)"` กลับมา)

### ราคาที่จ่าย (จ่ายจริง ไม่ใช่ทฤษฎี)
- `Barimite 200` — ป้ายบนใบคือ `Cim bar Ref#` (เฉพาะเจ้านี้) → product เป็น null ทั้งที่ LLM เคยได้ถูก
- `RB220` lot `72700403` — เลขอยู่ในคอลัมน์แรกของตารางใต้หัว `Batch no.` ไม่มีป้ายคู่ → null (งานของ A4)
- `TSC Zeolite`/`TAIHEIYO` — ชื่อสินค้าอยู่ในบรรทัดหัวเรื่อง (`ZEOLITE Na-4A PRODUCT CERTIFICATE`) ไม่มีป้าย → null

รวม: แก้ผิดเป็นถูกหรือเป็น null ที่ซื่อสัตย์ **9 หน้า** · เสีย recall **2 ช่อง**

### เจอระหว่างทาง
`FRICSTAR` ใบพิมพ์ `Lot No.: 02506014` แต่ชื่อไฟล์ที่คนตั้งคือ `Lot 25006014` — เทียบกับภาพใบจริงแล้ว
**ระบบอ่านถูก คนพิมพ์สลับเลข** นี่คือประโยชน์ตรงๆ ของการดึงหัวรายงานจากใบแทนที่จะเชื่อชื่อไฟล์

### รอยต่อที่รู้ตัว (ยังไม่แก้)
- อ่านหัวจาก `pg.text` (flat ของ engine default) เสมอ แม้หน้านั้น HQ/grid จะชนะ — ตรงกับ guard ตัวอื่นทุกตัว
  ที่กิน flat text (`coa-pipeline.ts:43`) และยังไม่มีหน้าไหนที่ HQ อ่านป้ายได้ดีกว่า mobile
- ป้ายชั้นเดียวกันที่เจอหลายครั้ง **ตัวแรกในลำดับการอ่านชนะ** ไม่มีการโหวต — `1F1710` p2 มี `Lot number` 4 ครั้ง
  (ครั้งหนึ่ง OCR เพี้ยนเป็น `2601A`) ได้ค่าถูกเพราะลำดับ ไม่ใช่เพราะตรวจสอบ

### ยังไม่ทำ
A5 รวมชื่อแถวที่ OCR ตัด · A4 header-driven parser (จะได้ lot ของ RB220 มาด้วย) · HQ engine `bad allocation`

---

## ROUND 31 (2026-09-09) — HQ engine ล้ม `bad allocation` แล้ว recall หายเงียบ

ของค้างจาก ROUND 29: รัน 10 ใบรวดเดียวแล้ว HQ engine (v5-server) ตายกลางทาง
`onnxruntime.capi.onnxruntime_pybind11_state.Fail: [ONNXRuntimeError] : 1 : FAIL : bad allocation`
→ `TAIHEIYO` ได้ 4P แทน 5P. ผลไม่ผิด (แถวที่หายเป็น honest SKIP) แต่ **หน้าเว็บกับ log แยกไม่ออก**
ว่าเครื่องล้มหรือใบอ่านไม่ออกจริง เพราะ `[hq-ocr] HQ OCR thin/failed` เป็นข้อความเดียวกันทั้งสองกรณี

### วัดก่อนเขียนโค้ด — 7 การทดลอง ตัดสมมติฐานทิ้ง 2 ข้อ

เครื่องตอนวัด: RAM 15.1GB · 32 logical cores · commit ใช้ไปแล้ว 46.2/61.0GB · availPhys 0.5–2.2GB

| # | ทำอะไร | ผล | สรุป |
|---|---|---|---|
| 1 | อ่าน counter ของ daemon ที่รันมา 2 วัน | `PM=1037MB` แต่ `PeakPM=3594MB` | spike แล้วคืน — **ไม่ใช่ leak** |
| 2 | sweep ขนาดภาพ 1000→3509px | det input อิ่มที่ `1408x1984` ทุกค่า ≥2000 | `Global.max_side_len=2000` ครอบไว้แล้ว |
| 3 | ยิงภาพเดิม 20 รอบติด | priv ไต่ +68MB/รอบ ถึง 3729MB แล้ว**ตกกลับ 2866** | sawtooth = heap ที่ reuse ได้ |
| 4 | Job Object จำกัด commit แล้วยิง | `RUNTIME_EXCEPTION ... Concat node ... bad allocation` | commit หมด → ORT โยน bad_alloc |
| 5 | จำกัด 900MB ตั้งแต่ตอนโหลดโมเดล | `Fail : 1 : FAIL : Load model ... failed:bad allocation` | **ล้มตอนโหลดได้ด้วย** |
| 6 | `intra_op_num_threads` 32/16/8/4/2 | peak เท่ากันหมด (~1910MB) · sha ข้อความเท่ากันเป๊ะ · 2 threads ช้า 30s | **thread scratch ไม่ใช่ตัวขยาย — ตกไป** |
| 7 | ข้อความ HQ ที่ 2828/2000/1600/1400/1200px | `Loss on Ignition` + `≤3.5%` ถูกทุกขนาด | ย่อภาพยังกู้เคส 4A ได้ |

**root cause:** HQ engine กิน resident ~1.0GB + transient ~1.9GB = **peak private ~3.7GB**
เครื่องที่ commit ตึงอยู่แล้วจะจองไม่ได้ → ORT โยน `bad allocation` ได้ทั้งตอนโหลดโมเดลและตอน run

★ exp 5 ฆ่าทางแก้ที่ดูสมเหตุสมผลที่สุด ★ "ปล่อย engine แล้วโหลดใหม่" = โยนของอุ่นทิ้งแล้วขอก้อนใหญ่กว่าเดิม
ตอนที่ memory กำลังตึง — **ล้มซ้ำง่ายกว่า retry เฉยๆ**

### หน้าต่างที่ fallback ช่วยได้จริง (Job Object cap, วัดต่อเนื่อง)

| cap | full-res 1414x2000 | retry 989x1400 |
|---|---|---|
| 2600–2800MB | รอด | (ไม่ต้องใช้) |
| 1800–2400MB | **ตาย** | **รอด + อ่าน `≤3.5%` ถูก** |
| ≤1600MB | ตาย | ตาย |

= ย่อภาพซื้อ headroom ได้ ~800MB

### สิ่งที่แก้
- **`ocr-py/ocr_server.py`** — OCR ล้ม → ย่อภาพเหลือด้านยาว `COA_OCR_RETRY_MAX_SIDE` (default 1400) แล้วยิงใหม่
  ด้วย engine เดิม → **คูณ box กลับ** ให้พิกัดที่ส่งออกอยู่ในภาพต้นฉบับเสมอ → แนบ `degraded` ใน response
- **`rapidocr.service.ts`** — ส่ง `degraded` ขึ้นไปทาง sink (rotation ยิง 3 มุม ธงรอบไหนติดก็นับ) ออกที่ `extractTextBoth`
- **`coa-pipeline.ts`** — แยก `[hq-ocr] ✗ HQ engine ล้ม` ออกจาก `HQ OCR thin` · HQ ที่ degraded ชนะได้
  แต่**ปักธง `needsReview` ทั้งหน้า**

### opus-reviewer จับ 2 blocker (แก้ครบก่อน commit)
1. **retry ไปโดน engine default ด้วย** — `try/except` ไม่ได้ดู `hq`. HQ มี `best` เป็นพื้น (อ่านแย่ลงก็แพ้ไปเฉยๆ)
   แต่ engine default **คือแหล่งข้อมูลเดียวของหน้า** — ล้มแล้วต้องดังตาม `OCR_DAEMON_DOWN` ไม่ใช่เงียบๆ
   อ่านครึ่งความละเอียด. เป็นเหตุผลเดียวกับที่ถอด Tesseract ออกใน ROUND 23
   → retry เฉพาะ `hq` **และ** เฉพาะ error ที่เป็น allocation จริง (`is_alloc_failure`)
2. **`degraded` ไม่เคยไปถึงจุดตัดสิน** — มีแค่ `console.warn`. `preservesPasses` จับคู่ PASS เดิม
   **ด้วยชื่อแถว ไม่ดูค่า** → HQ ที่อ่านจากภาพย่อเขียนทับเลขของแถวที่ PASS อยู่แล้วเป็นเลขอื่นที่ยังอยู่ในเกณฑ์
   แล้วกู้ PASS ใหม่ได้ 1 แถว = ชนะ `gridBeatsFlat` แบบเขียวสะอาด. ทาง grid-spatial ปักธง amber
   ทุกแถวที่พิสูจน์ column ไม่ได้ แต่ทาง HQ ไม่เคยปักเลย
   → เลือก **ปักธงทั้งหน้า ไม่ใช่ปฏิเสธ challenger** (ปฏิเสธ = retry ไม่ได้ recall กลับมาเลย) ตาม precedent ของ grid

ข้อรองที่แก้ด้วย: ย้าย retry ออกนอกบล็อก `except` (traceback ที่ค้าง pin tensor ของรอบที่ล้มไว้ทั้งชุด —
reviewer วัดได้ 5/5 objects ยังไม่ถูกปล่อย) · retry ล้มซ้ำแล้วยังเก็บ**ต้นเหตุแรก**ไว้ในข้อความ ·
`cv2.INTER_AREA` แทน INTER_LINEAR (ย่อครึ่งแล้วเส้นเลขบางไม่แหว่ง) · env พิมพ์ผิดไม่ทำ daemon ตายตอน start

### gate
| | PASS | FAIL | SKIP | rows |
|---|---|---|---|---|
| ROUND 30 (สองสถานะที่รู้จัก) | 128 / 129 | 0 | 10 / 11 | 138 / 140 |
| **ROUND 31 รอบสุดท้าย** | **129** | **0** | **11** | **140** |

รอบสุดท้าย **byte-identical กับ `my_r30-final` ทุกบรรทัด** · รอบก่อนแก้ blocker ได้ 128P/138 ซึ่งต่างจากรอบนี้
**เฉพาะ `1F1710` p4** (13P↔14P) = ตัวแกว่งเดิมตั้งแต่ ROUND 16 · 10 ใบหน้างาน **76P/1F/24S** เท่า baseline
(`1F` = `Kemolit` ที่ใบพิมพ์เกณฑ์ `<0.0` เอง) · `npx tsc -p .` = 0 · unit **19 suite** ผ่าน
· **`[retry]` ยิง 0 ครั้งทั้งสองชุด** = path ปกติไม่ถูกแตะ (ตามที่ควรเป็น — retry เป็น fallback หลัง bad_alloc เท่านั้น)

gate ตัวจริงของรอบนี้ไม่ใช่ corpus (corpus ยิง HQ challenger แค่ 4 หน้า และ **path bad_alloc ไม่ยิงเลยตอน RAM ปกติ**)
แต่คือ repro ใต้ Job Object cap: `hq`+alloc → retry คืน 41 tokens เท่า baseline, box span ต่าง 0.1% ·
`default`+alloc → raise (ไม่ retry) · `hq`+error อื่น → raise

### รอยต่อที่รู้ตัว (ยังไม่แก้)
- ภาพย่อ 1400px = **1.40 Mpx เทียบกับ 2.79 Mpx ที่คลัง validate ไว้ = ครึ่งเดียว** และหลักฐานว่าอ่านถูก
  มาจากใบเดียว (4A LoI). ธง `needsReview` ทั้งหน้าคือราคาที่จ่ายให้ความไม่แน่นอนนี้
- `to_array` ใช้ `cv2.imdecode` ส่วนรอบแรก rapidocr ใช้ PIL → EXIF กับ RGBA คนละทาง. กระทบเฉพาะ
  JPG/PNG ที่ผู้ใช้อัปตรง (PDF ที่ pdfjs render ไม่มี EXIF) และ path นั้นไม่เข้า `buildScannedGrid`
- `_engine_lock` ตอนนี้ครอบ 2 inference — หน้าหมุนที่ล้มทุกมุมจะถือ lock เดียวยาว 6 รอบ
- `correctRotation` โหวตมุมด้วยจำนวน token แนวกว้าง ถ้ามุมหนึ่ง degraded (token น้อยลงตามพิกเซล)
  การโหวตไม่ใช่ apples-to-apples. ไม่ใช่ regression (เดิมมุมที่ล้ม = `null` ถูกตัดทิ้งทั้งมุม) แต่เป็นความไม่สมมาตรใหม่
- **daemon เก่าค้างอยู่ตรวจไม่ได้** — restart backend อย่างเดียวแล้วลืม restart `npm run ocr:daemon` จะได้
  `ocr_server.py` ตัวเก่าที่ไม่มี field `degraded` เลย ซึ่งฝั่ง TS อ่านว่า "ไม่ degraded" ไม่ใช่ "ไม่รู้"
  (footgun เดียวกับตอนเพิ่ม flag `hq` ใน 743df04) — ยังไม่มี version handshake ระหว่าง backend กับ daemon

### ตรวจ end-to-end ผ่าน HTTP จริง (advisor จับได้ว่าการพิสูจน์ก่อนหน้าเรียก `run_ocr()` ในโปรเซสล้วน)
ยิง daemon ตัวจริงบนพอร์ตแยกใต้ Job Object cap 2400MB แล้วให้ `RapidOcrService` ตัวจริงคุยด้วย
(`_validate/_e2e-degraded.ts`) — ถ้า python กับ TS สะกด field คนละแบบ (`max_side` vs `maxSide`)
จะเงียบสนิทเพราะ `res.data` เป็น `any` และ `tsc` มองไม่เห็น:
- retry สำเร็จ → TS ได้ `degraded={"maxSide":1400,…}` + 41 tokens ครบ
- `RETRY_MAX_SIDE` ใหญ่กว่าภาพ (`small is None`) → raise → HTTP 500 → `extractTextBoth` คืน `null`
  → เข้าสาขา `[hq-ocr] ✗ HQ engine ล้ม` ตามที่ออกแบบ

### ค้างให้ user เคาะ (ไม่แก้เอง — pre-existing ตั้งแต่ 743df04 ไม่ใช่ของรอบนี้)
1. `preservesPasses` (`coa-pipeline.ts:330-345`) **value-blind กับแถวที่ PASS อยู่แล้ว** — จับคู่ด้วยชื่อก่อน
   → challenger ตัวไหนก็ตาม (grid หรือ HQ, ความละเอียดใดก็ได้) เขียนทับเลขของแถวที่ผ่านอยู่แล้ว
   เป็นเลขอื่นที่ยังอยู่ในเกณฑ์ได้ โดยยังนับว่า "PASS เดิมครบ"
2. HQ win path **ไม่ปัก `needsReview` เลย** ขณะที่ grid win path ปัก amber ทุกแถวที่พิสูจน์ไม่ได้
   → HQ challenger มีผิวสัมผัส deceptive-PASS ที่ grid ไม่มี. ROUND 31 ปิดเฉพาะกรณี degraded

### ยังไม่ทำ
A5 รวมชื่อแถวที่ OCR ตัด · A4 header-driven parser (จะได้ lot ของ RB220 มาด้วย)

## ROUND 32 (2026-09-10) — challenger เขียนเลขทับแถวที่ผ่านอยู่แล้วได้ โดยยังนับว่า "PASS เดิมครบ"

ของค้างที่ `opus-reviewer` จับได้ตอน ROUND 31 แต่ไม่ใช่ของรอบนั้น (pre-existing ตั้งแต่ `743df04`):

1. `preservesPasses` จับคู่ PASS เดิมด้วย**ชื่อแถว ไม่ดูค่า** → challenger ตัวไหนก็ได้ (grid หรือ HQ) เขียนเลขทับ
   แถวที่ผ่านอยู่แล้วเป็นเลขอื่นที่ยังอยู่ในเกณฑ์ + กู้ PASS ใหม่ 1 แถว = ชนะ `gridBeatsFlat` แบบเขียวสะอาด
   เคสคมสุด = **สองแถวสลับค่ากัน** → จับคู่ได้ทั้งคู่ "PASS เดิมครบ" ทั้งที่เลขผิดทั้งคู่
2. **HQ win path ไม่ปักธงเลย** ขณะที่ grid win path ปัก amber ทุกแถวที่พิสูจน์ column ไม่ได้

### วัดก่อน: log เก่าตอบไม่ได้
`coa-logs/*.json` เก็บแค่**ผู้ชนะ** ไม่เก็บ incumbent → นับจาก log ว่า "เคยเขียนทับกี่ครั้ง" ไม่ได้เลย
→ รวมการวัดเข้ากับ gate: ใส่ audit line พิมพ์ `ชื่อ: ค่าเดิม → ค่าใหม่` ที่จุดตัดสิน แล้วรัน gate รอบเดียว

★ audit line คือของที่คุ้มสุดของรอบนี้ ★ รอบแรกได้ amber +22 ซึ่ง **16 แถวเป็น false alarm** — บรรทัด audit
โชว์ `36 → 36`, `0.1 → 0.1` (ค่าเท่าเดิม) เพราะ confirm key ใส่ `specRaw` ด้วย → flat เขียน `0~0.2`
grid เขียน `0.2 max` (ขอบเกณฑ์เดียวกัน verdict เดียวกัน) ก็ถูกนับว่าเขียนทับ → ปักธงเฟ้อ Z99 10 แถว /
Barimite 2 / RI-015 4. **ถ้าไม่พิมพ์ค่าออกมา จะเขียน log ว่า "ปิดช่อง deceptive ได้ 22 แถว" ทั้งที่ 16 แถว
ไม่มีอะไรเปลี่ยน** → confirm key = `result|min|max` (`passValueKey`) เท่านั้น

### สิ่งที่แก้
- **`coa-pipeline.ts`** — ยุบ block ปักธงของ grid win เป็น `flagChallengerPasses(challenger, incumbent, engine, gridSource)`
  แล้วเรียกจาก**ทั้ง grid win และ HQ win** (เดิม HQ ไม่เรียกอะไรเลย) · `passKey` เดิมถูกแทนทั้งตัว
- matcher 3 phase: **จับคู่ชื่อ+ค่าตรงเป๊ะให้หมดก่อน** → ชื่อตรงค่าต่าง = เขียนทับ (amber เสมอ แม้ structural)
  → ยืนยันด้วยค่าข้ามชื่อได้เฉพาะ `result != null` **และ** triple ไม่ซ้ำในฝั่ง incumbent
- **`coa-evaluator.ts`** — ฟิลด์ `valueDisputed` บน `EvaluatedItem` (แบบเดียวกับ `ambiguousThousands`)
- **`coa-pipeline.ts` G6** + **`spec-column-recovery.ts`** — ด่านที่ล้างธงทุกตัวข้ามแถว `valueDisputed`
- ทุกธงเขียน `reason` ต่อท้ายของเดิมด้วย ` · ` (เดิมปักธงแต่ไม่มีข้อความ → หน้าเว็บโชว์ `<small>` ว่าง)

### opus-reviewer จับ 1 blocker + 3 ข้อรอง (รอบที่ 4 ติดกันที่มันจับของที่ gate มองไม่เห็น)
1. **BLOCKER — ยืนยันด้วยค่าอย่างเดียวปักธงผิดแถว**: `result=null` ทำให้ key เหลือ `"|min|max"` = ลายนิ้วมือ
   ของเกณฑ์ล้วน → `[Hg ≤15 ว่าง, Sb ≤15 ว่าง]` เทียบ `[Sb ≤15 ว่าง]` ได้ผล `flags=[false,true]` = **แถวใหม่
   ที่ไม่เคยพิสูจน์ column ได้เขียว ส่วนแถวที่ engine ทั้งสองอ่านตรงกันโดนธง**. RI-015 มี 3 แถวเกณฑ์ `<15`
   + 1 แถว `result=-` อยู่ในคลังแล้ว · **`needsReview=11` ที่ตรง prediction มองไม่เห็นบั๊กนี้** เพราะจำนวนธง
   เท่ากันทั้งสองทาง ย้ายแค่ตัวที่ถูกปัก
2. ตารางชื่อซ้ำ: challenger เก็บ `0.1` ไว้ + เพิ่ม `0.4` → ฟ้อง "เขียนทับ `0.1 → 0.4`" ทั้งที่ค่าเดิมยังอยู่
   + ปักธง 2 แถวแทนที่จะเป็น 1 · สลับลำดับแถวแล้วผลเปลี่ยน (order-dependent)
3. ปักธงแต่ไม่เขียน `reason` → `ResultRow.tsx:27` โชว์ `<small>` ว่าง แล้วตกไปใช้ title fallback
   "ค่ามาจากการกู้/อ่านคอลัมน์ใหม่" ซึ่ง**ผิดสำหรับกรณีเขียนทับ** (ไม่มีการกู้ — OCR 2 รอบอ่านเลขไม่ตรงกัน)
4. `reconcileDupontSpecs` (`spec-column-recovery.ts`) เป็น clear-only อีกชั้นที่อยู่หลัง helper → ล้างธงเหนียวได้
   (1F1710 p4 ยิง HQ challenger + ติด `specDupont` + `dupont-xpage` ทำงานจริงในรันนี้ = ถึงได้จริง)

### gate
| ชุด | PASS | FAIL | SKIP | rows | needsReview |
|---|---|---|---|---|---|
| corpus17 baseline (`my_r30-final`) | 129 | 0 | 11 | 140 | 3 |
| **corpus17 ROUND 32** | **128** | **0** | **10** | **138** | **11** |
| 10 ใบหน้างาน baseline | 76 | 1 | 24 | 101 | 26 |
| **10 ใบหน้างาน ROUND 32** | **76** | **1** | **24** | **101** | **28** |

corpus ออก **128P/138 rows = สถานะที่ถูกต้องอันที่สองของคลัง** (ต่างจาก 129P/140 เฉพาะ `1F1710` p4 =
LLM drift เดิมตั้งแต่ ROUND 16 ห้ามนับเป็น regression) · `diff` กับ baseline **ขยับแค่ `⚑` + ข้อความ `reason`
ที่เพิ่งเพิ่ม ไม่มีบรรทัดไหนค่าหรือ verdict เปลี่ยน** (เขียน prediction ข้อนี้ไว้ก่อนรัน: ไม่แตะ `passCount`/
`gridBeatsFlat`/`preservesPasses` → win/lose ขยับไม่ได้) · `npx tsc -p .` = 0 · unit **20 suite** exit 0 ทุกตัว

amber ที่เพิ่มอยู่บน **หน้าที่ HQ ชนะเท่านั้น**: `RI-015` 2→7 · `PR1950W_4063` p2 0→1 · `4A` 0→2 ·
หน้างาน `FRICSTAR` +1 · `TAIHEIYO` +1 — **6 หน้าที่ grid structural ชนะไม่ขยับแม้แถวเดียว**
(ไม่ย้อนรอย "ธงเฟ้อ" ที่ ROUND 22 ถอดออกไป)

### เคสจริงในคลัง = ราคาของการปิดช่องนี้
```
[hq-ocr] ⚠ HQ เขียนเลขทับแถวที่ best ผ่านอยู่แล้ว —
Equilibrium Water Capacity: 26.8|23.6| → 26.8|23.5| (ค่า|min|max)
```
`4A`: ค่าผลเท่ากัน (26.8) แต่ขอบล่างเกณฑ์ต่าง — mobile อ่าน `≥23.6`, v5 อ่าน `≥23.5` → PASS ทั้งสองทาง
แต่เกณฑ์คนละตัว = คนต้องเห็น. **1 แถวจริงในคลัง 17 ใบ** (ไม่ใช่ 0 แต่ก็ไม่ใช่ 22 อย่างที่รอบแรกหลอกตา)
★ ยิงติดของจริงบนใบใหม่ด้วย: `Copper Fiber` p2 `Thickness` = `0.09 → 0.08` (ระบบหยิบค่า sample แทนค่าเฉลี่ย
ที่ใบสั่งให้ใช้) — เคสที่คลัง 17 ใบไม่เคยยิงเลย

### gate ตัวจริงไม่ใช่ corpus
คลังยิง challenger ชนะแค่ 9 ครั้ง และเคส "สลับค่า"/"ชื่อซ้ำ"/"ค่าว่าง+เกณฑ์ซ้ำ" ไม่เคยเกิดเลย →
`keep-best-flagging.test.ts` (15 เคส / 40 checks) เป็นด่านเดียวที่มองเห็นของที่แก้: ชื่อตรงค่าต่าง
spatial/**structural** → amber · spec สะกดต่างขอบเท่ากัน → ไม่ amber · ขอบเปลี่ยนจริง → amber ·
แถวใหม่ structural มีขอบ → เขียว (เดิมต้องอยู่) · **สองแถวสลับค่ากัน → amber ทั้งคู่** ·
**ชื่อซ้ำ 2 ทิศทาง → ผลเท่ากัน ไม่ฟ้องเขียนทับ** · **ค่าว่าง+เกณฑ์ซ้ำ → ห้ามยืนยันข้ามแถว** ·
`reason` ไม่ว่างและไม่ทับของเดิม

### ตัดสินใจไว้ (ไม่ทำ)
- `preservesPasses` **ไม่แตะ** — reviewer เสนอรวมเป็น matcher ตัวเดียวกับ `flagChallengerPasses` แต่มันตัดสิน
  win/lose ถ้าแก้คลังขยับได้ · ทิศที่ไม่ตรงกันให้ผลฝั่งปลอดภัยเสมอ (gate ว่าผ่าน แต่ flag ว่าต้องตรวจ)
- ยังไม่สืบทอด amber ของ incumbent มาให้ challenger ที่อ่านค่าตรงกัน (ถือว่ายืนยันกันเอง) — รอบนี้ไม่มี `⚑` หายจริง

### ของค้างที่เจอระหว่างทาง (ไม่ใช่ของรอบนี้)
- **daemon ตายกลางรัน** `OSError: [WinError 10055] An operation on a socket could not be performed because
  the system lacked sufficient buffer space or because a queue was full` ที่ `ocr_server.py:209` `srv.serve_forever()`
  → ไฟล์ที่เหลือได้ `OCR_DAEMON_DOWN` (ตามดีไซน์ ROUND 23) รอบนั้นขาด `4A` ไป 4P/1S พอดี **ไม่ใช่ regression**
  ตระกูลเดียวกับ `bad allocation` ของ ROUND 31 (เครื่องตึง) แต่คนละ resource — socket buffer ไม่ใช่ heap
  ยังไม่มี health-watch/auto-restart

### ยังไม่ทำ
A5 รวมชื่อแถวที่ OCR ตัด · A4 header-driven parser (จะได้ lot ของ RB220 มาด้วย)

## ROUND 33 (2026-09-10) — เกรด 13 ใบใหม่จากหน้างานทีละแถว แล้วปิดทุกช่องที่เจอ

หน้างานส่งมาอีก 13 ใบ (`coa3-20260909T103756Z-1-001.zip` → ก็อปรวมใน `new format` = 23 ใบ)
9 ใบเป็นวัสดุที่คลังไม่เคยมี · เกรดด้วยวิธี ROUND 27: render ทุกหน้าเป็น PNG อ่านด้วยตา **บันทึก
ground truth ครบ 135 แถวก่อนเปิดผลรัน** (กัน anchoring)

### คะแนนก่อนแก้ (โค้ด ROUND 32)
`64P/6F/44S` จาก 114 แถว — **ตัดสินถูก 64/70 = 91% · ครอบคลุมแค่ 70/135** · deceptive PASS 1 · FAIL ปลอม 5

2 บั๊กที่ต้องปิด:
1. **`(NYGLOS8)` FAIL ปลอม 5 จาก 6 แถว** — ใบวางหัวตาราง `Lower limit | Upper limit | Analysis Results`
   (เกณฑ์มาก่อนผล) → LLM หยิบเลขตัวแรกเป็นค่าผล: `result=10.7 spec=12.5~14.0` ทั้งที่ใบเขียน
   เกณฑ์ 10.7–14.0 ผล 12.5. ใบนี้ผ่านหมดทุกแถวแต่ระบบฟ้อง FAIL
2. **`Mica 200-S` deceptive PASS** — ตาราง 2 ล็อต ชื่อแถวหลุดมาเป็นหัวคอลัมน์แล้วค่าเลื่อน:
   `Humidity result=26 spec=15~30` ทั้งที่ Humidity จริง = 0.19 เกณฑ์ 0.00~0.50 (26 คือค่า -200/+325
   ของล็อต 854416 · 15~30 คือเกณฑ์ -100/+200) — **ทั้งค่าและเกณฑ์ผิดแต่ขึ้นเขียว**
   ★ ใบพี่น้อง `325-HK` layout เดียวกันอ่านถูก เพราะเป็น text-layer ส่วน Mica เป็นสแกน ★

### วัดก่อนเขียนโค้ด — dump ข้อความที่ OCR อ่านได้ (ไม่เรียก LLM)
`npx ts-node _validate/_dump-text.ts <dir> <out>` → **OCR อ่านถูกทั้ง 13 ใบ** ทุกบั๊กอยู่ขั้นแปลความหมาย
ไม่ใช่ขั้นอ่าน. ตัดสมมติฐาน "ต้องปรับ OCR/เปลี่ยน engine" ทิ้งได้ตั้งแต่ยังไม่แตะโค้ด

### สิ่งที่แก้
**`spec-normalizer.ts`** (ทั้ง 4 ข้อเจอจาก dump ของจริง):
- คำนำหน้าติดเลข `Max0.20` / `Min99.30` — ใบญี่ปุ่นพิมพ์แบบนี้ทั้งคอลัมน์ (PAG-80/Kemolit)
- ★ ตัวตัดหน่วยลบคำว่า `min` ทิ้งเพราะ pattern เดิมมองว่าเป็น "นาที" → `Min99.30` เหลือ `99.30`
  = ทิศหาย → SKIP ★ นี่คือต้นเหตุจริงที่ `80.00MIN`/`94.00MIN` ของ Kemolit SKIP มาตลอดตั้งแต่ ROUND 27
  → แยก `stripUnitsKeepBounds` ใช้เฉพาะ branch ขอบล่าง
- OCR แทรกช่องว่างหลังจุดทศนิยม `Max0. 50` → ต่อคืนก่อน parse
- ป้ายชื่อย่อยนำหน้าเกณฑ์ `D50 6.5±1.0` / `SiO2+CaO 94以上` (KGP-H65 เขียนชื่อหลักคอลัมน์ซ้าย
  ชื่อย่อยอยู่ในช่องเกณฑ์) → ตัดป้ายแล้ว parse ใหม่ **เป็น branch สุดท้ายเท่านั้น** ไม่งั้น `Max 0.5`
  จะโดนตัดเหลือ `0.5` = ทิศหาย · แก้บั๊กจริงด้วย: `6.5±1.0` เคยกลายเป็นช่วง `6.5~1.0` (min>max)

**โมดูลใหม่ 4 ตัว** (ทุกตัว abstain เมื่อไม่ใช่ layout นั้น + มี unit test พินการ abstain):
- `limit-columns-recovery.ts` — หัวตารางบอกว่าเกณฑ์มาก่อนผล → อ่าน 3 เลขแรกเป็น min|max|result
- ★ PAG-80 (เกณฑ์ merge cell คร่อม 2 แถว ของผลรวม 11.9+16.8 vs 20~30) **ไม่ได้เขียนโมดูลใหม่** —
  `fail-guard` ที่มีอยู่แล้ว (downgrade FAIL→SKIP เมื่อ spec/result ไม่อยู่บรรทัด OCR เดียวกัน) จับได้เอง:
  `[fail-guard] downgrade 3 FAIL→SKIP (column collapse): -300+250μm, -250+180μm, -180+150μm` → 5P/3S
- `lot-row-table-recovery.ts` — ตารางหลายล็อต (`Specifications` บรรทัดเดียว + `LOT No.` บรรทัดละล็อต)
  และตารางแนวนอนที่สรุปด้วยแถว `平均` → สร้าง items เองตามตำแหน่งช่อง
- `paren-spec-recovery.ts` — ใบที่วัด 3 ครั้ง + ช่อง Average + เกณฑ์ในวงเล็บท้ายบรรทัด (Copper Fiber)
  → ค่าที่ใช้ตัดสินคือช่องก่อนวงเล็บ ไม่ใช่ค่าวัดครั้งสุดท้าย
- `bound-cell-recovery.ts` — OCR แยกคำ `Max`/`Min` เป็นช่องลอย (`0.020 | Max | 0.007`) → ต่อกลับเข้าเกณฑ์

**`coa-pipeline.ts`** — ต่อทั้ง 5 โมดูล · ทุกแถวที่ระบบสร้างเองปัก `needsReview` + เขียน `reason` ว่าอ่านมาจากไหน

★ ลำดับสำคัญ ★ 2 โมดูลที่สร้าง items เองต้องรัน**หลัง** `dropUngroundedItems`/`filterMetadataRows` —
แถวที่สร้างเองมีชื่อ (จากหัวตาราง) กับค่า (จากบรรทัดล็อต) คนละบรรทัด → anti-hallucination filter ตัดทิ้งหมด

★ กับดักที่เกือบพลาด ★ ถ้าแก้ "OCR แทรกช่องว่าง" อย่างเดียวโดยไม่มี `merged-spec-guard` →
`20. 0~30. 0` จะ parse ได้แล้วเอา 16.8 ไปเทียบ = **สร้าง FAIL ปลอม 2 แถวใหม่** แทนที่จะได้ recall

### คะแนนหลังแก้ (เทียบ ground truth ทีละแถว)
| | ก่อน (ROUND 32) | **หลัง (ROUND 33)** |
|---|---|---|
| ตัดสินถูก / ที่ตัดสิน | 64/70 = 91% | **106/106 = 100%** |
| ครอบคลุม (จาก 119 แถวที่ใบมีเกณฑ์) | 70/119 = 59% | **106/119 = 89%** |
| deceptive PASS | 1 | **0** |
| FAIL ปลอม | 5 | **0** |

รายไฟล์ที่ขยับ: `(NYGLOS8)` 0P/5F → **5P/0F** · `KGP-H65` 3P/4S → **7P** · `Kemolit` 8P → **10P/1F**
(1F = ใบพิมพ์เกณฑ์ `<0.0` เอง ของค้างเดิม) · `Mica 200-S` 1P (deceptive) → **12P/2S ครบ 2 ล็อต**
· `PAG-80` 0P/8S → **5P/3S** · `Copper Fiber` 3P+4P → **8P+8P** · `Zirconium` 3P+3P → **5P+5P**
· `VERMICULITE` 8P (ค่า sample 1) → **9P (ค่าจากแถว 平均 ตามที่ใบสั่ง)**

### gate
| ชุด | PASS | FAIL | SKIP | rows |
|---|---|---|---|---|
| corpus17 | **128** | **0** | **10** | **138** |
| 10 ใบหน้างานเดิม | **76** | **1** | **24** | **101** (เท่า baseline เป๊ะ) |
| 13 ใบใหม่ | 105 | 1 | 19 | 125 |

corpus ออกสถานะที่ถูกต้องอันที่สอง (ต่างจาก 129P/140 เฉพาะ `1F1710` p4 = LLM drift ตั้งแต่ ROUND 16)
· 0 deceptive · `npx tsc -p .` = 0 · unit **25 suite** exit 0 ทุกตัว (เพิ่ม 5 ไฟล์)
· `KGP-H65` ในคลังเปลี่ยนจาก `spec=50` (เลขเปล่า ทิศมาจากคอลัมน์) เป็น `spec=D90 50以下` (มีทิศจริงในช่อง) = ถูกขึ้น

### เรื่องภาษา (ตอบคำถาม user — สแกน dict ของ engine ที่ลงจริง)
40 ไฟล์ที่มี: **text-layer 21 · สแกน 19**
- `ppocr_keys_v1.txt` (v4 mobile, default): CJK 6,280 · latin 121 · **คานะ 5 ตัว** · **ไทย 0**
- `ppocrv5_dict.txt` (v5 server, HQ): CJK 15,909 · **คานะ 239** · **ไทย 0**
→ ไฟล์ digital อ่านได้ทุกภาษารวมไทย (ไม่ผ่าน OCR) · ไฟล์สแกน: จีน/คันจิ/อังกฤษ OK · คานะต้องพึ่ง HQ
· **ไทยแบบสแกนอ่านไม่ได้เลย** — ถ้าหน้างานส่งมาต้องเพิ่ม rec model (`rapidocr` มี `LangRec.TH`) แล้วแพ็กลง bundle offline
- เจอของแถม: `Mica 200-S` มี text-layer 609 ตัวแต่ **535 ตัวเป็นคันจิบนใบภาษาอังกฤษ** = ชั้น text เป็นขยะ
  จากเครื่องสแกน (เหมือน `Zirconium` 834 ตัว) → guard ของ ROUND 26 เด้งไป OCR ถูกต้องแล้ว

### ยังไม่ทำ (13 แถวที่เหลือ — honest SKIP ทั้งหมด ไม่ใช่คำตอบผิด)
- `Tin Powder AT-Sn` **ไม่ออกแถวเลย** — แนวนอน + แถว `Specifications` อยู่**ใต้**แถวค่า + เกณฑ์ 3 ช่อง
  ต่อ 4 คอลัมน์ (D10 ไม่มีเกณฑ์) ต้อง align จากขวา
- `325-HK` ล็อตที่ 2 (6 แถว) — text-layer เรียงกระจัดกระจาย จำนวนช่องไม่ตรง → `lot-row-table` ถอยเอง (ถูกแล้ว)
- `Copper Fiber` แถว `1400μm on` ×2 — เกณฑ์ `(0)` กับผล `0` ทำ guard เข้าใจว่าอ่านสลับ
- `VERMICULITE` แถว `12` (เกณฑ์ 0 ผล 0) และ `total` (100%) · `Kemolit` `BulkDensity(Loose)` ค่าตรงขอบ
- `PR3200M` p2 `Flow rate` OCR อ่านค่าไม่ออก · `NYGLOS8` `Air Jet Sieve` เกณฑ์ `0~0`
- A5 รวมชื่อแถวที่ OCR ตัด · A4 header-driven parser

## ROUND 34 (2026-09-10) — ปิด 13 แถวที่เหลือของ 23 ใบ: ออก 118P/0F/17S = ตรง ground truth ทุกแถว

ROUND 33 จบที่ 106/119 = 89% (13 แถวเป็น honest SKIP + `Tin Powder` ไม่ออกแถวเลย) รอบนี้ไล่ปิดทั้งหมด
โดยแยก "แก้ guard" (blast radius ทั้งคลัง) ออกจาก "เขียนโมดูล" (abstain เอง) แล้ว**รัน corpus คั่นกลาง**
เพื่อให้ regression ชี้กลับไปที่ 2 บรรทัดได้ ไม่ใช่ 6 ไฟล์

### ต้นเหตุที่เหลือ แยกเป็น 4 กลุ่ม (เจอจาก log จริง ไม่ใช่เดา)
1. **ค่าผลเท่าเกณฑ์เป๊ะ → ด่านฟ้องว่าน่าสงสัย** ทั้งที่ใบเขียนเกณฑ์ `0` / `100%` ไว้จริง
   (`NYGLOS8` ตะแกรง `0~0` · `Copper Fiber` `1400μm on` เกณฑ์ `(0)` ×2 หน้า · `VERMICULITE` แถว `12` + `total`)
   ★ ด่านนี้มีไว้กันของจริง ★ `FC-250-1500` ไม่มีคอลัมน์เกณฑ์เลย LLM คัดลอกค่าผลมาเป็นเกณฑ์ 9 แถว
   ถ้าผ่อนด่านแบบหยาบ = **9 deceptive PASS** ที่อ่านเหมือน "+9 recall"
2. **ใบพิมพ์เกณฑ์ที่ไม่มีค่าใดผ่านได้** — Kemolit `Retention on 60 mesh` เกณฑ์ `<0.0` ผล `0.000`
   → ระบบฟ้อง FAIL ทั้งที่ความผิดอยู่บนใบ (ใบเดียวกันหน้างานส่งมา 2 ชื่อไฟล์ = FAIL 2 ใบ ปัญหาเดียว)
3. **`Tin Powder` ไม่ออกแถวเลย** — แนวนอน + แถว `Specifications` อยู่**ใต้**แถวค่า + เกณฑ์ 3 ช่องต่อ 4 คอลัมน์
4. **`325-HK` ได้ล็อตเดียว และป้ายล็อตผิด** — grid อ่านตารางมาครบ 2 ล็อตแล้ว (`LOT NO. 850993 | LOT NO. 850997`)
   แต่ `parseStructuralGrid` เลือกคอลัมน์ค่าผลคอลัมน์เดียว (ขวาสุด = 850997) ส่วนหัวรายงานหยิบเลขล็อตตัวแรก
   (850993) → **ค่ากับป้ายคนละล็อต** = ผิดแบบเนียนกว่าหายทั้งแถว

### สิ่งที่แก้
**ธง provenance `specFromCell`** (`coa-evaluator.ts` + `ollama-coa.service.ts`) — โมดูล structural ทั้ง 4 ตัว
(`limit-columns` / `paren-spec` / `lot-row-table` / `bound-cell` เฉพาะ branch ที่เขียนเกณฑ์เอง) ติดธงว่า
"เกณฑ์อ่านมาจากช่องของตัวเองบนใบ" → ด่าน bare-eq + ด่านขอบ (เฉพาะ `min==max`) ปล่อยผ่านเมื่อ**ค่าผลเท่าเกณฑ์เป๊ะ**
- เหตุผลที่ปล่อยได้: ค่าเท่าเกณฑ์ = ผ่านทุกการตีความทิศ (`≤` / `≥` / `=`) ไม่ต้องรู้ทิศก็ตัดสินได้
- ยังปัก `needsReview` ทุกแถวที่ปล่อยผ่าน (PASS+amber ไม่ใช่เขียวเงียบ)
- ★ ไม่แตะขอบช่วง `min≠max` ★ — Kemolit `BulkDensity 0.500` บน `0.45~0.50` ยัง SKIP ตามที่ acc8e0a ตั้งใจ
- ธงเป็นฟิลด์จริง ไม่ใช่การ match ข้อความใน `reason` (reason ต่อกันด้วย ` · ` หลายชั้น — match แล้วเน่ารอบหน้า)

**เกณฑ์ที่ไม่มีค่าใดผ่านได้** (`coa-evaluator.ts`) — `op=lt` + ขอบ `≤0` + ผลไม่ติดลบ → SKIP พร้อมอ้างเกณฑ์ที่พิมพ์
(`ใบพิมพ์เกณฑ์ <0.0 — ไม่มีค่าใดผ่านได้`) ไม่ใช่ FAIL · ขอบ strict ปกติ (`<5` ผล 7) ยัง FAIL ได้ตามเดิม

**`spec-row-below-recovery.ts` (ใหม่)** — แถวเกณฑ์อยู่ใต้แถวค่า: **ยึดขวาทั้งสองฝั่ง** (เกณฑ์ที่ขาดคือคอลัมน์ซ้าย
ที่ใบไม่ได้กำหนด → `D10` ออกเป็น SKIP ตามใบ) · ★ ความน่าเชื่อของค่าใช้ **veto ไม่ใช่ select** ★ — เกณฑ์ที่จับคู่แล้ว
ขัดกับค่า = อ่านตำแหน่งผิด → **ถอยทั้งใบ** ห้ามลองสลับแนวให้ค่าเข้าเกณฑ์ (นั่นคือวงจร batch-as-spec ที่เคยพลาด)

**`parse-structural-grid.ts`** — แยก loop ออกเป็น `emitGridItems(…, resultCol, namePrefix)` แล้วเรียกซ้ำคอลัมน์ละล็อต
เมื่อหัวตารางมี ≥2 คอลัมน์ `LOT NO. x` → ชื่อแถวติดป้ายล็อตของตัวเอง (`LOT No.850993 Sieve Analysis +100`)
ล็อตเดียว = เดินทางเดิมเป๊ะ (sentinel pin ไว้ใน test)

### gate — แยก 2 ช่วงตามที่ตั้งใจ
| ชุด | baseline (r33d) | **ROUND 34** |
|---|---|---|
| corpus17 **หลังแก้ guard เท่านั้น** | 128P/0F/10S rows=138 | **128P/0F/10S rows=138 — diff ว่างเปล่า** |
| corpus17 หลังเขียนโมดูล (ก่อน reviewer fix) | 128P/0F/10S rows=138 | 129P/0F/11S rows=140 |
| **corpus17 ตัวที่นับ (หลัง reviewer fix)** | 128P/0F/10S rows=138 | **128P/0F/10S rows=138 — diff กับรอบ guard ว่างเปล่า** |
| 13 ใบใหม่ | 105P/1F/19S rows=125 | **118P/0F/17S rows=135** |
| 10 ใบหน้างานเดิม | 76P/1F/24S rows=101 | **76P/0F/25S rows=101** |
| 23 ใบรวม | 181P/2F/43S rows=226 | **194P/0F/42S rows=236** |

คลังมี 2 สถานะถูกต้อง (129P/140 และ 128P/138) ต่างกันเฉพาะ `1F1710` p4 = LLM drift ตั้งแต่ ROUND 16 —
รอบนี้ออกทั้ง 2 สถานะในวันเดียว (129P ก่อน reviewer fix · 128P หลัง) **และ diff ต่อบรรทัดกับรอบ guard-only
ว่างเปล่าทั้งคู่** = โค้ด ROUND 34 ไม่แตะคลังจริง · `npx tsc -p .` = 0 · unit **26 suite** exit 0 ทุกตัว ·
3 รันสุดท้าย `bad allocation` / `[retry]` / `OCR_DAEMON_DOWN` = **0 ครั้ง** (ผลไม่ได้มาจากภาพย่อ)

diff ผล 23 ใบ ก่อน↔หลัง reviewer fix = **ขยับแถวเดียวและเป็นข้อความเหตุผล** (`+150μm` เกณฑ์ที่ OCR อ่านเป็น
`一 0%`: เดิมผ่าน branch ตัดป้ายเป็น `eq 0` แล้วโดนด่าน bare-eq ฟ้อง "อาจอ่านสลับ" + ปักธง · ตอนนี้ตอบตรงๆ
ว่าอ่านเกณฑ์ไม่ออก ไม่ต้องปักธง) — verdict SKIP เท่าเดิม ไม่มีแถวไหนเปลี่ยน PASS/FAIL

### opus-reviewer จับ 2 Major ที่ gate มองไม่เห็น (รอบที่ 5 ติดกัน) — แก้แล้วทั้งคู่
1. **`parse-structural-grid` หลายล็อต: ค่าของล็อตข้างๆ กลายเป็นเกณฑ์ได้** — loop หาเกณฑ์ข้ามแค่ `resultCol`
   ของตัวเอง ไม่ข้ามคอลัมน์ล็อตอื่น → ใบที่เรียง `Item | LOT A | LOT B | Specifications` + ค่าผลทรงขอบ
   (`<0.010` ซึ่ง corpus มีจริง เช่น RI-015 Sb `<15`) → แถวล็อต A ได้เกณฑ์เป็นค่าของล็อต B = **เทียบค่ากับค่า
   แล้วขึ้นเขียวล้วนไม่มีธง** (path structural ไม่ปัก amber) → ส่ง set คอลัมน์ล็อตอื่นเข้า `emitGridItems`
   แล้วข้ามทั้งใน spec scan · `resolveSpecCol` · การหา mesh/method/unit
2. **branch ตัดป้ายใน `spec-normalizer` ทำ metadata กลายเป็นเกณฑ์** — probe ของจริง: `"Lot 240521"` → `eq 240521`,
   `"Date 2026"` → `eq 2026`, `"Mesh 100"` → `eq 100`. พิษจริงไม่ใช่ธงเฟ้อ แต่คือ **ด่าน abstain ของโมดูล
   structural พัง** — `lot-row-table.isSpecCell` / `spec-row-below` ใช้ `normalizeSpec != null` เป็นตัวตัดสินว่า
   "ช่องนี้เป็นเกณฑ์ไหม" → ช่องขยะถูกนับเป็นเกณฑ์ → `specs[]` มีของปลอมแทรก **โดยจำนวนช่องยังเท่ากันพอดี**
   = จับคู่เกณฑ์↔ค่าเลื่อนทั้งแถว (รูที่ธง `specFromCell` ทำให้อันตรายขึ้น) → รับเฉพาะส่วนที่เหลือที่มีทิศ/เป็นช่วง
   (`op !== eq/approx`) · fixture ROUND 33 ของ branch นี้มีทิศหมด ไม่เสียเคสไหน

ข้อรองที่แก้ตามด้วย: `spec-row-below` บังคับ **ติดกัน 3 บรรทัด** (ป้าย/ค่า/เกณฑ์) เดิมไล่ขึ้นไปจนหัวไฟล์
แล้วคว้าบรรทัด date/phone มาเป็นแถวค่าได้ · `<0.0` guard เป็น `value === 0` (เดิม `<= 0` ทำให้ `<-5` ผล 3
ซึ่ง −6 ผ่านได้จริง กลายเป็น SKIP ทั้งที่ควร FAIL) · multi-lot emit gate ด้วย `source === "structural"`
(scanned-vector วาง cell จาก token OCR ที่เลื่อนได้ → ค่าข้ามล็อต + keep-best นับแถวที่เบิ้ลเป็นชนะฟรี) ·
ถอนธง `specFromCell` ออกจาก `bound-cell-recovery` (วันนี้ inert เพราะ path นั้นผลิต `le/ge` เสมอ แต่ provenance
อ่อนสุด — หยิบบรรทัดแรกในหน้าที่ชื่อ match) + ล็อก contract ที่ field: **ตั้งได้เฉพาะโมดูลที่นับช่องแล้วถอย** ·
รายงานหลายล็อตไม่ประกาศเลขล็อตที่หัวอีก (`lotNo: null`) — เดิมโชว์ 850993 ทั้งที่ครึ่งหนึ่งเป็น 850997
= จะกลายเป็นแถว DB ผิดล็อตทันทีที่เปิด persist

### เทียบ ground truth (GT13.md — อ่านจากใบจริงก่อนเปิดผลรัน)
| | ROUND 32 | ROUND 33 | **ROUND 34** |
|---|---|---|---|
| ตัดสินถูก / ที่ตัดสิน | 64/70 = 91% | 106/106 = 100% | **118/118 = 100%** |
| ครอบคลุม (จาก 119 แถวที่ใบมีเกณฑ์) | 59% | 89% | **118/119 = 99%** |
| deceptive PASS | 1 | 0 | **0** |
| FAIL ปลอม | 5 | 1 | **0** |

GT คาด `118 PASS · 16 honest SKIP · 1 แถวเกณฑ์บนใบพัง` = **ระบบออก 118P/17S ตรงทุกแถว**
รายไฟล์ที่ขยับรอบนี้: `NYGLOS8` 5P/1S→**6P** · `325-HK` 5P/1S→**10P/2S ครบ 2 ล็อต** ·
`Copper Fiber` 8P/2S→**9P/1S** ×2 หน้า · `Tin Powder` 0 แถว→**3P/1S** · `VERMICULITE` 9P/2S→**11P** ·
`Kemolit` 2 ไฟล์ 1F ละใบ→**0F** (SKIP พร้อมเหตุผลว่าเกณฑ์บนใบพิมพ์ `<0.0`)

### ด่านที่เป็นตัวตัดสินจริง ไม่ใช่ corpus
`spec-cell-equality.test.ts` (12 เคส) — คู่ที่แยกของจริงออกจาก deceptive:
`{ค่า == เกณฑ์, ไม่มีที่มา}` → SKIP (FC-250-1500) · `{ค่า == เกณฑ์, เกณฑ์มาจากช่องบนใบ}` → PASS+amber
+ ขอบช่วง `min≠max` ยัง SKIP · เลขเปล่าที่ค่าไม่เท่ากัน ยัง SKIP · `<5` ผล 7 ยัง FAIL ·
ด่านระดับใบ `suppressCopiedSpec` ยังทำงาน (ทุกแถว spec==result → 0 PASS)
`spec-row-below-recovery.test.ts` (12 เคส) — abstain 5 ทาง: ไม่มีแถวเกณฑ์ · เกณฑ์เกินจำนวนป้าย ·
เกณฑ์ช่องเดียว · เกณฑ์อ่านไม่ออก · **ค่าหลุดเกณฑ์** (เคสสุดท้ายคือตัวกัน plausibility-select)

### แก้ doc ที่อ้างของที่ไม่มี
entry ROUND 33 เขียนว่ามี `merged-spec-guard.ts` (ตัดสินเกณฑ์ merge cell จากผลบวก) — **ไฟล์นั้นไม่มีในโค้ดจริง**
ของจริงคือ `fail-guard` ที่มีอยู่แล้วจับ PAG-80 ได้เอง (`downgrade 3 FAIL→SKIP (column collapse)`) → แก้ entry แล้ว

### ยังไม่ทำ (เหลือ 1 แถวที่ระบบตัดสินไม่ได้ + ของคนละเรื่อง)
- `Kemolit Retention on 60 mesh` เกณฑ์ `<0.0` — แก้ที่โค้ดไม่ได้ ต้องให้คนอ่านใบ (ตอนนี้ SKIP + บอกเหตุผลตรงๆ)
- `PR3200M` p2 `Flow rate` OCR อ่านค่าไม่ออกจริง (ทั้ง default และ HQ) · `TAIHEIYO` แถว `Density(kg/1)` เป็นเศษ
  ชื่อที่ OCR ตัดครึ่ง (= งาน A5 รวมชื่อแถว) · `Kemolit BulkDensity(Loose)` ค่าตรงขอบ = ด่านขอบตั้งใจให้คนตรวจ
- ยังไม่รู้ว่าทำไมใบ Kemolit ใบเดียวกัน 2 ชื่อไฟล์อ่านเกณฑ์แถวนั้นไม่เหมือนกัน (11P/1S vs 10P/2S) — ไม่ใช่ของรอบนี้
- **`parenSpec` เก็บแถวข้อความผิดแกน** (`coa-pipeline.ts` `filter(i => !/\d/.test(result))`) — แถวข้อความที่ผลมีตัวเลข
  (`K2Ti6O13`) ถูกทิ้ง ส่วนแถวขยะที่ไม่มีเลขถูกเก็บ → Copper Fiber ออก 10 แถว ขณะใบมี 11 · ของค้างก่อน ROUND 34
  ควรเก็บ "แถวที่ชื่อไม่ซ้ำกับ `parenSpec.items`" แทน (reviewer F8)
- A5 รวมชื่อแถวที่ OCR ตัด · A4 header-driven parser · ~~ไทยแบบสแกน~~ → ทำแล้วใน ROUND 35 (engine ตัวที่ 3 dict ไทย)

## ROUND 35 (2026-09-10) — ใบไทยแบบสแกน: เพิ่มเครื่องอ่านตัวที่ 3 ที่มี dict ภาษาไทย

ROUND 34 ปิดท้ายไว้ว่า "ไทยแบบสแกนอ่านไม่ได้เลย — dict ของ engine ทั้ง 2 ตัวมีไทย 0 ตัว" รอบนี้ปิดข้อนั้น

### อาการจริงที่ทำให้ trigger เดิมใช้ไม่ได้
ใบไทยสแกนเข้า engine default → **ตัวเลขกับ spec อ่านถูกหมด แต่คอลัมน์ชื่อรายการหายเกลี้ยง**
(แถวออกมาเป็น `%  |  ASTM D280  |  ≤ 0.50  |  0.32` ไม่มีชื่อ) → LLM แต่งชื่อ/เลื่อนคอลัมน์ →
`coa-grounding` ตัดทิ้งเป็น hallucination → **0 PASS โดยที่ไม่มีแถวไหนเป็น SKIP**
⇒ ด่านของ HQ challenger (`best.summary.skip > 0`) ไม่มีทางยิง. ปัญหาใบไทยไม่ได้มาในรูป verdict
มันมาในรูป "ข้อมูลหายไปก่อนถึงชั้น verdict" — ต้องมีด่านคนละแบบ

### สิ่งที่แก้
**`ocr-py/ocr_server.py` — engine registry แทน global 2 ตัว** (`VARIANTS` + `get_engine(variant)` +
`pick_variant(req)`) : `default` (mobile/PP-OCRv4) · `hq` (server/PP-OCRv5) · **`th` (mobile/PP-OCRv5
+ rec dict ไทย)**. สัญญาบน wire เพิ่ม field `lang`, `hq` เดิมยังรับอยู่ (back-compat)
- dict ของ `th`: 526 ตัว = ไทย 83 · เลขอารบิก 10 · ละติน 53 · `% ( ) , - . / < = > ~ ± ≤ ≥` ครบ
- `th` **lazy เสมอ ไม่มี preload** — RAM เครื่อง gate ตึงอยู่แล้ว (ROUND 31 `bad allocation`)
- เงื่อนไข retry ตอนจอง memory ไม่ได้ ขยายจาก `hq` เป็น `variant != "default"` — challenger ทุกตัว
  มี best เป็นพื้น อ่านแย่ลงก็แพ้ไปเฉยๆ ส่วน default คือแหล่งข้อมูลเดียวของหน้า ต้องดังตาม `OCR_DAEMON_DOWN`

**`rapidocr.service.ts` — `hq: boolean` → `variant: OcrVariant`** (`"default" | "hq" | "th"`) ร้อยผ่าน
`ocrTokens` / `correctRotation` / `getProcessedTokens` / `extractTextBoth`. compiler บังคับให้ทุก call site
เปลี่ยนตาม (`true` ไม่ assign เข้า union) — ไม่มีจุดไหนตกหล่นเงียบ

**`coa-pipeline.ts:thaiChallenge` — ★ ด่านเป็น "เห็นอักษรไทยไหม" ไม่ใช่ "มี SKIP ไหม" ★**
ยิงทุกหน้าที่เป็นสแกน แล้ว **ทิ้งผลทันทีถ้านับอักษรไทยได้ < 20 ตัว (`COA_OCR_TH_MIN_CHARS`)**
- เป็นสัญญาณที่ engine default **ปลอมไม่ได้** เพราะ dict มันไม่มีอักษรไทยสักตัว → ใบอังกฤษ/ญี่ปุ่น/จีน
  ตกด่านนี้ **ก่อนถึง LLM** = คลังเดิมไม่ขยับโดยโครงสร้าง ไม่ใช่โดยเลข keep-best
- ผ่านด่านแล้วเดินท่อเดียวกับ HQ เป๊ะ: `runFlatGridBest` → `gridBeatsFlat` → `flagChallengerPasses`
  (best เป็นพื้น · 0 FAIL · PASS เดิมครบ · เลขที่ best ยืนยันไม่ได้ = amber)
- **วางก่อน HQ และชนะแล้ว return เลย** — HQ dict ก็ไม่มีไทย ยิงต่อก็แพ้ ไม่ต้องเผาอีก ~35s

**`headerSink` — ชื่อสินค้า/เลขล็อตต้องมาจากข้อความที่ชนะ** ROUND 30/34 ตั้งใจให้หัวรายงานมีเจ้าของเดียว
คือ `recoverProductLot(pg.text)` ไม่ขึ้นกับว่า candidate ไหนชนะ. บนใบไทยกฎนั้นทำให้ **ได้ null ทั้งคู่**
เพราะ `pg.text` มาจาก engine ที่อ่านไทยไม่ออก → เพิ่ม sink (แบบเดียวกับธง `degraded`) ที่ตั้งค่า
**เฉพาะตอน challenger ไทยชนะ** เท่านั้น → หน้าอื่นทุกหน้าเดินทางเดิมเป๊ะ

**`product-lot-recovery.ts` — ป้ายภาษาไทย** `/ผลิตภัณฑ์$/` `/สินค้า$/` `/วัตถุดิบ$/` (product) ·
`/ล็อต/` `/รุ่นการผลิต/` (lot) + เพิ่มช่วง Unicode ไทยใน `validProduct`
★ เทียบ**ท้ายคำ ไม่ผูกต้นประโยค** ★ — OCR ไทยสลับพยัญชนะตัวหน้าได้จริง (`ชื่อ`→`ซื่อ` เจอในผลรัน)

### gate
| ชุด | baseline ROUND 34 | TH off | TH on (ก่อนแก้ reviewer) | **TH on (ตัวที่นับ)** |
|---|---|---|---|---|
| corpus17 | 128P/0F/10S rows=138 | 128P/0F/10S rows=138 · 335s | 129P/0F/11S rows=140 · 367s | **128P/0F/10S rows=138** · 371s |
| needsReview | — | 11 | 11 | **11** |
| บรรทัด `[th-ocr]` ในล็อก | — | **0** | **0** | **0** |
| `bad allocation` / `[retry]` / `OCR_DAEMON_DOWN` | — | 0 | 0 | **0** |
| daemon ตอบ variant ไม่ตรงที่ขอ | — | — | — | **0** |

รันสุดท้าย (หลังแก้ reviewer ทั้งหมด) **กลับมาเท่า baseline ROUND 34 เป๊ะ และ diff ต่อบรรทัดกับรอบ TH-off ว่างเปล่า**
(ตัวเลขสรุปเท่ากันไม่พอ — PASS→SKIP คู่กับ SKIP→PASS หักล้างกันได้) · **diff บรรทัด `[header]` ก็ว่างเปล่า**
= ป้ายไทยที่เพิ่มใน `product-lot-recovery` (ซึ่งวิ่งทุกหน้าทุกใบ ปิดด้วย `COA_OCR_TH_FALLBACK=false` ไม่ได้) ไม่ขยับหน้าไหนในคลังเลย

**diff ผลต่อบรรทัดระหว่าง 2 รอบแรก = 2 บรรทัด** (`1F1710` p4 `Percent Moisture` PASS + `By: QA Dept.` SKIP)
= LLM drift ตัวเดิมที่ ROUND 34 บันทึกไว้ว่าคลังมี 2 สถานะถูกต้อง ไม่ใช่ผลของโค้ดรอบนี้ —
**ยืนยันด้วย `[th-ocr]` = 0 ทั้งสองรอบ คือ challenger ไทยไม่เคยเข้าไปแตะคลังเลยแม้แต่หน้าเดียว**
(รวม TXAX-A 色相 กับใบญี่ปุ่น 試験成績表 ที่เป็นตัวเสี่ยงว่า rec ไทยจะเดา CJK ออกมาเป็นอักษรไทย)

`npx tsc -p .` backend = 0 · frontend = 0 · unit **26 suite** exit 0 ทุกตัว (product-lot 50 cases)

**ราคาของด่านนี้: +32s / 17 ไฟล์ = +9.6%** (stage `parse` 151→203s เพราะ OCR ไทยถูกเรียกใน processPage)
ปิดด้วย `COA_OCR_TH_FALLBACK=false` ได้ถ้าหน้างานรับไม่ไหว

### ผลกับใบไทยจริง — ★ ยังไม่มีใบจริง ทดสอบด้วยใบสังเคราะห์ ★
ไม่มีใบไทยในคลังเลยสักใบ → สร้างใบขึ้นมาเอง (render ผ่าน Chrome เพราะ PIL บนเครื่องนี้ไม่มี raqm →
วาง vowel/tone ของไทยผิดตำแหน่ง = ได้ภาพที่ไม่ใช่ไทยจริง เสียเวลาไป 2 รอบกับข้อนี้) แล้วยิงผ่าน `runCoaPipeline`:

| | engine default | **challenger ไทย** |
|---|---|---|
| ผล | **0P** / 2S (grounding ตัด 5 แถวที่ LLM แต่งชื่อ) | **7P / 0F / 1S** — ตัดสินถูกทั้ง 7 แถวตาม ground truth |
| ธง | — | ทุกแถว amber (best ยืนยันเลขไม่ได้) |
| product / lot | null / null | `แคลเซียมคาร์บอเนต ชนิดเคลือบผิว` / `TH-260910-01` |

**คุณภาพการอ่านไทย — พูดตรงๆ:** ตัวเลขและ operator (`≤ ≥ ± ~`) อ่าน**เท่ากับ engine default เป๊ะ**
ไม่มีเลขไหนหาย → คำตัดสินไม่ได้ขึ้นกับคุณภาพของชื่อแถว. ส่วนตัวอักษรไทย:
- **ข้อความยาวอ่านดี** — หัวใบ / ชื่อสินค้า / ป้ายเลขล็อต / ชื่อผู้ตรวจ ถูกหมด
- **ช่องสั้นในตารางถูกแค่ ~30%** (2/7 แถวใน e2e · 5/16 ในการ probe คำเดี่ยว) ที่เหลือออกมาเป็น
  อักษรละตินมั่ว (`ความชื้น` → `nCEUMSLURLS`) หรือ LLM หยิบหน่วยมาเป็นชื่อแทน (`μm`, `g/cm3`)
- ทดสอบแล้วว่า **ไม่ใช่ปัญหาความละเอียด** — 1750/2000/2600/3200px ได้ 5/16 เท่ากันทุกขนาด
⇒ สรุปที่ซื่อสัตย์: **"พร้อมลองกับใบไทย ยังไม่ผ่านการพิสูจน์กับกระดาษจริง"** ชื่อแถวที่เพี้ยนคนอ่านออกเองได้
แต่ถ้าหน้างานต้องการชื่อแถวสวย ต้องหา rec ไทยที่ดีกว่า v5-mobile (ยังไม่มีตัว server-tier ของไทย)

### opus-reviewer จับ 2 Blocker + 3 Major ที่ gate มองไม่เห็น (รอบที่ 6 ติดกัน) — แก้แล้วทั้งหมด

**B1 · ด่านอักษรไทย "fail open" ถ้า env พิมพ์ผิด** `Number(process.env.X ?? 20)` — `??` จับแค่ undefined
→ `COA_OCR_TH_MIN_CHARS=` (ว่าง) ได้ `0` · พิมพ์ผิดได้ `NaN` แล้ว **`x < NaN` เป็น false เสมอ**
⇒ บรรทัดเสียบรรทัดเดียวใน `.env` หน้างาน = **ด่านหายทั้งด่าน ทุกหน้าไหลเข้า LLM โดยไม่มี log บอก**
แก้ด้วย `envPositive()` (finite + > 0 เท่านั้น) — แบบเดียวกับ try/except ของ `COA_OCR_RETRY_MAX_SIDE`

**B2 · ป้ายไทยแบบผูกท้ายคำดึงชื่อลูกค้ามาเป็นชื่อสินค้า** — reviewer รัน `recoverProductLot` จริง
**ผิด 6/6 เคส** และทุกเคสมีป้าย `ชื่อผลิตภัณฑ์` ที่ถูกต้องอยู่บนใบเดียวกันแต่แพ้:
`ผู้รับสินค้า` `บริษัทผู้ผลิตสินค้า` `รายการสินค้า` `มาตรฐานผลิตภัณฑ์` ทั้งหมดลงท้ายด้วยคำสินค้า/ผลิตภัณฑ์
★ นี่คือบั๊ก ROUND 30 ตัวเดิมกลับมา ★ และ **แรงกว่าที่คิด: `recoverProductLot` วิ่งทุกหน้าทุกใบ
ปิดด้วย `COA_OCR_TH_FALLBACK=false` ไม่ได้** + หัวรายงานไม่ผ่าน keep-best เลย (ไม่มี amber ให้ปัก)
แก้ 3 จุด: ผูกป้ายทั้งช่อง `/^(?:ชื่อ|ซื่อ)?(?:ผลิตภัณฑ์|สินค้า|วัตถุดิบ)$/` · lot ผูกหัว
`/^(?:เลขที่|หมายเลข)?(?:ล็อต|ล๊อต)/` · เติมคำไทยใน `CUSTOMER_LABEL` · `validProduct` ต้องเจอ
**พยัญชนะ/สระเต็มตัว** ไม่ใช่ทั้งบล็อก U+0E00–0E7F (ไม่งั้น `่้๊๋ ั ิ` ที่ OCR อ่านเละนับเป็นชื่อ)
เทสเดิมที่เขียนไว้ **วัดอะไรไม่ได้เลย** (ป้อนใบอังกฤษล้วน ป้ายไทยไม่มีทางยิง) → เปลี่ยนเป็น 6 เคสจริงข้างบน

**M3 · ใบไทยที่มีค่าหลุดเกณฑ์ = FAIL หายเงียบ** `gridBeatsFlat` ตัด challenger ที่มี FAIL ทิ้ง —
ปลอดภัยกับ HQ เพราะ best เป็น report จริง แต่บนใบไทย **best แทบว่าง** ⇒ ใบไทยที่ทุกค่าผ่าน → โชว์ผล ·
ใบไทยที่มีค่าไม่ผ่าน → โชว์ "อ่านไม่ออก" = **ระบบพูดเฉพาะตอนคำตอบเป็น PASS**
แก้แบบไม่แตะ keep-best: ส่งจำนวน FAIL ที่ถูกทิ้งออกมาทาง sink แล้ว**ปักธง needsReview ทุกแถวของ best**
พร้อมเหตุผลตรงตัว ("เครื่องอ่านไทยเจอ N แถวหลุดเกณฑ์ — ต้องเทียบกับใบจริง")

**M4 · `headerSink` แทนที่ข้อความเดิมแทนที่จะเติม** — ใบสองภาษาที่ default อ่าน `Product Name` ได้สะอาด
แต่ rec ไทยอ่านบรรทัดเดียวกันเพี้ยน จะเสียหัวรายงานไปฟรีๆ → เปลี่ยนเป็น **merge: `pg.text` เป็นเจ้าของหลัก
ข้อความไทยเติมเฉพาะช่องที่ default ว่าง** (`??=`) → invariant "หัวรายงานมีเจ้าของเดียว" ของ ROUND 30 ยังอยู่

**M5 · ด่านนับตัวอย่างเดียวไม่พอ และ corpus พิสูจน์ข้อนี้ไม่ได้** — ใบ CJK ในคลัง (TXAX-A / KGP-H65 /
Suzorite / Z99) **เป็น text-layer ทั้งหมด** ส่วนหน้าที่เป็นสแกนล้วนเป็นอังกฤษ ⇒ `[th-ocr]`=0 เป็นจริง
เรื่อง regression แต่**ไม่ได้ตอบเลย**ว่า rec ไทยเดา CJK ออกมาเป็นอักษรไทยได้กี่ตัว
→ วัดเอง: render 12 หน้าจาก 9 ใบ (CJK + อังกฤษ) แล้วยิง `lang:"th"` ตรงเข้า daemon

| | อักษรไทยที่ได้ | สัดส่วน |
|---|---|---|
| รั่วสูงสุด (`1F1710` p2) | **9 ตัว** | **0.64%** |
| TXAX-A / KGP-H65 / Inolob | 3 / 1 / 5 | ≤0.49% |
| Suzorite · Z99 · TR_1099 · D-2072 · Barimite · 1F1710 p1,p3 | 0 | 0% |
| **ใบไทยจริง** | **164** | **39.9%** |

⇒ ด่านเป็น **AND ของ 2 เงื่อนไข**: `≥20 ตัว` **และ** `≥8% ของหน้า` — 8% อยู่สูงกว่าค่ารั่วที่วัดได้ 12 เท่า
และต่ำกว่าใบไทยจริง 5 เท่า. ★ นับตัวอย่างเดียวไม่ปลอดภัยเพราะสระ/วรรณยุกต์ไทยเป็นคนละ codepoint —
"20 ตัว" จริงๆ คือแค่ ~6-8 พยางค์ = ขยะจากขอบตราปั๊ม/ลายเซ็นก้อนเดียวก็ถึง ★

**ที่แก้ตามด้วย (MODERATE):**
- **engine ที่โหลดไม่ขึ้นถูกจำไว้** (`_ENGINE_FAILED` sentinel) — เครื่องออฟไลน์ที่ยังใช้ชุด model 10 ไฟล์
  จะ `get_engine("th")` แล้วนั่งรอ ModelScope timeout 60s **× 2 ไฟล์ ทุกหน้าสแกน ตลอดไป** (ไม่มี cache)
  = ใบ 4 หน้ากลายเป็นค้าง 4-8 นาที. ตอนนี้จ่ายครั้งเดียว log ดังๆ แล้วปิด variant จนกว่าจะ restart
- **daemon echo `variant` กลับมาในผล** + `/health` บอกรายชื่อ variant · ฝั่ง TS เตือนเมื่อได้ไม่ตรงที่ขอ
  (บทเรียน ROUND 31 ที่ daemon เก่าเงียบสนิท ตอนนี้เห็นทันทีว่า `lang` ถูกเมินหรือเปล่า)
- **ย้าย `onProgress({stage:"th"})` มาก่อน OCR** — เดิมแจ้งหลังผ่านด่าน ทำให้หน้าที่ไม่ใช่ไทย (ซึ่งคือ
  เกือบทั้งหมด) เสียเวลา OCR ไทยไปโดยหน้าเว็บยังขึ้น "LLM อ่านตาราง" · ป้ายเปลี่ยนเป็น "ลองอ่านแบบไทย"

**รูที่โผล่ตอนแก้ M3 เอง (advisor จับก่อน commit):** รอบแรกปักธงไว้ใน `processPage`
บน `best.rows` — แต่หน้าไทยที่ best มี SKIP จะเข้า HQ challenger ต่อ **ถ้า HQ ชนะ ธงที่เพิ่งปักหายทั้งหมด**
→ ย้ายไปปักที่ `runCoaPipeline` หลังรู้แล้วว่า candidate ไหนชนะ (ปักบน `report.rows`)
และต่อเหตุผลด้วย `[r.reason, note].filter(Boolean)` กัน `undefined · …` โผล่หน้าคน

**ขับ path นี้จริงแล้ว** (ก่อนหน้านี้มันไม่เคยถูกรันเลย — ใบสังเคราะห์ตัวแรกผ่านหมด):
ทำใบไทยที่มีค่าหลุดเกณฑ์ 2 แถว (`ความชื้น 0.72` vs `≤ 0.50` · `pH 9.90` vs `8.5-9.5`) →
เครื่องอ่านไทยเจอ 2 FAIL → keep-best ทิ้ง → **ทุกแถวของผู้ชนะติด amber พร้อมเหตุผลตรงตัว**
แถว pH ที่ engine default อ่านเป็น SKIP (9.9 ไปอยู่ทั้งช่องเกณฑ์และช่องค่า) ก็ติธงด้วย
= คนตรวจเห็นว่าต้องไปเทียบใบจริง แทนที่จะเห็นเขียวล้วนแล้วคิดว่าใบนี้ผ่าน

**reviewer ยืนยันว่าไม่มีปัญหา (ตรวจแล้ว):** PASS จาก challenger ไทยขึ้นเขียวล้วนไม่ได้ (`applyMarginGreen`
G0 ปฏิเสธ `spatial` ตั้งแต่ต้น) · เงื่อนไข retry ที่ขยายเป็น `variant != "default"` ไม่แตะ path เดิม ·
daemon เก่าที่ไม่ restart = ตอบ engine default → นับไทยได้ 0 → ถอยไปพฤติกรรมเดิม ไม่ให้ผลผิด

### offline install
model เพิ่ม 2 ไฟล์ (`th_PP-OCRv5_rec_mobile.onnx` 7.9MB + `ch_PP-OCRv5_det_mobile.onnx` 4.8MB)
→ `INSTALL-OFFLINE.md` แก้ทุกจุดที่นับไฟล์: models 10→**12** · `ocr-offline` 388→**401 MB** ·
รวม 86 ไฟล์/4.67GB → **88 ไฟล์/4.79 GB** · copy เข้า `C:\coa-setup\ocr-offline\models` บนเครื่อง dev แล้ว

### footgun ที่ต้องจำ (ตัวเดิมจาก ROUND 31 กลับมาอีกรอบ)
**daemon เก่าที่ยังไม่ restart จะไม่รู้จัก field `lang`** → ตอบด้วย engine default → นับอักษรไทยได้ 0 →
challenger ถูกทิ้ง → ระบบถอยไปเป็นพฤติกรรมก่อนแก้ **เงียบสนิท ไม่มี error**
ปลอดภัยโดยดีไซน์ (ไม่เพี้ยน) แต่ยังไม่มี version handshake ระหว่าง backend กับ daemon —
อัปโค้ดแล้วต้อง restart `npm run ocr:daemon` ทุกครั้ง ไม่งั้นทดสอบไปก็ไม่ตรงกับของจริง
ยืนยัน wire จริงทั้ง 3 เส้นแล้ว (ยิง HTTP ตรง): `{}`→0 อักษรไทย · `{hq:true}`→0 · `{lang:"th"}`→164 ·
`{lang:"th",hq:true}`→164 (lang มาก่อน) · `{lang:"zz"}`→default ไม่พัง

---

## ROUND 36 — เลขหลายตัวในช่องค่าผล: เลิกเฉลี่ย (2026-09-10)

**อาการ:** ช่องค่าผลที่เป็นข้อความและมีเลขมากกว่า 1 ตัว ถูก**เฉลี่ย**แล้วส่งเข้า evaluator ตรง ๆ
- `"12.3 ± 0.2"` → `6.25` → **ผ่านเกณฑ์ `5~10` เขียวสนิท** ทั้งที่ค่าจริง 12.3 หลุด
- `"8.00-11.00"` → เก็บเลขทีละตัวได้ `[8, -11]` (เครื่องหมายลบของตัวคั่นติดมาด้วย) → เฉลี่ย `-1.5` → **FAIL ปลอม**
- `"1. 09"` (OCR ตัดทศนิยมขาด) → เฉลี่ย `(1+9)/2 = 5` → เลขที่ไม่มีอยู่บนใบขึ้นหน้าจอ

ค่าเฉลี่ยเป็น deceptive PASS ชนิดเดียวกับที่ path object (`{avg,min,max}`) โดนแบนไปตั้งแต่ ROUND 25 —
แต่ path string ยังทำอยู่เงียบ ๆ

### แก้อย่างไร
`result-normalizer.ts` เลิกเฉลี่ย เปลี่ยนเป็นแยก 3 ทางตามรูปช่อง (`numeric.ts` เก็บตัวคั่นไว้ที่เดียว):

| ช่องอ่านได้เป็น | คืนอะไร | ผลที่เห็น |
|---|---|---|
| ค่าเผื่อ `26 ± 2` | **ช่วง 24–28** (เหมือน `spec-normalizer` อ่าน) | เทียบทั้งช่วง ขอบหลุด = FAIL |
| ช่วง `8.00-11.00`, `30〜55 sec` | ช่วง 8–11 | เทียบทั้งช่วง ไม่ยุบเป็นจุดเดียว |
| อ่านไม่ออก `1. 09`, `1.2 \| 0.26` | `null` | **SKIP** ตามหลัก honest SKIP > confident wrong |

### 3 รูที่ opus-reviewer จับได้ (แก้ไปพร้อมกันในรอบนี้)
รอบแรกผมให้ `±` คืน**ค่ากลาง** (`26 ± 2` → 26) ด้วยเหตุผลว่า "0.2 คือความคลาดเคลื่อนของเครื่องมือ"
reviewer ยิงตกด้วยหลักฐาน: **`±` ไม่เคยโผล่ในช่องค่าผลเลยสักครั้งใน `coa-logs/` ทั้ง 1205 ไฟล์** —
มันเป็นสำนวนของ**ช่องเกณฑ์** (spec-normalizer มี branch `±` ของตัวเองมาแต่ไหนแต่ไร)
ฉะนั้นรูปช่องนี้แทบจะแปลว่า "LLM หยิบช่องเกณฑ์มาวางผิดช่อง" — และค่ากลางของเกณฑ์
**อยู่กลางเกณฑ์ของตัวเองเสมอ → PASS เขียวสนิทที่คำนวณจากเลขของเกณฑ์เอง** = แลก FAIL ปลอมเป็น PASS ปลอม ผิดทิศ

1. **`±` → ช่วง ไม่ใช่ค่ากลาง** — `26 ± 2` เป็นช่วง 24–28 ก็ไปชนด่าน "ค่าผลตรงขอบเกณฑ์พอดี" → SKIP+ธง
   ส่วน `12.3 ± 0.2` vs `5~10` ยังเป็น FAIL ตามเดิม (ช่วง 12.1–12.5 อยู่นอกเกณฑ์ทั้งช่วง) — ไม่เสีย recall
2. **`evaluateInterval` ไม่มีด่านขอบเดียว** — `acc8e0a` ใส่ด่าน "ค่าผลตรงขอบ ≤/≥ พอดี → SKIP" ไว้เฉพาะ path
   ค่าเดี่ยว. ช่วง `0.10-0.28` vs `0.28 Max.` จึงเขียวสนิท ทั้งที่ค่าเดี่ยว `0.28` บนใบเดียวกันโดน SKIP+ธง
   → ย้ายด่านเดียวกันเข้า `evaluateInterval` (`le`/`ge` + เว้น `dirFromColumn` เหมือนเดิมเป๊ะ)
   รูนี้มีมาก่อน diff (เข้าถึงได้ทาง RB220 คอลัมน์ Min|Max) แต่ diff นี้เปิดให้ช่องข้อความเข้าถึงได้ด้วย
3. **regex ตัวคั่นโลภกินเครื่องหมายลบ** — `(?:sep\s*)+` ทำให้ `"-0.2--0.5"` อ่านเป็นช่วง `-0.2 ถึง 0.5`
   → vs เกณฑ์ `≥-0.3` ได้ PASS ทั้งที่ของจริงหลุด. แก้เป็น `+?` ตัวเดียว

### ผลรัน
- unit **26 suite ผ่านหมด** (`result-normalizer` 31→**40 เคส**) — เคสใหม่รวม `26 ± 2` vs `26 ± 2`,
  ช่วงชนขอบ `Max.`/`Min.`, `-0.2--0.5`, และเคสควบคุมที่ต้องยัง PASS อยู่
- corpus gate: **128P/0F/10S rows=138 verdict-rate=93% needsReview=11** (17 ใบ, เท่า baseline เป๊ะ) · `bad allocation` / `[retry]` / `OCR_DAEMON_DOWN` / `th-ocr` = 0
- row-level diff เทียบ baseline: **ว่างเปล่า** ทั้งเทียบ ROUND 35 final และเทียบรอบก่อนแก้ reviewer findings (225 แถว เหมือนกันทุกบรรทัด)

### ★ ห้ามอ่าน diff ว่างเปล่าว่า "แก้แล้วไม่มีผล" — ต้องรู้ว่าทำไมมันว่าง ★
ตอนแรกผมเอา `resultRaw` หลายเลขจาก `coa-logs/` มาอ้างว่าเป็นแถวปัจจุบัน **ผิด** — กรองตาม mtime แล้ว
ทุกเคสมาจากผลรัน**ก่อน** ROUND 25–34. structural grid ที่ทำใน ROUND 34 อ่านช่องพวกนั้นถูกตั้งแต่ต้นทาง
(ZP10 `Fiber Length` ตอนนี้อ่านได้ `1.09` ตรง ๆ ไม่ใช่ `1. 09` แล้ว)

ที่พูดได้จริงมี 2 ข้อ เท่านั้น:
- **ไม่มีแถวที่ชนะของผลรันวันนี้เดินผ่าน branch นี้** (log เก็บเฉพาะแถวของ candidate ที่ชนะ —
  candidate ที่แพ้ไม่ถูกบันทึก จึงพิสูจน์ "exposure = 0" ไม่ได้)
- **ผลสุดท้ายไม่ขยับแม้แต่บรรทัดเดียว** ← อันนี้คือหลักฐาน anti-regression ตัวจริง

บั๊กมีจริงในโค้ด แต่คลังปัจจุบันไม่เดินผ่าน branch นั้น นั่นคือเหตุผลที่ gate ไม่ขยับ

### หมายเหตุที่ต้องจำ
- **`±` ต้องอ่านเป็นช่วงทั้งสองฝั่ง** — `spec-normalizer` อ่าน `26 ± 2` เป็นช่วง 24–28 มาแต่เดิม,
  `result-normalizer` มาตรงกันตั้งแต่รอบนี้ (เดิมอ่านเป็น "ค่า ± ความคลาดเคลื่อน" แล้วคืนค่ากลาง)
  **อย่าเปลี่ยนกลับไปคืนค่ากลาง** เหตุผลอยู่ข้อ 1 ด้านบน
- **นโยบายขอบไม่ได้เปลี่ยน** — ค่าเดี่ยว `55` vs เกณฑ์ `30~55` เป็น SKIP+ธงอยู่ก่อนแล้ว
  การส่งช่วงจากช่องข้อความเข้า `evaluateInterval` จึงไม่ได้สร้างนโยบายใหม่ แค่ทำให้ทั้งสอง path ตรงกัน
- ปิด Fable finding #1 (`result-normalizer` เฉลี่ยเลขในข้อความ) เรียบร้อย

### ค้างไว้ (คนละ commit คนละ gate)
- `suppressCopiedSpec` (`coa-evaluator.ts:577`) เทียบข้อความแบบไม่ normalize tilde — `spec.raw` ผ่าน
  `~` มาแล้วแต่ `result.raw` เก็บตามใบดิบ → แถวที่ใช้ `〜` เต็มความกว้าง ตัวจับ copied-spec มองไม่เห็นเลย
  (ตอนนี้ถูกด่านอื่นบังไว้ ยังไม่ออกอาการ) · แก้ที่ `copied()` เท่านั้น **ห้ามแก้ `raw`** จอต้องโชว์ตามใบ
- `spec-normalizer.ts:81/91/108` ยังมี copy ของตัวคั่นเป็นของตัวเอง (ใช้กับข้อความที่ strip หน่วยแล้ว
  คนละ input กับฝั่ง result) — รวมเข้า `numeric.ts` ได้ แต่ไม่ mechanical
- Fable ที่เหลือ: rebuilt item กลับเข้าลูป LLM-repair · pass-guard ไม่ทำงานบนตารางแนวนอน
  (`coa-grounding.ts:484`) · `parenSpec` กรองผิดแกน · คอลัมน์ `Typical`/`Target` ·
  2 ตารางบนหน้าเดียวที่จำนวนคอลัมน์เท่ากัน · summary ไม่คำนวณใหม่หลัง `recoverMissingSieveRows`
