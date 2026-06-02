// การ์ด upload — drop zone + ปุ่ม Analyze + state กำลังวิเคราะห์
import type { RefObject } from "react";
import { fmtBytes } from "@/lib/format";
import { IconUpload, IconX } from "./icons";

export default function UploadCard({
  file,
  dragover,
  isPending,
  analyzing,
  inputRef,
  onPick,
  onDrop,
  onDragOver,
  onDragLeave,
  onAnalyze,
  onClear,
}: {
  file: File | null;
  dragover: boolean;
  isPending: boolean;
  analyzing: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLLabelElement>) => void;
  onDragLeave: () => void;
  onAnalyze: () => void;
  onClear: (e: React.MouseEvent) => void;
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
              .pdf · .png · .jpg · supplier COA / spec sheet
            </div>
            {file && (
              <div className="file-chip">
                <span className="file-chip-pdf">
                  {file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "IMG"}
                </span>
                <span>{file.name}</span>
                <span className="mono" style={{ color: "var(--ink-3)" }}>
                  · {fmtBytes(file.size)}
                </span>
                <span className="x" onClick={onClear} aria-label="Remove file">
                  <IconX />
                </span>
              </div>
            )}
          </div>
        </label>
        <button
          className="btn primary"
          disabled={!file || isPending}
          onClick={onAnalyze}
        >
          {isPending ? "Analyzing…" : "Analyze"}
          <span className="arrow">→</span>
        </button>
      </div>

      {analyzing && (
        <div className="analyzing">
          <div className="scanner">
            <div className="scanner-doc"></div>
            <div className="scanner-line"></div>
          </div>
          <div className="analyzing-text">
            reading parameters
            <span className="dot">.</span>
            <span className="dot">.</span>
            <span className="dot">.</span>
          </div>
        </div>
      )}
    </div>
  );
}
