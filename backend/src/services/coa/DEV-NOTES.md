# COA Analyzer — Dev Notes / Handoff

> อ่านไฟล์นี้ก่อนพัฒนาต่อ. อัปเดตเมื่อ corpus state / guards เปลี่ยน.

## ★ Priority #1 (ห้ามลืม) ★
**ไม่เอา deceptive PASS/FAIL** — verdict ที่ได้จากเลขอ่านผิด/ปั้น/map ผิดแถว.
honest **SKIP/needsReview** (หรือ drop row) ดีกว่า PASS/FAIL ที่มั่นใจแต่ผิด.
ทุก fix เป็น deterministic TypeScript/regex — **ไม่เทรน model**.

## สถานะปัจจุบัน (2026-06-03 — uncommitted)
- **Default LLM = `qwen3:4b`** (สลับจาก qwen2.5:7b). pilot+verify บน 16-file corpus: เร็วกว่า 2.4x
  (8.5 vs 20.7s/file เพราะ ~2.8GB fit GPU จริง, 7b 4.7GB ตก CPU-fallback), recall ดีกว่า (Z99 7b SKIP หมด → 4b 10 PASS ถูก 100%)
- **uncommitted changes** (รอ user สั่ง commit): `ollama-coa.service.ts` (model→4b + abstain rule + think:false),
  `coa-evaluator.ts` (bare-eq PASS guard). harness: `_validate/verify-4b.ts`, `_validate/dump-ocr.ts`
