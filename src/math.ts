import type { Point, RawMetrics } from './types';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function robustMedian(values: number[]): number {
  if (values.length < 5) return median(values);
  const med = median(values);
  const deviations = values.map((value) => Math.abs(value - med));
  const mad = median(deviations) || 1e-6;
  const kept = values.filter((value) => Math.abs(value - med) <= mad * 3.5);
  return median(kept);
}

export class MetricsEma {
  private value?: RawMetrics;

  constructor(private readonly alpha: number) {}

  update(next: RawMetrics): RawMetrics {
    if (!this.value) {
      this.value = { ...next };
      return this.value;
    }
    const output = { ...next };
    for (const key of Object.keys(next) as (keyof RawMetrics)[]) {
      output[key] = this.alpha * next[key] + (1 - this.alpha) * this.value[key];
    }
    this.value = output;
    return output;
  }

  reset(): void {
    this.value = undefined;
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
