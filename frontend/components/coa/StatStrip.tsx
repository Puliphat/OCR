// แถบสถิติ 4 ช่อง (Pass / Fail / Skip / Total) พร้อมแท่ง bar ตามสัดส่วน
import type { CoaReport } from "@/lib/types";

type Summary = CoaReport["summary"];

function Stat({
  label,
  value,
  tone,
  pct,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "muted" | "info";
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

export default function StatStrip({ summary }: { summary: Summary }) {
  const total = Math.max(summary.total, 1);
  return (
    <div className="stats">
      <Stat label="Pass" value={summary.pass} tone="good" pct={(summary.pass / total) * 100} />
      <Stat label="Fail" value={summary.fail} tone="bad" pct={(summary.fail / total) * 100 || 4} />
      <Stat label="Skip" value={summary.skip} tone="muted" pct={(summary.skip / total) * 100 || 4} />
      <Stat label="Total" value={summary.total} tone="info" pct={100} />
    </div>
  );
}
