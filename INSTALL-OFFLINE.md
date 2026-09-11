# INSTALL-OFFLINE — ติดตั้ง COA analyzer หน้างาน (air-gapped, ไม่มีเน็ต/winget)

เอกสารติดตั้ง **ครบทั้งระบบ** บนเครื่อง server ตัวเดียว (Windows x64) แบบออฟไลน์ 100% —
ไม่ต่อเน็ต ไม่ใช้ winget ไม่แตะ npm registry / pip PyPI / ModelScope / Ollama registry เลย
จากนั้นเครื่องอื่นในวง LAN เปิด browser เข้าใช้ได้

> เหตุผลที่ต้องออฟไลน์: หน้างานโรงงาน (security ญี่ปุ่น) บล็อกเว็บทั้งหมด →
> `ollama pull` / `pip install` / `npm install` / model auto-download **ทำไม่ได้** →
> ทุกอย่าง (installer + model + dependency) ถูก bundle มาให้ครบ

---

## 0. ต้องมีอะไรบ้าง

**ชุดติดตั้งที่ต้องเอาขึ้นเครื่อง server** — 3 ชุด (จาก Desktop ของเครื่อง dev)
ส่งผ่าน USB หรือ copy ข้ามผ่าน remote session ก็ได้ · **ปลายทางบนเครื่อง server = `C:\coa-setup\`** (ดู §0.2):

| ชุด | โฟลเดอร์ | ขนาด | หน้าที่ |
|---|---|---|---|
| 1 | `ollama-offline\` | 3.74 GB | Ollama + qwen3:4b (LLM parse text → JSON) |
| 2 | `ocr-offline\` | 401 MB | Python + RapidOCR + models (OCR สำหรับ scanned COA — รวม rec ภาษาไทย) |
| 3 | `coa-app-offline\` | 648 MB | Node app: backend + frontend (มี node_modules ครบ) + **Node runtime zip** |

รวม **88 ไฟล์** (~4.7 GB) · เอกสารที่ต้องอ่านคือไฟล์นี้ไฟล์เดียว (สำเนาอยู่ใน `coa-app-offline\` ด้วย)
**ตัวเลขที่ใช้ตัดสินว่าครบคือจำนวนไฟล์ ไม่ใช่ GB** — ขนาดขยับทุกครั้งที่แก้เอกสารหรือเพิ่ม model

> เคยมี `COA-Offline-Install-Guide.html` (คู่มือฉบับมีรูป) แถมมาในชุด — **เลิกทำแล้ว 17 ส.ค. 2026**
> เพราะไม่มีตัว build ในโปรเจกต์ ต้องปั้นมือทุกรอบ แล้วมันค้างเป็นเนื้อหาเก่าทันทีที่แก้ไฟล์นี้
> (รูปในนั้นเป็นหน้าจอแอป ไม่ใช่ขั้นตอนติดตั้ง — เปิดแอปถ่ายใหม่ได้)

**เครื่อง server หน้างานต้องมี (prerequisite):**
- Windows **x64** (native binary ใน bundle ผูก arch นี้)
- **Node.js ≥ v20.9** — เช็ค `node -v`. **ไม่ใช่ v18** — `next@16.0.10` ประกาศ `engines.node: >=20.9.0`
  รันบน v18 = `next build` ตาย. dev machine ที่ validate = v24.16.0
  → **ไม่ถึง / ไม่มี Node = ไม่ต้องหาโหลด** มี `node-v24.16.0-win-x64.zip` แถมมาใน `coa-app-offline\` แล้ว (ดู §0.1)
- **pm2** — ลงแล้ว (เช็ค `pm2 -v`) → ใช้ pm2 เป็นตัวคุม process (ทางหลักในเอกสารนี้)
  → **ไม่มี pm2 ลงเพิ่มไม่ได้ตอนออฟไลน์** (global npm package ต้องดึง registry) → ใช้ `start-all.ps1` แทน (ขั้น 7)
  → ⚠️ **สำรวจ pm2 ของเครื่องก่อนเสมอ (§7.0)** — เป็น service หรือเปล่า · `PM2_HOME` อยู่ไหน ·
  มี app ของทีมอื่นรันอยู่ด้วยไหม. 3 ข้อนี้เปลี่ยนวิธีติดตั้งจริง ไม่ใช่รายละเอียดปลีกย่อย
- **สิทธิ์ admin** — ต้องมี: Python ต้องลงแบบ machine-wide ที่ `C:\Python313` (§3.1) + เปิด firewall (ขั้น 6).
  Ollama ยังเป็น per-user ไม่ต้อง admin
- **GPU NVIDIA ว่าง ≥ 4 GB VRAM (แนะนำแรง)** — qwen3:4b กิน ~3.9 GB. ไม่มี GPU ระบบยังทำงานได้ครบ
  แต่ LLM ตกไปรันบน CPU = **ช้าลง ~11x** (วัดจริง 94 → 8.6 tok/s) → COA 1 ใบจาก ~10-20s เป็น ~2-8 นาที
  ดูวิธีตรวจที่ขั้น 8 · RAM ต้องเหลือ ≥ 6 GB (Ollama 3-4 GB + OCR daemon 0.5-1 GB + Node 1 GB)
- ไม่ต้องต่อเน็ตเลยตลอดกระบวนการ

### 0.1 ถ้า Node ต่ำกว่า v20.9 หรือไม่มี Node — ใช้ zip ที่แถมมา

`coa-app-offline\node-v24.16.0-win-x64.zip` (35 MB) = Node **แบบ portable** แตกแล้วใช้ได้เลย
ไม่ใช่ installer → **ไม่ต้อง admin ไม่ต้องถอน Node เดิม** (ของเดิมยังอยู่ ไม่ถูกแตะ)

```powershell
# 1) แตก zip
Expand-Archive C:\coa-setup\coa-app-offline\node-v24.16.0-win-x64.zip -DestinationPath C:\node

# 2) เติม PATH ให้ user นี้ (ถาวร) — วางไว้หน้าสุดเพื่อชนะ Node เก่า
$nodeDir = "C:\node\node-v24.16.0-win-x64"
setx Path "$nodeDir;$env:Path"

