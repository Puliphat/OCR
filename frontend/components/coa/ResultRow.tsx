// หนึ่งแถวในตารางผล — Item / Unit / Min / Max / Result / Status
import type { CoaRow } from "@/lib/types";
import { fmtNum } from "@/lib/format";

export default function ResultRow({ row }: { row: CoaRow }) {
  const isReview = row.needsReview === true;

  // needsReview rows always get the amber "review" pill regardless of status
  const statusClass = isReview
    ? " review"
    : row.status === "FAIL"
    ? " fail"
    : row.status === "SKIP"
    ? " skip"
    : "";

  const statusLabel = isReview ? "⚠ ต้องตรวจ" : row.status;

  return (
    <div className="row">
      <div className="row-name">
        {row.name}
        {row.method && <small>{row.method}</small>}
        {isReview && (
          <small style={{ color: "var(--warn)", fontStyle: "italic" }}>
            {row.reason}
          </small>
        )}
      </div>
      <div className="row-unit">{row.unit ?? "—"}</div>
      <div className="row-bound">{fmtNum(row.min)}</div>
      <div className="row-bound">{fmtNum(row.max)}</div>
      <div className="row-result">{row.resultRaw ?? fmtNum(row.result)}</div>
      <div className={"row-status" + statusClass} title={row.reason}>
        {statusLabel}
      </div>
    </div>
  );
}
