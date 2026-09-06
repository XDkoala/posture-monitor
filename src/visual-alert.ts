import { POSE } from './config';
import type { Severity } from './types';

/**
 * Latches a visual reminder after a confirmed posture reminder. It clears only
 * after the posture has continuously remained outside BAD for 500 ms.
 */
export class VisualAlertController {
  private active = false;
  private recoverySince: number | null = null;

  trigger(): void {
    this.active = true;
    this.recoverySince = null;
  }

  update(overall: Severity, now = Date.now()): boolean {
    if (!this.active) return false;
    if (overall === 'bad') {
      this.recoverySince = null;
      return true;
    }

    this.recoverySince ??= now;
    if (now - this.recoverySince >= POSE.visualRecoveryMs) this.clear();
    return this.active;
  }

  clear(): void {
    this.active = false;
    this.recoverySince = null;
  }

  get isActive(): boolean {
    return this.active;
  }
}
