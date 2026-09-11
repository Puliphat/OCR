// ค่าที่ใบพิมพ์ไว้เฉย ๆ ไม่มีคอลัมน์เกณฑ์ (บล็อก Chemical Element ของ TAIHEIYO)
//   วางเรียงแนวนอนตามใบ — ระบบเทียบให้ไม่ได้ จึงไม่นับรวมกับรายการที่ตรวจ
import type { CoaRow } from "@/lib/types";
import { fmtResult } from "@/lib/format";

export default function InfoStrip({ rows }: { rows: CoaRow[] }) {
  const cells = rows.filter((r) => r.result != null || r.resultRaw);
  if (cells.length === 0) return null;
  // ใบเขียนหน่วยไว้ครั้งเดียวที่หัวบล็อก (wt%) — ทุกช่องใช้หน่วยเดียวกัน
  const unit = cells.find((c) => c.unit)?.unit ?? null;

  return (
    <div className="info-block">
      <div className="info-block-head">
        <span className="info-block-title">ค่าบนใบ{unit ? ` · ${unit}` : ""}</span>
        <span className="info-block-note">ใบไม่ได้กำหนดเกณฑ์ไว้ — ดูอย่างเดียว ไม่นับเป็นรายการตรวจ</span>
      </div>
      <div className="info-scroll">
        <table className="info-table">
          <thead>
            <tr>
              {cells.map((c, i) => (
                <th key={i}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {cells.map((c, i) => (
                <td key={i}>{fmtResult(c)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
