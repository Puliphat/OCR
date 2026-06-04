// หน้าหลัก COA UI — orchestrator เท่านั้น (state + mutation + ประกอบ component)
// UI แต่ละส่วนแยกไฟล์ที่ components/coa/*, สไตล์ที่ app/styles/*
// state: idle (empty) | idle (file picked) | analyzing (mutation pending) | done (data)
// เรียก POST /api/coa/upload ผ่าน react-query (lib/axios.ts baseURL = :3001)
"use client";

import { useRef, useState } from "react";
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
          <ResultsCard data={data} elapsedMs={elapsedMs} />
          <HelperBar variant="tip">
            Tip — failing parameters get a red pill, rows needing human review get an amber{" "}
            <strong>⚠ ต้องตรวจ</strong> pill, and rows that couldn&apos;t be evaluated get a muted SKIP pill. Hover a status pill for details.
          </HelperBar>
        </>
      )}
    </div>
  );
}
