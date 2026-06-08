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
- verify สุดท้าย (4b, full guard chain + bare-eq + header-direction, _validate/_verify-4b-v6.log):
  - 4b: **43P / 2F / 44S** (verdict 51%, needsReview 24) — **0 deceptive PASS** · deceptive FAIL **เหลือ 2** (RI-015 scanned เท่านั้น)
  - Barimite **1P/6S → 5P/0F/2S**: Moisture/D50/D100/325Mesh กู้เป็น **PASS ถูกหมด** ด้วย header-direction (guard #9)
  - ★ แก้ความเข้าใจผิดเก่า: D50/D100 **ไม่ใช่ real FAIL** — geometry พิสูจน์ bound อยู่ใต้คอลัมน์ **Max** (11.0/80.0 = particle-size max) → PASS. 4b/7b อ่านเป็น FAIL เพราะทิศหาย. corpus จริงเกือบไม่มี real FAIL (เป็น COA สินค้าที่ ship แล้ว = ผ่าน spec)
- Gates: `tsc --noEmit` = 0 · spec-normalizer.test 39/39 · evaluator.test (5 fixtures, ตรง HEAD) ผ่าน
- ★ lever 1 (text-layer column-placeholder ใน flat text) = **ลองแล้ว REJECTED** — regress 4b (v3: TR_1099 3 PASS →
  3 FAIL ปลอม เพราะ restructure text ที่ป้อน LLM). **guard #9 = ทางที่ถูก** (post-LLM, geometry ดิบ, ไม่แตะ text ที่ LLM เห็น)

## Pipeline order (`coa-pipeline.ts runCoaPipeline`)
1. `extractText` — text-layer (`pdf-text-extractor`) → **RapidOCR sidecar :8765** (+ rotation auto-correct) → Tesseract fallback
2. `ollama.parseCoa` — qwen3:4b (LLM parse → RawCoaItem[])
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
| 8 | `ollama-coa.service.ts parseCoa prompt` | **abstain rule**: "return null ถ้าอ่านไม่ชัด ห้ามเดา/ยืมเลขแถวอื่น" → bias honest SKIP | 9e6a132 |
| 9 | `header-direction.ts` + `spec-recovery.ts applyHeaderDirectionHints` | **header-anchored direction** (text-layer): กู้ทิศ bare-eq จาก "X ของ bound เทียบ header Min.Spec/Max.Spec" (geometry ดิบจาก pdfjs, post-LLM, ★ ไม่แตะ text ที่ LLM เห็น → กัน lever-1 regression ★). upgrade SKIP→verdict เฉพาะ row eq + geometry ชัด. Barimite +4 PASS ★ ใหม่ ★ | uncommitted |

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
- Inolob 4P · TR_1099 3P · ZP10(×2) 1P/3S · RI-015(×2) 0/4S · PR1950W4063(×2) 6P · Barimite 4P/3S · SODA(×2) 6P · Suzorite 0/5S · Z99 10P/3S · D-2072(×2) 4P · TXAX 4P · 1F1710(×2) **prod=32P/0F/10S** [harness=0/0/0 = ARTIFACT ดู ★ ด้านล่าง] · 4A(×2) 1P/1S · RB220 1P/1S · PR1950W4064 3P/3S

> ★ HARNESS BUG (2026-06-08, verify แล้ว): `verify-4b.ts`/`sweep.ts`/`pilot`/`probe` ใช้ `extractText()` (coa-pipeline.ts:747) ที่คืน **first page เท่านั้น** (`return { text: first.text }`). PDF ที่หน้าแรกเป็น disclaimer/cover (เช่น 1F1710) → harness เห็น 0 row = วัดผิด. **Production (`runCoaPipeline`) ใช้ `extractTextPerPage` (loop ทุกหน้า) → 1F1710 จริง = 32P/0F/10S clean.** baseline บรรทัดบนสำหรับ multi-page PDF ที่หน้าแรกไม่มี table = เชื่อไม่ได้. ground-truth ต้อง probe ผ่าน runCoaPipeline (ดู `_validate/_probe2-1f1710.ts`). ก่อนเชื่อว่าไฟล์ไหน "พัง" → verify production path ก่อนเสมอ.

## Residual / next levers (ยังไม่ทำ, เรียงตาม payoff)
0. ✓ **text-layer Min/Max direction = SOLVED (guard #9 header-direction)** — Barimite class กู้แล้ว.
   ★ บทเรียนสำคัญ: "auto-FAIL หาย" เป็น false premise — D50/D100 **ไม่เคยเป็น real FAIL** (geometry: bound ใต้ Max → PASS).
   corpus = COA สินค้าที่ ship แล้ว → **ผ่าน spec แทบทั้งหมด เป็นเรื่องปกติ**. งานของระบบ = จับ OOS ที่นานๆ เจอ +
   honest SKIP ที่อ่านไม่ได้ (ไม่ปั้น). "FAIL น้อย" = ถูกต้อง ไม่ใช่ defect.
0b. **RI-015 sieve-table mis-read** (residual จริงที่เหลือ) — 4b เอา sieve aperture (0.425/0.15 = ขนาดตะแกรง label)
   มาเป็น result + ปั้น range spec (10-45, 50-80) → 2 deceptive FAIL ที่เหลือ (scanned, ไม่ใช่ eq → guard #7/#9 ไม่จับ).
   niche 1 ไฟล์. `downgradeUngroundedFails` ไม่จับเพราะเลขปั้นบังเอิญ co-locate. fix = เสี่ยง regress guard กว้าง → flag ไว้
0c. **scanned Min/Max direction** — guard #9 เป็น text-layer เท่านั้น. ไฟล์ scan (SODA bare-eq Assay/NaCl) ยัง SKIP.
   ทำได้ด้วย box-grid จาก RapidOCR box (รอบหน้า ถ้าจำเป็น) — แต่ scan geometry เชื่อยากกว่า text-layer, ระวัง.
   Docling = ทางสำหรับ shredded layout (PR1950W_4064) แต่ unproven บน COA scan + งานหลายวัน → defer จนกว่าจำเป็น
1. **LLM mis-association บนแถวหลายเลข** — qwen3:4b ประกอบ spec/result มั่วแม้ OCR สะอาด (เช่น Lot240521 500μ แสดง result 42 แทน 0.3 — verdict ยังถูกเพราะทั้งคู่ PASS, แต่เลขที่โชว์ผิด). เพดาน accuracy หลักตอนนี้ = table-STRUCTURE ไม่ใช่ OCR (v4 อ่านสะอาดแล้ว). ทางแก้: table-structure recognizer non-LLM (RapidTable / img2table) → ป้อน parse-structural-grid.ts → bypass LLM. (อย่าเปลี่ยนเป็น chat LLM ใหญ่กว่า — แก้ผิดจุด ยังเดา; 7b เคยลอง = SKIP เยอะกว่า, reject)
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
- Ollama: `localhost:11434`, model `qwen3:4b`
