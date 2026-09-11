# COA Analyzer — Dev Notes / Handoff

> อ่านไฟล์นี้ก่อนพัฒนาต่อ. ที่นี่เก็บเฉพาะ**หลักการกับวิธีรัน** — ของที่เปลี่ยนทุกรอบ (ตัวเลข baseline,
> รายการ guard, งานค้าง) อยู่ที่ `TEST-LOG.md` ไฟล์เดียว **อย่า restate ที่นี่**

## ★ Priority #1 (ห้ามลืม) ★

**ไม่เอา deceptive PASS/FAIL** — verdict ที่ได้จากเลขอ่านผิด/ปั้น/map ผิดแถว.
ทุก fix เป็น deterministic TypeScript/regex — **ไม่เทรน model**.

หลักการนี้อธิบายทุกอย่างที่ดูแปลกในโค้ดนี้: ทำไม bound result (`<15`) ห้าม FAIL · ทำไม bare-eq spec โดน downgrade
เป็น SKIP · ทำไม challenger ที่อ่านดีกว่าถูกปฏิเสธถ้ามันทับ PASS เดิม · ทำไม daemon ล่มแล้วพังดังๆ ไม่มี fallback

⚠️ **ฝั่ง FAIL เปลี่ยนนโยบายแล้ว (user เคาะ 2026-09-11)** — เดิม "อ่านไม่ชัด → กด FAIL ลงเป็น SKIP",
ตอนนี้ **ค่าหลุดเกณฑ์ = ไม่ผ่าน เสมอ** ใช้ธง `needsReview` บอกความไม่แน่ใจแทนการเปลี่ยน verdict ·
ผลเป็นคำ (`Traces`/`N/A`) ทั้งที่เกณฑ์เป็นตัวเลข = FAIL · **ค่าผลว่าง (อ่านไม่ได้) = SKIP** ห้ามยุบรวมกัน

## Pipeline order (`coa-pipeline.ts`)

**ต่อไฟล์** (`runCoaPipeline`): `extractTextPerPage` → วนทุกหน้า `processPage` → `recoverProductLot`
(ป้าย product/lot จากหัวใบ) → `reconcileDupontSpecs` (ใบ multi-batch หลายหน้ายันกันเอง) → re-summarize

**ต่อหน้า** (`processPage`): `runFlatGridBest` (flat text vs deterministic grid แข่งกัน เก็บตัวที่ดีกว่า)
→ ถ้าหน้าเป็นสแกน ยิง **Thai challenger** → ถ้ายัง SKIP เยอะ ยิง **HQ challenger** — challenger ทุกตัว
ผ่าน keep-best เหมือนกัน: เพิ่ม PASS, 0 FAIL, **PASS เดิมต้องครบ** ไม่งั้นทิ้ง

**ต่อ pass** (`runExtractionPass`): `parseStructuralGrid` หรือ `ollama.parseCoa` → **guard/recovery
หลายสิบตัวเรียงกัน** (grounding → metadata filter → spec/result recovery → header direction → …)
→ `evaluateCoa` → **guard หลัง evaluate** (sieve/text-row recovery, downgrade PASS ที่ลอกมา,
realign ตารางแนวนอน) → re-summarize → margin-green (เคลียร์ธงเหลืองที่ผ่านเกณฑ์ value-trust)

★ **ลำดับสำคัญกว่าตัว guard เอง** ★ — guard หลายตัวแก้ `raw.items` ในที่ (in-place) ตัวถัดไปเห็นผลของตัวก่อน
สลับลำดับ = เปลี่ยนผล. รายละเอียดว่าแต่ละตัวมีไว้ทำไม อ่าน comment หัวไฟล์ของมัน (`*-recovery.ts`)

## บทเรียนที่ยังใช้ได้

- **rotation คือ root cause ไม่ใช่ column collapse** — สแกนหมุน 90° ทำให้ RapidOCR อ่านตัวอักษรตะแคง เลข/spec เพี้ยน.
  bbox grid reconstruction แก้ไม่ได้ (geometry ของภาพหมุนเชื่อไม่ได้) ต้อง correct rotation ก่อน