# 3) ★ ปิดหน้าต่าง PowerShell แล้วเปิดใหม่ ★ (setx ไม่มีผลกับหน้าต่างที่เปิดค้างอยู่)
node -v      # ต้องขึ้น v24.16.0
npm -v       # ต้องขึ้นเลขเวอร์ชัน
```

> **ทำไมต้อง v24.16.0 ไม่ใช่ v20 เฉย ๆ:** `node_modules` ใน `backend.tar`/`frontend.tar` ถูก bundle มาจาก
> เครื่อง dev ที่รัน v24.16.0 — native binary (`sharp`, `@napi-rs/canvas`, `@next/swc`) เป็น N-API
> ซึ่งข้าม major ได้ตามสเปก แต่ใช้ major เดียวกับที่ validate แล้ว = ตัดความเสี่ยง ABI ทิ้งไปเลย
>
> เครื่องที่มี Node เก่าอยู่แล้ว **ไม่ต้องถอน** — PATH ตัวใหม่อยู่หน้าสุดก็ชนะแล้ว ถ้าอยากกลับไปใช้ของเดิม
> แค่เอา `C:\node\...` ออกจาก PATH · เช็คว่าใช้ตัวไหนอยู่: `(Get-Command node).Source`

### 0.2 เอาไฟล์ขึ้นเครื่อง server (ไม่มี USB — remote เข้าไปทำ)

ปลายทาง = **`C:\coa-setup\`** บนเครื่อง server:

```
C:\coa-setup\
├── ollama-offline\      3.74 GB    9 ไฟล์
├── ocr-offline\         401 MB    70 ไฟล์
└── coa-app-offline\     648 MB     9 ไฟล์
```

ต้นทาง = **`C:\coa-setup\`** บนเครื่อง dev (ชื่อเดียวกันทั้งสองฝั่ง) — ย้ายออกจาก OneDrive แล้ว
(อยู่ใน OneDrive จะเจอ 2 ปัญหา: ไฟล์เป็น placeholder 0 ไบต์ ถ้าไม่ได้ pin ไว้ · และ bundle 4.7 GB
กินโควตา free tier 5 GB จนหมด sync ค้าง — ย้ายออกมาแล้วจบทั้งคู่)

**RDP** — ตอนต่อ: Show Options → Local Resources → More → ติ๊ก **Drives** → ค่อยกด Connect
ได้แล้วเครื่อง server จะเห็นไดรฟ์ของเครื่อง dev ที่ `\\tsclient\C\...` → รัน **ฝั่ง server**:

```powershell
mkdir C:\coa-setup
robocopy "\\tsclient\C\coa-setup" C:\coa-setup /E /R:2 /W:5 /MT:8
```

> robocopy ดีกว่าลากวาง: retry เอง · รันซ้ำได้ = copy เฉพาะไฟล์ที่ยังขาด (ไม่ต้องเริ่มใหม่ทั้ง 4.7 GB)
> · บอกชัดว่าไฟล์ไหนพลาด. ลากวาง 4.7 GB ผ่าน clipboard ของ RDP ช้าและหลุดกลางทางบ่อย
> **AnyDesk/TeamViewer** ไม่มี `\\tsclient` → ใช้หน้าต่าง File Transfer ของโปรแกรม copy ทีละโฟลเดอร์
> เรียงจากเล็กไปใหญ่ (`coa-app-offline` → `ocr-offline` → `ollama-offline`)

**เช็คว่าครบจริงก่อนเริ่มติดตั้ง** (รันบนเครื่อง server):

```powershell
Get-ChildItem C:\coa-setup -Recurse -File | Measure-Object Length -Sum |
  ForEach-Object { "$($_.Count) ไฟล์ · $([math]::Round($_.Sum/1GB,2)) GB" }
# ต้องได้ 88 ไฟล์ (GB เป็นตัวประกอบ ไม่ใช่เกณฑ์) — ขาดไปแม้แต่ไฟล์เดียว = copy ไม่ครบ ให้รัน robocopy ซ้ำ
```

เลขไม่ตรง → หาว่าโฟลเดอร์ไหนขาด แล้ว robocopy เฉพาะตัวนั้นซ้ำ:
```powershell
Get-ChildItem C:\coa-setup -Directory | ForEach-Object {
  $m = Get-ChildItem $_.FullName -Recurse -File | Measure-Object Length -Sum
  "{0,-20} {1,3} ไฟล์  {2,15:N0} bytes" -f $_.Name, $m.Count, $m.Sum }
```

| โฟลเดอร์ | ไฟล์ | bytes |
|---|---|---|
| `ollama-offline` | 9 | 3,923,474,498 |
| `ocr-offline` | 70 | 420,079,856 |
| `coa-app-offline` | 9 | ~679 M (ไม่ fix — มีสำเนา `INSTALL-OFFLINE.md` อยู่ข้างใน ขยับทุกครั้งที่แก้เอกสาร) |

**ยึด "จำนวนไฟล์" เป็นหลัก ไม่ใช่ byte** — 2 โฟลเดอร์แรกเป็นของนิ่ง byte ต้องตรงเป๊ะ
⚠️ ขาดใน `ollama-offline\models` แม้ไฟล์เดียว = `ollama list` ขึ้นตารางเปล่าโดยไม่บอกสาเหตุ — อย่าข้ามไปขั้น 2

---

## 1. Layout — วางโฟลเดอร์ให้ถูก (สำคัญ, path ผูกกัน)

เลือก root สักที่ เช่น **`C:\zenithsphere\COA`** แล้วจัด `backend` / `frontend` / `ocr-py` เป็น **sibling**
(เพราะ `ecosystem.config.js` อ้างทั้ง 3 ตัวเป็น `path.join(__dirname, ...)` = อิงโฟลเดอร์ที่ไฟล์ config วางอยู่):

```
C:\zenithsphere\COA\
├── backend\            (ขั้น 4 — แตกจาก coa-app-offline\backend.tar)
├── frontend\           (ขั้น 4 — แตกจาก coa-app-offline\frontend.tar)
├── ocr-py\             (ขั้น 3 — จาก ocr-offline หลังลง venv+models)
├── ecosystem.config.js (ขั้น 4 — คัดจาก coa-app-offline\)
└── start-all.ps1       (ขั้น 4 — เผื่อไม่ใช้ pm2)
```

คู่มือนี้ใช้ **`C:\zenithsphere\COA`** (19 ตัว) เป็น root จริง — จะเปลี่ยนเป็นอะไรก็ได้ ขอแค่ผ่านกฎข้างล่าง

### ★ กฎความยาว path (MAX_PATH) — วัดจริงแล้ว

Windows ปกติจำกัด path ที่ **259 ตัวอักษร** (`LongPathsEnabled=0` = ค่า default) ไฟล์ลึกสุดใน bundle คือ

```
\ocr-py\venv\Lib\site-packages\onnxruntime\tools\ort_format_model\
   ort_flatbuffers_py\fbs\__pycache__\RuntimeOptimizationRecordContainerEntry.cpython-313.pyc
