import type { CSSProperties } from "react";

/*
 * Print ornaments. The khatam (8-point star of Moroccan zellige) is used the way
 * printers use a fleuron: a small dingbat that closes a section or centres a rule.
 */

export function khatamPoints(cx: number, cy: number, r: number, inner = 0.7654) {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const radius = i % 2 === 0 ? r : r * inner;
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(" ");
}

export function Fleuron({ size = 12, className, outline = false, style }: { size?: number; className?: string; outline?: boolean; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <polygon points={khatamPoints(12, 12, 11)} fill={outline ? "none" : "currentColor"} stroke="currentColor" strokeWidth={outline ? 1.2 : 0} strokeLinejoin="round" />
      {!outline && <polygon points={khatamPoints(12, 12, 5.5)} fill="#f5f0e6" />}
    </svg>
  );
}

/** Thick-and-thin double rule, the classic newspaper separator. */
export function DoubleRule({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="h-[3px] bg-ink" />
      <div className="mt-[3px] h-px bg-ink" />
    </div>
  );
}

/** Hairline — fleuron — hairline. Closes a section. */
export function FleuronRule({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 text-umber ${className ?? ""}`} aria-hidden="true">
      <span className="h-px flex-1 bg-rule" />
      <Fleuron size={11} />
      <span className="h-px flex-1 bg-rule" />
    </div>
  );
}

/** Loading indicator: a rule being "printed" across the line. */
export function PressLoader({ label = "Mise sous presse" }: { label?: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3">
      <span className="block h-px w-40 overflow-hidden bg-rule">
        <span className="animate-press block h-full w-full bg-ink" />
      </span>
      <span className="kicker text-umber">{label}…</span>
    </div>
  );
}
