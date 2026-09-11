# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**COA (Certificate of Analysis) analyzer** — ดูดข้อความจาก COA → parse เป็นตาราง → เทียบ result กับ spec → PASS/FAIL/SKIP ต่อรายการ

ชื่อโฟลเดอร์ `OCR` เป็นของเดิม โค้ด invoice ถูกถอดออกแล้ว (ดู git history ถ้าต้องการอ้างอิง) — ปัจจุบัน:

- รันได้ทั้ง **HTTP** (`POST /api/coa/upload`) และ **CLI** (`src/scripts/test-coa.ts`)
- **UI ใช้งานจริงแล้ว** — upload หลายไฟล์ได้ (สูงสุด 20), backend **เข้าคิวรันทีละงาน** (OCR/LLM มีตัวเดียว),
  หน้าเว็บ poll ความคืบหน้าแล้วโชว์ผลแยก **3 ช่อง: ผ่าน / ต้องตรวจ / ไม่ผ่าน**
- **ยังไม่ persist ผลลง DB** — `CoaReportEntity` / `CoaItemEntity` เขียนไว้พร้อมแล้วแต่ยัง comment ไว้ใน
  `data-source.ts:entities` และใน route handler · **DB init ปิด default** (`index.ts` init TypeORM เฉพาะเมื่อ `ENABLE_DB=true`)
- **ลงหน้างานจริงแล้ว** (โรงงาน, air-gapped) — ดู `DEPLOY.md` + `INSTALL-OFFLINE.md`

## Stack

- **Backend**: Express + TypeScript + TypeORM + PostgreSQL + pdfjs-dist + sharp + axios
- **Frontend**: Next.js 16 (app router) + React 19 + Tailwind 4 + @tanstack/react-query + axios · CSS แยกไฟล์ตาม section ที่ `app/styles/*`
- **Python sidecar** (`ocr-py/`) — **2 เส้น ล่มแยกกันได้**:
  - **RapidOCR daemon `:8765`** (`ocr_server.py`) — ไฟล์สแกน. start แยกเหมือน Ollama
  - **pdfplumber** (`pdf_table.py`) — backend spawn เป็น process สั้นๆ ต่อไฟล์ อ่านตารางของ PDF ที่มี text-layer
    (ไม่ผ่าน LLM). พัง → `PDF_GRID_DOWN` ทั้งที่ `:8765` ยังเขียว
- **LLM**: Ollama HTTP API ที่ `localhost:11434` — `qwen3:4b` parse text → JSON (reasoning model → ใส่ `think:false`)

### OCR engine — 3 ตัวใน daemon เดียว

ทุกตัวอยู่ใน `VARIANTS` ของ `ocr-py/ocr_server.py`, lazy-load, ใช้ lock เดียวไม่รันพร้อมกัน

| variant | model | ยิงเมื่อไร |
|---|---|---|
| `default` | mobile / PP-OCRv4 | ทุกหน้าที่เป็นสแกน |
| `hq` | server / PP-OCRv5 | หน้าที่ default อ่านจน SKIP เยอะ (challenger) |
| `th` | mobile / PP-OCRv5 + rec dict ไทย | ทุกหน้าสแกน แต่ **ทิ้งทันทีถ้าอักษรไทยไม่ถึงทั้ง 20 ตัวและ 8% ของหน้า** |

★ **ไม่มี fallback engine** ★ — Tesseract ถูกถอดออก (`61e5989`) เพราะมันอ่านได้แต่เลขเพี้ยน = deceptive PASS/FAIL
ซึ่งแย่กว่าพังดังๆ. daemon ล่ม → `OCR_DAEMON_DOWN` → หน้าเว็บเตือน + สั่ง restart daemon ให้อัตโนมัติ

**challenger ทุกตัวผ่าน keep-best เหมือนกัน**: เพิ่ม PASS, 0 FAIL, **PASS เดิมต้องครบ** ไม่งั้นทิ้งผลนั้น = anti-regression

> **ด่านของ challenger ต้องเป็นสัญญาณที่ engine เดิมปลอมไม่ได้ ไม่ใช่ verdict.** ใบไทยเข้า engine default แล้ว
> เลข/spec ถูกหมดแต่**ชื่อรายการหายทั้งคอลัมน์** → ไม่มีแถวไหนเป็น SKIP → trigger ของ HQ ไม่มีทางยิง.
> ด่านไทยจึงวัดจาก "dict ของ engine เดิมมีอักษรไทย 0 ตัว" ซึ่งปลอมไม่ได้ (วัดจริง: ใบ CJK/อังกฤษรั่วสูงสุด 0.64% · ใบไทย 39.9%)

