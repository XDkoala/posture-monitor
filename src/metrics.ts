import { clamp, distance, midpoint } from './math';
import type { CalibrationProfile, ClassifiedPosture, Point, PoseFrame, RawMetrics, ScoredMetrics, Sensitivity, Severity } from './types';
import { THRESHOLDS } from './config';

export const LANDMARK = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
} as const;

const visibility = (point: Point) => Math.min(point.visibility ?? 1, point.presence ?? 1);

export function computeRawMetrics(frame: PoseFrame): RawMetrics | null {
  const p = frame.points;
  const required = [p[0], p[7], p[8], p[11], p[12], p[23], p[24]];
  if (required.some((point) => !point)) return null;

  const [nose, leftEar, rightEar, leftShoulder, rightShoulder, leftHip, rightHip] = required;
  const confidence = required.reduce((sum, point) => sum + visibility(point), 0) / required.length;
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  if (shoulderWidth < 0.055) return null;

  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const hipCenter = midpoint(leftHip, rightHip);
  const torsoSize = Math.max(distance(shoulderCenter, hipCenter), shoulderWidth * 0.75, 0.01);
  const headCenter = midpoint(leftEar, rightEar);
  const eyeWidth = p[2] && p[5] ? distance(p[2], p[5]) : distance(leftEar, rightEar) * 0.55;

  const raw: RawMetrics = {
    shoulderTilt: (leftShoulder.y - rightShoulder.y) / shoulderWidth,
    hipTilt: (leftHip.y - rightHip.y) / Math.max(distance(leftHip, rightHip), 0.01),
    torsoLean: (shoulderCenter.x - hipCenter.x) / torsoSize,
    shoulderHipDistance: torsoSize / shoulderWidth,
    headShoulderOffsetX: (headCenter.x - shoulderCenter.x) / shoulderWidth,
    headShoulderOffsetY: (shoulderCenter.y - nose.y) / shoulderWidth,
    headScale: eyeWidth / shoulderWidth,
    shoulderWidth,
    confidence,
    movement: 0,
  };

  return raw;
}

export function scoreMetrics(current: RawMetrics, baseline: CalibrationProfile): ScoredMetrics {
  const shoulderDelta = Math.abs(current.shoulderTilt - baseline.shoulderTilt);
  const hipDelta = Math.abs(current.hipTilt - baseline.hipTilt);
  const torsoLeanDelta = Math.abs(current.torsoLean - baseline.torsoLean);
  const headSideDelta = Math.abs(current.headShoulderOffsetX - baseline.headShoulderOffsetX);
  const headDrop = Math.max(0, baseline.headShoulderOffsetY - current.headShoulderOffsetY);
  const torsoShortening = Math.max(0, baseline.shoulderHipDistance - current.shoulderHipDistance);
  const faceGrowth = Math.max(0, current.headScale - baseline.headScale);
  const bodyScaleGrowth = Math.max(0, current.shoulderWidth / Math.max(baseline.shoulderWidth, 0.01) - 1);

  const shoulderScore = clamp(shoulderDelta * 5.4 + hipDelta * 1.2, 0, 1.5);
  const torsoScore = clamp(torsoLeanDelta * 4.2 + hipDelta * 1.4, 0, 1.5);
  const headNeckScore = clamp(headDrop * 3.2 + headSideDelta * 2.4 + faceGrowth * 2.2 + bodyScaleGrowth * 0.45, 0, 1.5);
  const slouchScore = clamp(
    torsoShortening * 2.6 + headDrop * 2.1 + faceGrowth * 1.3 + bodyScaleGrowth * 0.35 + torsoLeanDelta * 0.7,
    0,
    1.5,
  );

  return { ...current, shoulderScore, torsoScore, headNeckScore, slouchScore };
}

function severity(score: number, sensitivity: Sensitivity): Severity {
  const threshold = THRESHOLDS[sensitivity];
  if (score >= threshold.bad) return 'bad';
  if (score >= threshold.mild) return 'mild';
  return 'good';
}

export function classifyPosture(metrics: ScoredMetrics, sensitivity: Sensitivity): ClassifiedPosture {
  const headNeck = severity(metrics.headNeckScore, sensitivity);
  const shoulder = severity(metrics.shoulderScore, sensitivity);
  const torso = severity(Math.max(metrics.torsoScore, metrics.slouchScore), sensitivity);
  const severities = [headNeck, shoulder, torso];
  const overall: Severity = severities.includes('bad') ? 'bad' : severities.includes('mild') ? 'mild' : 'good';
  return { overall, headNeck, shoulder, torso };
}
