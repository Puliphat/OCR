// ส่วนหัวเพจ — eyebrow + title + คำอธิบาย (type ล้วน ไม่มี mascot)
export default function Hero() {
  return (
    <div className="hero">
      <div className="eyebrow">Certificate of Analysis</div>
      <h1 className="title">
        Drop a spec sheet,
        <br />
        get an <em>instant verdict</em>.
      </h1>
      <div className="lede">
        Upload a supplier COA — the model extracts every parameter and flags what&apos;s out of spec.
      </div>
    </div>
  );
}
