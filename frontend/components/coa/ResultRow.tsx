// หนึ่งแถวในตารางผล — Item / Unit / Min / Max / Result / Status
import type { CoaRow } from "@/lib/types";
import { fmtNum } from "@/lib/format";

export default function ResultRow({ row }: { row: CoaRow }) {
  const statusClass =
    row.status === "FAIL" ? " fail" : row.status === "SKIP" ? " skip" : "";
  return (
    <div className="row">
      <div className="row-name">
        {row.name}
        {row.method && <small>{row.method}</small>}
      </div>
      <div className="row-unit">{row.unit ?? "—"}</div>
      <div className="row-bound">{fmtNum(row.min)}</div>
      <div className="row-bound">{fmtNum(row.max)}</div>
      <div className="row-result">{row.resultRaw ?? fmtNum(row.result)}</div>
      <div className={"row-status" + statusClass} title={row.reason}>
        {row.status}
      </div>
    </div>
  );
}