```
= **156 ตัว** (frontend ลึกสุด 145 · backend 116 → ocr-py เป็นตัวคุม)

> **259 − 156 = โฟลเดอร์แม่ยาวได้ ≤ 103 ตัวอักษร** — ทั้ง **deploy root** และ **โฟลเดอร์ที่รัน `install-ocr-offline.ps1`**
> (สคริปต์สร้าง venv ที่ `<โฟลเดอร์ของสคริปต์>\ocr-py\venv` ⇒ ตอนติดตั้งก็ติดกฎเดียวกัน)

| path | ยาว | |
|---|---|---|
| `C:\zenithsphere\COA` | **19** | ok ← ที่ใช้จริง |
| `C:\zenithsphere\COA\deploy\v1\server` | 36 | ok |
| `C:\coa-setup` | 10 | ok (ที่วางชุดติดตั้งตอนรัน installer) |
| `C:\Users\<user>\AppData\Local\Temp\...\<guid>\work\USB` | 124 | **พัง** |

เช็คก่อนลงมือ:
```powershell
$root = "C:\zenithsphere\COA"      # เปลี่ยนเป็น path จริง
"$($root.Length) ตัว — $(if ($root.Length -le 103) {'OK'} else {'ยาวเกิน ย้ายที่'})"
```

อาการเวลาเกิน: `pip install` ตายกลางคัน
`OSError: [Errno 2] No such file or directory: '...\onnxruntime\tools\ort_format_model\...'`
(ข้อความไม่บอกว่าเป็นเรื่องความยาว path เลย — เจอจริงตอน dry-run 10 ส.ค. 2026)

---

## 2. ชุด 1 — Ollama + qwen3:4b (ทำมือ)

> **13 ส.ค. 2026 หน้างาน: `install-offline.ps1` รันไม่ผ่าน แต่ดับเบิลคลิก installer ผ่าน** →
> ขั้นนี้เปลี่ยนเป็น **ทำมือทีละขั้น** เป็นทางหลัก. สคริปต์ยังอยู่ในชุด ใครรันได้ก็รันได้ แต่ไม่ต้องพยายามปลดล็อก
> ExecutionPolicy — ทุกขั้นล่างนี้เป็นคำสั่ง**พิมพ์สด**ซึ่งนโยบายที่บล็อก*ไฟล์*สคริปต์ไม่แตะ

**2.1 ติดตั้ง** — File Explorer → `C:\coa-setup\ollama-offline` → ดับเบิลคลิก `OllamaSetup.exe` → **Install**
(per-user ไม่ต้อง admin) → เสร็จแล้ว tray ขึ้นเอง (หน้าต่างแชทที่เด้งมา ปิดทิ้งได้)

**2.2 ปิด Ollama ก่อน copy** — คลิกขวา tray → *Quit Ollama* หรือ
```powershell
Get-Process ollama, 'ollama app' -EA SilentlyContinue | Stop-Process -Force
```

**2.3 copy model 2.33 GB** (~1–3 นาที) — robocopy ไม่ใช่ `Copy-Item`
(Copy-Item เคยตกไฟล์ blob เงียบ ๆ → `ollama list` ขึ้นตารางเปล่าโดยไม่บอกสาเหตุ)
```powershell
robocopy C:\coa-setup\ollama-offline\models "$env:USERPROFILE\.ollama\models" /E /R:3 /W:2
```

**2.4 นับให้ครบก่อนไปต่อ — ห้ามข้าม**
```powershell
Get-ChildItem "$env:USERPROFILE\.ollama\models" -Recurse -File | Measure-Object Length -Sum
# ต้องได้ Count : 6  ·  Sum : 2497294790  — ไม่ครบ = สั่ง robocopy ซ้ำ (มันลงเฉพาะที่ขาด)
```

**2.5 เปิด Ollama กลับ** (Start menu → Ollama) รอ ~5 วิ แล้ว verify:
```powershell
ollama list          # ต้องเห็น qwen3:4b  2.5 GB
ollama run qwen3:4b "ทดสอบ ตอบสั้นๆ"    # ออกด้วย /bye · เครื่องไม่มี GPU รอบแรกรอได้เป็นนาที
```
`ollama` ไม่รู้จักในหน้าต่างเดิม (เปิดค้างมาก่อนติดตั้ง) → ใช้ path เต็ม **อย่าเพิ่งปิดหน้าต่าง**
ถ้าหน้าต่างนั้นตั้ง `$env:Path` ของ Node ไว้: `& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" list`

> ทำไมต้อง copy blobs: หน้างาน `ollama pull` ไม่ได้ → ลง installer เฉยๆ = ไม่มี model
> Ollama รันเป็น **tray app** (ไม่อยู่ใน pm2) — ลงเสร็จมันขึ้นเอง, boot ก็ขึ้นเอง

---

## 3. ชุด 2 — OCR sidecar (RapidOCR + models) (ทำมือ)

