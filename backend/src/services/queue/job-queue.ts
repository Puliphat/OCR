// คิวงานในหน่วยความจำ — รันทีละ CONCURRENCY งาน (default 1) เพราะคอขวดจริงมีตัวเดียว:
// OCR daemon มี lock เดียว + Ollama โมเดลเดียว → ยิงขนานไม่ได้เร็วขึ้น แต่ทำให้ทุกคนช้าเท่ากัน
//
// ตั้งใจไม่รู้จัก COA เลย (generic run/progress + hook กู้ระบบ) — ผู้เรียกฉีด logic เข้ามา
// ★ ไม่ persist ★ restart backend = คิวหาย ผู้ใช้อัปใหม่ (ตกลงไว้: process เดียว ไม่เอา Redis/BullMQ)
import * as crypto from "crypto";

export type JobState = "queued" | "running" | "done" | "error" | "canceled";

export type Job<R = unknown, P = unknown> = {
  id: string;
  label: string;
  state: JobState;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: P;
  result?: R;
  error?: string;
};

type RunFn<R, P> = (onProgress: (p: P) => void) => Promise<R>;

// job พังแล้วกู้ได้ไหม — true = ระบบพร้อมแล้ว ให้เอา job กลับไปหัวคิวลองใหม่
// ★ ระหว่างที่ hook นี้ทำงาน คิวถูก pause ★ ไม่งั้น job ที่เหลือจะพังไล่กันหมดด้วยเหตุเดียวกัน
export type RecoverFn = (error: string) => Promise<boolean>;

type JobRecord = Job<unknown, unknown> & {
  run: RunFn<unknown, unknown>;
  cleanup?: () => void; // เรียกตอน job ถูกกวาดทิ้ง/ยกเลิก (ผู้เรียกใช้ลบไฟล์ upload)
  retried?: boolean;
};

const CONCURRENCY = Number(process.env.COA_QUEUE_CONCURRENCY) || 1;
const DONE_TTL_MS = 10 * 60_000; // job ที่จบแล้วอยู่ต่ออีก 10 นาที (เผื่อ FE poll/refresh) แล้วกวาดทิ้ง
const ETA_WINDOW = 10; // ใช้เวลาของ job ที่เสร็จล่าสุดกี่ตัวมาเฉลี่ย
const ETA_MIN_SAMPLES = 3; // น้อยกว่านี้ = ไม่เดา (ไฟล์ 1 หน้า vs สแกน 5 หน้า ต่างกันเป็น 10 เท่า)

class JobQueue {
  private jobs = new Map<string, JobRecord>();
  private waiting: string[] = [];
  private running = 0;
  private paused = false;
  private durations: number[] = [];
  private recover: RecoverFn | null = null;

  // ฉีด logic กู้ระบบจากภายนอก (route ใส่ตัวที่รู้จัก OCR daemon)
  setRecover(fn: RecoverFn): void {
    this.recover = fn;
  }

  enqueue<R, P>(opts: {
    label: string;
    run: RunFn<R, P>;
    cleanup?: () => void;
  }): Job<R, P> {
    const job: JobRecord = {
      id: crypto.randomUUID(),
      label: opts.label,
      state: "queued",
      enqueuedAt: Date.now(),
      run: opts.run as RunFn<unknown, unknown>,
      cleanup: opts.cleanup,
    };
    this.jobs.set(job.id, job);
    this.waiting.push(job.id);
    this.sweep();
    this.pump();
    return job as Job<R, P>;
  }

  // งานที่มีผลอยู่แล้ว (cache hit) — ใส่เป็น job สถานะ done ทันที ไม่ต้องเข้าคิว
  // ทำแบบนี้เพื่อให้ frontend มี flow เดียว: ได้ jobId มาแล้ว poll เหมือนกันหมด
  addCompleted<R>(label: string, result: R): Job<R> {
    const now = Date.now();
    const job: JobRecord = {
      id: crypto.randomUUID(),
      label,
      state: "done",
      enqueuedAt: now,
      startedAt: now,
      finishedAt: now,
      result,
      run: async () => undefined,
    };
    this.jobs.set(job.id, job);
    return job as Job<R>;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }

  snapshot(): { running: number; waiting: number; paused: boolean } {
    return { running: this.running, waiting: this.waiting.length, paused: this.paused };
  }

