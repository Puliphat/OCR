# OCR Migration Summary — Tesseract → Python RapidOCR sidecar

> เขียนไว้ 2026-06-02 (Opus session). สรุปสิ่งที่ย้าย/เพิ่ม + code map + ขั้นต่อไป.
>
> ⚠ **SUPERSEDED (2026-06-08)** — เอกสารนี้เป็นบันทึก migration รอบแรก (Tesseract→RapidOCR PP-OCRv3). state ปัจจุบันต่างไปแล้ว:
> **OCR = `rapidocr` 3.x / PP-OCRv4 mobile** (commit c1c9a7c, ไม่ใช่ rapidocr-onnxruntime/PP-OCRv3) · **LLM parse = `qwen3:4b`** (ไม่ใช่ qwen2.5:3b).
> ของจริงล่าสุดดู `CLAUDE.md` + `backend/src/services/coa/DEV-NOTES.md`. ตารางด้านล่างคงไว้เป็นประวัติ.

## TL;DR

ปัญหาเดิม: OCR อ่านค่าเพี้ยน (ค่าใน COA ผิด) — ส่วนใหญ่เป็น PDF scan.
รากปัญหา 16 ไฟล์จริง = 8 text-layer (ปัญหาที่ LLM parse) + 8 scanned (ปัญหาที่ OCR).
Tesseract บน scan = พัง: `7 ± 3`→`743` (± หาย), เลข bleed ข้ามแถว, multi-column เพี้ยน.

**ย้ายไป: Python RapidOCR sidecar** (เฉพาะขั้น OCR) — backend/frontend อื่นคงเป็น TS/React เหมือนเดิม.
พิสูจน์แล้วบน D-2072 (เคยเป็น garbage ทั้งใบ) → ตอนนี้ **4 PASS 0 FAIL = ตรง ground truth เป๊ะ**.

## ย้ายมาใช้ model/engine อะไร

| ขั้น | เดิม | ใหม่ |
|---|---|---|
| **OCR (scan)** | Tesseract.js (`eng+tha`) | **RapidOCR** (rapidocr-onnxruntime, PP-OCRv3, CPU onnxruntime) |
| PDF→PNG (ใน sidecar test) | pdfjs+canvas | PyMuPDF (fitz) @300dpi *(backend จริงยังใช้ pdfjs 2000px)* |
| LLM parse | qwen2.5:3b-instruct | **เหมือนเดิม** (ไม่แตะ) |
| evaluator/normalizer | TS | **เหมือนเดิม** (แก้ 1 bug, ดูล่าง) |

ทำไม RapidOCR ไม่ใช่ vision LLM (typhoon-ocr-3b / qwen2.5vl:3b): vision LLM 3B ต้องการ RAM ~7GB → เครื่องนี้ (RAM 15GB, free ~6GB) **ลงไม่ได้** (ขาด ~400MB-1GB ทุกครั้ง). RapidOCR = CPU onnx ~300MB → fit สบาย, เร็ว ~3-7s/หน้า.

ทำไมไม่ rewrite ทั้ง backend เป็น Python: frontend ผูก backend แค่ endpoint เดียว (`POST /api/coa/upload`) — Python service ที่ serve endpoint นี้ React ไม่ต้องแก้. แต่ rewrite ทั้ง backend = ต้อง port evaluator+normalizer (tune มากับ ground truth) + tests + Express→FastAPI + TypeORM→SQLAlchemy = เสี่ยง+นาน โดยไม่จำเป็น. **ปัญหา OCR แก้ได้ด้วย sidecar อย่างเดียว.** (ผู้ใช้เลือก "sidecar + คง TS backend")

## Architecture

```
PDF → [text-layer extract: TS เดิม]                    ← 8 ไฟล์ที่มี text-layer ผ่านทางนี้ (ฟรี ไม่ OCR)
        ↓ ถ้าไม่มี text-layer (scan)
      [render PDF→PNG: PdfService TS เดิม, 2000px]
        ↓
      [RapidOCR sidecar :8765] ←─ HTTP POST /ocr {path} → {tokens[] + box}   ★ ใหม่ ★
        ↓ reconstructText: จัด tokens เป็นแถว (y) เรียง x, join " | "
      [LLM parse: qwen2.5:3b-instruct TS เดิม] → JSON
        ↓
      [spec/result normalizer + evaluator: TS เดิม] → PASS/FAIL/SKIP
        ↓
      {report, logFile} → frontend React (ไม่แตะ)
```

sidecar = HTTP daemon (เหมือน Ollama) — start แยก, ถ้า daemon ล่ม pipeline fall back Tesseract อัตโนมัติ.

## Code map — อะไรอยู่ตรงไหน

