// การ์ดผลลัพธ์ — หัว (ไฟล์ + verdict) + StatStrip + ตาราง + footer meta
import type { CoaReport } from "@/lib/types";
import { bucketCounts, nowIctString } from "@/lib/format";
import { IconCheck, IconClose, IconClock, IconResultDoc } from "./icons";
import StatStrip from "./StatStrip";
import ResultRow from "./ResultRow";
import InfoStrip from "./InfoStrip";

export default function ResultsCard({
  report,
  logFile,
  elapsedMs,
  index,
  total,
}: {
  report: CoaReport;
  logFile: string;
  elapsedMs: number | null;
  index: number;
  total: number;
}) {
  const { rows, filename, product } = report;
  // แถวที่ใบไม่มีเกณฑ์ให้เทียบ แยกไปแถบด้านบน ที่เหลือคือรายการที่ระบบตรวจจริง
  const infoRows = rows.filter((r) => r.infoOnly);
  const checkRows = rows.filter((r) => !r.infoOnly);
  // นับจากแถวจริง ไม่ใช่ summary ของ backend — แถวที่ระบบตัดสินไม่ได้ต้องขึ้น "ต้องตรวจ" ไม่ใช่ผ่านเงียบ
  const count = bucketCounts(rows);
  const cleanPass = count.fail === 0 && count.total > 0 && count.review === 0;
  const warnPass = count.fail === 0 && count.total > 0 && count.review > 0;
  const elapsedSec = elapsedMs ? (elapsedMs / 1000).toFixed(1) : null;

  // lot/page badge label — shown only when total > 1
  const lotLabel = total > 1
    ? (report.lotNo ? `Lot ${report.lotNo}` : `Page ${report.page ?? index + 1}`)
    : null;

  return (
    <div className="card results">
      {/* head */}
      <div className="result-head">
        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", minWidth: 0 }}>
          <div className="doc-logo" aria-hidden="true">
            <IconResultDoc />
          </div>
          <div className="result-meta">
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
              <div className="result-product">{filename}</div>
              {lotLabel && (
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    color: "var(--ink-3)",
                    border: "1px solid var(--line)",
                    borderRadius: "999px",
                    padding: "2px 9px",
                    whiteSpace: "nowrap",
                    lineHeight: "1.6",
                    flexShrink: 0,
                  }}
                >
                  {lotLabel}
                </span>
              )}
            </div>
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
              ? "ผ่านครบทุกรายการ"
              : warnPass
              ? `ผ่าน — แต่มี ${count.review} รายการต้องตรวจ`
              : `ไม่ผ่าน ${count.fail} รายการ`}
          </div>
          <div className="ai-note">
            <IconClock />
            {elapsedSec ? `analyzed in ${elapsedSec}s · ` : ""}
            {count.total} field{count.total === 1 ? "" : "s"} parsed
          </div>
        </div>
      </div>

      {report.noSpecOnPaper && (
        <div className="no-spec-note">
          ใบนี้ไม่มีคอลัมน์เกณฑ์ (spec) — ระบบเทียบเองไม่ได้ ต้องเอาเกณฑ์ที่ตั้งไว้ในระบบมาเทียบ
        </div>
      )}

      {infoRows.length > 0 && <InfoStrip rows={infoRows} />}

      {/* stats */}
      <StatStrip rows={rows} />

      {/* table */}
      {checkRows.length > 0 && (
        <>
          <div className="rows-head">
            <div>Item</div>
            <div>Unit</div>
            <div>Spec</div>
            <div className="rc">Min</div>
            <div className="rc">Max</div>
            <div className="ra">Result</div>
            <div className="ra">Status</div>
          </div>
          <div className="rows">
            {checkRows.map((r, i) => (
              <ResultRow key={i} row={r} />
            ))}
          </div>
        </>
      )}

      {checkRows.length === 0 && (
        <div
          style={{
            padding: "20px 24px 22px",
            color: "var(--ink-3)",
            fontSize: 13,
            borderTop: "1px solid var(--line)",
          }}
        >
          {infoRows.length > 0
            ? "ใบนี้มีแต่ค่าที่ไม่มีเกณฑ์กำกับ — ไม่มีรายการให้ระบบตรวจ"
            : "No parameters were extracted from this file."}
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
