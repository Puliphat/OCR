import axios from "axios";

// baseURL ต้องเป็น "ที่อยู่ของ backend เมื่อมองจาก browser ของ client" ไม่ใช่ของ server:
//   client เครื่องอื่นใน LAN เปิดหน้าเว็บ → JS วิ่งบน browser ของ client → "localhost" = เครื่อง client เอง
//   ∴ deploy หน้างานต้องตั้ง NEXT_PUBLIC_API_BASE_URL=http://<SERVER_LAN_IP>:3001 ก่อน `next build`
//   (NEXT_PUBLIC_* ถูก inline ตอน build — เปลี่ยนแล้วต้อง build ใหม่). dev/เครื่องเดียว = localhost (default)
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
});
