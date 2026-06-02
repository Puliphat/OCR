// แถบ helper เล็กๆ ใต้การ์ด — ใช้ซ้ำ 3 แบบ: ready (เขียว) / error (แดง) / tip (accent)
import type { ReactNode } from "react";
import { IconCheck, IconClose, IconInfo } from "./icons";

type Variant = "ready" | "error" | "tip";

const ICON_STYLE: Record<Variant, { background: string; color: string } | undefined> = {
  ready: { background: "var(--good-soft)", color: "var(--good)" },
  error: { background: "var(--bad-soft)", color: "var(--bad)" },
  tip: undefined, // ใช้สี default ของ .helper-icon (accent)
};

export default function HelperBar({
  variant,
  children,
  style,
}: {
  variant: Variant;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={"helper" + (variant === "error" ? " fail" : "")} style={style}>
      <span className="helper-icon" style={ICON_STYLE[variant]}>
        {variant === "ready" && <IconCheck />}
        {variant === "error" && <IconClose size={12} strokeWidth={2} />}
        {variant === "tip" && <IconInfo />}
      </span>
      <span>{children}</span>
    </div>
  );
}