### ใหม่ (Python sidecar) — `C:\local-repo\OCR\ocr-py\`
- `ocr_server.py` — HTTP daemon บน `:8765`. โหลด RapidOCR ครั้งเดียว. `POST /ocr {path}` → `{tokens:[{text,score,x,y,y1,y2,x2}], elapse}`. stdlib http.server (ไม่มี dep หนัก).
- `render_and_test.py` — standalone test: render 8 scanned PDF (PyMuPDF) → ยิง daemon → dump ผลต่อไฟล์ที่ `_scan_test/*.txt`.
- `requirements.txt` — `rapidocr-onnxruntime`, `opencv-python-headless`, `pymupdf`.
- `venv/` — Python env (gitignored).
- `_scan_test/` — ผล OCR ดิบต่อไฟล์ + `_e2e_run.txt` (ผลรัน pipeline เต็ม). gitignored.

### ใหม่ (TS) — `backend\src\services\coa\`
- `rapidocr.service.ts` — ★ bridge ไป daemon ★. `ocrTokens(img)` ยิง HTTP, `reconstructText(tokens)` จัดแถว (gap = 0.6×median height), `extractText(img)` รวม 2 อย่าง. daemon ล่ม → คืน null.

### แก้ (TS)
- `backend\src\services\coa\coa-pipeline.ts` — `extractText()`: เพิ่มขั้น RapidOCR เป็น primary OCR (default ON, env `USE_RAPIDOCR`) ก่อน Tesseract. import RapidOcrService.
- `backend\src\services\coa\spec-normalizer.ts` — **fix bug**: `normalizeSpecFromCandidate` เดิมบังคับค่าใน column min→ge / max→le ทิ้ง operator เดิม. LLM ใส่ `≥ 50` ลง specMax → กลายเป็น `le 50` → 136.5 FAIL ผิด. แก้: ถ้าค่ามี operator ตัวเอง (ge/le/lt/gt/between) ใช้ตามนั้น; เฉพาะ bare number ถึงยึดทิศ column.
- `backend\src\services\coa\spec-normalizer.test.ts` — เพิ่ม 3 fixtures (≥ ใน max col, ≤ ใน min col, ± ใน max col). 36/36 pass.
- `backend\package.json` — เพิ่ม script `ocr:daemon`.
- `CLAUDE.md` — update stack/commands/env/pipeline/cheatsheet/tree สะท้อน sidecar.

### ที่ไม่แตะเลย
- frontend ทั้งหมด (React/Next.js) — contract เดิม `POST /api/coa/upload`.
- evaluator, result-normalizer, spec-recovery, ollama parse prompt, routes, entities, DB.

## วิธีรัน

```powershell
# 1. start OCR daemon (ครั้งแรกต้อง setup venv ก่อน — ดู ocr-py/requirements.txt)
cd C:\local-repo\OCR\backend
npm run ocr:daemon            # ค้างไว้ terminal แยก (เหมือน Ollama)

# 2. รัน pipeline (ต้องมี Ollama :11434 ด้วย)
npx ts-node src/scripts/test-coa.ts path\to\scan.pdf
# หรือ backend HTTP: npm run dev  (frontend ยิงมาที่ :3001)
```

## ผลทดสอบ — batch end-to-end ทั้ง 16 ไฟล์ (หลังแก้ครบ)