**คุณภาพ rec ไทย — พูดตรงๆ:** ตัวเลขและ operator `≤ ≥ ± ~` อ่าน**เท่า default เป๊ะ** คำตัดสินจึงไม่เพี้ยนตามคุณภาพชื่อแถว ·
ข้อความยาวอ่านดี (หัวใบ/ชื่อสินค้า/เลขล็อต) · **ช่องสั้นในตารางถูกแค่ ~30%** · **ยังไม่เคยทดสอบกับใบไทยสแกนของจริง**

## Commands

```powershell
# OCR sidecar — ต้อง start ก่อนรัน pipeline กับไฟล์สแกน (ค้างไว้ terminal แยก เหมือน Ollama)
cd ocr-py
python -m venv venv                      # ครั้งแรกเท่านั้น
venv\Scripts\pip install -r requirements.txt
cd ..\backend; npm run ocr:daemon        # daemon :8765

# Backend
cd backend
npm install
npm run dev                              # nodemon + ts-node, port 3001
npm run build                            # tsc -> dist/

# Frontend
cd frontend
npm install
npm run dev                              # Next.js, port 3000
npm run lint
npm run build

# CLI (รัน batch โดยไม่ผ่าน HTTP) — ผล append ที่ backend/coa-logs/run.log + JSON ต่อรายการ
npx ts-node src/scripts/test-coa.ts                  # ทุกไฟล์ใน backend/uploads/
npx ts-node src/scripts/test-coa.ts path\to\file.pdf

# Unit test — print-based ทั้งหมด ไม่มี test runner ไม่ต้องพึ่ง Ollama
npx ts-node src/services/coa/evaluator.test.ts       # ทีละไฟล์ (มี ~30 ไฟล์ *.test.ts)

# Corpus gate — ทำตาม skill `coa-corpus-verify` (บังคับเมื่อ diff แตะ services/coa/)
```

### Env (backend `.env`)

```
PORT=3001
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=qwen3:4b
OLLAMA_KEEP_WARM=true                    # false = ปิด warm ping (upload แรกหลัง idle เจอ ~37s model reload)
OCR_SIDECAR_URL=http://127.0.0.1:8765    # ตั้ง http://<LAN_IP>:8765 ถ้า daemon อยู่คนละเครื่อง
OCR_PY_PYTHON=                           # path python.exe ของ venv (เว้นว่าง = หา ocr-py/venv เอง) — ใช้กับ pdfplumber
COA_QUEUE_CONCURRENCY=1                  # งานพร้อมกันกี่งาน — 1 เพราะ OCR/LLM มีตัวเดียว

# DB — ปิด default ไม่ต้องต่อ Postgres
ENABLE_DB=                               # true = init TypeORM (ต้อง uncomment entities ใน data-source.ts ด้วย)
DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=postgres  DB_PASSWORD=postgres  DB_NAME=invoice_db
```

**สวิตช์ปิด/เปิด lever (ทุกตัว default เปิด — ใช้ตอนทำ A/B หาว่าตัวไหนทำผลเปลี่ยน)**

```
COA_GRID_LLM=false                       # ปิด deterministic grid ไม่ให้แข่งกับ flat LLM
COA_AVG_COLUMN=false                     # ปิดการกู้ค่าจากคอลัมน์ Avg
COA_SPEC_COLUMN=false                    # ปิดการกู้ spec จากคอลัมน์ Specification (DuPont)
COA_OCR_HQ_FALLBACK=false                # ปิด HQ challenger
COA_OCR_TH_FALLBACK=false                # ปิด challenger ใบไทย (ประหยัด ~10s/หน้าสแกน แลกกับอ่านใบไทยไม่ออก)
COA_OCR_TH_MIN_CHARS=20                  # ด่านไทยข้อ 1 — เว้นว่าง/พิมพ์ผิด กลับไปใช้ default ไม่ใช่ปล่อยผ่านทุกหน้า
COA_OCR_TH_MIN_RATIO=0.08                # ด่านไทยข้อ 2 (สัดส่วนต่ออักษรทั้งหน้า)
COA_OCR_HQ_SPECULATE=true                # ยิง HQ OCR ซ่อนใต้ LLM parse — ★ เปิดเฉพาะ daemon คนละเครื่อง ★
                                         #   เครื่องเดียวกันวัดแล้วช้าลง (HQ engine กิน CPU เบียด Ollama)
```

