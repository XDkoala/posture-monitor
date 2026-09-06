import { persistenceMs } from './config';
import type { ClassifiedPosture, MachinePhase, MachineSnapshot, Settings } from './types';

export class PostureStateMachine {
  private phase: MachinePhase = 'GOOD';
  private badSince: number | null = null;
  private cooldownUntil = 0;

  update(posture: ClassifiedPosture, settings: Settings, now = Date.now()): MachineSnapshot {
    let shouldRemind = false;
    const inCooldown = now < this.cooldownUntil;

    if (posture.overall !== 'bad') {
      this.badSince = null;
      this.phase = inCooldown ? 'COOLDOWN' : posture.overall === 'good' ? 'GOOD' : 'MILD';
    } else if (inCooldown) {
      this.phase = 'COOLDOWN';
      this.badSince ??= now;
    } else {
      this.badSince ??= now;
      const duration = now - this.badSince;
      if (duration >= persistenceMs(settings)) {
        this.phase = 'BAD_CONFIRMED';
        shouldRemind = true;
        this.phase = 'REMINDER';
        this.cooldownUntil = now + settings.cooldownSeconds * 1000;
      } else {
        this.phase = 'BAD_PENDING';
      }
    }

    return {
      ...posture,
      phase: this.phase,
      abnormalDurationMs: this.badSince ? now - this.badSince : 0,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
      shouldRemind,
    };
  }

  suspend(): void {
    this.badSince = null;
    if (Date.now() >= this.cooldownUntil) this.phase = 'GOOD';
  }

  reset(): void {
    this.phase = 'GOOD';
    this.badSince = null;
    this.cooldownUntil = 0;
  }
}