| File | ชนิด | ผล | หมายเหตุ |
|---|---|---|---|
| D-2072 | scan | **4 PASS** | ✓ ตรง ground truth (เคย garbage ทั้งใบ ภายใต้ Tesseract) |
| PR1950W (4063) | scan | **6 PASS** | ✓ สะอาด |
| 1F1710 | scan | **3 PASS** | ✓ |
| SODA ASH | scan | **6 PASS** | ✓ (เคย 1 FAIL ปลอม — แก้ด้วย specRaw-authoritative fix) |
| Inolob T204F | text | 4 PASS | ✓ |
| TR_1099 | text | 3 PASS | ✓ |
| Z99 | text | 10 PASS 3 SKIP | ตาราง 13 แถว |
| TXAX-A | text | 4 PASS 1 SKIP | |
| Barimite200 | text | 4 PASS 3 SKIP | |
| 4A | scan | 1 PASS 1 SKIP | |
| RB220 | text | 1 PASS 1 SKIP | |
| PR1950W (4064) | text | 3 PASS 3 SKIP | |
| ZP10 | scan | 1 PASS 3 SKIP | LLM ไม่จับ spec column |
| RI-015 | scan | 0 PASS 4 SKIP | OCR สวยมาก แต่ LLM เลือก result ไม่ได้ (7 Lot# cols) |
| Suzorite Mica | text | 0 PASS 4 FAIL | LLM ยัด result เข้า spec column (Density 0.3-0.3) |
| Lot240521 | scan | 0 PASS 3 FAIL | fax จางสุด — LLM column-drift + แกว่งทุก run |
| **รวม** | | **50 PASS, 7 FAIL, 20 SKIP / 77** | |

(ผลเต็ม: `ocr-py\_scan_test\_e2e_all16_v2.txt`)

### ★ ข้อสรุปสำคัญ: bottleneck ย้ายจาก OCR → LLM parse ★

- **OCR (RapidOCR) อ่านดีขึ้นชัดทุกไฟล์** — text/เลข/สัญลักษณ์ถูก (ดู `_scan_test/*.txt`). **ปัญหา OCR เดิม = แก้แล้ว**.
- FAIL/SKIP ที่เหลือ = **LLM parse (qwen2.5:3b)** จับ column ผิดบนตารางซับซ้อน: เลือก result/spec ผิดช่อง, ยัด result เข้า spec, min↔max สลับ. โมเดล 3b เล็กเกินสำหรับ layout ยาก.
- **พิสูจน์ว่าไม่ใช่ OCR:** text-layer files (ไม่ผ่าน OCR เลย เช่น Suzorite 4 FAIL, RB220/Barimite SKIP) ก็พังแบบเดียวกัน → ปัญหาอยู่ที่ LLM parse ล้วน ๆ.
- ตารางง่าย (D-2072 / PR1950W 6/6 / 1F1710 3/3 / SODA 6/6 / Inolob / TR_1099) ผ่านสะอาด = pipeline ทำงานถูก.

### หมายเหตุ regression
- 3 รอบรัน (ก่อน/หลัง 2 fix): D-2072 4P, PR1950W 6P, 1F1710 3P **ไม่เปลี่ยน** = ไม่ regress.
- Lot240521 1P→0P เป็น **LLM variance บน fax** (v1 ได้ spec "45", v2 ได้ "20 Max" — ทั้งคู่ผิด เพราะ 3b assign spec ผิด row บน fax garbage) ไม่ใช่ผลจาก fix.

Gates: spec-normalizer.test **39/39** · spec-recovery.test **ALL** · evaluator.test fixtures ผ่าน · `tsc --noEmit` clean.

## Fix ที่ทำ (เรียงตามลำดับ)

1. **OCR migration** — Tesseract → RapidOCR sidecar (หัวใจ). ดูบน.
2. **spec-normalizer `≥/≤` direction** — `normalizeSpecFromCandidate`: bare number ใน col → ใช้ทิศ col; ค่าที่มี operator (≥/≤/range) = self-describing → เคารพ operator (กัน "≥ 50" ใน specMax → le ผิด). [D-2072 Heat Resistance]
3. **specRaw authoritative** — `normalizeSpecFromCandidate`: ถ้า specRaw มี operator/range ชัด (non-eq) → เชื่อ specRaw ก่อน min/max. เพราะ LLM ชอบใส่ทั้ง `specRaw:"0.01 Max."` (ถูก) + `specMin:"0.01"` (bare ผิด) → เดิม bare ชนะ → fabricated FAIL. [SODA Insoluble]
4. **correctSpecDirectionFromOcr** (defense-in-depth, ยิง 0× บน corpus นี้) — เผื่อ LLM ให้ bare bound ล้วน ไม่มี specRaw แต่ OCR มี "X Max/Min" → anchor ที่ค่า V หาทิศใน OCR.

## ขั้นต่อไป (ค้างไว้ — ต้อง user ตัดสิน)

**ปัญหาที่เหลือทั้งหมด = LLM parse (qwen 3b) บนตารางซับซ้อน — ไม่ใช่ OCR.** ทางเลือกแก้ (ต้องเลือก):

1. **เปลี่ยน parse model ใหญ่ขึ้น** — qwen2.5:**7b**-instruct (q4 ~5GB) parse ตารางซับซ้อนแม่นกว่า 3b มาก. RAM อาจพอ (vision ไม่โหลด) แต่ต้อง pull (~4.7GB download) + ทดสอบว่ารันไหว. = น่าจะคุ้มสุด แต่ต้องลอง. (ยังไม่ทำ — รอตัดสิน)
2. **tune parse prompt** — เพิ่ม rule จัด column (เลือก result column เดียว, ห้ามยัด result เข้า spec). เสี่ยง regress + non-deterministic + 3b เพดานต่ำ.
3. **per-template parser** — COA แต่ละ supplier layout ต่างกันมาก (RI-015 7 Lot# cols, Suzorite, fax). ทำ parser เฉพาะ template ที่เจอบ่อย = แม่นสุดแต่ใช้แรง.

**อื่น ๆ:**
- **Lot240521 fax** — เคสแย่สุด. ถ้าต้องการให้ผ่าน: preprocess รูป fax (deskew/contrast) หรือ x-clustering ใน `rapidocr.service.ts`. แต่ fax คุณภาพนี้เพดานต่ำ.
- daemon ยัง start เอง (ไม่ auto-spawn) — ถ้า deploy จริงให้ backend spawn หรือทำเป็น service.
- **ยังไม่ commit อะไรเลย** — รอ user สั่ง.

## สถานะ commit (ยังไม่ commit)

ใหม่: `ocr-py/` (sidecar), `backend/src/services/coa/rapidocr.service.ts`, `backend/src/scripts/diag-extract.ts`, `OCR-MIGRATION-SUMMARY.md`
แก้: `coa-pipeline.ts`, `spec-normalizer.ts` (+test), `spec-recovery.ts` (+test), `backend/package.json`, `CLAUDE.md`
ค้างจากก่อนหน้า: `CLAUDE.md`, `ollama-coa.service.ts` (model name)
```