> ⚠️ **ก่อนเริ่ม — `C:\coa-setup\ocr-offline` ต้องยาว ≤ 103 ตัว** (กฎ MAX_PATH ในขั้น 1) = 22 ตัว ผ่านสบาย.
> ที่พังคือ path ลึกๆ อย่าง temp/scratch folder → ถ้าเป็นแบบนั้น copy ทั้งโฟลเดอร์ลง `C:\coa-setup\` ก่อน
> รวม ~3 นาที (วัดจริง: venv 15s + pip 48 packages offline ~80s + copy models + smoke test)

> **ชุดคำสั่งข้างล่างนี้ validated 14 ส.ค. 2026 บน dev · แก้ใหญ่ 17 ส.ค. 2026 จากหน้างานจริง**
> (Python ต้อง machine-wide + สร้าง venv ที่ deploy root ตรงๆ — ของเดิมพังใต้ pm2 service ดู §3.1)

**3.1 ลง Python 3.13 แบบ machine-wide ที่ `C:\Python313`**

> ### ★★ ห้ามลง Python ไว้ในโปรไฟล์ผู้ใช้ ★★  (เจอจริงหน้างาน 17 ส.ค. 2026 — ทำระบบล่มทั้งเส้น)
>
> venv **ไม่ได้มี Python อยู่ในตัว** — `venv\Scripts\python.exe` เป็นแค่ stub ที่อ่าน `pyvenv.cfg`
> แล้ว exec ต่อไปหา **base interpreter**. ลง Python แบบ per-user → base อยู่ที่
> `C:\Users\<user>\AppData\Local\Programs\Python\Python313`
> → pm2 หน้างานรันเป็น **Windows service คนละ account** → เข้าโฟลเดอร์โปรไฟล์คนอื่นไม่ได้ →
> ```
> PDF_GRID_DOWN: pdfplumber จบด้วยรหัส 103 —
>   did not find executable at 'C:\Users\...\Python313\python.exe': Access is denied.
> ```
> ocr-daemon ก็ตายด้วย (พอร์ต 8765 ไม่ตอบ, **pm2 log ว่างทั้ง out และ error** เพราะ `pythonw.exe` ไม่มี console)
> โรงงานที่มี AppLocker/SRP บล็อก exe ใต้ `C:\Users\` ก็ให้ `Access is denied` หน้าตาเดียวกัน
> → **แก้ทางเดียว = base Python ต้องอยู่นอกโปรไฟล์** ซ่อม venv เดิมไม่ได้ (path ฝังใน stub) ต้องสร้างใหม่

**ยังไม่มี Python บนเครื่องเลย** → Run as administrator แล้ว
```powershell
C:\coa-setup\ocr-offline\python-3.13.13-amd64.exe /passive InstallAllUsers=1 TargetDir=C:\Python313 Include_launcher=0 Include_test=0
```
(ดับเบิลคลิกก็ได้ → **Customize installation** → Next → ติ๊ก **Install for all users** → location `C:\Python313`)

**มี Python 3.13 per-user อยู่แล้ว** → installer จะขึ้นแค่ *Modify / Repair / Uninstall* ไม่มีตัวเลือก all-users
ให้ **copy โฟลเดอร์ออกมา** แทน เร็วกว่าและไม่ต้องถอนของเดิม (ถอนแล้วลงใหม่ไม่ผ่าน = หน้างานไม่มีเน็ตโหลด):
```powershell
robocopy "$env:LOCALAPPDATA\Programs\Python\Python313" C:\Python313 /E /R:2 /W:2 /MT:8
```
> **ห้ามใส่ `/COPYALL` หรือ `/SEC`** — ต้องปล่อยให้ ACL สืบทอดจาก `C:\` (Users อ่าน+รันได้)
> ก๊อป ACL เดิมมาด้วย = ยังเป็นสิทธิ์เฉพาะเจ้าของโปรไฟล์ = แก้ไม่หายเลย

เช็ค:
```powershell
C:\Python313\python.exe -V     # ต้องขึ้น Python 3.13.13
```

**3.2 copy source `.py` ไป deploy root ก่อน** (ไฟล์เล็ก ~30 KB)
```powershell
Copy-Item C:\coa-setup\ocr-offline\ocr-py C:\zenithsphere\COA\ocr-py -Recurse
```
> ⚠️ **`Copy-Item` ไม่ใช่ `Move-Item`** (เคยเขียนเป็น Move — พลาด). `Move` เอา `ocr_server.py` +
> `pdf_table.py` ออกจากชุดติดตั้งไปด้วย → ลงเครื่องที่ 2 หรือลงซ้ำไม่ได้อีก
> (wheels สร้าง venv ใหม่ได้ แต่ **ไม่ได้สร้าง source .py** ให้)

**3.3 สร้าง venv ตรงที่ deploy root เลย** (~15 วิ)
```powershell
C:\Python313\python.exe -m venv C:\zenithsphere\COA\ocr-py\venv
Test-Path C:\zenithsphere\COA\ocr-py\venv\Scripts\python.exe     # ต้อง True
```
> สร้างที่ปลายทางตรงๆ ดีกว่าสร้างในคลังแล้ว copy — ประหยัดการ copy 557 MB และไม่มีจังหวะที่ venv
> ชี้ผิดที่. คลัง (`wheels` + `models`) ยังอยู่ครบ อยากสร้างใหม่กี่รอบก็ได้

มี venv ค้างจากรอบที่พัง → ลบก่อนแล้วสั่งใหม่ (source `.py` ไม่โดนลบ):
```powershell
pm2 stop ocr-daemon
Remove-Item C:\zenithsphere\COA\ocr-py\venv -Recurse -Force
```

**3.4 ลง deps 48 ตัวจาก wheels ในเครื่อง** (~1.5 นาที, `--no-index` = ไม่แตะ PyPI)
```powershell
C:\zenithsphere\COA\ocr-py\venv\Scripts\python.exe -m pip install --no-index --find-links C:\coa-setup\ocr-offline\wheels -r C:\coa-setup\ocr-offline\frozen.txt
```
ท้ายสุดต้องขึ้น `Successfully installed ... rapidocr-3.8.1 ...` · เตือนเรื่อง pip เวอร์ชันใหม่กว่า = ไม่ต้องสน
(**ห้าม** `pip install --upgrade pip` — ต้องใช้เน็ต)

**3.5 copy models 12 ไฟล์เข้า venv** ← ข้อที่พลาดแล้วไฟล์สแกนพังทั้งใบ
```powershell
New-Item -ItemType Directory -Force C:\zenithsphere\COA\ocr-py\venv\Lib\site-packages\rapidocr\models | Out-Null
Copy-Item C:\coa-setup\ocr-offline\models\* C:\zenithsphere\COA\ocr-py\venv\Lib\site-packages\rapidocr\models\ -Force
Get-ChildItem C:\zenithsphere\COA\ocr-py\venv\Lib\site-packages\rapidocr\models -File | Measure-Object   # Count ต้อง = 12
```

**3.6 verify — 2 อย่าง ห้ามข้าม**
```powershell
Get-Content C:\zenithsphere\COA\ocr-py\venv\pyvenv.cfg
```
`home` และ `executable` ต้องชี้ **`C:\Python313`** — เห็น `C:\Users\...` เมื่อไหร่ = venv จะตายตอน pm2 รัน (ดู §3.1)
```powershell
C:\zenithsphere\COA\ocr-py\venv\Scripts\python.exe -c "import pdfplumber, rapidocr; print('OK')"
```
> เช็ค **`pdfplumber` ด้วย ไม่ใช่แค่ `rapidocr`** — pdfplumber คือตัวอ่านตาราง (structural grid) ซึ่ง
> backend spawn แยกจาก daemon. `rapidocr` ผ่านอย่างเดียวไม่ได้แปลว่าอีกเส้นรอด

> **GOTCHA สำคัญที่สุดของ OCR:** RapidOCR package ship มาแค่ v4 `_infer` — แต่ daemon ใช้
> v4 `_mobile` (default) + v5 `_server` (HQ) + v5 `_mobile` det กับ `th_..._rec_mobile` (ใบไทย)
> ซึ่งปกติ **auto-download จาก ModelScope ครั้งแรก**.
> ออฟไลน์ = download ไม่ได้ = daemon พัง. เลยต้อง copy models เข้า venv (= §3.5 ที่เพิ่งทำ).
> ถ้า daemon start แล้วขึ้น "downloading model..." = ลืมขั้นนี้
>
> HQ engine (v5 server) preload กิน RAM หลายร้อย MB. RAM น้อย → ปิดด้วย env `COA_OCR_HQ_PRELOAD=false`
> (ตั้งใน ecosystem.config.js block `ocr-daemon`) — แลกกับ request HQ แรกช้าลง

---

## 4. ชุด 3 — Node app (backend + frontend)

> **เช็คก่อน:** `node -v` ต้อง ≥ v20.9 — ไม่ถึง/ไม่มี ให้ทำ §0.1 (แตก node zip + setx PATH + เปิด PowerShell ใหม่) ก่อน

```powershell
cd C:\zenithsphere\COA
tar -xf C:\coa-setup\coa-app-offline\backend.tar      # ได้ C:\zenithsphere\COA\backend  (node_modules ครบ)
tar -xf C:\coa-setup\coa-app-offline\frontend.tar     # ได้ C:\zenithsphere\COA\frontend (node_modules ครบ)
copy C:\coa-setup\coa-app-offline\ecosystem.config.js  C:\zenithsphere\COA\
copy C:\coa-setup\coa-app-offline\start-all.ps1        C:\zenithsphere\COA\
mkdir C:\zenithsphere\COA\backend\uploads                    # multer เขียน upload ลงที่นี่ (tar ไม่ได้ใส่มา)
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