**ฝั่ง daemon (`ocr-py/ocr_server.py` อ่านเอง)**

```
OCR_BIND_HOST=0.0.0.0                    # 0.0.0.0 = รับ LAN (deploy default) | 127.0.0.1 = เฉพาะเครื่อง
COA_OCR_MODEL_TYPE / COA_OCR_VERSION             # engine default (mobile / PP-OCRv4)
COA_OCR_HQ_MODEL_TYPE / COA_OCR_HQ_VERSION       # engine hq      (server / PP-OCRv5)
COA_OCR_TH_MODEL_TYPE / COA_OCR_TH_VERSION       # engine th      (mobile / PP-OCRv5)
COA_OCR_HQ_PRELOAD=false                 # HQ กลับเป็น lazy-load (ประหยัด RAM, request hq แรกช้า)
COA_OCR_RETRY_MAX_SIDE=1400              # HQ จอง memory ไม่ได้ → อ่านซ้ำที่ด้านยาวเท่านี้ (0 = ปิด)
                                         #   ได้ครึ่งความละเอียดปกติ → ถ้าชนะ pipeline ปักธง needsReview ทั้งหน้า
```

ชื่อ DB default ยังเป็น `invoice_db` (ของเดิม) · TypeORM `synchronize: true` — เพิ่ม entity เมื่อไร ตารางรีเฟลคอัตโนมัติตอน start

## โครงสร้าง

```
backend/src/
├── index.ts                 entry: Express + mount /api/coa + keep-warm Ollama + (optional) init DB
├── data-source.ts           TypeORM config — entities ยัง comment ไว้
├── routes/coa.routes.ts     upload · queue · jobs · health · ocr/restart
├── entities/                CoaReportEntity / CoaItemEntity — เขียนไว้แล้วแต่ยัง inactive
├── scripts/                 CLI: test-coa (batch) · dump-tokens / dump-text-layer / diag-extract (diagnostic) · ab-models
└── services/
    ├── pdf.service.ts               PDF → PNG (pdfjs render, scale 2000/width)
    ├── image-processing.service.ts  sharp preprocess ก่อน OCR
    ├── ocr-daemon.ts                สั่ง restart daemon จากหน้าเว็บ
    ├── queue/job-queue.ts           คิวงาน: รันทีละงาน + รายงานลำดับ/ETA + กวาดงานเก่าทิ้ง
    └── coa/                         ★ หัวใจของระบบ — 36 ไฟล์ + test อีก 30 ★

frontend/
├── app/page.tsx             orchestrator: state + mutation + ประกอบ component (ไม่มี markup ย่อย)
├── app/styles/*.css         สไตล์แยกตาม section (globals.css แค่ import ตามลำดับ)
├── components/coa/*         UI ย่อยทั้งหมด
└── lib/                     axios (baseURL) · types (contract กับ backend) · format (3 ช่องผล + แปลงเลขขึ้นจอ)

ocr-py/
├── ocr_server.py            HTTP daemon :8765 — 3 engine variants, POST /ocr {image_b64|path, hq, lang} → tokens
├── pdf_table.py             pdfplumber: ดึงตารางจาก PDF text-layer (backend spawn ต่อไฟล์)
├── render_and_test.py       standalone: render PDF + OCR + dump ผลดิบ
└── venv/                    (gitignored) — ต้องมีทั้ง rapidocr และ pdfplumber
```

### `services/coa/` — จัดกลุ่มตามหน้าที่

ไฟล์เยอะและเพิ่มเรื่อยๆ **อย่าอ่านไล่ทีละไฟล์** — ดูกลุ่มก่อน แล้วเปิดเฉพาะตัวที่เกี่ยว
(ทุกไฟล์มี comment หัวไฟล์บอกว่ามีไว้ทำไม · ไฟล์ `*.test.ts` คู่กันคือ fixture จากใบจริง)

