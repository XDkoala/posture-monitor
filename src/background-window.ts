import type { Severity } from './types';
import { t } from './i18n';

type DocumentPictureInPictureApi = {
  window: Window | null;
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

export interface BackgroundSnapshot {
  severity: Severity | 'idle';
  label: string;
  message: string;
  sessionTime: string;
  visualAlert: boolean;
}

interface BackgroundCallbacks {
  onClosed: () => void;
}

export class BackgroundWindow {
  private pipWindow: Window | null = null;
  private callbacks?: BackgroundCallbacks;
  private closedHandled = true;

  get supported(): boolean {
    return 'documentPictureInPicture' in window;
  }

  get active(): boolean {
    return Boolean(this.pipWindow && !this.pipWindow.closed);
  }

  get schedulerWindow(): Window | null {
    return this.active ? this.pipWindow : null;
  }

  async open(callbacks: BackgroundCallbacks): Promise<void> {
    if (this.active) return;
    const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture;
    if (!api) throw new Error(t('pip.error.unsupported'));
    this.callbacks = callbacks;
    this.pipWindow = await api.requestWindow({ width: 280, height: 105 });
    this.closedHandled = false;
    this.buildDocument(this.pipWindow.document);
    this.pipWindow.addEventListener('pagehide', () => this.handleClosed(), { once: true });
  }

  close(): void {
    if (!this.pipWindow) return;
    this.pipWindow.close();
    this.handleClosed();
  }

  private handleClosed(): void {
    if (this.closedHandled) return;
    this.closedHandled = true;
    this.pipWindow = null;
    this.callbacks?.onClosed();
  }

  render(snapshot: BackgroundSnapshot): void {
    if (!this.active || !this.pipWindow) return;
    const doc = this.pipWindow.document;
    doc.title = t('pip.title');
    doc.body.classList.toggle('visual-alert', snapshot.visualAlert);
    const dot = doc.getElementById('pip-dot');
    if (dot) dot.className = `dot ${snapshot.visualAlert ? 'bad' : snapshot.severity}`;
    this.setText(doc, 'pip-label', snapshot.visualAlert ? t('alert.title') : snapshot.label);
    this.setText(doc, 'pip-message', snapshot.visualAlert ? t('alert.pipMessage') : snapshot.message);
    this.setText(doc, 'pip-time', snapshot.sessionTime);
  }

  private setText(doc: Document, id: string, value: string): void {
    const element = doc.getElementById(id);
    if (element) element.textContent = value;
  }

  private buildDocument(doc: Document): void {
    doc.title = t('pip.title');
    const style = doc.createElement('style');
    style.textContent = `
      :root{color-scheme:dark;font-family:Inter,"Segoe UI",system-ui,sans-serif;background:#0d1412;color:#edf5f1}
      *{box-sizing:border-box}body{margin:0;min-height:100vh;overflow:hidden;background:#0d1412}
      .compact{height:100vh;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:11px;padding:12px 14px;background:radial-gradient(circle at 25% -40%,#20362d,transparent 62%),#101815}
      .dot{width:10px;height:10px;border-radius:50%;background:#738179;box-shadow:0 0 0 5px rgba(120,140,130,.08)}.dot.good{background:#66db9f}.dot.mild{background:#e8b95e}.dot.bad{background:#ed716c}
      .copy{min-width:0}.copy h1{font-size:15px;line-height:1.25;letter-spacing:-.025em;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.message{font-size:9px;line-height:1.35;color:#82978e;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.time{font-size:9px;letter-spacing:.05em;color:#6f847a;font-variant-numeric:tabular-nums;white-space:nowrap}
      body.visual-alert .compact{background:radial-gradient(circle at 35% -50%,#422421,transparent 62%),#171211}.visual-alert .copy h1{color:#ffd9d6}.visual-alert .message{color:#e7aaa6}.visual-alert .time{color:#c58d89}
      body.visual-alert::after{content:'';position:fixed;inset:0;z-index:20;pointer-events:none;border:1px solid rgba(235,102,96,.62);background:linear-gradient(to bottom,rgba(225,85,80,.45),transparent),linear-gradient(to top,rgba(225,85,80,.45),transparent),linear-gradient(to right,rgba(225,85,80,.38),transparent),linear-gradient(to left,rgba(225,85,80,.38),transparent);background-repeat:no-repeat;background-position:top,bottom,left,right;background-size:100% 32px,100% 32px,28px 100%,28px 100%;animation:alert-pulse 2s ease-in-out infinite}
      @keyframes alert-pulse{0%,100%{opacity:.58}50%{opacity:.95}}
      @media(prefers-reduced-motion:reduce){body.visual-alert::after{animation:none;opacity:.9}}
    `;
    doc.head.append(style);
    doc.body.innerHTML = `
      <main class="compact">
        <span id="pip-dot" class="dot idle"></span>
        <div class="copy"><h1 id="pip-label">${t('pip.monitoring')}</h1><p id="pip-message" class="message">${t('pip.breathe')}</p></div>
        <strong id="pip-time" class="time">00:00:00</strong>
      </main>
    `;
  }
}
