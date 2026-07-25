# INSTALL-OFFLINE — ติดตั้ง COA analyzer หน้างาน (air-gapped, ไม่มีเน็ต/winget)

เอกสารติดตั้ง **ครบทั้งระบบ** บนเครื่อง server ตัวเดียว (Windows x64) แบบออฟไลน์ 100% —
ไม่ต่อเน็ต ไม่ใช้ winget ไม่แตะ npm registry / pip PyPI / ModelScope / Ollama registry เลย
จากนั้นเครื่องอื่นในวง LAN เปิด browser เข้าใช้ได้

> เหตุผลที่ต้องออฟไลน์: หน้างานโรงงาน (security ญี่ปุ่น) บล็อกเว็บทั้งหมด →
> `ollama pull` / `pip install` / `npm install` / model auto-download **ทำไม่ได้** →
> ทุกอย่าง (installer + model + dependency) ถูก bundle มาให้ครบ

---

## 0. ต้องมีอะไรบ้าง

**USB / โฟลเดอร์ที่ยกไปหน้างาน** — 3 ชุด (จาก Desktop ของเครื่อง dev):

| ชุด | โฟลเดอร์ | ขนาด | หน้าที่ |
|---|---|---|---|
| 1 | `ollama-offline\` | ~3.9 GB | Ollama + qwen3:4b (LLM parse text → JSON) |
| 2 | `ocr-offline\` | ~389 MB | Python + RapidOCR + models (OCR สำหรับ scanned COA) |
| 3 | `coa-app-offline\` | ~653 MB | Node app: backend + frontend (มี node_modules ครบ) |

**เครื่อง server หน้างานต้องมี (prerequisite):**
- Windows **x64** (native binary ใน bundle ผูก arch นี้)
- **Node.js ≥ v18** — ลงแล้ว (เช็ค `node -v`)
- **pm2** — ลงแล้ว (เช็ค `pm2 -v`) → ใช้ pm2 เป็นตัวคุม process (ทางหลักในเอกสารนี้)
- ไม่ต้องต่อเน็ต / ไม่ต้อง admin (installer เป็น per-user ทั้งคู่)

---

## 1. Layout — วางโฟลเดอร์ให้ถูก (สำคัญ, path ผูกกัน)

เลือก root สักที่ เช่น **`C:\coa`** แล้วจัด `backend` / `frontend` / `ocr-py` เป็น **sibling**
(เพราะ `ecosystem.config.js` อ้าง `./backend` `./frontend` `./ocr-py` แบบ relative):

```
C:\coa\
├── backend\            (ขั้น 4 — แตกจาก coa-app-offline\backend.tar)
├── frontend\           (ขั้น 4 — แตกจาก coa-app-offline\frontend.tar)
├── ocr-py\             (ขั้น 3 — จาก ocr-offline หลังลง venv+models)
├── ecosystem.config.js (ขั้น 4 — คัดจาก coa-app-offline\)
└── start-all.ps1       (ขั้น 4 — เผื่อไม่ใช้ pm2)
```

---

## 2. ชุด 1 — Ollama + qwen3:4b

```powershell
cd <USB>\ollama-offline
powershell -ExecutionPolicy Bypass -File install-offline.ps1
```

สคริปต์ทำ 3 ขั้น: ลง `OllamaSetup.exe /SILENT` (per-user) → copy model blobs เข้า
`%USERPROFILE%\.ollama\models` → `ollama list`

**ต้องเห็น `qwen3:4b` (2.5 GB) ในตาราง** = ผ่าน. ทดสอบ:
```powershell
ollama run qwen3:4b "ทดสอบ ตอบสั้นๆ"
```

> ทำไมต้อง copy blobs: หน้างาน `ollama pull` ไม่ได้ → ลง installer เฉยๆ = ไม่มี model
> Ollama รันเป็น **tray app** (ไม่อยู่ใน pm2) — ลงเสร็จมันขึ้นเอง, boot ก็ขึ้นเอง

---

## 3. ชุด 2 — OCR sidecar (RapidOCR + models)

```powershell
cd <USB>\ocr-offline
powershell -ExecutionPolicy Bypass -File install-ocr-offline.ps1
```

สคริปต์ทำ 4 ขั้น: หา/ลง Python 3.13 (per-user) → สร้าง `ocr-py\venv` →
`pip install --no-index --find-links wheels -r frozen.txt` (offline ล้วน) →
**copy models 10 ไฟล์เข้า `venv\Lib\site-packages\rapidocr\models\`** → smoke test

จบแล้วได้ `ocr-offline\ocr-py\` = OCR sidecar พร้อมรัน (venv + models ครบข้างใน)

**★ ย้าย ocr-py ไปวางที่ deploy root:**
```powershell
Move-Item <USB>\ocr-offline\ocr-py C:\coa\ocr-py
```
(หรือ copy ทั้งโฟลเดอร์ ขอแค่ `C:\coa\ocr-py\venv\Scripts\python.exe` มีจริง)

> **GOTCHA สำคัญที่สุดของ OCR:** RapidOCR package ship มาแค่ v4 `_infer` — แต่ daemon ใช้
> v4 `_mobile` (default) + v5 `_server` (HQ) ซึ่งปกติ **auto-download จาก ModelScope ครั้งแรก**.
> ออฟไลน์ = download ไม่ได้ = daemon พัง. เลยต้อง copy models เข้า venv (ขั้น 4 สคริปต์ทำให้แล้ว).
> ถ้า daemon start แล้วขึ้น "downloading model..." = ลืมขั้นนี้
>
> HQ engine (v5 server) preload กิน RAM หลายร้อย MB. RAM น้อย → ปิดด้วย env `COA_OCR_HQ_PRELOAD=false`
> (ตั้งใน ecosystem.config.js block `ocr-daemon`) — แลกกับ request HQ แรกช้าลง

---

## 4. ชุด 3 — Node app (backend + frontend)

```powershell
cd C:\coa
tar -xf <USB>\coa-app-offline\backend.tar      # ได้ C:\coa\backend  (node_modules ครบ)
tar -xf <USB>\coa-app-offline\frontend.tar     # ได้ C:\coa\frontend (node_modules ครบ)
copy <USB>\coa-app-offline\ecosystem.config.js  C:\coa\
copy <USB>\coa-app-offline\start-all.ps1        C:\coa\
mkdir C:\coa\backend\uploads                    # multer เขียน upload ลงที่นี่ (tar ไม่ได้ใส่มา)
```

- `tar` มีมากับ Windows 10/11 อยู่แล้ว. ถ้าไม่มีใช้ 7-Zip แตก `.tar`
- **ไม่ต้อง `npm install`** — node_modules ถูก bundle มาแล้ว (native binary ตรง arch: `sharp-win32-x64`, `@napi-rs/canvas`, `@next/swc-win32-x64`)
- backend รันด้วย ts-node (ไม่มี build step). env service URL ตั้งใน `ecosystem.config.js` ให้แล้ว → ไม่ต้องสร้าง `backend\.env` (ถ้าจะเปิด DB persist ค่อยเพิ่มทีหลัง)

---

## 5. ★ ตั้ง IP แล้ว BUILD frontend ★ (จุดพลาดง่ายสุด — อ่านให้ครบ)

frontend **ฝัง IP ของ backend ตอน build** (`NEXT_PUBLIC_*` ถูก inline) → ต้องรู้ LAN IP ของ
เครื่อง server นี้ก่อน build:

```powershell
ipconfig        # หา IPv4 Address ของ adapter ที่ต่อ LAN โรงงาน เช่น 192.168.1.50
```

สร้าง `C:\coa\frontend\.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=http://192.168.1.50:3001      ← ใส่ IP จริงของ server
```

แล้ว build (offline ได้ เพราะ node_modules ครบ — validated แล้ว):
```powershell
cd C:\coa\frontend
npm run build
```

**กติกาที่พลาดบ่อย:**
- ❌ **ห้ามใส่ `localhost`** — JS วิ่งบน browser ของ *client* → `localhost` = เครื่อง client เอง = upload พัง
- ❌ **IP งาน resonac (`100.116.118.114` / ช่วง `100.x`) ใช้ไม่ได้** — นั่นคือ Tailscale/VPN ของ
  อีกโปรเจกต์ คนละเครื่อง. ต้องเป็น **LAN IP ของเครื่อง server COA นี้เอง** ที่ client ในโรงงานมองเห็น
- ⚠️ เปลี่ยน IP ทีหลัง = **ต้อง `npm run build` ใหม่ทุกครั้ง** (ค่าถูกฝังตอน build)

---

## 6. Firewall — เปิด 2 port

```powershell
netsh advfirewall firewall add rule name="COA-frontend-3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="COA-backend-3001"  dir=in action=allow protocol=TCP localport=3001
```
`8765` (OCR daemon) + `11434` (Ollama) = localhost เท่านั้น **ไม่ต้องเปิด**

---

## 7. Start — ยก stack ด้วย pm2

```powershell
cd C:\coa
pm2 start ecosystem.config.js
pm2 save                        # จำ process list (boot ขึ้นมา pm2 resurrect)
pm2 status                      # ต้องเห็น 3 ตัว online: coa-backend / ocr-daemon / coa-frontend
```

`ecosystem.config.js` คุม 3 process (Ollama แยก tray):

| process | port | คำสั่งจริง |
|---|---|---|
| `coa-backend` | 3001 | ts-node `backend/src/index.ts` (env: OLLAMA_URL, OCR_SIDECAR_URL localhost) |
| `ocr-daemon` | 8765 | `ocr-py/venv/Scripts/python.exe ocr_server.py 8765` (mobile/v4 + HQ preload) |
| `coa-frontend` | 3000 | `next start` (ต้อง `next build` จากขั้น 5 ก่อน) |

boot persist (server รีสตาร์ท pm2 ขึ้นเอง): ลง `pm2-installer` หรือ scheduled task รัน `pm2 resurrect`

**ทางเลือกไม่ใช้ pm2** (ถ้า pm2 มีปัญหา): `cd C:\coa; .\start-all.ps1` — เปิด 3 หน้าต่าง terminal เอง

---

## 8. Verify (5 เช็ค)

```powershell
# บน server
curl http://localhost:8765/health      # OCR daemon: {"ok":true}
curl http://localhost:11434/api/tags    # Ollama: มี qwen3:4b
pm2 status                              # 3 online, restart count ไม่พุ่ง

