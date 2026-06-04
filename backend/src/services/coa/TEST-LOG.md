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
- corpus ล่าสุด: **43P / 2F / 44S** (verify _validate/_verify-4b-v6.log) · 0 deceptive PASS · deceptive FAIL เหลือ 2 (RI-015)
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
| 7 | Barimite200 | text-layer | 5P/2S | ⬜ | header-direction กู้ Moisture/D50/D100/325Mesh |
| 8 | SODA_ASH | rapidocr | 2P/4S | ⬜ | scan bare-eq → SKIP |
| 9 | Suzorite_Mica | text-layer | 0P/3S | ⬜ | |
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
| Sieve Residue on 350 μ | 15~45 | 42.3 | SKIP | PASS | ❌ | pass-guard column-collapse downgrade ผิด (ค่าถูกอยู่แล้ว) |
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
