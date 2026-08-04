// บรรทัดเดียวบอกภาระของระบบตอนนี้ — ซ่อนเองเมื่อไม่มีงาน (คนใช้คนเดียวจะไม่เห็นเลย)
import { QueueSnapshot } from "@/lib/types";

export default function QueueBanner({ snapshot }: { snapshot: QueueSnapshot | null }) {
  if (!snapshot) return null;
  const { running, waiting, paused } = snapshot;
  if (!paused && running + waiting === 0) return null;

  return (
    <div className="queue-banner mono">
      {paused
        ? "ระบบกำลังกู้ตัวอ่านไฟล์ — งานในคิวหยุดรอชั่วคราว"
        : `ระบบกำลังทำ ${running} งาน${waiting > 0 ? ` · รออีก ${waiting} งาน` : ""}`}
    </div>
  );
}
