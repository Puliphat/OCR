import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { CoaReportEntity } from "./CoaReportEntity";

// TODO: ยังไม่ active — เปิดใช้พร้อมกับ CoaReportEntity (ดู data-source.ts)
@Entity({ name: "coa_items" })
export class CoaItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => CoaReportEntity, (report) => report.items, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "report_id" })
  report!: CoaReportEntity;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", nullable: true })
  unit!: string | null;

  @Column({ type: "text", nullable: true })
  method!: string | null;

  @Column({ type: "double precision", nullable: true })
  min!: number | null;

  @Column({ type: "double precision", nullable: true })
  max!: number | null;

  @Column({ type: "double precision", nullable: true })
  result!: number | null;

  @Column({ type: "varchar", length: 8 })
  status!: "PASS" | "FAIL" | "SKIP";

  @Column({ type: "text", default: "" })
  reason!: string;

  @Column({ type: "text", nullable: true })
  specRaw!: string | null;

  @Column({ type: "text", nullable: true })
  resultRaw!: string | null;
}
