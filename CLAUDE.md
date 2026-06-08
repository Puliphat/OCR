# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**COA (Certificate of Analysis) analyzer** — extract ข้อความจาก COA → LLM parse → เทียบ result กับ spec → PASS/FAIL/SKIP ต่อรายการ

ชื่อโฟลเดอร์ `OCR` เป็นของเดิม โค้ด invoice ถูกถอดออกแล้ว (ดู git history ถ้าต้องการอ้างอิง) — ปัจจุบัน:

- COA pipeline รันได้ทั้งผ่าน **HTTP** (`POST /api/coa/upload`) และ **CLI** (`src/scripts/test-coa.ts`)
- **มี UI แล้ว** ที่ `app/page.tsx` (upload + ตารางผล) ใช้ react-query เรียก backend
- **ยังไม่ persist ผลลง DB** — `CoaReportEntity` / `CoaItemEntity` ถูกเขียนไว้พร้อมใช้แล้ว แต่ยัง comment ไว้ใน `data-source.ts:entities` และใน route handler (`coa.routes.ts`)
- **DB init ปิดอยู่ default** — `index.ts` จะ init TypeORM เฉพาะเมื่อ `ENABLE_DB=true` ใน env (ไม่งั้น start server เปล่าๆ ไม่ต้องต่อ Postgres)

## Stack

- **Backend**: Express + TypeScript + TypeORM + PostgreSQL + pdfjs-dist + axios → Ollama / OCR sidecar
- **Frontend**: Next.js 16 (app router) + React 19 + Tailwind CSS 4 + @tanstack/react-query + axios
- **OCR sidecar** (`ocr-py/`): Python **RapidOCR `rapidocr` 3.x** (PP-OCRv4 **mobile** default, CPU onnxruntime, models ~16MB / venv ~366MB) — default OCR engine สำหรับ scanned COA. v4 (successor ของ `rapidocr-onnxruntime` ที่ค้างที่ PP-OCRv3 เพราะ pin Requires-Python <3.13). แม่นกว่า Tesseract มากบนตาราง (± ≥ ทศนิยม/multi-column ไม่เพี้ยน). HTTP daemon บน `:8765` (start แยกเหมือน Ollama). Tesseract.js เหลือเป็น fallback อย่างเดียวถ้า daemon ล่ม
  - Override: `COA_OCR_MODEL_TYPE` (`mobile` default | `server`), `COA_OCR_VERSION` (`PP-OCRv4` default | `PP-OCRv5`) — server/v5 auto-download ModelScope. mobile ชนะ corpus (ZP10/RI-015 ground-truth) + เบากว่า 12x
- **LLM**: Ollama HTTP API ที่ `localhost:11434`
  - `qwen3:4b` — parse text → JSON (default; reasoning model → ใส่ `think:false`. A/B vs โมเดลอื่น ดู `src/scripts/ab-models.ts`)
  - Override: `OLLAMA_URL`, `OLLAMA_MODEL`, `OCR_SIDECAR_URL`, `USE_RAPIDOCR`

## Commands

```powershell
# OCR sidecar (ต้อง start ก่อน รัน pipeline กับไฟล์ scan) — daemon บน :8765
cd ocr-py
python -m venv venv                      # ครั้งแรกเท่านั้น
venv\Scripts\pip install -r requirements.txt
# start daemon (ค้างไว้ใน terminal แยก เหมือน Ollama):
cd ..\backend; npm run ocr:daemon        # = ../ocr-py/venv/Scripts/python ../ocr-py/ocr_server.py 8765

# Backend HTTP server (พร้อมรับ /api/coa/upload จาก frontend)
cd backend
npm install
npm run dev                              # nodemon + ts-node, port 3001
npm run build                            # tsc → dist/

# COA pipeline แบบ CLI (รัน batch กับไฟล์ใน uploads/ โดยไม่ผ่าน HTTP)
npx ts-node src/scripts/test-coa.ts                  # ทุกไฟล์ใน backend/uploads/
npx ts-node src/scripts/test-coa.ts path\to\file.pdf # PDF/PNG/JPG เฉพาะไฟล์
# ผลลัพธ์ append ที่ backend/coa-logs/run.log + JSON ต่อรายการ

# COA evaluator regression check (ไม่ต้องพึ่ง Ollama — print-based, ไม่มี test runner)
npx ts-node src/services/coa/evaluator.test.ts

# Frontend
cd frontend
npm install
npm run dev                              # Next.js, port 3000
npm run lint
npm run build
```

