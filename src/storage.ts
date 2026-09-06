import { DEFAULT_SETTINGS } from './config';
import type { CalibrationProfile, ClassifiedPosture, DailyStats, Settings } from './types';

const SETTINGS_KEY = 'posture-monitor.settings.v1';
const CALIBRATION_KEY = 'posture-monitor.calibration.v1';
const HISTORY_KEY = 'posture-monitor.history.v1';

const todayKey = () => new Date().toLocaleDateString('sv-SE');

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const saveSettings = (settings: Settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

export function loadCalibration(): CalibrationProfile | null {
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_KEY) ?? 'null') as CalibrationProfile | null;
  } catch {
    return null;
  }
}

export const saveCalibration = (profile: CalibrationProfile) => localStorage.setItem(CALIBRATION_KEY, JSON.stringify(profile));

function blankStats(date = todayKey()): DailyStats {
  return {
    date,
    totalValidMs: 0,
    goodMs: 0,
    mildMs: 0,
    badMs: 0,
    reminderCount: 0,
    issues: { headNeck: 0, shoulder: 0, torso: 0 },
    lastUpdated: Date.now(),
  };
}

function readHistory(): DailyStats[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as DailyStats[];
  } catch {
    return [];
  }
}

export class StatsStore {
  private stats: DailyStats;
  private lastTick = Date.now();
  private lastSave = 0;

  constructor() {
    this.stats = readHistory().find((entry) => entry.date === todayKey()) ?? blankStats();
  }

  tick(posture: ClassifiedPosture, now = Date.now()): DailyStats {
    if (this.stats.date !== todayKey()) this.stats = blankStats();
    const elapsed = Math.min(1500, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    this.stats.totalValidMs += elapsed;
    this.stats[`${posture.overall}Ms`] += elapsed;
    if (posture.headNeck !== 'good') this.stats.issues.headNeck += elapsed;
    if (posture.shoulder !== 'good') this.stats.issues.shoulder += elapsed;
    if (posture.torso !== 'good') this.stats.issues.torso += elapsed;
    this.stats.lastUpdated = now;
    if (now - this.lastSave > 5000) this.save();
    return this.snapshot;
  }

  idle(now = Date.now()): void {
    this.lastTick = now;
  }

  addReminder(): void {
    this.stats.reminderCount += 1;
    this.save();
  }

  save(): void {
    const history = readHistory().filter((entry) => entry.date !== this.stats.date);
    history.push(this.stats);
    history.sort((a, b) => b.date.localeCompare(a.date));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 7)));
    this.lastSave = Date.now();
  }

  get snapshot(): DailyStats {
    return structuredClone(this.stats);
  }
}
