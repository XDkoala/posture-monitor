import { POSE } from './config';
import { distance, median } from './math';
import type { Point } from './types';

const TRACKED_LANDMARKS = [0, 7, 8, 11, 12, 23, 24] as const;

interface MovementSample {
  timestamp: number;
  shoulderWidth: number;
  points: Point[];
}

export interface MovementReading {
  rawScore: number;
  filteredScore: number;
  frameDeltaMs: number;
  consecutiveFrames: number;
  active: boolean;
  comparable: boolean;
}

const idleReading = (frameDeltaMs = 0): MovementReading => ({
  rawScore: 0,
  filteredScore: 0,
  frameDeltaMs,
  consecutiveFrames: 0,
  active: false,
  comparable: false,
});

/**
 * Detects deliberate whole-upper-body movement without treating a single noisy
 * pose metric as motion. Displacements are normalized by shoulder width and
 * combined with a median so one unstable landmark cannot dominate the result.
 */
export class MovementDetector {
  private previous?: MovementSample;
  private filteredScore = 0;
  private consecutiveFrames = 0;
  private activeUntil = 0;

  update(points: Point[], timestamp: number): MovementReading {
    const tracked = TRACKED_LANDMARKS.map((index) => points[index]);
    const leftShoulder = points[11];
    const rightShoulder = points[12];
    if (tracked.some((point) => !point) || !leftShoulder || !rightShoulder) {
      this.reset();
      return idleReading();
    }

    const shoulderWidth = Math.max(distance(leftShoulder, rightShoulder), 0.055);
    const current: MovementSample = {
      timestamp,
      shoulderWidth,
      points: tracked.map((point) => ({ x: point.x, y: point.y })),
    };
    const previous = this.previous;
    this.previous = current;
    if (!previous) return idleReading();

    const frameDeltaMs = timestamp - previous.timestamp;
    if (frameDeltaMs <= 0 || frameDeltaMs > POSE.movementMaxFrameGapMs) {
      this.filteredScore = 0;
      this.consecutiveFrames = 0;
      this.activeUntil = 0;
      return idleReading(frameDeltaMs);
    }

    const scale = Math.max((shoulderWidth + previous.shoulderWidth) / 2, 0.055);
    const displacements = current.points.map((point, index) => distance(point, previous.points[index]) / scale);
    const rawScore = median(displacements);
    this.filteredScore = POSE.movementEmaAlpha * rawScore + (1 - POSE.movementEmaAlpha) * this.filteredScore;

    if (rawScore >= POSE.movementImmediateThreshold) {
      this.consecutiveFrames = POSE.movementConfirmFrames;
      this.activeUntil = timestamp + POSE.movementHoldMs;
    } else if (rawScore >= POSE.movementEnterThreshold) {
      this.consecutiveFrames += 1;
      if (this.consecutiveFrames >= POSE.movementConfirmFrames) {
        this.activeUntil = timestamp + POSE.movementHoldMs;
      }
    } else if (rawScore < POSE.movementExitThreshold) {
      this.consecutiveFrames = 0;
    } else {
      this.consecutiveFrames = Math.max(0, this.consecutiveFrames - 1);
    }

    if (timestamp < this.activeUntil && this.filteredScore >= POSE.movementExitThreshold) {
      this.activeUntil = Math.max(this.activeUntil, timestamp + 120);
    }

    return {
      rawScore,
      filteredScore: this.filteredScore,
      frameDeltaMs,
      consecutiveFrames: this.consecutiveFrames,
      active: timestamp < this.activeUntil,
      comparable: true,
    };
  }

  reset(): void {
    this.previous = undefined;
    this.filteredScore = 0;
    this.consecutiveFrames = 0;
    this.activeUntil = 0;
  }
}
