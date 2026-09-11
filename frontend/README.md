# frontend — COA analyzer UI

Next.js 16 (app router) + React 19 + Tailwind 4 + @tanstack/react-query · dev server ที่ **:3000**

หน้าเดียว: เลือกไฟล์ COA → `POST /api/coa/upload` คืน `jobId` ทันที (backend เข้าคิวรันทีละงาน) →
poll `GET /api/coa/jobs?ids=` จนจบ → ตารางผลแยก 3 ช่อง **ผ่าน / ต้องตรวจ / ไม่ผ่าน**
(backend คืน `PASS`/`FAIL`/`SKIP` + ธง `needsReview` — การจับกลุ่มเป็น 3 ช่องอยู่ที่ `lib/format.ts:rowBucket`)

```bash
npm install
npm run dev        # :3000 — ต้องมี backend :3001 ขึ้นอยู่ด้วย
npm run build
npm run lint
```

## โครง

```
app/page.tsx          orchestrator: state + mutation + ประกอบ component (ไม่มี markup ย่อย)
app/styles/*.css      สไตล์แยกตาม section, globals.css แค่ import ตามลำดับ
components/coa/*      UI ย่อยทั้งหมด (UploadCard / JobCard / ResultsCard / ResultRow / …)
lib/types.ts          contract กับ backend — แก้ฝั่งไหนต้องแก้คู่กัน
lib/format.ts         แปลงค่าไปขึ้นจอ + จัด 3 ช่องผล
lib/axios.ts          baseURL ของ backend
```

## Env

`NEXT_PUBLIC_API_BASE_URL` — ที่อยู่ backend **เมื่อมองจาก browser ของ client** ไม่ใช่ของ server
ไม่ตั้ง = `http://localhost:3001` (พอสำหรับ dev เครื่องเดียว)

⚠️ `NEXT_PUBLIC_*` ถูก inline ตอน `next build` → **แก้ค่าแล้วต้อง build ใหม่เสมอ** และห้ามใส่ `localhost`
ตอน deploy ให้ client เครื่องอื่นเข้า. รายละเอียด deploy อยู่ที่ `../DEPLOY.md` §3 (เจ้าของเรื่องนี้ไฟล์เดียว)
