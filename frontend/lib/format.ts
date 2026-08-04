// ฟังก์ชัน format ที่ใช้ร่วมกันใน UI (ตัวเลข / ขนาดไฟล์ / เวลา)

/** ตัวเลข → string: integer คงเดิม, ทศนิยมตัด trailing zero, null → "—" */
export function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * ค่าผลสำหรับ "แสดงบนจอ" — ใช้เลขที่ระบบตีความแล้ว จุดทศนิยมเป็น "." เสมอ
 * ★ ต่างจาก resultRaw ที่เก็บข้อความตามใบ ★ ใบยุโรปเขียน "200,00 – 250,00" ซึ่งคนไทยอ่านสับสน
 *   (นึกว่า 20000) → จอโชว์ "200 – 250" ส่วน resultRaw ยังเก็บของเดิมไว้ครบใน tooltip + DB
 * ค่าที่ไม่ใช่ตัวเลข ("White" / "<15" / "K2Ti6O13") ไม่มีเลขให้แปลง → ใช้ข้อความตามใบตรง ๆ
 */
export function fmtResult(row: {
  result: number | null;
  resultMin?: number | null;
  resultMax?: number | null;
  resultRaw: string | null;
}): string {
  const { resultMin: lo, resultMax: hi } = row;
  if (lo != null && hi != null && lo !== hi) return `${fmtNum(lo)} – ${fmtNum(hi)}`;
  if (row.result != null) return fmtNum(row.result);
  return row.resultRaw ?? "—";
}

/** bytes → "B" / "KB" / "MB" อ่านง่าย */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** วินาทีที่ต้องรอ → ข้อความหยาบๆ ("ไม่ถึงนาที" / "~3 นาที") — ไม่โชว์วินาทีเพราะเป็นค่าประมาณ */
export function fmtWait(sec: number): string {
  if (sec < 60) return "ไม่ถึงนาที";
  return `~${Math.round(sec / 60)} นาที`;
}

/** เวลาปัจจุบันโซน Asia/Bangkok เช่น "29 May 2026, 13:07 ICT" */
export function nowIctString(): string {
  const d = new Date();
  return (
    d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }) + " ICT"
  );
}
