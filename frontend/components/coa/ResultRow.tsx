// หนึ่งแถวในตารางผล — Item / Unit / Spec / Min / Max / Result / Status
import type { CoaRow } from "@/lib/types";
import { fmtNum, fmtResult, rowBucket } from "@/lib/format";

export default function ResultRow({ row }: { row: CoaRow }) {
  // 3 ช่องเท่านั้น (ดู rowBucket) — แถวที่ระบบตัดสินเองไม่ได้ไปอยู่ช่อง "ต้องตรวจ" ไม่ใช่ช่องเทาที่คนมองข้าม
  const bucket = rowBucket(row);
  const isReview = bucket === "review";
  const statusClass = bucket === "fail" ? " fail" : isReview ? " review" : "";

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
      {/* เกณฑ์ตามที่พิมพ์บนใบ — แถวที่เทียบข้อความกับข้อความไม่มีเลข min/max ให้ดู ต้องอ่านช่องนี้ */}
      <div className="row-spec" title={row.specRaw ?? undefined}>
        {row.specRaw ?? "—"}
      </div>
      <div className="row-bound">{fmtNum(row.min)}</div>
      <div className="row-bound">{fmtNum(row.max)}</div>
      {/* จอโชว์เลขที่ตีความแล้ว (จุดทศนิยม "." เสมอ) · hover เห็นข้อความตามใบไว้เทียบ */}
      <div className="row-result" title={row.resultRaw ?? undefined}>
        {fmtResult(row)}
      </div>
      {/* fallback ใช้ได้เฉพาะแถวที่ปักธงจริง — เดิมแถว PASS สะอาด (reason ว่าง) ก็ตกมาโชว์ "ต้องตรวจ" */}
      <div
        className={"row-status" + statusClass}
        title={
          row.reason ||
          (isReview ? "ต้องตรวจ — ระบบยังยืนยันแถวนี้เองไม่ได้ อ่านจากใบจริง" : undefined)
        }
      >
        {isReview ? (
          <>
            <span className="rev-icon" aria-hidden="true">⚠</span>
            ผ่าน · ต้องตรวจ
          </>
        ) : bucket === "fail" ? (
          "ไม่ผ่าน"
        ) : (
          "ผ่าน"
        )}
      </div>
    </div>
  );
}
