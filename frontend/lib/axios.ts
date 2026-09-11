import axios from "axios";

// baseURL ต้องเป็น "ที่อยู่ของ backend เมื่อมองจาก browser ของ client" ไม่ใช่ของ server — client
//   เครื่องอื่นใน LAN เปิดหน้าเว็บ "localhost" = เครื่อง client เอง ไม่ใช่ server → deploy หน้างานต้องตั้ง
//   NEXT_PUBLIC_API_BASE_URL=http://<SERVER_LAN_IP>:3001 ก่อน `next build` (inline ตอน build, เปลี่ยนต้อง build ใหม่)
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001",
});
