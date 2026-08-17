// pm2 process definitions — ทุกตัวรันบนเครื่อง server เดียวกัน
//   ยก stack: `pm2 start ecosystem.config.js`
//   deploy code ใหม่: `git pull && cd frontend && npm run build && cd .. && pm2 restart all`
//   ★ Ollama ไม่อยู่ในนี้ ★ — เป็น tray app/Windows service แยก (ตั้ง OLLAMA_HOST + Quit tray + เปิดใหม่)
//
// prerequisite ก่อน start ครั้งแรก:
//   backend/  : npm install                         (ts-node รัน .ts ตรง ไม่ต้อง build)
//   frontend/ : npm install && npm run build         (ตั้ง NEXT_PUBLIC_API_BASE_URL ใน .env.local ก่อน build)
//   ocr-py/   : python -m venv venv && venv\Scripts\pip install -r requirements.txt
//   firewall  : เปิด 3000 (FE) + 3001 (BE) ให้ LAN client เข้าถึง — 8765/11434 ไม่ต้องเปิด (localhost)
//
// ★ ทุก path ในไฟล์นี้ต้อง absolute ผ่าน __dirname ★
// pm2 resolve `cwd` และ `interpreter` จาก cwd ของ "ตัว pm2 ตอนถูกเรียก" ไม่ใช่ที่เราสั่ง —
// หน้างานติดตั้ง pm2 เป็น **Windows service** (cwd = C:\Windows\System32) → relative path ชี้ผิดที่ทั้งหมด.
// __dirname = โฟลเดอร์ที่ ecosystem.config.js อยู่ → ย้าย deploy root ไปไหนก็ยังถูก
const path = require("path");

module.exports = {
  apps: [
    {
      // Express API (ts-node — ไม่มี build step). bind 0.0.0.0 default → LAN client เข้าได้ (เปิด firewall 3001)
      name: "coa-backend",
      cwd: path.join(__dirname, "backend"),
      script: "node_modules/ts-node/dist/bin.js",
      args: "src/index.ts",
      env: {
        PORT: "3001",
        OLLAMA_URL: "http://localhost:11434/api/generate",
        OLLAMA_MODEL: "qwen3:4b",
        OCR_SIDECAR_URL: "http://127.0.0.1:8765", // daemon อยู่เครื่องเดียวกัน → localhost
        // COA_OCR_HQ_SPECULATE: ห้ามเปิดตราบใดที่ daemon อยู่เครื่องเดียวกับ Ollama — วัดแล้วช้าลง
        //   (HQ OCR ของ RapidOCR แย่ง CPU กับ Ollama). เปิดได้เฉพาะตอนย้าย daemon ไปเครื่องอื่นใน LAN
      },
    },
    {
      // RapidOCR Python daemon. เครื่องเดียวกับ backend → bind 127.0.0.1 พอ (ไม่ต้อง expose LAN)
      name: "ocr-daemon",
      cwd: path.join(__dirname, "ocr-py"),
      script: "ocr_server.py",
      args: "8765",
      // ★ absolute ★ — เขียน "./venv/..." แล้วตายด้วย
      //   [PM2][ERROR] Error: Interpreter ./venv/Scripts/python.exe is NOT AVAILABLE in PATH.
      // pythonw.exe (ไม่ใช่ python.exe) = ไม่จอง console → ไม่มีหน้าต่างดำโผล่บนเครื่อง server
      // ทดสอบแล้วว่า log ยังเข้า pm2 ครบ (pm2 ต่อ pipe ให้ ไม่ได้พึ่ง console ของ process)
      // ⚠️ แลกมาด้วย: ถ้า venv พัง pythonw ตายเงียบ — pm2 log ว่างทั้ง out/error ไม่มีเบาะแสเลย
      //    ตอน debug ให้สลับเป็น python.exe ชั่วคราว error ถึงจะโผล่ (ดู INSTALL-OFFLINE.md §10)
      interpreter: path.join(__dirname, "ocr-py", "venv", "Scripts", "pythonw.exe"),
      env: {
        OCR_BIND_HOST: "127.0.0.1",
        COA_OCR_MODEL_TYPE: "mobile",
        COA_OCR_VERSION: "PP-OCRv4",
        COA_OCR_HQ_PRELOAD: "true",
      },
    },
    {
      // Next.js (production). ต้อง `next build` ก่อน. bind 0.0.0.0 default → LAN client เข้าได้ (เปิด firewall 3000)
      name: "coa-frontend",
      cwd: path.join(__dirname, "frontend"),
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env: {
        PORT: "3000",
      },
    },
  ],
};
