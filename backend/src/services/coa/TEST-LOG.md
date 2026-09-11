# COA — Test Log (ผลระบบ vs ค่าจริง)

> ไฟล์นี้จด **ผลที่ระบบตัด** เทียบ **ค่าจริงในเอกสาร** ทีละรอบแก้ (FIX ROUND)
> เป้า: รวบ pattern ที่ผิด → แก้ทีเดียวถูกทาง (ไม่เดา). อ่าน [DEV-NOTES.md](./DEV-NOTES.md) คู่กัน.
>
> **ROUND 1–30 ถูกย่อเหลือตารางดัชนีด้านล่าง (2026-09-11)** — ต้นเหตุของรอบเหล่านั้นฝังอยู่ในโค้ด + คอมเมนต์แล้ว
> ที่ถูกตัดไปพร้อมกัน: `Context snapshot` (ค้างอยู่ที่ ROUND 6 · ยังลิสต์ Tesseract ที่ถอดไปแล้ว) · ตาราง `ผลต่อไฟล์` เวอร์ชัน v6 ·
> บล็อก **รายละเอียดต่อแถวของ 7 ใบแรกที่ user เกรดเอง** (`Lot240521`, `ZP10`, `RI-015`, `PR1950W_4063`, `Barimite200`,
> `SODA ASH`, `Suzorite_Mica` — ยืนยัน 2026-06-04/06-05). **ข้อความเต็มทุกบรรทัดยังอยู่ครบใน git**
> → `git log -p -- backend/src/services/coa/TEST-LOG.md`
>
> **baseline ล่าสุดอยู่ที่รอบล่างสุดของไฟล์นี้เสมอ** — อย่าลอกตัวเลขมาแปะไว้หัวไฟล์ แปะเมื่อไหร่ค้างเมื่อนั้น
>
> ⚠️ **ไฟล์นี้ตามหลัง code อยู่** — เช็คด้วย `git log --oneline -1 -- backend/src/services/coa/TEST-LOG.md`
> แล้วเทียบกับ `git log --oneline -5`. commit ที่ใหม่กว่านั้นยังไม่มี FIX ROUND entry: อ่านจาก commit message
> + log ใน `backend/_validate/*.log` (local เท่านั้น `*.log` gitignored) **อย่าใช้รอบล่างสุดเป็น baseline โดยไม่เช็คก่อน**

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

## บทเรียนที่ยังใช้ได้ (ยกออกมาจากรอบเก่า — อ่านก่อนเริ่มรอบใหม่)

- ★ **ห้ามอ่าน diff ว่างเปล่าว่า "แก้แล้วไม่มีผล"** ★ ต้องรู้ว่าทำไมมันว่าง: เข้าไม่ถึงโดยโครงสร้าง (ไม่มี item เดินผ่าน branch นั้น)
  หรือเดินผ่านจริงแต่ด่าน abstain เดิมกันไว้ — คนละน้ำหนักกันคนละเรื่อง (ROUND 36/37)
- **PASS ที่ตกไม่ใช่ regression จนกว่าจะยืนยันว่า Ollama + daemon ขึ้นครบ** — ROUND 11 (Ollama connection หลุดตอนใช้พร้อม UI →
  RB220/PR1950W_4064 ออก 0P) · ROUND 32 (daemon ตาย `WinError 10055` กลางรัน → `4A` หาย 4P/1S)
- **harness พังได้เหมือนโค้ด** — `convertToImage` hardcode `getPage(1)` ทำให้ไฟล์หลายหน้าเสียหน้า 2+ **เงียบ** จนถึง ROUND 5
  (1F1710 เสีย 3 หน้า, PR1950W เสีย lot ที่ 2) · gate ที่ไม่พิมพ์ค่าที่จะวัด (product/lot) พิสูจน์งานไม่ได้เลย (ROUND 30)
- **suite ที่ไม่มี `process.exit` ไม่ใช่ gate** — `evaluator.test.ts` พิมพ์ `MISMATCH` แล้ว exit 0 มาตลอดจนถึง ROUND 29
- **unit fixture ที่เราแต่งเองสะอาดกว่าของจริงเสมอ** — corpus gate คือด่านที่จับ (ROUND 19 D-2072 · ROUND 21 จับ 2 regression ที่ unit มองไม่เห็น)
- **เทียบ gate ต้อง apples-to-apples** — เครื่องเดียว วันเดียว สลับโค้ดด้วย `git stash` (ROUND 13/15/17) · corpus dir ต้องเป็นชุดเดียวกันจริง
  (ROUND 26: `uploads/` สะสม 155 ไฟล์ + `RI-015` มี 2 เวอร์ชัน checksum ต่างกัน)
- **`1F1710` p4 แกว่ง 11–14P บนโค้ดเดียวกัน** = qwen3 drift (prefix-cache) จดไว้ตั้งแต่ ROUND 16 → คลังมี **2 สถานะที่ถูกต้อง
  (129P/140 rows และ 128P/138 rows)** ห้ามนับความต่างนี้เป็น regression
- **"guard ตัด PASS ได้อย่างเดียว" ไม่จริงที่ระดับ pipeline** — SKIP ที่เพิ่มไป trigger `keep-best`/`hq-ocr` ได้ (เงื่อนไข `summary.skip > 0`)
  → ห้ามใช้ monotonicity เป็นข้อพิสูจน์ว่า PASS ที่เพิ่มคือ drift ต้องนับครั้งที่ guard ยิงจริงต่อแถว (ROUND 29)
- **ธงเฟ้อ = คนเลิกเชื่อธง** — `needsReview` ต้องมาจากความเสี่ยงจริง (คอลัมน์เดา / เลขมาจาก OCR) ไม่ใช่ path `structural`
  ที่ตัวเลขดึงจาก text layer + ยืนยันคอลัมน์ด้วยเส้นตารางจริง (ROUND 22/24)
- ★ **needsReview PASS ห้ามโชว์เขียวล้วน** ★ pill เขียว + ⚠ amber + headline "ผ่าน — แต่มี N รายการต้องตรวจ" เป็น invariant ของ FE ตั้งแต่ ROUND 3
- ⚠️ **policy ค่าผลเป็นข้อความถูกกลับด้านแล้ว** — เดิม (2026-06-04 ตอนเกรด RI-015) `Traces`/`N/A` → SKIP ·
  **ตอนนี้ (2026-09-11, commit `6eceffa`): ผลเป็นคำทั้งที่เกณฑ์เป็นตัวเลข = FAIL** เพราะระบบยืนยันว่าผ่านไม่ได้ ·
  ที่ยังเป็น SKIP คือ **ค่าผลว่างเปล่า** (ระบบอ่านไม่ได้) — คนละเรื่อง ห้ามยุบรวม
