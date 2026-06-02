// แถบบนสุด — โลโก้แบรนด์ + สถานะ model
import { IconBrandDoc } from "./icons";

export default function Topbar() {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <IconBrandDoc />
        </div>
        <div>
          <div className="brand-title">COA Analyzer</div>
          <div className="brand-sub">v2.4 · ai-assisted</div>
        </div>
      </div>
      <div className="top-actions">
        <span className="pulse-dot"></span>
        <span>model · ready</span>
      </div>
    </div>
  );
}