# บน client เครื่องอื่นในวง LAN
#   browser -> http://192.168.1.50:3000   (IP server)
#   upload COA จริง 1 ใบ -> ต้องได้ตาราง PASS/FAIL/SKIP (ไม่ค้าง/ไม่ error)
```

---

## 9. Deploy code ใหม่รอบถัดไป (ถ้ามีแก้)

ถ้าหน้างานต่อเน็ตไม่ได้ → ต้องยก tar ชุดใหม่มาแตกทับ. ถ้าต่อ git ได้:
```powershell
cd C:\coa
git pull
cd frontend; npm run build; cd ..     # เฉพาะถ้าแก้ FE (Next ต้อง build ใหม่)
pm2 restart all                        # ★ ทั้งหมด — ไม่ใช่แค่ backend ★
```
> ★ ต้อง `pm2 restart all` — contract OCR แก้ทั้ง backend (ส่ง bytes) + daemon (decode).
> restart แค่ backend ทิ้ง daemon เก่า = fall back Tesseract เงียบ = OCR หยาบลง

---

## 10. Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| client upload error/ค้าง แต่ server เองใช้ได้ | `.env.local` ใส่ `localhost` หรือลืม build ใหม่ | ตั้ง IP จริง → `npm run build` → `pm2 restart coa-frontend` |
| OCR daemon start ขึ้น "downloading model..." | ลืม copy models เข้า venv (ขั้น 3) | รัน `install-ocr-offline.ps1` ใหม่ หรือ copy `models\*` เข้า `venv\Lib\site-packages\rapidocr\models\` |
| ผล OCR หยาบ/เพี้ยนผิดปกติ | daemon ล่ม → fall back Tesseract เงียบ | `curl :8765/health` ต้อง `{"ok":true}` · `pm2 restart ocr-daemon` |
| daemon กิน RAM เยอะ | HQ engine (v5 server) preload | ตั้ง `COA_OCR_HQ_PRELOAD=false` ใน ecosystem block `ocr-daemon` → `pm2 restart ocr-daemon` |
| upload แรกหลัง idle นาน ~37s | qwen3 โดน evict จาก RAM/VRAM | ปกติ — keep-warm ping กันไว้แล้ว; เช็ค Ollama tray รันจริง |
| client เข้า `:3000` ไม่ได้เลย | firewall ปิด | เปิด firewall 3000+3001 (ขั้น 6) · `pm2 logs coa-frontend` |
| pm2 ไม่มี/พัง | ลง offline ไม่ได้ (global npm) | ใช้ `start-all.ps1` แทน (ไม่พึ่ง pm2) |

---

## 11. สรุป Gotcha (อ้างอิงเร็ว)

1. **models ต้อง bundle** — Ollama blobs + RapidOCR onnx auto-download ไม่ได้ตอนออฟไลน์ → copy มาให้ครบ
2. **frontend IP ฝังตอน build** — ตั้ง `.env.local` (LAN IP server, ไม่ใช่ localhost/resonac-100.x) ก่อน `npm run build` เสมอ
3. **layout sibling** — `backend/ frontend/ ocr-py/` ต้องอยู่ root เดียวกัน (`ecosystem.config.js` อ้าง relative)
4. **pm2 restart all** ตอน deploy — ไม่ใช่แค่ backend (contract OCR 2 ฝั่ง)
5. **node_modules bundle มาแล้ว** — ห้าม `npm install` ทับ (registry บล็อก + จะพัง native binary)

> เอกสารนี้ = source of truth สำหรับติดตั้งหน้างาน. DEPLOY.md = architecture + runbook ทั่วไป (ไม่เจาะ offline)
