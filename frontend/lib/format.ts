// ฟังก์ชัน format ที่ใช้ร่วมกันใน UI (ตัวเลข / ขนาดไฟล์ / เวลา)

/** ตัวเลข → string: integer คงเดิม, ทศนิยมตัด trailing zero, null → "—" */
export function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

/** bytes → "B" / "KB" / "MB" อ่านง่าย */
export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
