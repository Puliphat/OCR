# COA Analyzer — Dev Notes / Handoff

> อ่านไฟล์นี้ก่อนพัฒนาต่อ. อัปเดตเมื่อ corpus state / guards เปลี่ยน.

## ★ Priority #1 (ห้ามลืม) ★
**ไม่เอา deceptive PASS/FAIL** — verdict ที่ได้จากเลขอ่านผิด/ปั้น/map ผิดแถว.
honest **SKIP/needsReview** (หรือ drop row) ดีกว่า PASS/FAIL ที่มั่นใจแต่ผิด.
ทุก fix เป็น deterministic TypeScript/regex — **ไม่เทรน model**.

## สถานะปัจจุบัน (commit 1667795)
- Corpus: **79 PASS / 0 FAIL / 32 SKIP** (25 files, 111 items), **0 deceptive verdict**
- git (local, ยังไม่ push): `1667795` → `287a62b` → `0e0e7e3` → `41e057b`
- Gates: `tsc --noEmit` = 0 · spec-normalizer.test 39/39 · coa-fail-guard.test 10/10 · coa-grounding.test 9/9 · evaluator.test ok

## Pipeline order (`coa-pipeline.ts runCoaPipeline`)
1. `extractText` — text-layer (`pdf-text-extractor`) → **RapidOCR sidecar :8765** (+ rotation auto-correct) → Tesseract fallback
2. `ollama.parseCoa` — qwen2.5:3b-instruct (LLM parse → RawCoaItem[])
3. `dropUngroundedItems` — anti-hallucination (ตัด row ที่ไม่มีใน OCR)
4. `recoverSpecsFromOcr` — เติม spec ที่ LLM หล่น (เฉพาะ row spec ว่าง)
5. `correctSpecDirectionFromOcr` — แก้ทิศ bare-bound จาก operator ใน OCR
6. `evaluateCoa` — ตัด PASS/FAIL/SKIP ต่อ row
7. `downgradeUngroundedFails` — anti-fabricated-FAIL (FAIL→SKIP ถ้า spec/result ไม่ co-locate)

## Guards/levers ที่ ship แล้ว (5)
| # | ที่ไหน | ทำอะไร | commit |
|---|---|---|---|
| 1 | `coa-grounding.ts dropUngroundedItems` | drop LLM row ที่ไม่มีใน OCR (1F1710 hallucination) | 0e0e7e3 |
| 2 | `coa-evaluator.ts evaluateItem` ~L120 | spec boundary == result → SKIP (เอา result มาเป็นขอบ spec) | (เดิม) |
| 3 | `coa-grounding.ts downgradeUngroundedFails` | FAIL→SKIP ถ้า spec ทุก bound + result ไม่อยู่บรรทัด OCR เดียวกัน (`.every`) | 287a62b, 1667795 |
| 4 | `rapidocr.service.ts correctRotation` | ตรวจ scan หมุน 90/270 (box tall vs wide) → re-OCR เลือกมุมตรง. **fast-path เป๊ะถ้าไม่หมุน** | 1667795 |
| 5 | `spec-normalizer.ts JUDGMENT_TAIL` | ตัด Success/Pass/ผ่าน ท้าย specRaw → ทิศ spec ถูก | 1667795 |

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