สร้าง `C:\zenithsphere\COA\frontend\.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=http://192.168.1.50:3001      ← ใส่ IP จริงของ server
```

แล้ว build (offline ได้ เพราะ node_modules ครบ — validated แล้ว):
```powershell
cd C:\zenithsphere\COA\frontend
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

### 7.0 สำรวจ pm2 ของเครื่องก่อน — 4 บรรทัด (ห้ามข้าม)

```powershell
pm2 list                                                    # มี app ของคนอื่นอยู่ไหม
pm2 report | Select-String "node version"                   # Node ที่ daemon ใช้จริง
$env:PM2_HOME                                               # home อยู่ไหน
Get-CimInstance Win32_Service -Filter "Name='pm2.exe'" | Select-Object Name,StartName
```

หน้างาน 17 ส.ค. 2026 ได้: **pm2 = Windows service** (`pm2.exe`, Automatic) ·
`PM2_HOME=C:\ProgramData\pm2\home` (ไม่ใช่ `%USERPROFILE%\.pm2`) · node 22.21.1 · มี app ของทีมอื่น `ZS-MMS` รันอยู่ด้วย

สิ่งที่ต้องรู้จากผลนี้:

- **มี app ของคนอื่นอยู่** → ⛔ ห้าม `pm2 restart all` / `delete all` / `stop all` / `pm2 update`
  เจาะจงชื่อเสมอ: `pm2 restart coa-backend`. (`pm2 update` restart ทุก process รวมของคนอื่น)
- **pm2 เป็น service** → cwd ของมันคือ `C:\Windows\System32` → `ecosystem.config.js` ต้องใช้
  `path.join(__dirname, ...)` ทั้ง `cwd` และ `interpreter` (แก้ในไฟล์ให้แล้ว) — relative จะชี้ผิดที่ทั้งหมด
- **service รันคนละ account กับที่เรา login** → เข้าโฟลเดอร์โปรไฟล์เราไม่ได้ ⇒ Python ต้องอยู่ `C:\Python313` (§3.1)
- **`pm2 report` node version สำคัญกว่า `node -v`** — pm2 spawn ลูกด้วย Node ของ daemon เอง
  ต่ำกว่า v20.9 ทั้งที่ shell ใหม่แล้ว → เติม `interpreter: "C:\\node\\node-v24.16.0-win-x64\\node.exe"`
  ใน block `coa-backend` + `coa-frontend` (อย่าแตะ block `ocr-daemon` — ของมันเป็น python)

### 7.1 ยก stack

```powershell
cd C:\zenithsphere\COA
pm2 start ecosystem.config.js
pm2 status                      # ต้องเห็น 3 ตัว online: coa-backend / ocr-daemon / coa-frontend (+ app ของคนอื่นยังอยู่ครบ)
```

`ecosystem.config.js` คุม 3 process (Ollama แยก tray):

| process | port | คำสั่งจริง |
|---|---|---|
| `coa-backend` | 3001 | ts-node `backend/src/index.ts` (env: OLLAMA_URL, OCR_SIDECAR_URL localhost) |
| `ocr-daemon` | 8765 | `ocr-py/venv/Scripts/pythonw.exe ocr_server.py 8765` (mobile/v4 + HQ preload) |
| `coa-frontend` | 3000 | `next start` (ต้อง `next build` จากขั้น 5 ก่อน) |

### 7.2 `pm2 save` — boot persist (คิดก่อนสั่ง ถ้าเครื่องมี app ของคนอื่น)

```powershell
Test-Path "$env:PM2_HOME\dump.pm2"
```

- **True** → app ของคนอื่นอยู่ใน resurrect list อยู่แล้ว = pm2 เป็นคนปลุกมันตอนบูต →
  สำรองแล้ว save ได้เลย (แค่เพิ่มของเรา 3 ตัว)
  ```powershell
  copy "$env:PM2_HOME\dump.pm2" "$env:PM2_HOME\dump.pm2.before-coa"
  pm2 save
  ```
- **False** → app ของคนอื่นขึ้นด้วยวิธีอื่น (คนสั่งมือ / scheduled task) → `pm2 save` จะ**ลากมันเข้า
  resurrect list ด้วย** = บูตหน้าอาจขึ้นซ้อน 2 ตัว → เช็คกับเจ้าของ app นั้นก่อน
  ยังไม่ save ก็ใช้งานได้ปกติ แค่บูตใหม่ต้องสั่ง `pm2 start ecosystem.config.js` เอง

pm2 ยังไม่เป็น service (ไม่มีใน `Get-Service`) → ลง `pm2-installer` หรือ scheduled task รัน `pm2 resurrect`

> ### ⚠️ บูตใหม่แล้ว Ollama ไม่ขึ้น — จุดตายเงียบที่สุดของ deployment นี้
> pm2 service ยก 3 process ขึ้นตั้งแต่ boot **โดยไม่ต้อง login** แต่ **Ollama เป็น tray app per-user**
> ต้องมีคน login ก่อนถึงจะขึ้น → ผลคือ `pm2 status` เขียวครบ **แต่ upload พังทุกใบ**
> เลือกทางใดทางหนึ่งก่อนปิดงาน: ปล่อย session login ค้างไว้ / เปิด auto-login / ทำ Ollama เป็น Windows service
> **ทดสอบจริง:** รีบูต → **อย่า login** → รอ 2 นาที → remote เข้ามา upload 1 ใบ ผ่าน = จบงานจริง

**ทางเลือกไม่ใช้ pm2** (pm2 มีปัญหา / รัน `.ps1` ไม่ได้) — เปิด PowerShell **3 หน้าต่าง** ตามลำดับ เว้นบานละ ~10 วิ
แล้วปล่อยค้างไว้ (ปิดบานไหน = ส่วนนั้นดับ · หยุดด้วย `Ctrl+C` ในบานนั้น):

```powershell
# บาน 1 — OCR daemon :8765
cd C:\zenithsphere\COA\ocr-py
.\venv\Scripts\python.exe .\ocr_server.py 8765

# บาน 2 — backend :3001
cd C:\zenithsphere\COA\backend
npm start

