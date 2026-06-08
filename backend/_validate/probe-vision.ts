// diagnose qwen2.5vl:3b 500 — try variants, print full error body
import axios from "axios";
import * as path from "path";
import { ImageProcessingService } from "../src/services/image-processing.service";

const URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const CHAT = "http://localhost:11434/api/chat";

async function call(label: string, body: any, url = URL) {
  try {
    const res = await axios.post(url, body, { timeout: 300_000 });
    const r = res.data.response ?? res.data.message?.content;
    console.log(`[${label}] OK len=${(r ?? "").length}\n  ${String(r).slice(0, 200)}`);
  } catch (e: any) {
    const body = e?.response?.data;
    console.log(`[${label}] FAIL ${e?.response?.status}: ${typeof body === "object" ? JSON.stringify(body) : body ?? e?.message}`);
  }
}

async function main() {
  const buf = await new ImageProcessingService().preprocess(path.resolve("uploads/20260203_Lot240521.png"), 90);
  const b64 = buf.toString("base64");
  console.log(`image bytes=${buf.length} b64len=${b64.length}`);

  await call("generate+json", { model: "qwen2.5vl:3b", prompt: "Read this image. JSON only.", images: [b64], stream: false, format: "json", options: { temperature: 0 } });
  await call("generate+nojson", { model: "qwen2.5vl:3b", prompt: "What text do you see? Reply briefly.", images: [b64], stream: false, options: { temperature: 0 } });
  await call("generate+noimg", { model: "qwen2.5vl:3b", prompt: "Say hello.", stream: false, options: { temperature: 0 } });
  await call("chat+img", { model: "qwen2.5vl:3b", stream: false, messages: [{ role: "user", content: "What text do you see?", images: [b64] }] }, CHAT);
}
main().catch((e) => { console.error(e); process.exit(1); });
