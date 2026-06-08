// หน้าหลัก COA UI — orchestrator เท่านั้น (state + mutation + ประกอบ component)
// UI แต่ละส่วนแยกไฟล์ที่ components/coa/*, สไตล์ที่ app/styles/*
// state: idle (empty) | idle (file picked) | analyzing (mutation pending) | done (data)
// เรียก POST /api/coa/upload ผ่าน react-query (lib/axios.ts baseURL = :3001)
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { UploadResponse } from "@/lib/types";
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

  const mutation = useMutation<UploadResponse, Error, File>({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append("file", f);
      const start = performance.now();
      try {
        const res = await api.post<UploadResponse>("/api/coa/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return res.data;
      } finally {
        setElapsedMs(Math.round(performance.now() - start));
      }
    },
  });

  const { data, isPending, isError, error } = mutation;
  const mode: Mode = isPending ? "analyzing" : data ? "done" : "idle";

  // Auto-restart RapidOCR daemon when result used Tesseract fallback
  useEffect(() => {
    if (!data) return;
    const hasTesseract = data.reports.some((r) => r.ocrEngine === "tesseract");
    if (!hasTesseract) return;

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
  }, [data]);

  // Clear daemonStatus once re-upload finishes (new result won't have tesseract)
  useEffect(() => {
    if (daemonStatus === "uploading" && data && !data.reports.some((r) => r.ocrEngine === "tesseract")) {
      setDaemonStatus(null);
    }
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

      {/* error */}
      {isError && (
        <HelperBar variant="error" style={{ marginTop: 20 }}>
          {error?.message ?? "Something went wrong while analyzing."}
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
                daemonStatus={daemonStatus}
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