### Env (backend `.env`)

```
DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=postgres  DB_PASSWORD=postgres  DB_NAME=invoice_db
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=qwen3:4b
OCR_SIDECAR_URL=http://127.0.0.1:8765    # RapidOCR daemon (default)
USE_RAPIDOCR=true                        # false = ข้าม sidecar ใช้ Tesseract เลย
COA_OCR_MODEL_TYPE=mobile                # mobile (default) | server  — อ่านโดย ocr-py/ocr_server.py
COA_OCR_VERSION=PP-OCRv4                 # PP-OCRv4 (default) | PP-OCRv5
PORT=3001
```

ชื่อ DB default ยังเป็น `invoice_db` (ของเดิม) — เปลี่ยนได้ผ่าน `DB_NAME` env หรือ default ใน `data-source.ts`
TypeORM `synchronize: true` — เพิ่ม entity เมื่อไร ตารางใน Postgres รีเฟลคอัตโนมัติตอน start

## โครงสร้างโดยรวม

```
backend/src/
├── index.ts                    entry: เปิด Express, mount /api/coa, init DB
├── data-source.ts              TypeORM config (entities ยัง comment ไว้)
├── routes/coa.routes.ts        POST /api/coa/upload, GET /api/coa/health
├── entities/                   มีไฟล์แล้วแต่ยัง inactive รอ enable
│   ├── CoaReportEntity.ts
│   └── CoaItemEntity.ts
├── scripts/test-coa.ts         CLI runner (batch ไฟล์ใน uploads/)
└── services/
    ├── pdf.service.ts                 PDF → PNG (pdfjs render, scale 2000/width)
    ├── image-processing.service.ts    sharp preprocess ก่อน OCR
    └── coa/                           ★ หัวใจของระบบ ★
        ├── coa-pipeline.ts            orchestrator (3 steps)
        ├── pdf-text-extractor.ts      ดูด text-layer จาก PDF (ฟรี, ไม่ต้อง OCR)
        ├── rapidocr.service.ts        ★ ยิง OCR sidecar (:8765) + จัด tokens เป็นแถว ★
        ├── ollama-coa.service.ts      เรียก Ollama (qwen3:4b) → JSON (prompt อยู่ที่นี่)
        ├── coa-evaluator.ts           PASS/FAIL/SKIP + summary
        ├── spec-normalizer.ts         parse spec format (range, ±, ≤≥, …)
        ├── result-normalizer.ts       parse result (รับ number/string/{avg,min,max})
        ├── spec-normalizer.test.ts
        └── evaluator.test.ts          fixtures จากใบจริง

frontend/
├── app/page.tsx                UI: upload form + ตารางผล
├── components/providers.tsx    react-query provider
└── lib/
    ├── axios.ts                baseURL → localhost:3001
    └── types.ts                CoaRow, UploadResponse

ocr-py/                         ★ Python OCR sidecar ★
├── ocr_server.py              HTTP daemon (:8765) — RapidOCR loaded once, POST /ocr {path}→tokens
├── render_and_test.py         standalone test: render 8 scanned PDFs + OCR + dump _scan_test/
├── requirements.txt           rapidocr (3.x), onnxruntime, opencv-python-headless, pymupdf
└── venv/                      (gitignored)
```

## COA pipeline (สิ่งที่ต้องอ่านก่อนแก้)

**3 ขั้น** (อยู่ใน `backend/src/services/coa/coa-pipeline.ts`):

1. **Text extraction** (`coa/pdf-text-extractor.ts`) — ลอง PDF text-layer ก่อน (เร็ว/ฟรี) — ถ้า `hasUsableText = false` (น้อยกว่า 100 chars หลัง strip whitespace) → `pdf.service.convertToImage` (หน้า 1, scale = 2000/width) → **RapidOCR sidecar** (`coa/rapidocr.service.ts` ยิง daemon :8765, คืน tokens+box → จัดเป็นแถวด้วย `reconstructText`) → ถ้า daemon ล่ม fall back Tesseract `eng+tha` (multi-rotation)
2. **LLM parse** (`coa/ollama-coa.service.ts:parseCoa`) — Ollama qwen3:4b (`think:false`), `format: "json"`, `temperature: 0`, `keep_alive: 0` — prompt บังคับ shape `{ product, lotNo, items[{name,unit,method,specRaw,specMin,specMax,result}] }` และให้ใช้ Avg column ถ้ามี
3. **Deterministic evaluator** (`coa/coa-evaluator.ts`) → status `PASS`/`FAIL`/`SKIP` ต่อ row พร้อม `reason` + summary