# บาน 3 — frontend :3000
cd C:\zenithsphere\COA\frontend
npm start
```

- **ลง Node จาก zip (§0.1)** → บาน 2 และ 3 ต้องพิมพ์ `$env:Path = "C:\node\node-v24.16.0-win-x64;$env:Path"`
  **ก่อน** `npm start` ทุกบาน ทุกครั้งที่เปิดหน้าต่างใหม่ (บาน 1 ใช้ Python ไม่ต้อง)
- env ที่ `ecosystem.config.js` ตั้งให้ = ค่า default ในโค้ดอยู่แล้ว (`OLLAMA_URL` localhost:11434 ·
  `OCR_SIDECAR_URL` 127.0.0.1:8765 · PORT 3001/3000 · OCR mobile+HQ preload) → วิธีนี้ไม่ต้องตั้ง env เพิ่ม
- ข้อเสีย: **บูตใหม่ระบบไม่ขึ้นเอง** ต้องเปิด 3 บานใหม่ทุกครั้ง → มี pm2 ให้ใช้ pm2

---

## 8. Verify (6 เช็ค)

```powershell
# บน server
curl http://localhost:8765/health      # OCR daemon: {"ok":true}
curl http://localhost:11434/api/tags    # Ollama: มี qwen3:4b
pm2 status                              # 3 online, restart count ไม่พุ่ง

# ★ เช็ค GPU — ทำหลัง upload ใบแรก (model ต้องถูกโหลดก่อนถึงจะเห็น) ★
ollama ps                               # คอลัมน์ PROCESSOR ต้องเป็น "GPU" ไม่ใช่ "CPU"

