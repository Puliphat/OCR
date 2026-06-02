// empty state — การ์ด "how it works" 3 ขั้น แสดงตอนยังไม่เลือกไฟล์ (กันหน้าว่าง)
import { IconCheck } from "./icons";

export default function EmptyState() {
  return (
    <div className="card empty">
      <div className="empty-grid">
        <div className="step">
          <div className="step-num">
            <span>01</span> · upload
          </div>
          <div className="step-art">
            <div className="art-pdf"></div>
          </div>
          <div className="step-title">Drop the supplier PDF</div>
          <div className="step-desc">
            Any COA / spec sheet works — single-page or multi-page, scanned or native.
          </div>
        </div>
        <div className="step">
          <div className="step-num">
            <span>02</span> · analyze
          </div>
          <div className="step-art">
            <div className="art-scan">
              <div className="art-scan-line"></div>
            </div>
          </div>
          <div className="step-title">The model reads it</div>
          <div className="step-desc">
            Every parameter, unit and result is parsed and matched against your stored spec window.
          </div>
        </div>
        <div className="step">
          <div className="step-num">
            <span>03</span> · verdict
          </div>
          <div className="step-art">
            <div className="art-verdict">
              <div className="art-verdict-dot"></div>
              <div className="art-verdict-dot"></div>
              <div className="art-verdict-dot"></div>
              <div className="art-verdict-check">
                <IconCheck size={14} />
              </div>
            </div>
          </div>
          <div className="step-title">PASS / FAIL at a glance</div>
          <div className="step-desc">
            Each row shows where the result sits inside the spec, with a clear overall verdict.
          </div>
        </div>
      </div>
      <div className="empty-cta">
        <div className="empty-cta-text">
          <strong>No file yet.</strong> Pick one above — drag a PDF in or click to browse.
        </div>
      </div>
    </div>
  );
}