- **daemon เก่าที่ยังไม่ restart จะไม่รู้จัก field ใหม่ แล้วเงียบสนิท** (`hq` ตอน `743df04` · `degraded` ROUND 31 · `lang` ROUND 35)
  — อัปโค้ดแล้วต้อง `npm run ocr:daemon` ใหม่เสมอ ยังไม่มี version handshake
- **OCR ไม่เคยเป็นตัวปัญหาหลัก** — ROUND 1 (ผิดจุดเดียว `7→T`) · ROUND 33 (OCR อ่านถูกทั้ง 13 ใบ บั๊กอยู่ชั้นแปลความหมาย)
  → **วัดด้วย `_validate/_dump-text.ts` ก่อนเสมอ ไม่ต้องเผา LLM**
- **deterministic recovery ทุกตัวต้อง abstain เมื่อไม่ใช่ layout ของตัวเอง** และแตะทีละฝั่ง (แตะ result ห้ามแตะ spec) · โมดูลที่สร้าง items เอง
  ต้องรัน **หลัง** `dropUngroundedItems`/`filterMetadataRows` ไม่งั้น anti-hallucination filter ตัดทิ้งหมด (ROUND 33)
- **`opus-reviewer` จับ blocker ที่ gate มองไม่เห็นได้ทุกรอบ** (รอบที่ 4/5/6 ติดกัน) — corpus ไม่มี ground truth ในตัว จึงตรวจ deceptive PASS เองไม่ได้

---

## ทางที่ลองแล้วไม่เอา (ห้ามเสนอซ้ำโดยไม่มีหลักฐานใหม่)

- **prompt ยาวขึ้นเพื่อสอน LLM** — ROUND 17 เพิ่ม field `resultMin/resultMax` + rule 4 บรรทัด → 4b คายแถวหายทั้งคลัง (rows 128→119, 1F1710 p4 เหลือ 3P) → revert ทั้งก้อน
- **guard รายแถว "spec == result → SKIP"** — ROUND 26 ทำคลังตก 125P→121P (RI-015 `Sb <15` เป็นของจริงบนใบ); สัญญาณจริงคือ **ทั้งใบซ้ำ** → `suppressCopiedSpec` ระดับใบ
- **column-shift recovery แบบ overwrite result** — ROUND 2: บนบรรทัดเดียวแยก "ป้าย" กับ "result จริง" ไม่ได้ → เหลือได้แค่ **downgrade → SKIP**
- **pass-guard glue-anchor แบบ substring** (`line.includes(joinedName)`) — ROUND 4: บรรทัดแปลกที่ชื่อโผล่เป็น substring แล้วแบกค่ายืมได้ credit เต็ม → ใช้ **exact-cell**
- **ใช้ grid แทน flat ทุกใบ (blanket)** — ROUND 6: ZP10 rotated / RI-015 2 ตาราง พังเพราะ column band เพี้ยน → ต้องเป็น keep-best (flat เป็นพื้น)
- **heuristic row-based กับตาราง transposed/แนวนอน** — Suzorite (2026-06-05) เป็นหลักฐานชิ้นแรกว่าต้องใช้ structural extractor ไม่ใช่ prompt/guard (ยังค้างถึง ROUND 38)
- **กฎจับคู่ป้าย↔ค่าบนตารางแนวนอนแบบง่าย** — ROUND 38 วัด 3 วิธีกับ 3 ใบจริง ไม่มีวิธีไหนถูกเกิน 1 ใน 3 → เดาคอลัมน์ = รับรองค่าที่ยืมมา
- **auto → PASS ให้แถวที่กู้คอลัมน์มา (ไม่ต้องมีคนตรวจ)** — ROUND 2/3/6: flat OCR กู้ทิศคอลัมน์ให้ปลอดภัยไม่ได้ → ระหว่างนี้ใช้ amber
- **ยกเว้นธงทั้ง layout DuPont** — ROUND 23: จะกลบเคสหน้า 3 ที่อ่านคอลัมน์ Batch เป็น Specification (spec แคบกว่าจริง = deceptive FAIL) → ใช้ cross-page reconciliation แทน
- **HQ speculative prefetch เปิด default** — ROUND 15/20 วัด 2 รอบ: เครื่องเดียวกันช้าลง 329s→340s (HQ engine เบียด CPU ของ Ollama) → คง opt-in
- **ยิง LLM ขนานข้ามหน้า** — ROUND 20 วัด Ollama ตรง ๆ: 2 request ขนานเร็วขึ้นแค่ 17% (GPU saturated) แลกกับ race บน `gpuDisabled`/`releaseRunner` → ไม่ทำ
- **A5 "รวมชื่อแถวที่ OCR ตัด" ในฐานะตัวปิด deceptive PASS** — ROUND 29 เปิด JSON ของรอบที่พังแล้วพบว่าทั้งบล็อกเลื่อน ไม่ใช่แค่ชื่อขาด (ยังค้างในฐานะงานจำนวนแถว/การแสดงผล)
- **ปล่อย HQ engine แล้วโหลดใหม่เมื่อ `bad allocation`** — ROUND 31 exp 5: ล้มตอนโหลดโมเดลได้ด้วย → ย่อภาพแล้วยิงซ้ำแทน
- **ผ่อนด่าน "ค่าผลเท่าเกณฑ์" แบบหยาบ** — ROUND 34: `FC-250-1500` ที่ไม่มีคอลัมน์เกณฑ์จะได้ **9 deceptive PASS** ที่อ่านเหมือน "+9 recall" → ต้องมีธง `specFromCell`
- **`±` ในช่องค่าผลคืนค่ากลาง** — ROUND 36: `±` เป็นสำนวนของช่องเกณฑ์ → ค่ากลางคือ PASS ปลอมที่คำนวณจากเลขของเกณฑ์เอง → อ่านเป็น **ช่วง**

---

## ดัชนี ROUND 1–30 (ย่อ — รายละเอียดเต็มอยู่ใน git history)