- verify สุดท้าย (4b, full guard chain + symmetric bare-eq, _validate/_verify-4b-v4.log):
  - 4b: **39P / 2F / 48S** (verdict 46%, needsReview 28, 133s) — verdict-rate ลดเพราะตัด verdict ที่เชื่อไม่ได้ออก (honest)
  - **0 deceptive PASS** · deceptive FAIL **เหลือ 2** (RI-015 ไฟล์เดียว, ดู residual #0) — ลดจาก 7
  - Barimite: deceptive FAIL (Moisture/PH/325Mesh) → SKIP ✓ · real FAIL (D50/D100) → SKIP ด้วย (cost ของ symmetric guard)
- Gates: `tsc --noEmit` = 0 · spec-normalizer.test 39/39 · evaluator.test 4P/0F (+ synthetic 4F) ผ่าน
- ★ lever 1 (text-layer column-placeholder preserve) = **ลองแล้ว REJECTED** — regress 4b (v3: FAIL 7→10,
  TR_1099 3 PASS → 3 FAIL ปลอม เพราะ column-restructure ทำ 4b mis-read range bound). reverted. ดู residual #0

## Pipeline order (`coa-pipeline.ts runCoaPipeline`)
1. `extractText` — text-layer (`pdf-text-extractor`) → **RapidOCR sidecar :8765** (+ rotation auto-correct) → Tesseract fallback
2. `ollama.parseCoa` — qwen2.5:3b-instruct (LLM parse → RawCoaItem[])
3. `dropUngroundedItems` — anti-hallucination (ตัด row ที่ไม่มีใน OCR)
4. `recoverSpecsFromOcr` — เติม spec ที่ LLM หล่น (เฉพาะ row spec ว่าง)
5. `correctSpecDirectionFromOcr` — แก้ทิศ bare-bound จาก operator ใน OCR
6. `evaluateCoa` — ตัด PASS/FAIL/SKIP ต่อ row
7. `downgradeUngroundedFails` — anti-fabricated-FAIL (FAIL→SKIP ถ้า spec/result ไม่ co-locate)

## Guards/levers ที่ ship แล้ว (8)
| # | ที่ไหน | ทำอะไร | commit |
|---|---|---|---|
| 1 | `coa-grounding.ts dropUngroundedItems` | drop LLM row ที่ไม่มีใน OCR (1F1710 hallucination) | 0e0e7e3 |
| 2 | `coa-evaluator.ts evaluateItem` ~L120 | spec **range edge** == result → SKIP (เอา result มาเป็นขอบ spec) | (เดิม) |
| 3 | `coa-grounding.ts downgradeUngroundedFails` | FAIL→SKIP ถ้า spec ทุก bound + result ไม่อยู่บรรทัด OCR เดียวกัน (`.every`) | 287a62b, 1667795 |
| 4 | `rapidocr.service.ts correctRotation` | ตรวจ scan หมุน 90/270 (box tall vs wide) → re-OCR เลือกมุมตรง. **fast-path เป๊ะถ้าไม่หมุน** | 1667795 |
| 5 | `spec-normalizer.ts JUDGMENT_TAIL` | ตัด Success/Pass/ผ่าน ท้าย specRaw → ทิศ spec ถูก | 1667795 |
| 6 | `coa-grounding.ts downgradeUngroundedPasses` | PASS→SKIP ถ้า result ไม่อยู่บรรทัด data ของชื่อ row (column collapse ฝั่ง PASS) | 884b44e |
| 7 | `coa-evaluator.ts evaluateItem` ~L132 | **bare-eq spec → SKIP (symmetric)** op=eq/approx = spec เลขเดี่ยวไม่มีทิศ → ทั้ง PASS (copy result→spec) และ FAIL (bound ทิ้งทิศ) เชื่อไม่ได้ → SKIP ★ ใหม่ ★ | uncommitted |
| 8 | `ollama-coa.service.ts parseCoa prompt` | **abstain rule**: "return null ถ้าอ่านไม่ชัด ห้ามเดา/ยืมเลขแถวอื่น" → bias honest SKIP ★ ใหม่ ★ | uncommitted |

## ★ KEY FINDING ★
Lot240521 root cause = **rotation (หมุน 90°)** ไม่ใช่ column collapse.
RapidOCR อ่านตัวอักษรตะแคง → เลข/spec เพี้ยน. **bbox grid reconstruction (แผนเดิม) = lever ผิด** — geometry ภาพหมุนเชื่อไม่ได้. rotation correction คือ fix ต้นเหตุ.

## วิธีเทส
3 terminal: daemon → backend → frontend
```
cd C:\local-repo\OCR\backend && npm run ocr:daemon   # รอ "OCR daemon ready ... (model loaded)"
cd C:\local-repo\OCR\backend && npm run dev
cd C:\local-repo\OCR\frontend && npm run dev          # http://localhost:3000
```
- CLI batch: `cd backend && npx ts-node src/scripts/test-coa.ts` (ทุกไฟล์ใน uploads/) → log ที่ `coa-logs/run.log` + JSON ต่อไฟล์
- ★ daemon ต้องการ **absolute path** — ส่ง relative → 500 → fall back Tesseract (ผลเพี้ยน, ไม่ใช่ของจริง)
- diagnostic geometry: `npx ts-node src/scripts/dump-tokens.ts <file>` → dump RapidOCR tokens+boxes
- debug ต่อ run: `coa-logs/_last-ocr.txt` (OCR ที่ใช้จริง) + `_last-ollama.txt` (LLM parse). **overwrite ทุก run** → รันไฟล์เดียวถ้าจะดู

## Baseline ต่อไฟล์ (เทียบหา regression)
ไฟล์ rotation fire เฉพาะ: **Lot240521 (.pdf+.png), _diag_small.png** (เอกสารเดียวกัน). ที่เหลือ fast-path เป๊ะเดิม.
- Lot240521 .pdf/.png: 5P/0F/0S · _diag_small: 4P/0F/1S
- Inolob 4P · TR_1099 3P · ZP10(×2) 1P/3S · RI-015(×2) 0/4S · PR1950W4063(×2) 6P · Barimite 4P/3S · SODA(×2) 6P · Suzorite 0/5S · Z99 10P/3S · D-2072(×2) 4P · TXAX 4P · 1F1710(×2) 0/0/0 · 4A(×2) 1P/1S · RB220 1P/1S · PR1950W4064 3P/3S

## Residual / next levers (ยังไม่ทำ, เรียงตาม payoff)
0. **restore auto-FAIL (ต้องพึ่ง structural extractor / Docling)** — symmetric bare-eq guard (#7) ตัด deceptive FAIL
   ฝั่ง bare-eq ออกหมด **แต่กด real FAIL ทิ้งด้วย** (Barimite D50 Min11.0/actual10.414, D100 Min80.0/actual69.11 →
   ตอนนี้เป็น needsReview-SKIP, คนต้อง confirm ทิศเอง). corpus เลย **0 auto-FAIL** (honest แต่ QA tool ไม่ flag เสียเอง).
   เหตุที่ deterministic แก้ไม่ได้: ทิศ Min/Max อยู่ที่ **column position** (header) ซึ่ง flat text ทำหาย.
   ✗ ลองแล้ว: lever-1 (เติม empty-cell placeholder ใน `pdf-text-extractor`) = **regress** (column position เชื่อไม่ได้
   เมื่อ Min/Max header merge / ค่าตกผิด slot, ทำ 4b mis-read range → TR_1099 3 PASS เป็น 3 FAIL ปลอม). reverted.
   → ทางเดียวที่เหลือ = **Docling/TableFormer** (render→typed-grid, รู้ว่า cell อยู่ใต้ header ไหน) = pilot หลายวัน
0b. **RI-015 sieve-table mis-read** — 4b เอา sieve aperture (0.425/0.15 = ขนาดตะแกรง label) มาเป็น result + ปั้น
   range spec (10-45, 50-80) → 2 deceptive FAIL ที่เหลือ (ไม่ใช่ eq → guard #7 ไม่จับ). niche 1 ไฟล์ scan.
   `downgradeUngroundedFails` ไม่จับเพราะเลขปั้นบังเอิญ co-locate. fix = เสี่ยง regress guard กว้าง → flag ไว้ก่อน
1. **LLM mis-association บนแถวหลายเลข** — qwen2.5:3b ประกอบ spec/result มั่วแม้ OCR สะอาด (เช่น Lot240521 500μ แสดง result 42 แทน 0.3 — verdict ยังถูกเพราะทั้งคู่ PASS, แต่เลขที่โชว์ผิด). เพดาน accuracy หลักตอนนี้. ทางแก้: prompt few-shot ตาราง / multi-pass cross-check / model ใหญ่ขึ้น (7b เคยลอง = SKIP เยอะกว่า, reject)
2. **decimal-loss** — OCR ทศนิยมหาย (ZP10/4A: 5.8→58, 0.001→0.01). guard flag needsReview แล้วแต่ยังไม่กู้. ทางแก้: OCR preprocess/DPI tuning (ระวัง: width 2000 validate มาแล้ว, ดู image-processing.service.ts comment)
3. **RapidOCR model variant** PP-OCRv4/v5 server
4. **dataset โตฟรีจาก needsReview queue** — honest SKIP ตอนนี้ → user แก้ → labeled data → fine-tune ทีหลัง (ดู ocr-rapidocr-decision)

## ระหว่างเทสทุกไฟล์ ให้จับตา/จด
- ไฟล์ไหนได้ **FAIL** — เช็คทันทีว่าจริงหรือปลอม (เทียบใบจริง). ตอนนี้ corpus FAIL=0 ทุกตัว → เจอ FAIL = ต้องสืบ
- ไฟล์ไหน **PASS แต่เลขที่โชว์ผิด** (mis-association) — จด param + ไฟล์
- ไฟล์หมุนตัวอื่นนอกจาก Lot240521 (log `[rapidocr] rotated scan`) — ดูว่า correct ถูกมุมไหม
- decimal-loss ใหม่ (note "ทศนิยมหาย")
- ไฟล์ที่ rotation **ควร fire แต่ไม่ fire** (ผล SKIP เยอะผิดปกติ + ตัวอักษรตะแคง)

## Machine deps
- RapidOCR daemon: `127.0.0.1:8765` (`ocr-py/ocr_server.py`, venv ที่ `ocr-py/venv`)
- Ollama: `localhost:11434`, model `qwen2.5:3b-instruct`
