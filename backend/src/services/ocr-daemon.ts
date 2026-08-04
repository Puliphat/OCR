// คุม Python OCR sidecar (:8765) — probe health + สั่ง start ใหม่
// สกัดออกจาก coa.routes.ts เพื่อให้ queue runner กู้ daemon เองได้ ไม่ต้องรอ frontend สั่ง
import * as path from "path";
import * as child_process from "child_process";
import axios from "axios";

const SIDECAR_URL = () => process.env.OCR_SIDECAR_URL || "http://127.0.0.1:8765";

export async function isOcrDaemonHealthy(): Promise<boolean> {
  try {
    await axios.get(`${SIDECAR_URL()}/health`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// spawn แบบ detached แล้วปล่อย — daemon โหลดโมเดลเองใช้เวลาหลายวินาที (ใช้ waitForOcrDaemon รอ)
// paths อ้างจาก repo root (ขึ้นไป 3 ชั้นจาก backend/src/services)
export function restartOcrDaemon(): void {
  const repoRoot = path.join(__dirname, "..", "..", "..");
  const pythonExe = path.join(repoRoot, "ocr-py", "venv", "Scripts", "python.exe");
  const serverScript = path.join(repoRoot, "ocr-py", "ocr_server.py");

  const child = child_process.spawn(pythonExe, [serverScript, "8765"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

// poll จน daemon ตอบ health หรือหมดเวลา — คืน true = พร้อมใช้แล้ว
export async function waitForOcrDaemon(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOcrDaemonHealthy()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
