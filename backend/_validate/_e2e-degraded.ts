// ตรวจว่า degraded เดินทางข้าม HTTP จริง — ฝั่ง python กับ TS สะกด field คนละแบบก็เงียบ (res.data เป็น any)
// ใช้ RapidOcrService ตัวจริง ชี้ OCR_SIDECAR_URL ไป daemon ที่ถูกจำกัด memory ไว้
import { RapidOcrService } from "../src/services/coa/rapidocr.service";

async function main() {
  const img = process.argv[2];
  const svc = new RapidOcrService();
  const out = await svc.extractTextBoth(img, "hq");
  if (out == null) {
    console.log("RESULT null (daemon errored) — HQ challenger จะเข้าสาขา 'HQ engine ล้ม'");
    return;
  }
  console.log(
    `RESULT tokens=${out.tokens.length} degraded=${JSON.stringify(out.degraded)} flatChars=${out.flat.length}`
  );
  console.log(out.degraded ? "OK: ธง degraded ข้าม HTTP มาถึง TS" : "BAD: ไม่มีธง degraded ฝั่ง TS");
}

main().catch((e) => {
  console.error("threw:", e?.message ?? e);
  process.exit(1);
});
