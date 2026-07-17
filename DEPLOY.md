# DEPLOY — ลงหน้างาน (server เดียว, LAN client เข้าใช้)

Runbook สำหรับ deploy COA analyzer บนเครื่อง **server ตัวเดียว** (Windows) แล้วให้ **เครื่องอื่นในวง LAN เปิด browser เข้าใช้ได้**

---

## 1. Architecture — 4 process บนเครื่อง server

| process | port | คุมด้วย | LAN เข้าถึง? |
|---|---|---|---|
| **frontend** (Next.js) | 3000 | pm2 | ✅ client เปิดหน้านี้ |
| **backend** (Express/ts-node) | 3001 | pm2 | ✅ frontend ยิง API มาที่นี่ |
| **ocr-daemon** (Python RapidOCR) | 8765 | pm2 | ❌ localhost เท่านั้น |
| **Ollama** (qwen3:4b) | 11434 | **tray/service แยก** | ❌ localhost เท่านั้น |

client เครื่องอื่น **คุยกับแค่ 3000 + 3001** · daemon กับ Ollama เป็นเรื่องภายในของ server (localhost)

```
[client browser] --3000--> [frontend] --(ใน browser client)--3001--> [backend] --localhost--> [daemon :8765]
                                                                              \--localhost--> [Ollama :11434]
```

---

## 2. Prerequisite — ติดตั้งครั้งแรก

```powershell
# --- Ollama (ครั้งเดียว) ---
# ลง OllamaSetup.exe แล้ว:
ollama pull qwen3:4b
# เครื่องเดียว daemon/backend คุย localhost → ไม่ต้องตั้ง OLLAMA_HOST
# (จะตั้ง 0.0.0.0 เผื่อแยกเครื่องทีหลังก็ได้: setx OLLAMA_HOST 0.0.0.0 → Quit tray → เปิดใหม่)

# --- backend (ts-node รัน .ts ตรง ไม่ต้อง build) ---
cd backend
npm install
#  สร้าง backend\.env (ดูหัวข้อ 3)

# --- OCR daemon ---
cd ..\ocr-py
python -m venv venv
venv\Scripts\pip install -r requirements.txt

# --- frontend (ต้อง build — ตั้ง IP server ก่อน!) ---
cd ..\frontend
npm install
#  สร้าง frontend\.env.local (ดูหัวข้อ 3) ← ★ ต้องมีก่อน build ★
npm run build

# --- pm2 (ถ้ายังไม่มี) ---
npm install -g pm2
```

---

## 3. Env — ตั้ง 2 ไฟล์

### `backend\.env` — DB + feature flag
```
PORT=3001
OLLAMA_MODEL=qwen3:4b
# service URL (localhost เพราะ server เดียว) ตั้งใน ecosystem.config.js ให้แล้ว ไม่ต้องซ้ำ
# DB ปิด default (ไม่ persist) — เปิดเมื่อพร้อม:
# ENABLE_DB=true
# DB_HOST=localhost  DB_PORT=5432  DB_USERNAME=postgres  DB_PASSWORD=xxx  DB_NAME=invoice_db
```

### `frontend\.env.local` — ★ จุดพลาดง่ายสุด ★
```
NEXT_PUBLIC_API_BASE_URL=http://<SERVER_LAN_IP>:3001
```
- `<SERVER_LAN_IP>` = IP ของเครื่อง server ในวง LAN (เช็ค `ipconfig` → IPv4 Address เช่น `192.168.1.50`)
- **ห้ามใส่ `localhost`** — JS วิ่งบน browser ของ client → `localhost` = เครื่อง client เอง = upload พัง
- ⚠️ `NEXT_PUBLIC_*` ถูก inline ตอน `next build` → **แก้ค่าแล้วต้อง `npm run build` ใหม่เสมอ**

---

## 4. Firewall — เปิด 2 port

```powershell
netsh advfirewall firewall add rule name="COA-frontend-3000" dir=in action=allow protocol=TCP localport=3000
netsh advfirewall firewall add rule name="COA-backend-3001"  dir=in action=allow protocol=TCP localport=3001
# 8765 (daemon) + 11434 (Ollama) ไม่ต้องเปิด — localhost เท่านั้น
```

---

## 5. Start — ยก stack ทั้งหมด

