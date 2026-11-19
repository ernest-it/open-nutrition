import { useState } from 'react';
import { N, statusFor } from '@open-nutrition/shared';
import { fmt, kcal, useElementWidth } from './ui';

/** Calorie ring: sized from its container's measured width (capped), never fixed pixels. */
export function CalorieRing({ eaten, budget, max = 240 }: { eaten: number; budget: number; max?: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const size = Math.max(120, Math.min(max, width || max));
  const stroke = Math.max(10, Math.round(size * 0.085));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = budget > 0 ? eaten / budget : 0;
  // "kcal over" is plain arithmetic; the red colour follows the shared calorie band (over 110%), like every other status.
  const over = budget > 0 && eaten > budget;
  const status = statusFor(N.energy, eaten, budget);
  const remaining = Math.round(budget - eaten);
  return (
    <div ref={ref} className="ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={budget > 0 ? `${kcal(eaten)} of ${kcal(budget)} kcal eaten` : `${kcal(eaten)} kcal eaten`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className={`ring-fill ${status ?? ''}`}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${Math.min(1, frac) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="46%" textAnchor="middle" className="ring-big" style={{ fontSize: size * 0.17 }}>
          {budget > 0 ? kcal(Math.abs(remaining)) : kcal(eaten)}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="ring-small" style={{ fontSize: Math.max(11, size * 0.065) }}>
          {budget > 0 ? (over ? 'kcal over' : 'kcal left') : 'kcal eaten'}
        </text>
      </svg>
    </div>
  );
}

export interface WeightPoint {
  takenAt: number;
  value: number;
  trend: number;
}

/** Weight chart: raw readings as dots, 7-day moving average as a line, optional goal line. Responsive via ResizeObserver. */
export function WeightChart({ points, goal, unit }: { points: WeightPoint[]; goal: number | null; unit: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(200, width || 300);
  const H = Math.round(Math.max(180, Math.min(320, W * 0.45)));
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  if (points.length < 2)
    return (
      <div ref={ref} className="chart-empty">
        Log at least two weigh-ins to see your trend.
      </div>
    );
  const xs = points.map((p) => p.takenAt);
  const ys = points.flatMap((p) => [p.value, p.trend]).concat(goal != null ? [goal] : []);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const span = y1 - y0 || 1;
  y0 -= span * 0.08;
  y1 += span * 0.08;
  const sx = (x: number) => padL + ((x - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const sy = (y: number) => padT + (1 - (y - y0) / (y1 - y0 || 1)) * (H - padT - padB);
  const trendPath = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.takenAt).toFixed(1)},${sy(p.trend).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((f) => y0 + (y1 - y0) * f);
  const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hp = hover != null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(sx(p.takenAt) - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  }

  return (
    <div ref={ref} className="chart-wrap">
      <div className="legend">
        <span>
          <i className="lg-dot" /> Weigh-ins
        </span>
        <span>
          <i className="lg-line" /> 7-day average
        </span>
        {goal != null && (
          <span>
            <i className="lg-goal" /> Goal
          </span>
        )}
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={`Weight trend chart: ${points.length} weigh-ins from ${fmtDate(x0)} to ${fmtDate(x1)}, latest 7-day average ${fmt(points[points.length - 1]!.trend, 1, true)} ${unit}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={padL - 6} y={sy(t) + 4} textAnchor="end" className="tick">
              {fmt(t, 1)}
            </text>
          </g>
        ))}
        <text x={padL} y={H - 6} className="tick">
          {fmtDate(x0)}
        </text>
        <text x={W - padR} y={H - 6} textAnchor="end" className="tick">
          {fmtDate(x1)}
        </text>
        {goal != null && <line x1={padL} x2={W - padR} y1={sy(goal)} y2={sy(goal)} className="goal" />}
        {points.map((p, i) => (
          <circle key={i} cx={sx(p.takenAt)} cy={sy(p.value)} r={points.length > 120 ? 2.5 : 4} className="raw" />
        ))}
        <path d={trendPath} className="trend" />
        {hp && (
          <g>
            <line x1={sx(hp.takenAt)} x2={sx(hp.takenAt)} y1={padT} y2={H - padB} className="crosshair" />
            <circle cx={sx(hp.takenAt)} cy={sy(hp.trend)} r={5} className="trend-dot" />
          </g>
        )}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(Math.max(sx(hp.takenAt), 70), W - 70) }}>
          <strong>{new Date(hp.takenAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
          <span>
            {fmt(hp.value, 1, true)} {unit} · 7-day avg {fmt(hp.trend, 1, true)}
          </span>
        </div>
      )}
    </div>
  );
}