| รอบ | วันที่ | เรื่อง | ผล | commit |
|---|---|---|---|---|
| 1 | 2026-06-04 | spec-normalizer รับตัวคั่นหลายตัว (`270 -~350`) + result เป็น bound (`<15`) ที่ PASS ได้เมื่อพิสูจน์ได้ | 43P/2F/45S → 45P/2F/43S | |
| 2 | 2026-06-04 | LLM ทิ้งคอลัมน์ result → `result-recovery` + decimal-space guard + column-shift guard (downgrade อย่างเดียว) | 43P/2F/45S → 50P/0F/40S | |
| 3 | 2026-06-04 | column-shift ผ่อน claimed filter + `sieve-table-recovery` (quad gate) + FE โชว์ amber needsReview | 50P/0F/40S → 53P/0F/37S | `8cee093` `2173cf4` |
| 4 | 2026-06-04 | pass-guard anchor หลุดเพราะ OCR เชื่อมชื่อแถวติดกัน → glue-anchor แบบ exact-cell | 53P/0F/37S → 54P/0F/36S | `87b5242` |
| 5 | 2026-06-04 | multi-page: render/OCR/eval แยกต่อหน้า คืน `CoaReport[]` (เดิมอ่านหน้า 1 หน้าเดียว) | 54P/0F/36S → 68P/0F/44S | |
| 6 | 2026-06-05 | flatten ทิ้ง geometry → ป้อน grid ให้ LLM แบบ keep-best + 6b balanced amber / UI / reason ภาษาคน | 68P/0F/44S → 75P/0F/36S | |
| 7 | 2026-06-06 | `avg-column-recovery` — ดึงคอลัมน์ Average/Mean เป็นค่าผล (4b หยิบค่าวัดตัวสุดท้าย) | 87P/0F/32S → 88P/0F/31S | |
| 8 | 2026-06-06 | `spec-column-recovery` — DuPont double Min/Max (LLM อ่านคอลัมน์ Batch เป็น Specification) | 88P/0F/31S → 88P/0F/31S | |
| 9 | 2026-06-10 | `metadata-row-filter` (Lot number/ACCEPT) + bare-number spec-col routing ที่ทิศต้อง unanimous | 126P/0F/25S → **คาด** 128P/0F/14S | |
| — | 2026-06-10 | FULL CORPUS RE-RUN: verify หลัง ROUND 9 + เคลียร์ contradiction Z99/Suzorite (ของจริงจบแล้วทั้งคู่) | 128P/0F/12S rows=140 | |
| 10 | 2026-06-10 | grounding ตัด Cu/Zn ของตารางแนวนอนทิ้ง → path 3 `isTransposedGrounded` + name-in-block | 128P/0F/12S → 129P/0F/12S | |
| 11 | 2026-06-10 | LLM ทิ้งแถว sieve `0.0/0.0` ทั้งแถว → `recoverMissingSieveRows` (SKIP+amber เสมอ ไม่ promote) | 101P/0F/11S (รันนั้น Ollama หลุดกลางคัน) | |
| 12 | 2026-06-10 | perf UI: Ollama ค้าง + `keep_alive:0` ตกค้าง → `"10m"` + sha256 cache ใน route | RI-015 45.5s · 10P/0F/4S | |
| 13 | 2026-07-14 | cold start: keep-warm qwen3 (options ต้องตรง) + `skipMayBenefitFromHq` + HQ preload | 125P/0F/16S → 126P/0F/15S | |
| 14 | 2026-07-17 | daemon ข้ามเครื่อง: contract `path` → `image_b64` + bind `0.0.0.0` | 126P/0F/15S (เท่า ROUND 13 เป๊ะ) | |
| 15 | 2026-07-21 | profile upload (LLM = 56% ของเวลา) + HQ speculative prefetch → **opt-in** เพราะเครื่องเดียวขาดทุน | baseline 126P/0F/15S · default path เท่าเดิม | |
| 16 | 2026-07-21 | live progress UI (`ProgressFn` + `GET /progress/:jobId` + `ProgressPanel`) | 123P/0F/14S (ต่างเพราะ variance 3 ไฟล์เดิม) | |
| 17 | 2026-07-25 | ค่าผลเป็นช่วง Min\|Max (RB220): เลิกเฉลี่ย → `interval` + `evaluateInterval` + `result-minmax-recovery` | 114P/0F/14S → 114P/0F/14S | |
| 18 | 2026-07-25 | ใบญี่ปุ่น KGP-H65: grounding รองรับ CJK + keep-best เทียบชื่อแบบ normalize + `以下/以上` ใน grid parser | 114P/0F/14S → 126P/0F/16S rows=142 | |
| 19 | 2026-07-25 | pass-guard sub-row scan ไม่มีขอบเขต = guard ตายสนิท + LLM ตกไปรัน CPU ทั้ง session (8.6→94.4 tok/s) | 126P/0F/12S rows=138 · 329s (จาก 1120s) | |
| 20 | 2026-07-25 | `applyMarginGreen` ไม่เคยทำงานกับแถวที่ grid ชนะ (ลำดับผิด) + junk row `Certificate of …` | 126P/0F/11S rows=137 · needsReview 43 | |
| 21 | 2026-07-26 | corpus 16→17 (KGP-H65) + ป้ายแยกแถวใต้ชื่อกลุ่ม merged (เปิดเฉพาะ `structural`) | 134P/0F/12S rows=146 | |
| 22 | | structural = ตัวเลข extract จาก text layer ไม่ใช่ recognize → เลิกปักธงกัน OCR risk ที่ไม่มีจริง + FE tooltip | 133P/0F/11S · needsReview 41 | |
| 23 | | ถอด Tesseract fallback (พังดัง ๆ ดีกว่าอ่านผิดเงียบ ๆ) + `reconcileDupontSpecs` โหวตข้ามหน้า | 133P/0F/11S · needsReview 14 | `61e5989` |
| 24 | 2026-08-03 | "อยู่ในกรอบ min/max = ผ่าน" ตัดธง 4 จุด (verify กับใบจริง 12/12 ก่อน) + `PDF_GRID_DOWN` แทน fail-soft เงียบ | 133P/0F/11S · needsReview 4 | |
| 25 | 2026-08-03 | ชื่อแถวเพี้ยนบน scanned-vector (เส้นคอลัมน์เหลื่อมภาพ ~73px) → `carrySection` เฉพาะ `structural` | 133P/0F/12S rows=145 | |
| 26 | 2026-09-07 | text-layer ที่ decode ไม่ออก → LLM แต่งเลข (`looksDecodable`) + ใบที่ไม่มีคอลัมน์เกณฑ์ (`suppressCopiedSpec`) | 125P/0F/13S → 126P/0F/14S | |
| 27 | 2026-09-07 | เกรด 10 ใบหน้างานทีละแถว ปิด 5 ช่อง (ข้อความล้วน=PASS ได้ · `0.5≧` · grounding · `-` = เกณฑ์ว่าง · transposed-label) | 125P/0F/13S → 129P/0F/11S · หน้างาน 62P/1F/36S → 71P/1F/27S | |
| 28 | 2026-09-08 | A1 text-layer ที่สแกนเนอร์ฝัง (ภาพคลุมหน้า 1.00) · A2 `spec-bound-grounding` + `spec-pair-recovery` · A3 `text-row-recovery` | 129P/0F/11S (guard ใหม่ยิง 0 ครั้งในคลัง) | |
| 29 | 2026-09-09 | PASS ที่นั่งตรงขอบของเกณฑ์ขอบเดียว (`le`/`ge`) → เข้า guard เดียวกับ `between` + `evaluator.test.ts` ได้ exit code | 128P/0F/10S rows=138 | |
| 30 | 2026-09-09 | หัวรายงาน: ชื่อลูกค้าถูกเอามาเป็นชื่อสินค้า → `product-lot-recovery` (ดูที่ **ป้าย** ไม่ใช่รูปทรงของค่า) | 128P/0F/10S rows=138 · แก้ถูก 9 หน้า เสีย recall 2 ช่อง | |

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

