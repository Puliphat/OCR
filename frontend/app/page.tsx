// หน้าหลัก COA UI — orchestrator เท่านั้น (state + mutation + ประกอบ component)
// UI แต่ละส่วนแยกไฟล์ที่ components/coa/*, สไตล์ที่ app/styles/*
// flow: เลือกไฟล์ → POST /api/coa/upload คืน jobId ทันที (งานเข้าคิวที่ backend) → poll
//       GET /api/coa/jobs?ids= จนทุกงานจบ. รันทีละงานเพราะ OCR/LLM มีตัวเดียว
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { EnqueueResponse, JobStatus, QueueSnapshot } from "@/lib/types";
import Topbar from "@/components/coa/Topbar";
import Hero from "@/components/coa/Hero";
import UploadCard from "@/components/coa/UploadCard";
import EmptyState from "@/components/coa/EmptyState";
import HelperBar from "@/components/coa/HelperBar";
import JobCard from "@/components/coa/JobCard";
import QueueBanner from "@/components/coa/QueueBanner";

const SESSION_KEY = "coa-job-ids";
const MAX_FILES = 20; // ตรงกับ upload.array("file", 20) ที่ backend

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragover, setDragover] = useState(false);
  const [jobIds, setJobIds] = useState<string[]>([]);
  // ★ เก็บสถานะงานไว้เอง ไม่ derive จาก poll ตรงๆ ★ — backend กวาด job ทิ้งหลัง 10 นาที
  //   ถ้าผูกกับ response ล้วน ผลที่คนกำลังอ่านอยู่จะหายจากจอเอง
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [rejected, setRejected] = useState<EnqueueResponse["rejected"]>([]);
  const [liveMs, setLiveMs] = useState(0); // นาฬิกาวิ่งตั้งแต่กดวิเคราะห์ (รวมเวลารอคิว)

  // refresh แล้วยังตามงานของตัวเองต่อได้ (คนละเรื่องกับ queue banner ที่นับงานทุกคน)
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        setJobIds(JSON.parse(saved));
      } catch {
        /* ของเก่าอ่านไม่ออกก็เริ่มใหม่ */
      }
    }
  }, []);
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(jobIds));
  }, [jobIds]);

  const ordered = jobIds.map((id) => jobs[id]).filter(Boolean);
  const active = ordered.some((j) => j.state === "queued" || j.state === "running");
  const waitingForFirstStatus = jobIds.length > 0 && ordered.length === 0;
  const busy = active || waitingForFirstStatus;

  const mutation = useMutation<EnqueueResponse, Error, File[]>({
    mutationFn: async (list: File[]) => {
      const form = new FormData();
      for (const f of list) form.append("file", f);
      try {
        const res = await api.post<EnqueueResponse>("/api/coa/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return res.data;
      } catch (e) {
        // axios ให้ message เป็น "Request failed with status code 400" — ข้อความจริงอยู่ใน body
        const detail = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        throw new Error(detail || (e as Error).message);
      }
    },
    onSuccess: (data) => {
      setRejected(data.rejected ?? []);
      setJobIds(data.jobs.map((j) => j.jobId));
      setJobs(
        Object.fromEntries(
          data.jobs.map((j) => [j.jobId, { jobId: j.jobId, filename: j.filename, state: "queued" as const }])
        )
      );
    },
  });

  // poll สถานะทุกงานพร้อมกันครั้งเดียว — merge ทับของเดิม (งานที่หายไปแล้วคงผลไว้)
  useQuery({
    queryKey: ["coa-jobs", jobIds],
    queryFn: async () => {
      const res = await api.get<{ jobs: JobStatus[] }>(`/api/coa/jobs?ids=${jobIds.join(",")}`);
      setJobs((prev) => {
        const next = { ...prev };
        for (const j of res.data.jobs) next[j.jobId] = j;
        return next;
      });
      return res.data.jobs;
    },
    enabled: busy && jobIds.length > 0,
    refetchInterval: 700,
    gcTime: 0,
  });

  // ภาระรวมของระบบ (นับงานของทุกคน) — ดึงเฉพาะตอนมีงานของเราค้างอยู่
  const { data: queueSnapshot } = useQuery<QueueSnapshot>({
    queryKey: ["coa-queue"],
    queryFn: async () => (await api.get<QueueSnapshot>("/api/coa/queue")).data,
    enabled: busy,
    refetchInterval: 2000,
    gcTime: 0,
  });

  // นาฬิกาวิ่ง (0.1s tick) ระหว่างยังมีงานค้าง
  useEffect(() => {
    if (!busy) return;
    setLiveMs(0);
    const t0 = performance.now();
    const iv = setInterval(() => setLiveMs(performance.now() - t0), 100);
    return () => clearInterval(iv);
  }, [busy]);

  async function cancelJob(jobId: string) {
    try {
      await api.delete(`/api/coa/jobs/${jobId}`);
    } catch {
      /* ยกเลิกไม่สำเร็จ = งานเริ่มไปแล้ว สถานะรอบหน้าจะบอกเอง */
    }
    setJobs((prev) => ({ ...prev, [jobId]: { ...prev[jobId], state: "canceled" } }));
  }

  // เลือกหลายรอบได้ (browse ทีละชุด / ลากมาวางเพิ่ม) — สะสมไว้แล้วค่อยกด Analyze ทีเดียว
  // ซ้ำ = ไฟล์เดิม (ชื่อ+ขนาด+เวลาแก้ล่าสุด) ข้ามไป ไม่ให้เข้าคิวสองรอบ
  function pickFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      const fresh = picked.filter((f) => !seen.has(`${f.name}|${f.size}|${f.lastModified}`));
      return [...prev, ...fresh].slice(0, MAX_FILES);
    });
    setJobIds([]);
    setJobs({});
    setRejected([]);
    mutation.reset();
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragover(false);
    pickFiles(e.dataTransfer.files);
  }
  function onDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragover(true);
  }
  function analyze() {
    if (files.length > 0 && !busy) mutation.mutate(files);
  }
  function clearFiles(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFiles([]);
    setJobIds([]);
    setJobs({});
    setRejected([]);
    mutation.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  const nothingYet = ordered.length === 0 && files.length === 0 && !mutation.isError;

  return (
    <div className="app">
      <Topbar />
      <Hero />

      <QueueBanner snapshot={busy ? queueSnapshot ?? null : null} />

      <UploadCard
        files={files}
        dragover={dragover}
        busy={busy}
        inputRef={inputRef}
        onPick={(e) => {
          pickFiles(e.target.files);
          e.target.value = ""; // เคลียร์ทิ้ง ไม่งั้นเลือกไฟล์เดิมซ้ำหลังลบออกแล้ว onChange ไม่ยิง
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragover(false)}
        onAnalyze={analyze}
        onClear={clearFiles}
        onRemove={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />

      {/* empty state — ยังไม่ได้เลือกไฟล์ */}
      {nothingYet && <EmptyState />}

      {/* file ready — nudge */}
      {files.length > 0 && ordered.length === 0 && !busy && !mutation.isError && (
        <HelperBar variant="ready" style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--ink)" }}>
            {files.length === 1 ? files[0].name : `${files.length} ไฟล์`}
          </strong>{" "}
          พร้อมแล้ว กด <strong style={{ color: "var(--ink)" }}>Analyze</strong> เพื่อส่งเข้าระบบ
        </HelperBar>
      )}

      {/* ไฟล์ที่ระบบไม่รับ (นามสกุลไม่รองรับ) — ไฟล์ที่เหลือยังเข้าคิวตามปกติ */}
      {rejected.length > 0 && (
        <HelperBar variant="error" style={{ marginTop: 20 }}>
          ข้ามไป {rejected.length} ไฟล์ — {rejected.map((r) => `${r.filename} (${r.reason})`).join(", ")}
        </HelperBar>
      )}

      {/* อัปโหลดไม่สำเร็จตั้งแต่ต้น (ยังไม่ได้เข้าคิว) */}
      {mutation.isError && (
        <HelperBar variant="error" style={{ marginTop: 20 }}>
          {mutation.error?.message ?? "ส่งไฟล์ไม่สำเร็จ"}
        </HelperBar>
      )}

      {/* งานของเรา — เรียงตามลำดับที่ส่ง ไม่สลับที่ระหว่างทาง (การ์ดจะได้ไม่กระโดด) */}
      {ordered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 20 }}>
          {ordered.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              liveMs={liveMs}
              elapsedMs={job.durationMs ?? null}
              showHead={ordered.length > 1}
              onCancel={cancelJob}
            />
          ))}
        </div>
      )}

      {ordered.some((j) => j.state === "done") && (
        <HelperBar variant="tip">
          Tip — ผลมี 3 แบบเท่านั้น: <strong>ผ่าน</strong> (เขียว),{" "}
          <strong>⚠ ผ่าน · ต้องตรวจ</strong> (เหลือง — ระบบยังยืนยันเองไม่ได้ ต้องเทียบกับใบจริง) และ{" "}
          <strong>ไม่ผ่าน</strong> (แดง) · ชี้ที่ป้ายสถานะเพื่อดูเหตุผล
        </HelperBar>
      )}
    </div>
  );
}
