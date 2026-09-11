// แถบสถิติ 4 ช่อง (ผ่าน / ต้องตรวจ / ไม่ผ่าน / ทั้งหมด) พร้อมแท่ง bar ตามสัดส่วน
import type { CoaRow } from "@/lib/types";
import { bucketCounts } from "@/lib/format";

function Stat({
  label,
  value,
  tone,
  pct,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "warn" | "info";
  pct: number;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone}`}>{value}</div>
      <div className="stat-bar">
        <div className={`stat-bar-fill ${tone}`} style={{ width: pct + "%" }}></div>
      </div>
    </div>
  );
}

export default function StatStrip({ rows }: { rows: CoaRow[] }) {
  const c = bucketCounts(rows);
  const total = Math.max(c.total, 1);
  return (
    <div className="stats">
      <Stat label="ผ่าน" value={c.pass} tone="good" pct={(c.pass / total) * 100} />
      <Stat label="ต้องตรวจ" value={c.review} tone="warn" pct={(c.review / total) * 100 || 4} />
      <Stat label="ไม่ผ่าน" value={c.fail} tone="bad" pct={(c.fail / total) * 100 || 4} />
      <Stat label="ทั้งหมด" value={c.total} tone="info" pct={100} />
    </div>
  );
}