## ROUND 37 — เกณฑ์ที่อ่านมาจากช่องบนใบ ไม่ให้ตัวไล่หาบรรทัดมาตัดขอบทิ้ง (2026-09-10)

**อาการ (ยังไม่ออกอาการจริง — ปิดก่อนออก):** `dropUngroundedSpecBounds` ตัดเกณฑ์สองขอบให้เหลือขอบเดียว
โดยเอาหลักฐานจาก **flat text** (หาบรรทัดที่ชื่อ match แล้วดูว่ามีช่องว่างกับเลขขอบไหม) — แต่มันรันที่
`coa-pipeline.ts:680` ซึ่งอยู่**หลัง** โมดูล structural 3 ตัวที่อ่านเกณฑ์มาจากช่องของแถวตัวเองแล้ว
(`lot-row-table` 639 · `paren-spec` 651 · `spec-row-below` 661 — ทุกตัวติดธง `specFromCell`)

ตัดขอบทิ้ง = **ทำเกณฑ์ให้หลวมกว่าใบจริง** (`0.10~0.28` → `0.10 Min.` แล้วค่า 0.9 ขึ้นเขียว) ด้วยหลักฐาน
ที่อ่อนกว่าที่มาของเกณฑ์เอง — โมดูลนี้เขียนคำเตือนข้อนี้ไว้ในตัวเองอยู่แล้ว (บล็อกคอมเมนต์ `★ ต้องเห็น
ช่องว่างบนใบก่อนถึงจะตัด ★`) แต่ด่านนั้นกันเฉพาะ "OCR อ่านขอบไม่ครบ" ไม่ได้กัน "เกณฑ์มาจากช่องแล้ว"

### แก้อย่างไร
บรรทัดเดียวหัวลูป: `if (it.specFromCell === true) continue;` — ก่อน `normalizeSpecFromCandidate`
ใช้ idiom `=== true` ตัวเดียวกับ `coa-evaluator.ts:271`

ธงเป็นตัวแยกที่ตรงเป๊ะที่จุดนี้: ผู้ตั้งธงอีกตัว (`limit-columns-recovery`) รันทีหลังที่บรรทัด 770 ·
`bound-cell-recovery` ถูก ROUND 34 ถอนธงออกไปแล้ว → ที่บรรทัด 680 `specFromCell === true` แปลว่า
"มาจาก 3 โมดูลข้างบน" เท่านั้น · LLM ตั้งฟิลด์นี้ไม่ได้ (prompt ไม่เคยเอ่ยชื่อฟิลด์)

ผลพลอยได้: ปิดทาง **ฟอกธงของโมดูลนี้** ไปในตัว — ของเดิมเขียนทับ `specRaw` แล้วปล่อยธงติดค้าง = เกณฑ์ที่
heuristic เขียนเองยังอ้างได้ว่า "มาจากช่องบนใบ" (วันนี้ไม่มีพิษเพราะรูปที่ตัดออกมาเป็น `Min./Max.` ซึ่ง
ไม่เข้าเงื่อนไข `specCellEquality` แต่เป็นรูอยู่ดี) → ไม่ต้องเพิ่มบรรทัดล้างธงในโมดูลนี้

★ **ฟอกธงยังเปิดอยู่อีก 2 pass** ★ `bound-cell` (670) กับ `spec-pair` (743) ก็เขียนทับ `specRaw`
แล้วปล่อยธงติดค้างเหมือนกัน — `spec-pair` เข้าถึงได้จริงเพราะ `lot-row-table.isSpecCell` รับเลขเปล่า
(`normalizeSpec != null`) → ออก `eq` ได้ ซึ่งเป็น trigger ของ `spec-pair` พอดี (ของจริงในคลัง:
VERMICULITE `total` เกณฑ์ 100 · แถว `12` เกณฑ์ 0)

### ★ ทำไม row-diff ว่างเปล่าทั้งสองคลัง — และทำไมคราวนี้พูดได้แรงกว่า ROUND 36 ★
`[spec-bound]` ยิง **0 ครั้ง** ทั้ง corpus17 และ 13 ใบใหม่ แต่เหตุผลคนละแบบกัน:

| คลัง | โมดูลที่ติดธงยิงไหม | `[spec-bound]` | อ่านว่าอะไร |
|---|---|---|---|
| corpus17 | `lot-table`/`paren-spec`/`spec-below` = **0 ทั้งหมด** | 0 | ไม่มี item ติดธงเลย → เข้าไม่ถึงโดยโครงสร้าง |
| 13 ใบใหม่ | `paren-spec` ×5 · `lot-table` ×3 · `spec-below` ×1 | 0 | **item ติดธงเดินผ่านโมดูลนี้จริง** แต่ด่าน abstain เดิมบังไว้ครบทุกแถว |

ชุด 13 ใบคือหลักฐานที่ใช้ได้จริง: path ถูกเดินถึง ไม่ใช่ code ตายทั้งดุ้น. ที่ยังไม่ออกอาการเพราะ
**อย่างน้อย 1 ใน 3 ด่านเดิม** (`anchorLine` หาบรรทัดเดียวไม่เจอ / ไม่มีช่องว่างในบรรทัด /
`minIn === maxIn`) กันไว้ทุกแถว — **ไม่ได้วัดว่าด่านไหนกันแถวไหน**

และตัวที่กันไว้**ไม่ใช่**ด่าน `op !== between`: แถวติดธงในคลังเป็น `between` ของจริงและเขียวอยู่
(Copper Fiber 8 แถว · VERMICULITE 10 แถว · Tin Powder D50 `18-26` D90 `43-71`) — ทุกแถวคือจุดที่
การตัดขอบจะทำเกณฑ์หลวมลงใต้ verdict สีเขียว. รอบนี้เปลี่ยนจาก "รอดเพราะบังเอิญ" เป็น "รอดเพราะมีด่าน"