**`spec-normalizer.ts`** จัดการ format จริงที่เจอ:
- range: `275-425`, `0.6~0.8`, `40.0 ~ 70.0`, `105〜115`
- tolerance: `26 ± 2`, `120 +/- 30`
- bounds: `≤`/`≦`/`<=`/`Max.`, `≥`/`≧`/`>=`/`Min.`, strict `<`/`>`
- bare number → eq
- รับทั้ง `specRaw` คอลัมน์เดียว และ `specMin`+`specMax` แยกคอลัมน์ (ดู `normalizeSpecFromCandidate`)

**`result-normalizer.ts`** รับ number / string / `{avg,min,max,raw}` — reject ค่าที่ไม่ขึ้นต้นด้วยตัวเลข (`White`, `K2Ti6O13`) → status เป็น SKIP ไม่ใช่ FAIL

**`evaluator.test.ts`** = mock fixture จากใบจริง (Inolob T204F, Twaron TR_1099, TXAX-A, D-2072) + failing case — ใช้ตรวจ regression เวลาแก้ normalizer

## จุดที่แก้บ่อย (cheatsheet)

| ต้องการแก้ | ไปที่ |
|---|---|
| LLM parse ผิด / เพิ่ม field | `coa/ollama-coa.service.ts` (prompt ใน `parseCoa`) |
| spec format ใหม่ที่ pipeline อ่านไม่เข้าใจ | `coa/spec-normalizer.ts` + เพิ่ม fixture ที่ `evaluator.test.ts` |
| result column รูปแบบใหม่ | `coa/result-normalizer.ts` |
| OCR อ่านไม่ออก (scan) | start daemon ก่อน (`npm run ocr:daemon`) · ปรับ row-grouping ที่ `coa/rapidocr.service.ts` · daemon settings `ocr-py/ocr_server.py` · text-layer threshold `coa/pdf-text-extractor.ts` |
| spec อ่านถูกแต่ PASS/FAIL กลับด้าน | `coa/spec-normalizer.ts` (`normalizeSpecFromCandidate` เคารพ operator ≥/≤ ในค่า ไม่ยึดทิศ column) |
| เพิ่ม endpoint / รับ field เพิ่ม | `routes/coa.routes.ts` |
| UI ตาราง / สี / column | `frontend/app/page.tsx` (`ResultTable`, `StatusPill`) |
| เปิด persist DB | (1) เติม `ENABLE_DB=true` + `DB_PASSWORD=...` ใน `.env` (2) uncomment `entities` ใน `data-source.ts` (3) uncomment block ใต้ `// TODO: persist ลง DB` ใน `routes/coa.routes.ts` |

## Context management (สำคัญ — ป้องกัน context เต็ม → ทำงานคลาดเคลื่อน)

- **ทุกครั้งที่ compress → บันทึก decision สำคัญลง memory vault ทันที** (SessionEnd hook ทำงานอัตโนมัติแล้ว แต่ decision ใหม่ให้ save เอง)
- **ก่อนเริ่มงานใหม่ → search memory ก่อนเสมอ** อย่าวางใจ context ที่ย่อไป
- **งานข้าม session → อ่าน MEMORY.md + memory_search ก่อนเริ่ม**
- **decision/fix/bug/non-obvious → save ทันที** อย่ารอ session end

## Reference template (อ่านประกอบ — stack ไม่ตรง)

`C:\local repo\setupskills` มี template CLAUDE.md/SKILL.md (Express + pg raw SQL + Zod + asyncHandler + Vite + AntD) — **stack ต่างจาก repo นี้** (เราใช้ TypeORM + Next.js 16 + Tailwind) อย่ายก pattern เข้ามาทั้งดุ้นโดยไม่ตกลงกันก่อน
