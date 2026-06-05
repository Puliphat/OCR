// หนึ่งแถวในตารางผล — Item / Unit / Min / Max / Result / Status
import type { CoaRow } from "@/lib/types";
import { fmtNum } from "@/lib/format";

export default function ResultRow({ row }: { row: CoaRow }) {
  const isReview = row.needsReview === true;
  // ★ needsReview PASS → เขียว (อ่านออกว่า "ผ่าน") + flag ⚠ amber pulse — ลด "ความตกใจ" ให้คนเหลือบยืนยันเร็ว
  //   review ที่ยังไม่ผ่าน (SKIP/FAIL ต้องตรวจ) → amber เต็มเดิม. ★ ไม่ใช่เขียวล้วน: ⚠+edge เหลือง + header เหลือง + ยังนับ reviewCount ★
  const isReviewPass = isReview && row.status === "PASS";
  const statusClass = isReviewPass
    ? " review-pass"
    : isReview
    ? " review"
    : row.status === "FAIL"
    ? " fail"
    : row.status === "SKIP"
    ? " skip"
    : "";

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
      <div
        className={"row-status" + statusClass}
        title={row.reason || "ต้องตรวจ — ค่ามาจากการกู้/อ่านคอลัมน์ใหม่ ยืนยันกับใบจริง"}
      >
        {isReviewPass ? (
          <>
            <span className="rev-icon" aria-hidden="true">⚠</span>
            PASS
          </>
        ) : isReview ? (
          "⚠ ต้องตรวจ"
        ) : (
          row.status
        )}
      </div>
    </div>
  );
}
