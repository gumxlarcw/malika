"use client";

type JobLog = {
  ts: string;
  message: string;
  type: "ok" | "error" | "info";
};

type Props = {
  jobs: JobLog[];
};

export default function EximJobLog({ jobs }: Props) {
  if (jobs.length === 0) {
    return null;
  }

  return (
    <div className="rounded border border-border p-4 space-y-2 bg-muted/30">
      <h3 className="font-medium text-sm">EXIM Seed Job Log</h3>
      <div className="max-h-40 overflow-auto space-y-1 text-xs font-mono">
        {jobs.map((job, idx) => (
          <div key={idx} className="flex gap-2">
            <span className="text-muted-foreground w-16">[{job.ts}]</span>
            <span className={job.type === "ok" ? "text-emerald-600" : job.type === "error" ? "text-red-600" : "text-foreground"}>
              {job.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
