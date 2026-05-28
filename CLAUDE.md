# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**COA (Certificate of Analysis) analyzer** — extract ข้อความจาก COA → LLM parse → เทียบ result กับ spec → PASS/FAIL/SKIP ต่อรายการ

ชื่อโฟลเดอร์ `OCR` เป็นของเดิม โค้ด invoice ถูกถอดออกแล้ว (ดู git history ถ้าต้องการอ้างอิง) — ปัจจุบัน:

- COA pipeline รันผ่าน CLI script (`src/scripts/test-coa.ts`)
- **ยังไม่มี HTTP route** สำหรับ COA — `src/index.ts` start Express ขึ้นเปล่าๆ พร้อม TODO ให้เพิ่ม route
- **ยังไม่มี COA UI** — `app/page.tsx` เป็น placeholder รอเชื่อม
- **ยังไม่ persist ผลลง DB** — `data-source.ts` มี `entities: []` ว่าง พร้อมรับ entity ใหม่ (เช่น `CoaReport`, `CoaItem`) เมื่อพร้อมเก็บ

## Stack

- **Backend**: Express + TypeScript + TypeORM + PostgreSQL + Tesseract.js + pdfjs-dist + axios → Ollama
- **Frontend**: Next.js 16 (app router) + React 19 + Tailwind CSS 4 + @tanstack/react-query + axios
- **OCR/LLM**: Tesseract (`eng+tha`, traineddata อยู่ที่ `backend/eng.traineddata` + `tha.traineddata`), Ollama HTTP API ที่ `localhost:11434`
  - `gemma3` — parse text → JSON
  - `scb10x/typhoon-ocr-3b` — vision OCR (COA pipeline ปิดไว้เพราะกินแรม ~7.5GB; ใช้ Tesseract fallback แทน)
  - Override: `OLLAMA_URL`, `OLLAMA_CHAT_URL`, `OLLAMA_MODEL`, `OLLAMA_OCR_MODEL`

## Commands

```powershell
# COA pipeline (วิธีรันหลัก ณ ตอนนี้)
cd backend
npm install
npx ts-node src/scripts/test-coa.ts                  # ทุกไฟล์ใน backend/uploads/
npx ts-node src/scripts/test-coa.ts path\to\file.pdf # PDF/PNG/JPG เฉพาะไฟล์
# ผลลัพธ์ append ที่ backend/coa-logs/run.log

# COA evaluator regression check (ไม่ต้องพึ่ง Ollama — print-based, ไม่มี test runner)
npx ts-node src/services/coa/evaluator.test.ts

# Backend HTTP server (รอเพิ่ม COA route)
npm run dev                              # nodemon + ts-node, port 3001
npm run build                            # tsc → dist/

# Frontend (รอ COA UI)
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
OLLAMA_CHAT_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma3
OLLAMA_OCR_MODEL=scb10x/typhoon-ocr-3b
PORT=3001
```

ชื่อ DB default ยังเป็น `invoice_db` (ของเดิม) — เปลี่ยนได้ผ่าน `DB_NAME` env หรือ default ใน `data-source.ts`
TypeORM `synchronize: true` — เพิ่ม entity เมื่อไร ตารางใน Postgres รีเฟลคอัตโนมัติตอน start

## COA pipeline (สิ่งที่ต้องอ่านก่อนแก้)

ทั้งหมดอยู่ใน `backend/src/services/coa/` + `src/scripts/test-coa.ts` + `src/services/pdf.service.ts` + `src/services/image-processing.service.ts` (สองตัวท้าย shared infra)

**3 ขั้น:**

1. **Text extraction** (`coa/pdf-text-extractor.ts`) — ลอง PDF text-layer ก่อน (เร็ว/ฟรี) — ถ้า `hasUsableText = false` (น้อยกว่า 100 chars หลัง strip whitespace) → fallback ไป `pdf.service.convertToImage` (หน้า 1, scale = 2000/width) → `image-processing.service.processImage` (sharp preprocess) → Tesseract `eng+tha` ใน `test-coa.ts:getText()`
2. **LLM parse** (`coa/ollama-coa.service.ts:parseCoa`) — Ollama gemma3, `format: "json"`, `temperature: 0`, `keep_alive: 0` — prompt บังคับ shape `{ product, lotNo, items[{name,unit,method,specRaw,specMin,specMax,result}] }` และให้ใช้ Avg column ถ้ามี
3. **Deterministic evaluator** (`coa/coa-evaluator.ts`) → status `PASS`/`FAIL`/`SKIP` ต่อ row พร้อม `reason` + summary

**`spec-normalizer.ts`** จัดการ format จริงที่เจอ:
- range: `275-425`, `0.6~0.8`, `40.0 ~ 70.0`, `105〜115`
- tolerance: `26 ± 2`, `120 +/- 30`
- bounds: `≤`/`≦`/`<=`/`Max.`, `≥`/`≧`/`>=`/`Min.`, strict `<`/`>`
- bare number → eq
- รับทั้ง `specRaw` คอลัมน์เดียว และ `specMin`+`specMax` แยกคอลัมน์ (ดู `normalizeSpecFromCandidate`)

**`result-normalizer.ts`** รับ number / string / `{avg,min,max,raw}` — reject ค่าที่ไม่ขึ้นต้นด้วยตัวเลข (`White`, `K2Ti6O13`) → status เป็น SKIP ไม่ใช่ FAIL

**`evaluator.test.ts`** = mock fixture จากใบจริง (Inolob T204F, Twaron TR_1099, TXAX-A, D-2072) + failing case — ใช้ตรวจ regression เวลาแก้ normalizer

## Next steps (เปิดทาง — ยังไม่มี)

1. สร้าง entity `CoaReport` + `CoaItem` ใน `src/entities/` แล้วเพิ่มเข้า `data-source.ts:entities`
2. เขียน controller/route — รับ upload (multer ใน `index.ts`), เรียก COA pipeline เหมือนใน `test-coa.ts:processFile`, save ผ่าน TypeORM, return `CoaReport`
3. Frontend: เขียน UI ใหม่ที่ `app/page.tsx` ใช้ react-query + axios (`lib/axios.ts`, baseURL `http://localhost:3001`) เพื่อ upload + แสดง result table

## Reference template (อ่านประกอบ — stack ไม่ตรง)

`C:\local repo\setupskills` มี template CLAUDE.md/SKILL.md (Express + pg raw SQL + Zod + asyncHandler + Vite + AntD) — **stack ต่างจาก repo นี้** (เราใช้ TypeORM + Next.js 16 + Tailwind) อย่ายก pattern เข้ามาทั้งดุ้นโดยไม่ตกลงกันก่อน