- **corpus = COA สินค้าที่ ship แล้ว → ผ่าน spec แทบทั้งหมดเป็นเรื่องปกติ** "FAIL น้อย" = ถูกต้อง ไม่ใช่ defect.
  งานของระบบ = จับ OOS ที่นานๆ เจอ + honest SKIP ที่อ่านไม่ได้
- **ห้ามแตะ text ที่ป้อนให้ LLM เพื่อกู้ทิศ spec** — เคยลอง (text-layer column-placeholder) แล้ว regress หนัก
  (TR_1099 3 PASS → 3 FAIL ปลอม). ทางที่ถูกคือ guard **หลัง** LLM ที่อ่าน geometry ดิบแยกต่างหาก
- **diff ที่ไม่ขยับแถวเลย ≠ "แก้แล้วไม่มีผล"** — ต้องรู้ว่าทำไมมันว่าง (คลังปัจจุบันอาจมองไม่เห็นรูที่เพิ่งปิด)
  ไม่งั้นจะถอน fix ที่ถูกต้องทิ้ง
- **harness เก่าอ่านหน้าแรกหน้าเดียว** (`verify-4b.ts`/`sweep.ts`) → ไฟล์ที่หน้าแรกเป็น cover นับขาด.
  ใช้ `_validate/verify-4b-only.ts` ที่เรียก `runCoaPipeline` ตัวจริงเท่านั้น

## วิธีเทส

3 terminal: daemon → backend → frontend
```
cd C:\local-repo\OCR\backend && npm run ocr:daemon   # รอ "OCR daemon ready ... (model loaded)"
cd C:\local-repo\OCR\backend && npm run dev
cd C:\local-repo\OCR\frontend && npm run dev          # http://localhost:3000
```

- CLI batch: `cd backend && npx ts-node src/scripts/test-coa.ts` (ทุกไฟล์ใน `uploads/`) → log ที่ `coa-logs/run.log` + JSON ต่อไฟล์
- corpus gate + เกณฑ์ตัดสินผล: ทำตาม skill `coa-corpus-verify` (`.claude/skills/coa-corpus-verify/SKILL.md`)
- ★ **Python ล่มได้ 2 เส้นแยกกัน** — daemon `:8765` (ไฟล์สแกน → `OCR_DAEMON_DOWN`) กับ `pdfplumber`
  ที่ backend spawn เอง (ตาราง text-layer → `PDF_GRID_DOWN`). `:8765` เขียวไม่ได้แปลว่าอีกเส้นรอด
- diagnostic geometry: `npx ts-node src/scripts/dump-tokens.ts <file>` → dump RapidOCR tokens+boxes
- debug ต่อ run: `coa-logs/_last-ocr.txt` (OCR ที่ใช้จริง) + `_last-ollama.txt` (LLM parse). **overwrite ทุก run** → รันไฟล์เดียวถ้าจะดู

## Machine deps

- RapidOCR daemon: `127.0.0.1:8765` (`ocr-py/ocr_server.py`, venv ที่ `ocr-py/venv` — ต้องมี `pdfplumber` ด้วย)
- Ollama: `localhost:11434`, model `qwen3:4b`

## เจ้าของข้อมูลแต่ละเรื่อง (อย่าเขียนซ้ำข้ามไฟล์)

| เรื่อง | ไฟล์ |
|---|---|
| ประวัติทุกรอบที่แก้ · baseline ปัจจุบัน · งานค้าง | `TEST-LOG.md` |
| วิธีรัน corpus gate + เกณฑ์ block/ผ่าน | `.claude/skills/coa-corpus-verify/SKILL.md` |
| stack · env · โครงไฟล์ · cheatsheet ว่าแก้อะไรที่ไหน | `CLAUDE.md` (root) |
| deploy หน้างาน | `DEPLOY.md` · `INSTALL-OFFLINE.md` (แบบ air-gapped) |
