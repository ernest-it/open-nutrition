import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from './ui';

/** Measure the width a chart may use (charts never use fixed pixel sizes). */
export function useMeasuredWidth(initial = 0): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

/**
 * Calorie ring: the arc is the share of the budget eaten; going over draws the overflow in the
 * danger colour on top. Sized from the measured container width (capped by `max`).
 */
export function CalorieRing({ eaten, budget, max = 240 }: { eaten: number; budget: number; max?: number }) {
  const t = useTheme();
  const [width, onLayout] = useMeasuredWidth();
  const size = Math.max(120, Math.min(max, width));
  const stroke = Math.max(10, size * 0.085);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = budget > 0 ? eaten / budget : 0;
  const main = Math.min(1, share);
  const over = share > 1 ? Math.min(1, share - 1) : 0;
  const remaining = Math.round(budget - eaten);
  const overBudget = remaining < 0;
  return (
    <View onLayout={onLayout} style={{ width: '100%', alignItems: 'center' }}>
      {width > 0 && (
        <View
          style={{ width: size, height: size }}
          accessible
          accessibilityRole="image"
          accessibilityLabel={
            budget > 0
              ? `${Math.round(eaten)} of ${Math.round(budget)} calories eaten, ${Math.abs(remaining)} ${overBudget ? 'over' : 'remaining'}`
              : `${Math.round(eaten)} calories eaten`
          }
        >
          <Svg width={size} height={size}>
            <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.track} strokeWidth={stroke} fill="none" />
              {main > 0 && (
                <Circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={overBudget ? t.warn : t.accent}
                  strokeWidth={stroke}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${c * main} ${c}`}
                />
              )}
              {over > 0 && (
                <Circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={t.danger}
                  strokeWidth={stroke}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${c * over} ${c}`}
                />
              )}
            </G>
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: stroke * 1.6 }}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.2}
              style={{ color: overBudget ? t.danger : t.text, fontSize: size * 0.2, fontWeight: '800' }}
            >
              {budget > 0 ? Math.abs(remaining).toLocaleString() : Math.round(eaten).toLocaleString()}
            </Text>
            <Text numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2} style={{ color: t.muted, fontSize: Math.max(12, size * 0.065) }}>
              {budget > 0 ? (overBudget ? 'kcal over' : 'kcal left') : 'kcal eaten'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

export interface SeriesPoint {
  x: number; // epoch ms
  y: number;
}

/**
 * Line chart for body weight: raw points as dots, the moving-average trend as a line, and an
 * optional dashed goal line. Width comes from the layout; height scales with it.
 */
export function TrendChart({
  points,
  trend,
  goal,
  unit,
  format,
}: {
  points: SeriesPoint[];
  trend: SeriesPoint[];
  goal?: number | null;
  unit: string;
  format: (v: number) => string;
}) {
  const t = useTheme();
  const [width, onLayout] = useMeasuredWidth();
  const height = Math.round(Math.max(160, Math.min(320, width * 0.55)));
  const padL = 44;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  if (!points.length) return <View onLayout={onLayout} style={{ height: 1 }} />;
  const xs = points.map((p) => p.x);
  const ys = [...points.map((p) => p.y), ...trend.map((p) => p.y), ...(goal != null ? [goal] : [])];
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  if (maxX - minX < 86_400_000) {
    minX -= 43_200_000;
    maxX += 43_200_000;
  }
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const spread = Math.max(1, maxY - minY);
  minY -= spread * 0.1;
  maxY += spread * 0.1;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = height - padT - padB;
  const sx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
  const sy = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * plotH;
  const ticks = [0, 0.5, 1].map((f) => minY + f * (maxY - minY));
  const line = trend.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const dot = Math.max(2.5, Math.min(4, 300 / points.length));
  const dateLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const last = trend[trend.length - 1];
  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Weight trend. Latest trend ${last ? format(last.y) : ''} ${unit}${goal != null ? `, goal ${format(goal)} ${unit}` : ''}.`}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((v, i) => (
            <G key={i}>
              <Line x1={padL} x2={width - padR} y1={sy(v)} y2={sy(v)} stroke={t.border} strokeWidth={1} />
              <SvgText x={padL - 6} y={sy(v) + 4} fontSize={11} fill={t.muted} textAnchor="end">
                {format(v)}
              </SvgText>
            </G>
          ))}
          {goal != null && goal >= minY && goal <= maxY && (
            <G>
              <Line x1={padL} x2={width - padR} y1={sy(goal)} y2={sy(goal)} stroke={t.success} strokeWidth={1.5} strokeDasharray="6 4" />
              <SvgText x={width - padR} y={sy(goal) - 4} fontSize={11} fill={t.success} textAnchor="end">
                goal
              </SvgText>
            </G>
          )}
          {points.map((p, i) => (
            <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={dot} fill={t.muted} opacity={0.55} />
          ))}
          {trend.length > 1 && <Path d={line} stroke={t.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
          <SvgText x={padL} y={height - 6} fontSize={11} fill={t.muted} textAnchor="start">
            {dateLabel(minX)}
          </SvgText>
          <SvgText x={width - padR} y={height - 6} fontSize={11} fill={t.muted} textAnchor="end">
            {dateLabel(maxX)}
          </SvgText>
        </Svg>
      )}
    </View>
  );
}

/** Simple vertical bars (e.g. calories per day of a week) with an optional target line. */
export function DailyBars({ values, labels, target, color }: { values: number[]; labels: string[]; target?: number | null; color: string }) {
  const t = useTheme();
  const [width, onLayout] = useMeasuredWidth();
  const height = Math.round(Math.max(110, Math.min(200, width * 0.35)));
  const padB = 18;
  const max = Math.max(1, ...values, target ?? 0) * 1.1;
  const n = values.length;
  const slot = n ? width / n : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const sy = (v: number) => (height - padB) * (1 - v / max);
  const every = Math.ceil(n / Math.max(1, Math.floor(width / 34)));
  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {values.map((v, i) => (
            <Rect
              key={i}
              x={i * slot + (slot - barW) / 2}
              y={sy(v)}
              width={barW}
              height={Math.max(0, height - padB - sy(v))}
              rx={Math.min(4, barW / 2)}
              fill={target && v > target * 1.05 ? t.warn : color}
            />
          ))}
          {target != null && target > 0 && (
            <Line x1={0} x2={width} y1={sy(target)} y2={sy(target)} stroke={t.muted} strokeDasharray="4 4" strokeWidth={1} />
          )}
          {labels.map((l, i) =>
            i % every === 0 ? (
              <SvgText key={i} x={i * slot + slot / 2} y={height - 4} fontSize={10} fill={t.muted} textAnchor="middle">
                {l}
              </SvgText>
            ) : null,
          )}
        </Svg>
      )}
    </View>
  );
}
