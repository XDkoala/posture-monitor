export type Severity = 'good' | 'mild' | 'bad';
export type MachinePhase = 'GOOD' | 'MILD' | 'BAD_PENDING' | 'BAD_CONFIRMED' | 'REMINDER' | 'COOLDOWN';
export type Sensitivity = 'relaxed' | 'standard' | 'sensitive';
export type MonitorMode = 'normal' | 'relaxed';

export interface Point {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface PoseFrame {
  points: Point[];
  timestamp: number;
}

export interface RawMetrics {
  shoulderTilt: number;
  hipTilt: number;
  torsoLean: number;
  shoulderHipDistance: number;
  headShoulderOffsetX: number;
  headShoulderOffsetY: number;
  headScale: number;
  shoulderWidth: number;
  confidence: number;
  movement: number;
}

export interface CalibrationProfile extends RawMetrics {
  timestamp: number;
  sampleCount: number;
}

export interface ScoredMetrics extends RawMetrics {
  headNeckScore: number;
  slouchScore: number;
  shoulderScore: number;
  torsoScore: number;
}

export interface ClassifiedPosture {
  overall: Severity;
  headNeck: Severity;
  shoulder: Severity;
  torso: Severity;
}

export interface MachineSnapshot extends ClassifiedPosture {
  phase: MachinePhase;
  abnormalDurationMs: number;
  cooldownRemainingMs: number;
  shouldRemind: boolean;
}

export interface Settings {
  reminderDelaySeconds: 5 | 10 | 20 | 30;
  mode: MonitorMode;
  sensitivity: Sensitivity;
  desktopNotification: boolean;
  soundNotification: boolean;
  visualNotification: boolean;
  cooldownSeconds: 60 | 120 | 300;
}

export interface DailyStats {
  date: string;
  totalValidMs: number;
  goodMs: number;
  mildMs: number;
  badMs: number;
  reminderCount: number;
  issues: Record<'headNeck' | 'shoulder' | 'torso', number>;
  lastUpdated: number;
}