| กลุ่ม | ไฟล์ | หน้าที่ |
|---|---|---|
| **orchestrator** | `coa-pipeline.ts` | คุมลำดับทั้งหมด + challenger + keep-best ★ อ่านตัวนี้ก่อนเสมอ ★ |
| **ดึงข้อความ** | `pdf-text-extractor.ts` · `rapidocr.service.ts` | text-layer (ฟรี) vs OCR sidecar |
| **อ่านตารางแบบ deterministic** | `pdf-grid-extractor.ts` · `parse-structural-grid.ts` · `ocr-grid.ts` · `scanned-grid-builder.ts` | ไม่ผ่าน LLM — แข่งกับ flat LLM แล้วเก็บตัวที่ดีกว่า |
| **LLM** | `ollama-coa.service.ts` | prompt อยู่ที่นี่ |
| **ตัดสิน** | `coa-evaluator.ts` · `spec-normalizer.ts` · `result-normalizer.ts` · `numeric.ts` | PASS/FAIL/SKIP + reason |
| **ด่านกันผลปลอม** | `coa-grounding.ts` · `metadata-row-filter.ts` · `spec-bound-grounding.ts` | ตัดแถวที่ LLM แต่ง · downgrade PASS/FAIL ที่พิสูจน์ไม่ได้ |
| **ตัวซ่อมต่อ pattern** | `*-recovery.ts` (17 ตัว) · `header-direction.ts` · `shared-spec-cell.ts` · `method-cell-shift.ts` · `split-name-merge.ts` | แต่ละตัวแก้ layout แบบเดียว — ชื่อไฟล์บอกว่าแบบไหน |

## COA pipeline (สิ่งที่ต้องอ่านก่อนแก้)

**ต่อไฟล์** — วนทุกหน้า → กู้ product/lot จากหัวใบ → ใบ multi-batch หลายหน้ายันกันเอง (`reconcileDupontSpecs`) → สรุปใหม่

**ต่อหน้า** — ลอง text-layer ก่อน (เร็ว/ฟรี) ถ้า `hasUsableText = false` (น้อยกว่า **300 chars** หลัง strip whitespace
**หรือ** `looksDecodable` ตก — text-layer ที่ decode ไม่ออกทำตัวเลขหายเกลี้ยง) → render เป็น PNG → ยิง OCR daemon.
จากนั้น **flat LLM แข่งกับ deterministic grid** เก็บตัวที่ดีกว่า → ถ้าเป็นสแกน ยิง Thai challenger → ถ้ายัง SKIP เยอะ ยิง HQ challenger

**ต่อ pass** — parse (grid หรือ LLM) → **guard/recovery หลายสิบตัวเรียงกัน** → `evaluateCoa` →
**guard หลัง evaluate** → สรุปใหม่ → margin-green (เคลียร์ธงเหลืองที่ผ่านเกณฑ์ value-trust)

★ **ลำดับสำคัญกว่าตัว guard เอง** ★ — guard หลายตัวแก้ item ในที่ ตัวถัดไปเห็นผลของตัวก่อน สลับลำดับ = เปลี่ยนผล

**`spec-normalizer.ts`** จัดการ format จริงที่เจอ: range `275-425` / `0.6~0.8` / `105〜115` · tolerance `26 ± 2` ·
bounds `≤ ≦ <= Max.` `≥ ≧ >= Min.` · strict `< >` · bare number → eq · รับทั้ง `specRaw` คอลัมน์เดียวและ `specMin`+`specMax` แยกคอลัมน์

**`result-normalizer.ts`** รับ number / string / `{avg,min,max,raw}` — ค่าที่ไม่ขึ้นต้นด้วยตัวเลข (`White`, `K2Ti6O13`) → SKIP ไม่ใช่ FAIL

## จุดที่แก้บ่อย (cheatsheet)

| ต้องการแก้ | ไปที่ |
|---|---|
| LLM parse ผิด / เพิ่ม field | `coa/ollama-coa.service.ts` (prompt ใน `parseCoa`) |
| spec format ใหม่ที่อ่านไม่เข้าใจ | `coa/spec-normalizer.ts` + เพิ่ม fixture ที่ `spec-normalizer.test.ts` |
| result column รูปแบบใหม่ | `coa/result-normalizer.ts` |
| spec อ่านถูกแต่ PASS/FAIL กลับด้าน | `coa/spec-normalizer.ts` (`normalizeSpecFromCandidate` เคารพ operator ≥/≤ ในค่า ไม่ยึดทิศ column) |
| layout ใหม่ที่ยังไม่มีใครอ่านออก | เพิ่ม `*-recovery.ts` ตัวใหม่ + ต่อเข้า `runExtractionPass` **ให้ถูกลำดับ** |
| ตารางของ PDF text-layer อ่านเพี้ยน | `ocr-py/pdf_table.py` · `coa/parse-structural-grid.ts` |
| ใบไทยสแกนอ่านไม่ออก / ชื่อรายการไทยเพี้ยน | `ocr-py/ocr_server.py` (`VARIANTS.th`) · ด่าน + challenger ที่ `coa/coa-pipeline.ts` (`thaiChallenge`) · ป้าย product/lot ที่ `coa/product-lot-recovery.ts` |
| OCR อ่านไม่ออก (สแกน) | start daemon ก่อน (`npm run ocr:daemon`) · row-grouping ที่ `coa/rapidocr.service.ts` · threshold text-layer ที่ `coa/pdf-text-extractor.ts` |
| เพิ่ม endpoint / รับ field เพิ่ม | `routes/coa.routes.ts` (+ `frontend/lib/types.ts` — contract ร่วม แก้คู่กัน) |
| คิวงาน / ETA / ลำดับ | `services/queue/job-queue.ts` |
| UI ตาราง / สี / การจัด 3 ช่อง | `frontend/components/coa/*` (`ResultsCard` / `ResultRow` / `StatStrip`) · เกณฑ์แบ่งช่องที่ `frontend/lib/format.ts` (`rowBucket`) |
| เปิด persist DB | (1) `ENABLE_DB=true` + `DB_PASSWORD=...` ใน `.env` (2) uncomment `entities` ใน `data-source.ts` (3) uncomment block ใต้ `// TODO: persist ลง DB` ใน `routes/coa.routes.ts` |

