import "reflect-metadata";
import { DataSource } from "typeorm";
import * as dotenv from "dotenv";
// import { CoaReportEntity } from "./entities/CoaReportEntity";
// import { CoaItemEntity } from "./entities/CoaItemEntity";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "invoice_db",
  synchronize: true,
  logging: false,
  // เปิด persist COA: uncomment 2 import ข้างบน + 2 entry ข้างล่าง
  // synchronize: true จะสร้างตาราง coa_reports / coa_items ให้อัตโนมัติตอน start
  entities: [
    // CoaReportEntity,
    // CoaItemEntity,
  ],
  migrations: [],
  subscribers: [],
});