### ข้อที่ตอบไปพร้อมกัน: "แถวที่ระบบประกอบเองกลับเข้าลูปซ่อม LLM"
ไล่ทุก pass ที่รันหลังบรรทัด 661 แล้วเขียน `specRaw`/`result` ทับของเดิม — **`spec-bound` เป็นตัวเดียว
ที่แตะ item ติดธงได้** เพราะเป็นตัวเดียวที่ trigger ด้วย `op === "between"` ซึ่งเป็นรูปที่โมดูล structural
ผลิตออกมาพอดี ตัวที่เหลือ abstain เพราะ**รูปของ input ไม่ใช่เพราะรู้จักธง**:

| pass | บรรทัด | เขียนอะไร | ทำไมไม่แตะ item ติดธง |
|---|---|---|---|
| `bound-cell` | 670 | `specRaw` + `result` | ต้องมีช่อง `Max`/`Min` ลอยเดี่ยวบนบรรทัดที่ anchor ได้ → ผลลัพธ์เป็น `le`/`ge` ซึ่งไม่เข้าด่าน `between` ของ `spec-bound` และไม่เข้า `specCellEquality` |
| **`spec-bound`** | **680** | **`specRaw`** | **← รูที่ปิดรอบนี้** (trigger = `between` ตรงกับที่ 3 โมดูลผลิต) |
| `spec-recovery` | 683 | `specRaw` | เติมเฉพาะช่องที่ว่าง (`blank()` guard) ไม่ทับ |
| `result-recovery` | 690 | `result` | เติมเฉพาะช่องที่ว่าง ไม่ทับ |
| `spec-direction` | 721 | `specRaw` | ออกทันทีถ้า `specRaw` ไม่ว่าง |
| `header-direction` | 733 | `specRaw` | ต้องการ **bare-eq** — ROUND 34 ห้าม structural ออก `eq/approx` |
| `spec-pair` | 743 | `specRaw` | ต้องการ **bare-eq** เหมือนกัน |
| `avg-column` `spec-column` `limit-cols` `result-minmax` | 705–781 | `result` (+ `specRaw` บางตัว) | anchor กับ grid/header ของตัวเอง abstain นอก layout · ไม่ยิงร่วมกับ 3 โมดูลนี้ในคลังทั้งสองชุด |

**ยังไม่ปิด (ของจริง ไม่ใช่ทฤษฎี):** 4 ตัวล่างของตาราง**ไม่อ่านธง** — วันนี้ไม่ชนกันเพราะ layout คนละแบบ
ไม่ใช่เพราะมีด่าน. ใบที่มีทั้งคอลัมน์ Average และเกณฑ์ในวงเล็บจะให้ `avg-column` เขียน `result` ทับแถวของ
`paren-spec` ได้ (คลังปัจจุบันไม่มีใบทรงนี้) — ถ้าจะปิดต้องเป็น commit ของตัวเอง พร้อมคิดว่า "ทับด้วยค่าที่
อ่านจากช่องเหมือนกัน" ควรชนะใครก่อน

**ยังไม่ปิด (ทฤษฎี):** `parsed as RawCoa` ที่ `ollama-coa.service.ts:172` ไม่กรอง field → ถ้าโมเดล
คายฟิลด์ `specFromCell` ออกมาเองจะทะลุเข้าระบบเป็นธงจริง. วันนี้ prompt ไม่เคยเอ่ยชื่อฟิลด์นี้ + ใช้
`format:"json"` ตาม shape ที่กำหนด → ยังไม่เคยเห็น แต่รอบนี้ทำให้ธง"มีอำนาจมากขึ้น" (สั่งข้ามด่านได้ด้วย)
→ whitelist field ตอน parse คุ้มขึ้นกว่าเดิม

### ผลรัน
| ชุด | ก่อนแก้ (HEAD 9932a9f) | หลังแก้ | row-diff |
|---|---|---|---|
| corpus17 | 128P/0F/10S rows=138 needsReview=11 (676 บรรทัด / 225 `[eval]`) | **เท่าเดิมทุกช่อง** | ว่างเปล่า 225 แถว |
| 13 ใบใหม่ | 118P/0F/17S rows=135 needsReview=61 (242 `[eval]`) | **เท่าเดิมทุกช่อง** | ว่างเปล่า 242 แถว |
| **HG-PP#180 เดี่ยว** | 4P/0F/2S rows=6 needsReview=5 · `[spec-bound]` ยิง **2 ครั้ง** | **เท่าเดิมทุกช่อง · ยังยิง 2 ครั้ง** | ว่างเปล่า 24 แถว |

★ แถว HG-PP คือแถวที่พิสูจน์ว่า**ไม่เสีย recall** ★ มันเป็นไฟล์เดียวที่ `[spec-bound]` เคยยิงจริง และ**ไม่อยู่
ในทั้ง corpus17 และ 13 ใบใหม่** (อยู่ในชุด 10 ใบหน้างาน) — ถ้าไม่รันแยก คำว่า "ไม่เสีย recall" จะเป็นการ
อนุมานจาก log เก่าล้วนๆ. รันแล้วได้: ยังตัด `Fe(42.0% - 46.0%→42 Min.)` เหมือนเดิม และไฟล์นี้
`lot-table`/`paren-spec`/`spec-below` ยิง 0 → แถว HG-PP ไม่ติดธง ด่านใหม่จึงแตะไม่ถึงโดยโครงสร้าง

**คลังไม่ reproducible ระดับบิต** — `[grounding]` ออก 6 บรรทัดรอบก่อน 7 บรรทัดรอบหลังบน 13 ใบชุดเดียวกัน
(hallucination drop เกินมา 1 ที่ Copper Fiber). ไม่ใช่ผลของ diff นี้: `[grounding]` รันที่บรรทัด 615
**ก่อน** 680 และ `[spec-bound]` ยิง 0 ทั้งสองรอบ → เป็น qwen3:4b แกว่งเองที่ temperature 0.
**แถว `[eval]` ตรงกันทุกไบต์** รอบหน้าอย่าอ่าน log delta 1 บรรทัดว่าเป็น regression

`npx tsc -p .` = 0 · unit **26 suite** exit 0 ทุกตัว (`spec-bound-grounding` 8→**13 เคส**) ·
ทั้ง 3 รัน `bad allocation` / `[retry]` / `OCR_DAEMON_DOWN` = **0**

เคสที่เป็นตัวตัดสินคือ **คู่ควบคุมในไฟล์เทสต์** ไม่ใช่คลัง: เคส 5 กับ 6 เป็น input เดียวกันเป๊ะต่างแค่ธง —
ไม่มีธงยังตัดเป็น `6 Max.` เหมือนเดิม (โมดูลไม่ตาย) · มีธงไม่ตัด (ธงถูกอ่าน) · เคส 7 ผสมสองแถวในใบเดียว
พิสูจน์ว่าข้ามเป็นรายแถว ไม่ใช่ถอยทั้งใบ