  // ลำดับในคิว (1 = คิวถัดไป) — undefined เมื่อไม่ได้รออยู่
  position(id: string): number | undefined {
    const i = this.waiting.indexOf(id);
    return i < 0 ? undefined : i + 1;
  }

  // ประมาณเวลารอจนถึงคิวตัวเอง (วินาที) — undefined เมื่อยังไม่มีสถิติพอ ★ อย่าเดาเลขให้คนเชื่อผิด ★
  etaSec(id: string): number | undefined {
    const ahead = this.waiting.indexOf(id);
    if (ahead < 0) return undefined;
    if (this.durations.length < ETA_MIN_SAMPLES) return undefined;

    const avg = this.durations.reduce((a, b) => a + b, 0) / this.durations.length;
    // เวลาที่เหลือของงานที่รันอยู่ (ถ้ารันนานเกินค่าเฉลี่ยแล้วก็นับเป็น 0)
    let runningRemain = 0;
    for (const j of this.jobs.values()) {
      if (j.state !== "running" || !j.startedAt) continue;
      runningRemain = Math.max(runningRemain, Math.max(0, avg - (Date.now() - j.startedAt)));
    }
    return Math.max(1, Math.round((runningRemain + ahead * avg) / 1000));
  }

  // ยกเลิกได้เฉพาะงานที่ยังไม่เริ่ม — pipeline ไม่มี abort signal, งานที่รันอยู่หยุดกลางคันไม่ได้
  cancel(id: string): { ok: boolean; state?: JobState } {
    const job = this.jobs.get(id);
    if (!job) return { ok: false };
    if (job.state !== "queued") return { ok: false, state: job.state };

    const i = this.waiting.indexOf(id);
    if (i >= 0) this.waiting.splice(i, 1);
    job.state = "canceled";
    job.finishedAt = Date.now();
    job.cleanup?.();
    job.cleanup = undefined;
    return { ok: true, state: "canceled" };
  }

  private pump(): void {
    while (!this.paused && this.running < CONCURRENCY && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      const job = this.jobs.get(id);
      if (!job || job.state !== "queued") continue;

      // ★ ตั้ง running แบบ synchronous ก่อน await ใดๆ ★ — ไม่งั้น cancel ที่มาถึงระหว่างนั้น
      //   จะเห็นสถานะ queued แล้วยกเลิกงานที่เริ่มไปแล้ว
      job.state = "running";
      job.startedAt = Date.now();
      job.progress = undefined;
      this.running++;
      void this.execute(job);
    }
  }

  private async execute(job: JobRecord): Promise<void> {
    let requeued = false;
    try {
      job.result = await job.run((p) => {
        job.progress = p;
      });
      job.state = "done";
      this.durations.push(Date.now() - (job.startedAt ?? Date.now()));
      if (this.durations.length > ETA_WINDOW) this.durations.shift();
    } catch (e) {
      const msg = (e as Error).message;
      job.state = "error";
      job.error = msg;

      // ★ กันคิวไหม้ทั้งแถว ★ — ถ้าเหตุพังเป็นเรื่องของ "ระบบล่ม" (เช่น OCR daemon) การปล่อยให้ job
      //   ถัดไปเริ่มทันทีคือทำให้ทั้งคิวพังใน 3 วินาที. หยุดคิว → กู้ → เอา job นี้กลับไปหัวคิว
      //   ลองใหม่ครั้งเดียว (retried flag) ไม่วนไม่รู้จบ
      if (!job.retried && this.recover) {
        job.retried = true;
        this.paused = true;
        let recovered = false;
        try {
          recovered = await this.recover(msg);
        } catch {
          recovered = false;
        }
        this.paused = false;
        if (recovered) {
          job.state = "queued";
          job.error = undefined;
          job.progress = undefined;
          job.startedAt = undefined;
          this.waiting.unshift(job.id);
          requeued = true;
        }
      }
    } finally {
      if (!requeued) job.finishedAt = Date.now();
      this.running--;
      this.sweep();
      this.pump();
    }
  }

  // กวาด job ที่จบไปนานแล้ว + ลบไฟล์ที่ผูกไว้ (ไม่งั้น uploads/ บวมเรื่อยๆ)
  private sweep(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.state === "queued" || job.state === "running") continue;
      if (now - (job.finishedAt ?? job.enqueuedAt) < DONE_TTL_MS) continue;
      job.cleanup?.();
      this.jobs.delete(id);
    }
  }
}

export const jobQueue = new JobQueue();
