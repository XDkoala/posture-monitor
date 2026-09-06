import type { Sensitivity, Settings } from './types';

export const POSE = {
  targetFps: 15,
  backgroundFps: 2,
  pictureInPictureFps: 10,
  backgroundStaleMs: 5000,
  visualRecoveryMs: 500,
  confidenceThreshold: 0.55,
  movementEnterThreshold: 0.16,
  movementExitThreshold: 0.07,
  movementImmediateThreshold: 0.32,
  movementMaxFrameGapMs: 350,
  movementHoldMs: 450,
  movementConfirmFrames: 3,
  movementEmaAlpha: 0.5,
  emaAlpha: 0.22,
  calibrationMs: 4000,
  minimumCalibrationSamples: 25,
  wasmUrl: '/mediapipe/wasm',
  modelUrl: '/models/pose_landmarker_lite.task',
} as const;

export const THRESHOLDS: Record<Sensitivity, { mild: number; bad: number }> = {
  relaxed: { mild: 0.42, bad: 0.8 },
  standard: { mild: 0.3, bad: 0.62 },
  sensitive: { mild: 0.22, bad: 0.48 },
};

export const DEFAULT_SETTINGS: Settings = {
  reminderDelaySeconds: 10,
  mode: 'normal',
  sensitivity: 'standard',
  desktopNotification: false,
  soundNotification: true,
  visualNotification: true,
  cooldownSeconds: 120,
};

export function persistenceMs(settings: Settings): number {
  return (settings.mode === 'relaxed' ? 30 : settings.reminderDelaySeconds) * 1000;
}
