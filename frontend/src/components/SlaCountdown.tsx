import { useEffect, useState } from "react";

// Formats a millisecond duration as "HH:MM:SS remaining" (or "overdue" once
// negative) - matching the spec's own example display exactly.
function formatDuration(ms: number): string {
  const isNegative = ms < 0;
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return isNegative ? `overdue by ${clock}` : `${clock} remaining`;
}

// A ticking countdown - SLA remaining time isn't something the server can
// push updates for every second (that would be a lot of socket traffic for
// something the CLIENT can compute on its own from a fixed deadline). We
// just re-render once a second locally; the deadline itself still comes
// from the server and is the source of truth.
export function SlaCountdown({ deadline, breached }: { deadline: string; breached: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = new Date(deadline).getTime() - now;

  return (
    <span className={breached ? "font-medium text-red-600" : "text-slate-600"}>
      {formatDuration(remainingMs)}
    </span>
  );
}
