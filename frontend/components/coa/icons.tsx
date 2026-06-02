// inline SVG icons ที่ใช้ซ้ำใน COA UI — stroke ใช้ currentColor ให้สีไหลตาม parent
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(size: number, props: SVGProps<SVGSVGElement>) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function IconCheck({ size = 12, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2.5}>
      <polyline points="2 6 5 9 10 3" />
    </svg>
  );
}

export function IconClose({ size = 12, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={2.5}>
      <line x1="3" y1="3" x2="9" y2="9" />
      <line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  );
}

export function IconClock({ size = 11, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={1.5}>
      <circle cx="6" cy="6" r="5" />
      <path d="M6 3v3l2 1" />
    </svg>
  );
}

export function IconInfo({ size = 12, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} strokeWidth={1.8}>
      <circle cx="6" cy="6" r="5" />
      <line x1="6" y1="5" x2="6" y2="8.5" />
      <circle cx="6" cy="3.5" r=".5" fill="currentColor" />
    </svg>
  );
}

/** ปุ่มกากบาทเล็กบน file-chip (viewBox 10×10) */
export function IconX({ size = 10, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      {...props}
    >
      <line x1="2" y1="2" x2="8" y2="8" />
      <line x1="8" y1="2" x2="2" y2="8" />
    </svg>
  );
}

/** ไอคอน upload (cloud-up) ในกล่อง drop — viewBox 24×24 */
export function IconUpload({ size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** โลโก้แบรนด์ในกล่องดำมุมซ้ายบน — เส้นกลางสี accent */
export function IconBrandDoc({ size = 18, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 20) / 18}
      viewBox="0 0 22 26"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 1 L14 1 L20 7 L20 25 L3 25 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 1 L14 7 L20 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <line x1="6" y1="13" x2="17" y2="13" stroke="#ff6b3d" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="6" y1="17" x2="17" y2="17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
      <line x1="6" y1="21" x2="13" y2="21" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

/** โลโก้เอกสาร decorative บนหัว result card (สีตายตัวตาม palette) */
export function IconResultDoc() {
  return (
    <svg width="22" height="26" viewBox="0 0 22 26" fill="none" aria-hidden="true">
      <path d="M3 1 L14 1 L20 7 L20 25 L3 25 Z" fill="#ffffff" stroke="#37352f" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M14 1 L14 7 L20 7" fill="#f1f1ef" stroke="#37352f" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="7" cy="13" r="1.6" fill="#448361" />
      <line x1="10" y1="13" x2="17" y2="13" stroke="#9b9a97" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="17" r="1.6" fill="#448361" />
      <line x1="10" y1="17" x2="17" y2="17" stroke="#9b9a97" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="21" r="1.6" fill="#ff6b3d" />
      <line x1="10" y1="21" x2="15" y2="21" stroke="#9b9a97" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
