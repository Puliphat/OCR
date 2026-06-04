// การ์ดผลลัพธ์ — หัว (ไฟล์ + verdict) + StatStrip + ตาราง + footer meta
import type { UploadResponse } from "@/lib/types";
import { nowIctString } from "@/lib/format";
import { IconCheck, IconClose, IconClock, IconResultDoc } from "./icons";
import StatStrip from "./StatStrip";
import ResultRow from "./ResultRow";

export default function ResultsCard({
  data,
  elapsedMs,
}: {
  data: UploadResponse;
  elapsedMs: number | null;
}) {
  const { report, logFile } = data;
  const { summary, rows, filename, product } = report;
  const reviewCount = rows.filter((r) => r.needsReview === true).length;
  const cleanPass = summary.fail === 0 && summary.total > 0 && reviewCount === 0;
  const warnPass = summary.fail === 0 && summary.total > 0 && reviewCount > 0;
  const elapsedSec = elapsedMs ? (elapsedMs / 1000).toFixed(1) : null;

  return (
    <div className="card results">
      {/* head */}
      <div className="result-head">
        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", minWidth: 0 }}>
          <div className="doc-logo" aria-hidden="true">
            <IconResultDoc />
          </div>
          <div className="result-meta">
            <div className="result-product">{filename}</div>
            {product && <div className="result-product-sub">{product}</div>}
          </div>
        </div>
        <div className="verdict">
          <div
            className={
              "verdict-badge" +
              (cleanPass ? "" : warnPass ? " warn" : " fail")
            }
          >
            <span className="verdict-check">
              {cleanPass || warnPass ? (
                <IconCheck size={11} />
              ) : (
                <IconClose size={11} />
              )}
            </span>
            {cleanPass
              ? "COA passes spec"
              : warnPass
              ? `ผ่าน — แต่มี ${reviewCount} รายการต้องตรวจ`
              : `${summary.fail} parameter${summary.fail === 1 ? "" : "s"} out of spec`}
          </div>
          <div className="ai-note">
            <IconClock />
            {elapsedSec ? `analyzed in ${elapsedSec}s · ` : ""}
            {summary.total} field{summary.total === 1 ? "" : "s"} parsed
          </div>
        </div>
      </div>

      {/* stats */}
      <StatStrip summary={summary} />

      {/* table */}
      {rows.length > 0 && (
        <>
          <div className="rows-head">
            <div>Item</div>
            <div>Unit</div>
            <div className="rc">Min</div>
            <div className="rc">Max</div>
            <div className="ra">Result</div>
            <div className="ra">Status</div>
          </div>
          <div className="rows">
            {rows.map((r, i) => (
              <ResultRow key={i} row={r} />
            ))}
          </div>
        </>
      )}

      {rows.length === 0 && (
        <div
          style={{
            padding: "20px 24px 22px",
            color: "var(--ink-3)",
            fontSize: 13,
            borderTop: "1px solid var(--line)",
          }}
        >
          No parameters were extracted from this file.
        </div>
      )}

      {/* footer meta */}
      <div className="footer-meta">
        <div className="meta-item">
          <strong>log</strong> · {logFile}
        </div>
        <div className="meta-item">
          <strong>checked</strong> · {nowIctString()}
        </div>
        {report.lotNo && (
          <div className="meta-item">
            <strong>lot</strong> · {report.lotNo}
          </div>
        )}
      </div>
    </div>
  );
}
