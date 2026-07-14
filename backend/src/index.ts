// Entry ของ backend — เปิด Express, mount COA route, แล้วค่อย init TypeORM
// แก้ middleware / mount route ใหม่ที่นี่ (route logic อยู่ใน routes/coa.routes.ts)
import "reflect-metadata";
import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { AppDataSource } from "./data-source";
import fs from "fs";
import coaRouter from "./routes/coa.routes";
import { startOllamaKeepWarm } from "./services/coa/ollama-coa.service";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

app.use("/api/coa", coaRouter);

// คง qwen3 อุ่นใน VRAM (warm ทันที + ping ทุก 8 นาที) — ตัด ~37s model reload ที่ user เจอตอน
// upload แรกหลัง server idle. ปิดด้วย OLLAMA_KEEP_WARM=false
startOllamaKeepWarm();

// DB ยังไม่ได้ใช้ persist อะไร (entities ว่าง + route ยัง comment block save ไว้)
// เปิด DB ตอนพร้อม persist: ใส่ ENABLE_DB=true ใน .env + เปิด entities ใน data-source.ts
if (process.env.ENABLE_DB === "true") {
  AppDataSource.initialize()
    .then(() => {
      console.log("Data Source has been initialized!");
      app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
      });
    })
    .catch((err) => {
      console.error("Error during Data Source initialization:", err);
    });
} else {
  app.listen(port, () => {
    console.log(`Server is running on port ${port} (DB disabled)`);
  });
}