### ค้างไว้ (คนละ commit คนละ gate)
- `suppressCopiedSpec` (`coa-evaluator.ts:577`) ตาบอด tilde เต็มความกว้าง — แก้ที่ `copied()` ห้ามแก้ `raw`
- `spec-normalizer.ts:81/91/108` ยังมี copy ตัวคั่นของตัวเอง ยังไม่รวมเข้า `numeric.ts`
- pass-guard ไม่ทำงานบนตารางแนวนอน (`coa-grounding.ts:484`) · `parenSpec` กรองผิดแกน ·
  คอลัมน์ `Typical`/`Target` · 2 ตารางบนหน้าเดียวที่จำนวนคอลัมน์เท่ากัน ·
  summary ไม่คำนวณใหม่หลัง `recoverMissingSieveRows`
- 4 pass ท้ายตารางข้างบนไม่อ่านธง `specFromCell` (ดูหัวข้อ "ยังไม่ปิด") · ฟอกธงที่ `bound-cell` + `spec-pair`
- whitelist field ตอน parse ผล LLM
- ★ **รูฝาแฝดที่ยังเปิด: แถวจาก deterministic grid** ★ `parse-structural-grid` / `scanned-grid-builder`
  อ่านเกณฑ์จากช่องเหมือนกันแต่**ไม่ติดธง** → ยังโดน `spec-bound` ตัดได้ · หนักกว่านั้น path `runFlatGridBest`
  ส่ง `gridText` ให้ LLM แต่ส่ง **flat `text`** เป็นตัว anchor (`coa-pipeline.ts:1063-1065`) = ground แถวที่มาจาก
  layout หนึ่ง ด้วย layout อีกอัน. เข้าถึงได้จริง: `[grid-parser]` 12 candidate ใน corpus17 · 6 ใน 13 ใบ ·
  10 ใน 23 ใบ (325-HK ชนะด้วย 10 PASS แถวสองขอบล้วน — ตัด `92~100` เหลือ `92 Min.` = ทรง deceptive PASS)
  **วิธีแก้ที่ถูก:** ทำเหมือน fail-guard ที่ `coa-pipeline.ts:802` คือข้าม call เมื่อ `isDeterministicGrid`
  ★ **ห้ามแก้ด้วยการติดธง `specFromCell` ให้ grid** ★ ธงนั้นปลด `specCellEquality` (`coa-evaluator.ts:271`)
  ซึ่ง ROUND 34 จงใจบีบไว้แคบ — ติดธงเพิ่ม = เปิดประตูที่ไม่ได้ตั้งใจเปิด

## ROUND 38 — ด่านกัน PASS ปลอม ตาบอดตารางแนวนอน แล้วเผลอ downgrade แถวที่ถูก (2026-09-10)

**อาการที่วัดได้ในคลัง:** `RI-015` มีตารางเคมีเป็น **แนวนอน** (ชื่อธาตุเป็นหัวคอลัมน์ ค่าอยู่แถว `Lot # 01`)
`downgradeUngroundedPasses` ยิง 5 แถวเป็น SKIP พร้อมเหตุผล "ค่าผลอาจมาจากแถวอื่น" — **ผิดทั้ง 5 แถว**
เทียบใบจริง (`wt% Cu 60.9` ในเกณฑ์ `57-61`, `Pb 32 < 50`, `Cd 5 < 15` …) ทุกแถวผ่านตามใบ

```
CHEMICAL ANALYSIS |  wt% Cu  | wt% Zn  | Pb (ppm) | Cd (ppm) | Sb (ppm) | As (ppm)   <- แถวป้าย = ชื่อรายการ
Pattern           |  57 - 61 | 36 - 40 |  < 50    |  < 15    |  < 15    |  < 15      <- แถวเกณฑ์
Lot # 01          |  60.9    | 38.44   |  32      |  5       |  <15     |  8         <- แถวค่า
```

### ต้นเหตุ
ด่านนี้ใช้โมเดล **"ค่าต้องอยู่บรรทัดเดียวกับชื่อแถว"** ซึ่งจริงเฉพาะตารางแนวตั้ง. บนทรงแนวนอน
บรรทัดที่ชื่อ anchor ติดคือ**แถวป้าย ซึ่งไม่เคยถือค่าของแถวไหนเลย** -> ตรวจไม่เจอ -> ตกไปที่
`coa-grounding.ts:484` (`if (!hasDataNumber) continue`) ซึ่งเป็นตัวชี้ขาดว่าจะเงียบหรือจะยิง:

| แถวป้ายมีเลขไหม | `hasDataNumber` | ผล |
|---|---|---|
| ไม่มีเลขเลย | false | **เงียบ** — PASS ปลอมบนทรงนี้รอดทุกกรณี |
| มีเลขของป้ายอื่นหลงมา | true | **ยิงทุกแถว** รวมแถวที่ถูกต้อง = false SKIP |

RI-015 ตกกรณีล่างเพราะ OCR อ่าน `Zn` เป็น `Zn1` — **เลข 1 ตัวเดียวจากการอ่านเพี้ยน** เป็นตัวตัดสินว่า
ด่านจะยิงหรือไม่ยิง. ไม่ว่ากรณีไหน ด่านก็ไม่เคยได้ตรวจอะไรจริงเลยบนทรงนี้

มีด่านที่ 2 ซ้อนอยู่: `nameSig.length < 2` — ป้ายสั้น (`D50` `D90` `pH` `Fe`) ไม่เข้าลูปตั้งแต่ต้น
`Tin Powder` ตกด่านนี้ จึงไม่เคยถูกแตะทั้งก่อนและหลังรอบนี้

### repro (probe 8 เคส ยิงเข้า `downgradeUngroundedPasses` ตรง ๆ)
| เคส | ทรง | ควรได้ | ก่อนแก้ | หลังแก้ |
|---|---|---|---|---|
| A/B | Tin Powder (ป้ายสั้น) | keep / downgrade | keep / **keep** | เท่าเดิม (ตกด่าน `nameSig<2`) |
| C/D | ป้ายยาว ไม่มีเลข | keep / downgrade | keep / **keep** | เท่าเดิม (ตกด่าน 484) |
| E/F | แนวตั้ง (control) | downgrade / keep | ถูกทั้งคู่ | **ถูกทั้งคู่** |
| G/H | ป้ายยาว มีเลข | keep / downgrade | **downgrade** / downgrade | **keep** / keep |

