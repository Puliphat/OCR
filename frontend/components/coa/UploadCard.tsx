// การ์ด upload — drop zone + ปุ่ม Analyze (รับได้หลายไฟล์ ระบบจะทยอยทำทีละใบ)
// ความคืบหน้าไปอยู่ที่ JobCard แล้ว เพราะผูกกับ "งาน" ไม่ใช่ฟอร์ม
import type { RefObject } from "react";
import { fmtBytes } from "@/lib/format";
import { IconUpload, IconX } from "./icons";

export default function UploadCard({
  files,
  dragover,
  busy,
  inputRef,
  onPick,
  onDrop,
  onDragOver,
  onDragLeave,
  onAnalyze,
  onClear,
  onRemove,
}: {
  files: File[];
  dragover: boolean;
  busy: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLLabelElement>) => void;
  onDragLeave: () => void;
  onAnalyze: () => void;
  onClear: (e: React.MouseEvent) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="card">
      <div className="upload">
        <label
          className={"drop" + (dragover ? " dragover" : "")}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            multiple
            style={{ display: "none" }}
            onChange={onPick}
          />
          <div className="drop-icon">
            <IconUpload />
          </div>
          <div className="drop-text">
            <div className="drop-title">
              {dragover ? "Drop it here" : "Drop a PDF or click to browse"}
            </div>
            <div className="drop-sub">
              {files.length > 0
                ? `เลือกแล้ว ${files.length} ไฟล์ · เลือกเพิ่มได้ (สูงสุด 20) แล้วกด Analyze ทีเดียว`
                : ".pdf · .png · .jpg · เลือกได้หลายไฟล์ ระบบทยอยทำทีละใบ"}
            </div>
            {files.length > 0 && (
              <div className="file-chips">
                {files.map((f, i) => (
                  <div className="file-chip" key={`${f.name}-${i}`}>
                    <span className="file-chip-pdf">
                      {f.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}
                    </span>
                    <span className="file-chip-name" title={f.name}>
                      {f.name}
                    </span>
                    <span className="mono" style={{ color: "var(--ink-3)" }}>
                      · {fmtBytes(f.size)}
                    </span>
                    <span
                      className="x"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        files.length === 1 ? onClear(e) : onRemove(i);
                      }}
                      aria-label={`Remove ${f.name}`}
                    >
                      <IconX />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </label>
        <button className="btn primary" disabled={files.length === 0 || busy} onClick={onAnalyze}>
          {busy ? "Analyzing…" : files.length > 1 ? `Analyze (${files.length})` : "Analyze"}
          <span className="arrow">→</span>
        </button>
      </div>
    </div>
  );
}
