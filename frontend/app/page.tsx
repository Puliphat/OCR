// หน้าหลัก COA UI — orchestrator เท่านั้น (state + mutation + ประกอบ component)
// UI แต่ละส่วนแยกไฟล์ที่ components/coa/*, สไตล์ที่ app/styles/*
// state: idle (empty) | idle (file picked) | analyzing (mutation pending) | done (data)
// เรียก POST /api/coa/upload ผ่าน react-query (lib/axios.ts baseURL = :3001)
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { UploadResponse, PipelineProgress } from "@/lib/types";
import Topbar from "@/components/coa/Topbar";
import Hero from "@/components/coa/Hero";
import UploadCard from "@/components/coa/UploadCard";
import EmptyState from "@/components/coa/EmptyState";
import HelperBar from "@/components/coa/HelperBar";
import ResultsCard from "@/components/coa/ResultsCard";

type Mode = "idle" | "analyzing" | "done";

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragover, setDragover] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<"restarting" | "uploading" | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [liveMs, setLiveMs] = useState(0); // นาฬิกาวิ่งระหว่างรอวิเคราะห์

  const mutation = useMutation<UploadResponse, Error, File>({
    mutationFn: async (f: File) => {
      const id = crypto.randomUUID();
      setJobId(id);
      const form = new FormData();
      form.append("file", f);
      form.append("jobId", id);
      const start = performance.now();
      try {
        const res = await api.post<UploadResponse>("/api/coa/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return res.data;
      } catch (e) {
        // axios ให้ message เป็น "Request failed with status code 500" — ข้อความจริงอยู่ใน body
        // ต้องดึงขึ้นมา ไม่งั้นหน้าเว็บบอกไม่ได้ว่า daemon ล่มหรือไฟล์มีปัญหา
        const detail = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
        throw new Error(detail || (e as Error).message);
      } finally {
        setElapsedMs(Math.round(performance.now() - start));
      }
    },
  });

  const { data, isPending, isError, error } = mutation;
  const mode: Mode = isPending ? "analyzing" : data ? "done" : "idle";

  // ระหว่างรอ: poll ขั้นที่ pipeline กำลังทำ ทุก ~0.45s เอามาโชว์ progress จริง
  const { data: progress } = useQuery<PipelineProgress | null>({
    queryKey: ["coa-progress", jobId],
    queryFn: async () =>
      (await api.get<{ progress: PipelineProgress | null }>(`/api/coa/progress/${jobId}`)).data.progress,
    enabled: isPending && !!jobId,
    refetchInterval: 450,
    gcTime: 0,
  });

  // นาฬิกาวิ่ง (0.1s tick) ระหว่าง analyzing
  useEffect(() => {
    if (!isPending) return;
    setLiveMs(0);
    const t0 = performance.now();
    const iv = setInterval(() => setLiveMs(performance.now() - t0), 100);
    return () => clearInterval(iv);
  }, [isPending]);

  // ★ daemon ล่ม → พังทั้ง request ★ (ไม่มี Tesseract fallback แล้ว — ผลเพี้ยนเงียบอันตรายกว่าพังดังๆ)
  //   สั่ง restart daemon + poll health + ยิงไฟล์เดิมซ้ำให้อัตโนมัติ. เงื่อนไขเดิมดูจาก ocrEngine ของ
  //   "ผลที่สำเร็จ" ซึ่งตอนนี้ไม่มีทางเกิด → ย้ายมาดูจาก error code ที่ backend ส่งมาแทน
  useEffect(() => {
    if (!isError || !error?.message.startsWith("OCR_DAEMON_DOWN")) return;

    // Clear any stale poll
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setDaemonStatus("restarting");

    // Fire restart — best-effort, no await
    api.post("/api/coa/ocr/restart").catch(() => undefined);

    let attempts = 0;
    const MAX_ATTEMPTS = 30;

    pollIntervalRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const res = await api.get<{ ok: boolean }>("/api/coa/ocr/daemon-health");
        if (res.data.ok) {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          setDaemonStatus("uploading");
          if (file) mutation.mutate(file);
        }
      } catch {
        // ignore transient health-check errors
      }
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(pollIntervalRef.current!);
        pollIntervalRef.current = null;
        setDaemonStatus(null);
      }
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, error]);

  // ยิงซ้ำสำเร็จแล้ว (มีผลออกมา) → เลิกโชว์สถานะ daemon
  useEffect(() => {
    if (daemonStatus === "uploading" && data) setDaemonStatus(null);
  }, [data, daemonStatus]);

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    mutation.reset();
    setElapsedMs(null);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0] ?? null);
  }
  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragover(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }
  function onDragOver(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragover(true);
  }
  function analyze() {
    if (file && !isPending) mutation.mutate(file);
  }
  function clearFile(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setFile(null);
    mutation.reset();
    setElapsedMs(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="app">
      <Topbar />
      <Hero />

      <UploadCard
        file={file}
        dragover={dragover}
        isPending={isPending}
        analyzing={mode === "analyzing"}
        progress={progress ?? null}
        liveMs={liveMs}
        inputRef={inputRef}
        onPick={onPick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragover(false)}
        onAnalyze={analyze}
        onClear={clearFile}
      />

      {/* empty state — ยังไม่ได้เลือกไฟล์ */}
      {mode === "idle" && !file && <EmptyState />}

      {/* file ready — nudge */}
      {mode === "idle" && file && !isError && (
        <HelperBar variant="ready" style={{ marginTop: 20 }}>
          <strong style={{ color: "var(--ink)" }}>{file.name}</strong> is ready. Hit{" "}
          <strong style={{ color: "var(--ink)" }}>Analyze</strong> to run it through the model.
        </HelperBar>
      )}

      {/* error — daemon ล่มแยกข้อความ + บอกว่ากำลังกู้ให้อัตโนมัติ (ผู้ใช้จะได้ไม่กด Analyze รัวๆ) */}
      {isError && (
        <HelperBar variant="error" style={{ marginTop: 20 }}>
          {error?.message.startsWith("OCR_DAEMON_DOWN") ? (
            <>
              <strong style={{ color: "var(--ink)" }}>OCR daemon ไม่ทำงาน</strong> — ไฟล์สแกนอ่านไม่ได้จนกว่าจะเริ่ม daemon
              {daemonStatus === "restarting" && " · กำลังสั่งเริ่มให้อัตโนมัติ…"}
              {daemonStatus === "uploading" && " · daemon ขึ้นแล้ว กำลังวิเคราะห์ใหม่…"}
              {daemonStatus === null && " · เริ่มเองได้ที่ backend: npm run ocr:daemon"}
            </>
          ) : (
            error?.message ?? "Something went wrong while analyzing."
          )}
        </HelperBar>
      )}

      {/* results */}
      {mode === "done" && data && (
        <>
          {data.reports.length > 1 && (
            <div
              style={{
                marginTop: 20,
                fontSize: 12,
                color: "var(--ink-3)",
                fontFamily: "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
                letterSpacing: "0.04em",
              }}
            >
              พบ {data.reports.length} lot/หน้า
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: data.reports.length > 1 ? 12 : 0 }}>
            {data.reports.map((rep, i) => (
              <ResultsCard
                key={i}
                report={rep}
                logFile={data.logFile}
                elapsedMs={i === 0 ? elapsedMs : null}
                index={i}
                total={data.reports.length}
              />
            ))}
          </div>
          <HelperBar variant="tip">
            Tip — failing parameters get a red pill, rows needing human review get an amber{" "}
            <strong>⚠ ต้องตรวจ</strong> pill, and rows that couldn&apos;t be evaluated get a muted SKIP pill. Hover a status pill for details.
          </HelperBar>
        </>
      )}
    </div>
  );
}