## ★ Priority #1 — ไม่เอา deceptive PASS/FAIL ★

verdict ที่ได้จากเลขอ่านผิด/ปั้น/map ผิดแถว **แย่กว่าไม่ตอบ**. ทุก fix เป็น deterministic TypeScript/regex — **ไม่เทรน model**

หลักการนี้อธิบายทุกอย่างที่ดูแปลกในโค้ดนี้: ทำไม bound result (`<15`) ห้าม FAIL · ทำไม bare-eq spec โดน downgrade เป็น SKIP ·
ทำไม challenger ที่อ่านดีกว่าถูกปฏิเสธถ้ามันทับ PASS เดิม · ทำไม daemon ล่มแล้วพังดังๆ ไม่มี fallback

**ฝั่ง FAIL ใช้คนละกติกา (user เคาะ 2026-09-11):** ค่าหลุดเกณฑ์ = **ไม่ผ่าน เสมอ** ·
guard ที่เคยกด FAIL→SKIP ตอนนี้คง FAIL แล้วปักธง `needsReview` แทน · ใบเขียนผลเป็นคำ (`Traces`/`N/A`)
ทั้งที่เกณฑ์เป็นตัวเลข = FAIL · แต่**ค่าผลว่าง (ระบบอ่านไม่ได้) = SKIP** — คนละเรื่อง ห้ามยุบรวม

**แตะอะไรใน `services/coa/` ต้องรัน corpus gate ก่อน commit** — ทำตาม skill `coa-corpus-verify`
(ห้ามบอกว่า "แก้แล้ว" โดยไม่รัน gate)

## เจ้าของข้อมูลแต่ละเรื่อง (อย่าเขียนซ้ำข้ามไฟล์)

| เรื่อง | ไฟล์ |
|---|---|
| ประวัติทุกรอบที่แก้ · baseline ปัจจุบัน · งานค้าง | `backend/src/services/coa/TEST-LOG.md` |
| หลักการ + วิธีรัน/debug ระหว่างพัฒนา | `backend/src/services/coa/DEV-NOTES.md` |
| วิธีรัน corpus gate + เกณฑ์ block/ผ่าน | `.claude/skills/coa-corpus-verify/SKILL.md` |
| deploy หน้างาน | `DEPLOY.md` · `INSTALL-OFFLINE.md` (air-gapped) |
| ประวัติ migration Tesseract → RapidOCR | `OCR-MIGRATION-SUMMARY.md` (superseded, เก็บเป็นประวัติ) |

## Context management

- **ก่อนเริ่มงานใหม่ → search memory ก่อนเสมอ** อย่าวางใจ context ที่ย่อไป
- **ทุกครั้งที่ compress → บันทึก decision สำคัญลง memory vault ทันที**
- **decision / fix / bug / non-obvious → save ทันที** อย่ารอ session end

## Reference template (อ่านประกอบ — stack ไม่ตรง)

`C:\local-repo\skills\setupskills` มี template CLAUDE.md/SKILL.md (Express + pg raw SQL + Zod + asyncHandler + Vite + AntD)
— **stack ต่างจาก repo นี้** (เราใช้ TypeORM + Next.js 16 + Tailwind) อย่ายก pattern เข้ามาทั้งดุ้นโดยไม่ตกลงกันก่อน
