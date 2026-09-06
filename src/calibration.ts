import { POSE } from './config';
import { robustMedian } from './math';
import type { CalibrationProfile, RawMetrics } from './types';

export class Calibrator {
  private samples: RawMetrics[] = [];
  private startedAt = 0;

  start(now = performance.now()): void {
    this.samples = [];
    this.startedAt = now;
  }

  add(metrics: RawMetrics): void {
    if (metrics.confidence >= POSE.confidenceThreshold && metrics.movement < POSE.movementEnterThreshold) {
      this.samples.push(metrics);
    }
  }

  get progress(): number {
    if (!this.startedAt) return 0;
    return Math.min(1, (performance.now() - this.startedAt) / POSE.calibrationMs);
  }

  get ready(): boolean {
    return this.progress >= 1;
  }

  finish(): CalibrationProfile | null {
    if (this.samples.length < POSE.minimumCalibrationSamples) return null;
    const keys: (keyof RawMetrics)[] = [
      'shoulderTilt', 'hipTilt', 'torsoLean', 'shoulderHipDistance', 'headShoulderOffsetX',
      'headShoulderOffsetY', 'headScale', 'shoulderWidth', 'confidence', 'movement',
    ];
    const result = Object.fromEntries(keys.map((key) => [key, robustMedian(this.samples.map((sample) => sample[key]))])) as unknown as RawMetrics;
    return { ...result, timestamp: Date.now(), sampleCount: this.samples.length };
  }
}
