"use client";

import { useEffect, useState } from "react";
import { formatRemaining } from "@/lib/format";

/**
 * Live countdown to the poll end time, with an optional hairline showing how much
 * of the voting window has elapsed. Purely visual: the server decides when voting stops.
 */
export function Countdown({ endTime, startTime, onExpire }: { endTime: string; startTime?: string | null; onExpire?: () => void }) {
  const end = new Date(endTime).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= end) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [end, onExpire]);

  const remaining = end - now;
  const start = startTime ? new Date(startTime).getTime() : null;
  const elapsed = start && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null;

  return (
    <span className="inline-flex flex-col gap-2">
      <span className="font-mono text-sm tabular-nums text-ink">{remaining > 0 ? `Clôture dans ${formatRemaining(remaining)}` : "Délai écoulé"}</span>
      {elapsed !== null && (
        <span className="block h-px w-44 bg-rule" aria-hidden="true">
          <span className="block h-px bg-ink transition-[width] duration-1000 ease-linear" style={{ width: `${elapsed * 100}%` }} />
        </span>
      )}
    </span>
  );
}
