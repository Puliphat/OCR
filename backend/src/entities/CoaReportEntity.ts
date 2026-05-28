import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { CoaItemEntity } from "./CoaItemEntity";

// TODO: ยังไม่ active — uncomment import + entry ใน data-source.ts:entities เพื่อเปิดใช้
//        synchronize: true จะสร้างตารางอัตโนมัติตอน start
@Entity({ name: "coa_reports" })
export class CoaReportEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  filename!: string;

  @Column({ type: "text", nullable: true })
  product!: string | null;

  @Column({ type: "text", nullable: true })
  lotNo!: string | null;

  @Column({ type: "int", default: 0 })
  passCount!: number;

  @Column({ type: "int", default: 0 })
  failCount!: number;

  @Column({ type: "int", default: 0 })
  skipCount!: number;

  @Column({ type: "int", default: 0 })
  totalCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => CoaItemEntity, (item) => item.report, {
    cascade: true,
    eager: true,
  })
  items!: CoaItemEntity[];
}
