import "reflect-metadata";
import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { AppDataSource } from "./data-source";
import fs from "fs";
import coaRouter from "./routes/coa.routes";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

app.use("/api/coa", coaRouter);

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