### ทำไมไม่แก้เป็น "อ่านคอลัมน์ให้ถูก" — วัดแล้วทำไม่ได้
ลอง 3 วิธีจับคู่ป้ายกับค่า บนตารางแนวนอนจริงทั้ง 3 ใบที่มีในคลัง:

| ใบ | ยึดขวาจาก cell | ยึดขวาจากเลข | ยึดซ้ายจากเลข |
|---|---|---|---|
| Tin Powder | ผิด | **ถูก** | ผิด |
| RI-015 | ผิด | ผิด | **ถูก** |
| TAIHEIYO CMF | **ถูก** | ถอย (จำนวนไม่ตรง) | ถอย |

มีอีกวิธีที่**ไม่เคยผิด**: จับคู่ตาม index ของช่อง โดยบังคับว่า**จำนวนช่องของแถวป้ายกับแถวค่าต้องเท่ากัน**
ไม่เท่าก็ถอย — TAIHEIYO ได้ครบ 7 ธาตุ ส่วน Tin Powder (4 vs 7) กับ RI-015 (6 vs 7) ถอยทั้งคู่
**แต่วันนี้ใช้ไม่ได้ผลเลย** เพราะป้ายของ TAIHEIYO (`SiO2`) และ Tin Powder (`D50`) ตกด่าน `nameSig < 2`
ตั้งแต่ต้นลูป → ยังไม่ต้องเขียน แต่ห้ามสรุปว่า "จับคู่คอลัมน์ทำไม่ได้"

**ไม่มีวิธีไหนใน 3 วิธีที่ probe ถูกเกิน 1 ใน 3** และแต่ละวิธีผิดกับอีก 2 ใบ. ผิดคอลัมน์ฝั่ง keep = **รับรองค่าที่ยืมมา
ว่าเป็นของแถวนั้น = PASS ปลอมที่ด่านนี้มีไว้กันโดยตรง** -> ใส่กฎจับคู่แบบเดา อันตรายกว่าไม่ใส่
(ต้นเหตุเชิงโครงสร้าง: OCR รวม/ตัดช่องไม่เหมือนกันทุกใบ — RI-015 รวม 2 ป้ายเป็นช่องเดียวและหยิบ `01`
จาก `Lot#01` มาเป็นเลข · Tin Powder มี `SA2607003` นำและ `Pass` ปิดท้าย · TAIHEIYO มีช่องหน่วย `(wt%)`)

### แก้อย่างไร
คืนสัญญาเดิมของด่าน — **"พิสูจน์ collapse ไม่ได้ -> คง PASS"** — ให้ครอบทรงแนวนอนด้วย
เพิ่มด่านก่อน downgrade: ถอยเมื่อบรรทัด anchor เป็น **แถวป้ายที่มีชื่อแถวนี้เป็นช่องเต็ม** และ
**ค่าของแถวโผล่บนบรรทัดถัดลงไปในบล็อกเดียวกัน**

- แถวป้าย = อย่างน้อย 3 ช่อง และ**ไม่มีช่องไหนเป็นเลขล้วน** (มีช่องเลขล้วน = บรรทัดนี้ถือค่าเอง = แนวตั้ง ไม่แตะ)
- ชื่อต้องตรง**เต็มช่อง** ไม่ใช่ substring — พิสูจน์ว่าชื่อนี้เป็นป้ายคอลัมน์จริง
- ★ **ด่านยังมีฟัน** ★ ค่าที่ไม่โผล่ในบล็อกเลย = ปั้นมาจริง -> ยัง downgrade ตามเดิม

### ราคาที่จ่าย (พูดตรง ๆ)
เคส H ถอยหลัง: ค่าที่ยืมมาจากคอลัมน์ข้าง ๆ บนตารางแนวนอน เดิมโดน downgrade ตอนนี้ไม่โดน
**แต่การ downgrade นั้นไม่ใช่ความสามารถของด่าน** — มันเกิดจาก `hasDataNumber` ที่ขึ้นกับว่า OCR
เผลอทิ้งเลขไว้บนแถวป้ายหรือเปล่า (เคส D ทรงเดียวกันแต่ป้ายไม่มีเลข ด่านก็ปล่อยผ่านอยู่แล้ว)

หลักฐานเชิงคลัง: `[pass-guard]` ยิง **ทั้งหมด 1 ครั้งในทุกคลัง** (corpus17 + 13 ใบ + 10 ใบหน้างาน)
= RI-015 = **false SKIP 5 แถว, true catch 0** -> ที่ตัดทิ้งไปคือกฎที่ยังไม่เคยจับของจริงได้เลยสักครั้ง

### ผลรัน — diff นี้**ขยับแถวจริง** (ต่างจาก ROUND 37)
| ชุด | ก่อนแก้ (HEAD 84c0ffc) | หลังแก้ | ผลต่อ verdict |
|---|---|---|---|
| corpus17 | 128P/0F/10S rows=138 **needsReview=11** | 128P/0F/10S rows=138 **needsReview=8** | verdict เท่าเดิม · ธงลด 3 |
| 13 ใบใหม่ | 118P/0F/17S rows=135 nr=61 | **เท่าเดิมทุกช่อง** | ไม่ขยับ |
| 10 ใบหน้างาน | 76P/0F/25S rows=101 nr=29 | **เท่าเดิมทุกช่อง** | ไม่ขยับ |

**verdict รายไฟล์เหมือนกันเป๊ะทั้ง 3 คลัง** (diff มีแต่เวลา) · `npx tsc -p .` = 0 · unit **26 suite** exit 0
(`coa-pass-guard` 24->**34 เคส**) · ทั้ง 3 รัน `bad allocation` / `[retry]` / `OCR_DAEMON_DOWN` = 0
(ตัวเลขข้างบนคือรอบหลังแก้ตาม reviewer แล้ว — รันคลังครบ 3 ชุดใหม่ทั้งหมด ไม่ได้ใช้ผลรอบก่อนแก้)

ที่ขยับคือ **ภายในไฟล์ RI-015**:

| | ก่อน | หลัง |
|---|---|---|
| `[pass-guard]` | downgrade **5** | downgrade **2** |
| candidate ตัวตั้ง | 6P | **9P** |
| HQ challenger | ชนะ 6P->11P · needsReview **+5** | ชนะ 9P->11P · needsReview **+2** |
| ผลสุดท้ายของใบ | 11P/0F/3S | **11P/0F/3S** |