# บน client เครื่องอื่นในวง LAN
#   browser -> http://192.168.1.50:3000   (IP server)
#   upload COA จริง 1 ใบ -> ต้องได้ตารางผลแยก 3 ช่อง ผ่าน/ต้องตรวจ/ไม่ผ่าน (ไม่ค้าง/ไม่ error)
```

> ★ **`ollama ps` ขึ้น `100% CPU` = ระบบยังใช้ได้แต่ช้า ~11x** — เครื่องนี้ไม่มี GPU หรือ VRAM ไม่พอ
> (qwen3:4b ต้องการ ~3.9 GB). ถ้ามีการ์ดแต่ยังขึ้น CPU: มีอย่างอื่นกิน VRAM อยู่ (เกม/embedding model
> ค้างใน Ollama) → `ollama stop <ตัวนั้น>` แล้ว upload ใหม่. ตรวจตั้งแต่วันติดตั้ง อย่ารอ user บ่นว่าช้า

### เวลาที่ควรได้ (baseline จาก dry-run เต็มรูปแบบ 10 ส.ค. 2026)

เครื่อง dev: Windows 11, Node v24.16.0, NVIDIA GPU. ช้ากว่านี้เยอะ = มีอะไรผิด ให้ไล่ตาม §10

| ขั้น | เวลา |
|---|---|
| `install-ocr-offline.ps1` (48 wheels offline + models + smoke test) | 81.6 s |
| `tar -xf backend.tar` / `frontend.tar` | 5.6 s / 20.6 s |
| `npm run build` (frontend, offline) | 33.3 s — TypeScript ผ่าน, 4 static pages |
| `pm2 start` → backend (ts-node) online | ~17 s |
| → frontend online | ~3 s |
| → ocr-daemon ตอบ `/health` (โหลด v4 mobile + v5 server จากดิสก์) | ~2 s |
| **COA vector PDF 1 ใบ** (ZP10) | **15.6 s** → 4 แถว PASS |
| **COA สแกน 1 ใบ** (RI-015, ผ่าน OCR) | **60.9 s** → 11 PASS / 0 FAIL / 2 ต้องตรวจ / 13 fields |

daemon log ตอน start ต้องขึ้น `File exists and is valid` ทุก model = อ่านจากดิสก์ ไม่ได้แตะเน็ต

---

## 9. Deploy code ใหม่รอบถัดไป (ถ้ามีแก้)

ถ้าหน้างานต่อเน็ตไม่ได้ → ต้องยก tar ชุดใหม่มาแตกทับ. ถ้าต่อ git ได้:
```powershell
cd C:\zenithsphere\COA
git pull
cd frontend; npm run build; cd ..     # เฉพาะถ้าแก้ FE (Next ต้อง build ใหม่)
pm2 restart all                        # ★ ทั้งหมด — ไม่ใช่แค่ backend ★
```
> ★ ต้อง `pm2 restart all` — contract OCR แก้ทั้ง backend (ส่ง bytes) + daemon (decode).
> restart แค่ backend ทิ้ง daemon เก่า = ไฟล์สแกนพังทั้งใบ (ไม่มี fallback engine แล้ว)

---

## 10. Troubleshooting

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| **ไฟล์ `.ps1` รันไม่ผ่าน** — `cannot be loaded` / `is not digitally signed` / `running scripts is disabled on this system` (เจอจริงหน้างาน 13 ส.ค. 2026) | นโยบายความปลอดภัยของเครื่องบล็อกไฟล์สคริปต์ · ถ้าเป็นนโยบายระดับ GPO สั่ง `-ExecutionPolicy Bypass` ก็ไม่ผ่าน | **ไม่ต้องปลดล็อก** — ใช้ขั้น 2 กับ 3 ฉบับทำมือ (คำสั่งพิมพ์สดไม่ติดนโยบายนี้ มันบล็อกเฉพาะ*ไฟล์*สคริปต์) · ไม่มี pm2 ด้วย → เปิดเอง 3 หน้าต่างตามขั้น 7 |
| pip ตายตอน `--find-links`: `Could not find a version that satisfies the requirement` | พิมพ์ path ของ `wheels` หรือ `frozen.txt` ผิด (ชุดคำสั่งยาว ตกตัวอักษร) | copy คำสั่ง §3.4 ไปทั้งบรรทัด อย่าพิมพ์เอง · เช็ค `Test-Path C:\coa-setup\ocr-offline\wheels` ต้อง True |
| `install-ocr-offline.ps1` ตายตอน pip: `OSError: [Errno 2] No such file or directory: '...onnxruntime\tools\ort_format_model\...'` | **path ยาวเกิน MAX_PATH** (ข้อความไม่บอกตรงๆ) | ย้ายโฟลเดอร์ไป path สั้น (`C:\coa-setup`) แล้วรันใหม่ — ดูกฎ ≤103 ตัวในขั้น 1 |
| `install-offline.ps1` (Ollama) ค้างที่ `== 1/3 ==` ไม่ไปต่อ ทั้งที่ Ollama ติดตั้งเสร็จแล้ว | installer เปิด tray `ollama app.exe` ทิ้งไว้ แล้ว `Start-Process -Wait` รอ **ลูกหลาน** ของ process ด้วย → รอตัวที่ไม่มีวันปิด (แก้ในสคริปต์แล้ว: `-PassThru` + `WaitForExit()`) | อย่าปิดหน้าต่างที่ค้าง — เปิด PowerShell หน้าต่างใหม่ รัน `Get-Process ollama, 'ollama app' -EA SilentlyContinue \| Stop-Process -Force` แล้วหน้าต่างเดิมจะวิ่งต่อเอง (สคริปต์ kill tray อยู่แล้วในขั้นถัดไป) |
| `pm2 start` ขึ้นแค่ 2 process ขาด `ocr-daemon` + `[PM2][ERROR] Interpreter ./venv/Scripts/python.exe is NOT AVAILABLE in PATH` | pm2 resolve `interpreter` จาก cwd ของ **ตัว pm2 ตอนถูกเรียก** ไม่ใช่ `cwd` ของ app → path relative ชี้ผิดที่ (แก้ในไฟล์แล้ว: ใช้ `path.join(__dirname, ...)`) | `copy C:\coa-setup\coa-app-offline\ecosystem.config.js C:\zenithsphere\COA\` แล้ว `pm2 start ecosystem.config.js --only ocr-daemon` |
| **`PDF_GRID_DOWN: pdfplumber จบด้วยรหัส 103 — did not find executable at 'C:\Users\...\Python313\python.exe': Access is denied.`** (เจอจริงหน้างาน 17 ส.ค. 2026) | base Python ลงไว้ในโปรไฟล์ผู้ใช้ · pm2 รันเป็น service คนละ account → อ่านโฟลเดอร์นั้นไม่ได้ (หรือ AppLocker บล็อก exe ใต้ `C:\Users\`) · venv เป็นแค่ stub ที่ชี้ต่อไปหา base | ทำ **§3.1** (robocopy Python ไป `C:\Python313`) → ลบ venv เก่า → สร้างใหม่จาก `C:\Python313\python.exe` → §3.4–3.6 → `pm2 restart ocr-daemon` + `pm2 restart coa-backend`. ซ่อม venv เดิมไม่ได้ path ฝังอยู่ใน stub |
| `ocr-daemon` ไม่ตอบ `:8765` แต่ **`pm2 logs ocr-daemon` ว่างเปล่าทั้ง out และ error** | `pythonw.exe` ไม่มี console → stub ตายก่อนเขียน log อะไรเลย = เงียบสนิท | สลับ interpreter เป็น `python.exe` ชั่วคราวเพื่อให้มันพูด: แก้ `ecosystem.config.js` → `pm2 delete ocr-daemon` → `pm2 start ecosystem.config.js --only ocr-daemon` → `pm2 logs ocr-daemon --lines 40 --nostream` · แก้เสร็จเปลี่ยนกลับเป็น `pythonw.exe` |
| ทุก path ใน `ecosystem.config.js` ชี้ผิดที่ ทั้งที่สั่ง `pm2 start` จาก deploy root | pm2 ลงเป็น **Windows service** → cwd ของมัน = `C:\Windows\System32` ไม่ใช่ที่เราสั่ง | `cwd` และ `interpreter` ต้องเป็น `path.join(__dirname, ...)` ทั้ง 3 app (แก้ในไฟล์แล้ว) · ตรวจด้วย `node -e "console.log(require('C:/zenithsphere/COA/ecosystem.config.js').apps.map(a=>a.cwd))"` |
| installer Python ขึ้นแค่ **Modify / Repair / Uninstall** ไม่มีตัวเลือก Install for all users | มี Python 3.13 per-user ติดตั้งอยู่แล้ว | อย่าถอนของเดิม (ถอนแล้วลงใหม่ไม่ผ่าน = ไม่มี Python เลย หน้างานไม่มีเน็ต) → `robocopy` โฟลเดอร์ออกมาที่ `C:\Python313` ตาม §3.1 |
| คำสั่งจากชีทขึ้น `'Copy-Item' is not recognized as an internal or external command` (หรือชื่อ cmdlet อื่น) | รันใน **cmd.exe** ไม่ใช่ PowerShell (prompt ขึ้น `C:\...>` เฉยๆ ไม่มี `PS` นำหน้า) | พิมพ์ `powershell` ก่อน ให้ prompt เป็น `PS C:\...>` — ทุกคำสั่งในชีทเป็น PowerShell (`setx`, `Expand-Archive`, `New-NetFirewallRule`, `$root` ใช้ใน cmd ไม่ได้) |
| `npm run build` ตาย / `next` ไม่ยอมรัน | Node เก่ากว่า v20.9 | `node -v` → ต่ำกว่า v20.9 ให้ทำ §0.1 (node zip ที่แถมมา) แล้ว**เปิด PowerShell ใหม่** · ยังขึ้นเลขเก่า = PATH ไม่ติด เช็ค `(Get-Command node).Source` |
| client upload error/ค้าง แต่ server เองใช้ได้ | `.env.local` ใส่ `localhost` หรือลืม build ใหม่ | ตั้ง IP จริง → `npm run build` → `pm2 restart coa-frontend` |
| OCR daemon start ขึ้น "downloading model..." | ลืม copy models เข้า venv (§3.5) | ทำ **§3.5** ใหม่ (Count ต้อง = 12) → `pm2 restart ocr-daemon` |
| ไฟล์สแกนขึ้น `OCR daemon ไม่ทำงาน` | daemon ล่ม (ไม่มี fallback engine — ตั้งใจให้พังดังๆ) | `curl :8765/health` ต้อง `{"ok":true}` · `pm2 restart ocr-daemon` |
| daemon กิน RAM เยอะ | HQ engine (v5 server) preload | ตั้ง `COA_OCR_HQ_PRELOAD=false` ใน ecosystem block `ocr-daemon` → `pm2 restart ocr-daemon` |
| upload แรกหลัง idle นาน ~37s | qwen3 โดน evict จาก RAM/VRAM | ปกติ — keep-warm ping กันไว้แล้ว; เช็ค Ollama tray รันจริง |
| **ทุกใบช้าผิดปกติ (นาที ไม่ใช่วินาที)** | LLM รันบน CPU ไม่ใช่ GPU | `ollama ps` → ถ้า `100% CPU`: ปลดของที่กิน VRAM (`ollama ps` ตัวอื่น → `ollama stop <ชื่อ>`) แล้วลองใหม่. ไม่มี GPU เลย = ช้าแบบนี้ตามสเปก |
| เคยเร็วอยู่แล้วจู่ๆ ช้าทั้งเครื่อง | GPU timeout 1 ครั้งเคยทำให้ตกไป CPU ถาวร | แก้ที่โค้ดแล้ว (ROUND 19 — latch เฉพาะ crash จริง + ปล่อย CPU runner ทิ้ง). ถ้ายังเจอบน build เก่า: `pm2 restart coa-backend` |
| client เข้า `:3000` ไม่ได้เลย | firewall ปิด | เปิด firewall 3000+3001 (ขั้น 6) · `pm2 logs coa-frontend` |
| pm2 ไม่มี/พัง | ลง offline ไม่ได้ (global npm) | ใช้ `start-all.ps1` แทน (ไม่พึ่ง pm2) |

---

## 11. สรุป Gotcha (อ้างอิงเร็ว)

1. **models ต้อง bundle** — Ollama blobs + RapidOCR onnx auto-download ไม่ได้ตอนออฟไลน์ → copy มาให้ครบ
2. **frontend IP ฝังตอน build** — ตั้ง `.env.local` (LAN IP server, ไม่ใช่ localhost/resonac-100.x) ก่อน `npm run build` เสมอ
3. **layout sibling** — `backend/ frontend/ ocr-py/` ต้องอยู่ root เดียวกัน (`ecosystem.config.js` อ้าง relative)
4. **pm2 restart all** ตอน deploy — ไม่ใช่แค่ backend (contract OCR 2 ฝั่ง)
5. **node_modules bundle มาแล้ว** — ห้าม `npm install` ทับ (registry บล็อก + จะพัง native binary)
6. **เช็ค `ollama ps` ว่าขึ้น GPU ตั้งแต่วันติดตั้ง** — ตก CPU = ช้า 11x แต่ระบบไม่ error อะไรเลย จับไม่ได้ถ้าไม่ดู
7. **ห้ามเปิด `COA_OCR_HQ_SPECULATE=true` บน single-server** — วัดแล้วช้าลง (HQ OCR แย่ง CPU กับ Ollama).
   ตัวนี้มีไว้ตอนแยก OCR daemon ไปคนละเครื่องเท่านั้น
8. **path ≤ 103 ตัว** ทั้ง deploy root และที่รัน installer — เกินแล้ว pip ตายด้วย error ที่ไม่บอกสาเหตุจริง (ขั้น 1)
9. **Node ≥ v20.9** ไม่ใช่ v18 — `next@16.0.10` บังคับไว้ใน `engines`. ไม่ถึง = แตก `node-v24.16.0-win-x64.zip`
   ที่แถมมา + `setx Path` + **เปิด PowerShell ใหม่** (§0.1) · pm2 ลงเพิ่มออฟไลน์ไม่ได้ → ใช้ `start-all.ps1`
10. **venv ตัวมันเองย้ายได้ แต่ base Python ย้ายไม่ได้** — `venv\Scripts\python.exe` ยังรันปกติหลัง `Move-Item`
    (ที่พังคือ `pip.exe` เพราะ shebang ฝัง absolute path → ใช้ `python.exe -m pip` แทน).
    แต่ venv ผูกกับ **base interpreter** ตาม `pyvenv.cfg` — ย้าย/ลบ base เมื่อไหร่ venv ตายทันที สร้างใหม่สถานเดียว
11. **อย่าพึ่งไฟล์ `.ps1` หน้างาน** — เครื่อง server อาจบล็อกไฟล์สคริปต์ทั้งหมด (เจอจริง 13 ส.ค. 2026)
    → ขั้น 2/3 ฉบับทำมือ + ขั้น 7 เปิดเอง 3 หน้าต่าง คือทางหลัก · สคริปต์เก็บไว้เป็นทางลัดเฉยๆ
12. **★ Python ต้องอยู่ `C:\Python313` ห้ามอยู่ใต้ `C:\Users\`** — pm2 service รันคนละ account →
    `Access is denied` ทั้ง ocr-daemon และ pdfplumber (§3.1). ข้อนี้ทำระบบล่มทั้งเส้นมาแล้ว 17 ส.ค. 2026
13. **`pm2 report` node version ≠ `node -v`** — pm2 spawn ลูกด้วย Node ของ daemon ตัวเอง ไม่ใช่ของ shell
14. **เครื่องมี app ของทีมอื่นใน pm2** — ห้าม `restart/stop/delete all` และ `pm2 update` · `pm2 save` ลากของคนอื่น
    เข้า resurrect list ด้วย เช็ค `$env:PM2_HOME\dump.pm2` ก่อน (§7.2)
15. **Ollama tray ไม่ขึ้นตอน boot ถ้าไม่มีคน login** — pm2 เขียวครบแต่ upload พังทุกใบ.
    ทดสอบด้วยการรีบูตแล้ว**ไม่ login** ก่อนปิดงานเสมอ (§7.2)

---

## 12. บันทึกการติดตั้งจริง

| รอบ | ผล |
|---|---|
| **10 ส.ค. 2026** dry-run เต็มรูปแบบบน dev | ผ่าน — baseline เวลาในขั้น 8 มาจากรอบนี้ · เจอกฎ MAX_PATH ≤103 |
| **13 ส.ค. 2026** หน้างานครั้งที่ 1 | `.ps1` ถูกบล็อกทั้งหมด → เปลี่ยนขั้น 2/3 เป็นทำมือ · ดับเบิลคลิก `OllamaSetup.exe` ผ่าน |
| **14 ส.ค. 2026** dev | validate ชุดคำสั่งทำมือจากศูนย์ · เจอ Node ≥ v20.9 → แถม node zip เข้า bundle |
| **17 ส.ค. 2026** หน้างานครั้งที่ 2 | **ติดตั้งสำเร็จ ใช้งานจริงได้** — เจอ 2 บั๊กใหญ่: Python per-user (§3.1) และ `cwd` relative ใต้ pm2 service (§7.0) |

**ค่าจริงของเครื่อง server หน้างาน (17 ส.ค. 2026):**

| | |
|---|---|
| deploy root | `C:\zenithsphere\COA` |
| LAN IP / URL | `10.88.22.19` → UI `http://10.88.22.19:3000` (API 3001) |
| account ที่ใช้ติดตั้ง | `administrator.HITACHI-PM` |
| Node | 22.21.1 (ทั้ง shell และ pm2 daemon → **ไม่ต้องใช้ node zip**) |
| pm2 | Windows service `pm2.exe` Automatic · `PM2_HOME=C:\ProgramData\pm2\home` |
| co-tenant | `ZS-MMS` v1.1.1 รันใน pm2 ตัวเดียวกัน |
| Python | `C:\Python313` (robocopy มาจาก per-user install) |
| GPU | **ไม่มี** → LLM รัน CPU · COA 1 ใบ ~3–10 นาที = ปกติสำหรับเครื่องนี้ |

> ⚠️ **`C:\coa-setup` บนเครื่อง server ถูกลบทิ้งแล้ว (17 ส.ค. 2026)** — ชุดกู้ระบบเหลือชุดเดียวที่
> `C:\coa-setup` ของเครื่อง dev. venv พัง / ต้อง redeploy เมื่อไหร่ = ต้องขนขึ้นไปใหม่ทั้ง bundle

---

> เอกสารนี้ = source of truth สำหรับติดตั้งหน้างาน. DEPLOY.md = architecture + runbook ทั่วไป (ไม่เจาะ offline)