```powershell
cd C:\local-repo\OCR        # repo root (ที่มี ecosystem.config.js)
pm2 start ecosystem.config.js
pm2 save                    # จำ process list ไว้ (boot ขึ้นมาใหม่ pm2 resurrect)
pm2 status                  # เช็คทั้ง 3 online: coa-backend / ocr-daemon / coa-frontend
```

boot persist (server รีสตาร์ทแล้ว pm2 ขึ้นเอง): ลง `pm2-installer` หรือตั้ง scheduled task รัน `pm2 resurrect`

---

## 6. Deploy code ใหม่ (รอบถัดไป)

```powershell
cd C:\local-repo\OCR
git pull
cd frontend; npm run build; cd ..   # เฉพาะถ้าแก้ FE (Next ต้อง build ใหม่)
pm2 restart all                     # restart backend + daemon + frontend พร้อมกัน
```

⚠️ **ต้อง `pm2 restart all` ไม่ใช่แค่ backend** — contract OCR แก้ทั้ง 2 ฝั่ง (backend ส่ง bytes, daemon ต้องเป็น code ใหม่ถึงจะ decode). restart แค่ backend ทิ้ง daemon เก่าไว้ = เสี่ยงพัง

**Ollama ไม่ต้องแตะ** ตอน deploy code — restart เฉพาะตอนเปลี่ยน `OLLAMA_HOST` หรือ pull model ใหม่

---

## 7. Verify หลัง deploy (5 เช็ค)

```powershell
# บน server
curl http://localhost:8765/health          # daemon: {"ok":true}
curl http://localhost:11434/api/tags        # Ollama: มี qwen3:4b
pm2 status                                  # 3 ตัว online, restart count ไม่พุ่ง

# บน client เครื่องอื่นใน LAN
#   เปิด browser → http://<SERVER_LAN_IP>:3000
#   upload ไฟล์ COA จริง 1 ใบ → ต้องได้ตารางผล PASS/FAIL/SKIP (ไม่ค้าง/ไม่ error)
```

---

## 8. Troubleshooting — gotcha ที่เจอจริง

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| client upload แล้ว error/ค้าง แต่บน server เองใช้ได้ | `frontend\.env.local` ใส่ `localhost` หรือลืม build ใหม่ | ตั้ง `NEXT_PUBLIC_API_BASE_URL=http://<SERVER_IP>:3001` → `npm run build` → `pm2 restart coa-frontend` |
| ผล OCR เพี้ยน/หยาบผิดปกติหลัง deploy | daemon เก่าค้าง (restart แค่ backend) → fall back Tesseract เงียบ | `pm2 restart ocr-daemon` (หรือ `restart all`) |
| upload แรกหลัง server idle นาน ~37s | qwen3 โดน evict จาก VRAM | ปกติ — keep-warm ping ทุก 8 นาทีกันไว้แล้ว (`OLLAMA_KEEP_WARM`); ถ้ายังนานเช็ค Ollama process ขึ้นจริง |
| daemon 500 / หาไฟล์ไม่เจอ | (เฉพาะถ้าแยก daemon ไปคนละเครื่องทีหลัง) code ใหม่ส่ง bytes แล้ว — เช็คว่า daemon เป็น code ล่าสุด | `pm2 restart ocr-daemon` |
| client เข้า `:3000` ไม่ได้เลย | firewall ปิด / Next bind ผิด | เปิด firewall 3000+3001 · `pm2 logs coa-frontend` ดู bind |
| แตะ pipeline OCR/evaluator แล้วไม่แน่ใจผล | — | รัน gate: `cd backend && npx ts-node _validate/verify-4b-only.ts <corpus-dir>` เทียบ baseline ที่ `src/services/coa/TEST-LOG.md` |

---

## 9. หมายเหตุ — future: แยก daemon/Ollama ไปเครื่อง LAN อีกตัว

code รองรับแล้ว (`rapidocr.service.ts` ส่ง bytes, daemon bind `OCR_BIND_HOST=0.0.0.0`). ถ้าจะ offload:
1. ยก `ocr-daemon` (+Ollama) ไปเครื่อง LAN อีกตัว → ตั้ง `OCR_BIND_HOST=0.0.0.0` + firewall 8765/11434 บนเครื่องนั้น
2. backend ตั้ง `OCR_SIDECAR_URL=http://<OCR_IP>:8765` + `OLLAMA_URL=http://<OLLAMA_IP>:11434/api/generate`
3. รัน gate ยืนยัน 0 regression ก่อนใช้จริง