3 แถวที่เลิก downgrade = false SKIP ที่ยืนยันกับใบแล้ว -> ธง `needsReview` รวมของคลังลด 11->8
อีก 2 แถว (`(udd) sv` = Sb `<15` · `(udd) qs` = As `8 < 15`) **ยังเป็น false SKIP เหมือนกัน**
ตามใบ แต่ยัง downgrade เพราะ OCR รวม 2 ป้ายเป็นช่องเดียว (`"(udd) sv  (udd) qs"`) -> ชื่อไม่ตรงเต็มช่อง
-> พิสูจน์ไม่ได้ว่าเป็นคอลัมน์ของตัวเอง. **คำตัดสินจึงยังขึ้นกับอุบัติเหตุของ OCR อยู่ดี** เปลี่ยนจาก
"เลขหลงบนแถวป้าย" เป็น "ป้ายถูกรวมช่อง" — รอบนี้ปิดได้เฉพาะกรณีที่ OCR แยกช่องให้

★ ผลสุดท้ายไม่ขยับ **ไม่ได้แปลว่าแก้แล้วไม่มีผล** ★ RI-015 รอดมาได้เพราะ HQ challenger บังเอิญ
อ่านชื่อสะอาดพอที่ด่านจะไม่ยิง — ถ้า HQ แพ้หรือ daemon ปิด ใบนี้จะออก 6P แทน 11P ทันที

### opus-reviewer จับ 2 blocker ที่ gate มองไม่เห็น — แก้แล้วทั้งคู่
1. **ด่านแนวนอนรั่วไปคลุมตารางแนวตั้ง** — เกณฑ์ "แถวป้าย = ไม่มีช่องเลขล้วน" หลวมเกิน:
   แถวแนวตั้งปกติที่ค่ามีหน่วย (`0.35 g/L`) หรือเกณฑ์เป็นช่วง (`18 - 26`) ก็ไม่มีช่องเลขล้วนเหมือนกัน
   → ถูกนับเป็นแถวป้าย → **ค่าที่ยืมมาจากแถวถัดไปรอดเป็น PASS** = รูที่ด่านนี้มีไว้กันโดยตรง
   reviewer ยิงผ่านฟังก์ชันจริง 4 เคส รั่วทั้ง 4 → แก้เป็น **"ช่องขึ้นต้นด้วยตัวเลข"** (`VALUE_CELL`)
   ★ คลังปัจจุบันมองไม่เห็นรูนี้ ★ สแกน OCR ทั้ง 40 หน้า: บรรทัดที่มี ≥3 ช่องและไม่มีช่องเลขล้วน
   เป็น metadata ล้วน (`NET WEIGHT | 125 Kg`) ไม่มีแถวรายการสักแถว → gate ผ่านทั้งที่รูเปิดอยู่
2. **ขอบเกณฑ์ที่ยืมมาหลุดด่าน** — เดิมเช็คแค่ว่าค่าผลโผล่ใต้แถวป้ายไหม ไม่เช็คขอบเกณฑ์
   → ค่าผลถูกแต่ LLM ยกเกณฑ์หลวมจากที่อื่นมา (`32` vs `≤500` แทน `<50` ของจริง) = PASS ปลอมรอด
   ทั้งที่ path บรรทัดเดียวข้างบนบังคับ `rHit && sHit` มาตลอด → บังคับให้เห็นทั้งค่าและขอบ
   **แต่ยอมให้อยู่คนละบรรทัดในหน้าต่างเดียวกัน** (ค่ากับเกณฑ์อยู่คนละบรรทัด = นิยามของทรงแนวนอน
   ถ้าบังคับบรรทัดเดียวกัน RI-015 จะพังกลับ) + ข้ามบรรทัดที่ไม่ใช่ตาราง (<3 ช่อง) กันเลขในหัวจดหมาย

ข้อรองที่ยังไม่ทำตาม (จงใจ): **ไม่ปัก `needsReview` ตอนถอย** — bail อื่นของฟังก์ชันนี้เงียบหมด
และแถวในตารางแนวนอนเดียวกันตกคนละด่าน (บางแถวตก `nameSig<2` บางแถวตก 484) → ปักเฉพาะแถวที่มาถึง
branch นี้ = ธงกระจายมั่วในตารางเดียวกัน ซึ่งแย่กว่าไม่ปัก (กฎ margin-green: ธงเฟ้อ → คนเลิกเชื่อธง)
ถ้าจะปัก ต้องปักทั้งใบตอนตรวจพบทรงแนวนอน = คนละ commit

### ค้างไว้ (คนละ commit คนละ gate)
- ★ **ตารางแนวนอนยังไม่มีด่านกัน PASS ปลอม** ★ (เคส B/D/H) — ปิดได้ต่อเมื่อมีตัวอ่านคอลัมน์ของทรงนี้
  ที่เชื่อได้ ดูตารางผลการวัด 3 วิธีข้างบนว่าทำไมกฎง่าย ๆ ใช้ไม่ได้ · ทางที่น่าจะไปได้คือยืมผลของ
  `spec-row-below-recovery` / `parse-structural-grid` ที่จับคู่ช่องสำเร็จแล้ว แทนที่จะจับคู่เองใหม่ในด่าน
- ป้ายสั้น (`nameSig < 2`) ยังไม่เข้าลูปเลย — `Tin Powder` (`D50`/`D90`/`D100`) ไม่มีด่านคุ้มครองทั้งสองทาง
- ไม่มีตัวนับว่า branch ถอยถูกเดินกี่ครั้ง (`console.warn` ยิงเฉพาะตอน downgrade > 0) → วัด blast radius
  ของรอบหน้าไม่ได้ · และ verdict ที่ขยับอาจไปเปลี่ยน `skipMayBenefitFromHq` / `preservesPasses` ต่อ
  (SKIP น้อยลง = อาจไม่ยิง HQ challenger · PASS ตัวตั้งสูงขึ้น = challenger ที่ดีกว่าอาจถูกปฏิเสธ)
  RI-015 รอดทั้งสองทางในรอบนี้ แต่เป็นความบังเอิญของไฟล์ ไม่ใช่คุณสมบัติของ diff
- `suppressCopiedSpec` (`coa-evaluator.ts:577`) ตาบอด tilde เต็มความกว้าง — แก้ที่ `copied()` ห้ามแก้ `raw`
- `spec-normalizer.ts:81/91/108` ยังมี copy ตัวคั่นของตัวเอง ยังไม่รวมเข้า `numeric.ts`
- `parenSpec` กรองผิดแกน · คอลัมน์ `Typical`/`Target` · 2 ตารางบนหน้าเดียวที่จำนวนคอลัมน์เท่ากัน ·
  summary ไม่คำนวณใหม่หลัง `recoverMissingSieveRows`
- ของค้างจาก ROUND 37: 4 pass ท้ายไม่อ่านธง `specFromCell` · ฟอกธงที่ `bound-cell` + `spec-pair` ·
  whitelist field ตอน parse ผล LLM · รูฝาแฝดของ `spec-bound` บนแถวจาก deterministic grid
