import type { Settings } from './types';
import { t } from './i18n';

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

function playSoftChime(): void {
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const gain = context.createGain();
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(520, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(660, context.currentTime + 0.18);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.46);
  oscillator.addEventListener('ended', () => void context.close());
}

export function sendReminder(settings: Settings, showVisual: () => void): void {
  const title = t('alert.title');
  const body = t('alert.message');
  if (settings.desktopNotification && 'Notification' in window && Notification.permission === 'granted') {
    const options: NotificationOptions & { renotify: boolean } = {
      body,
      tag: 'posture-reminder',
      renotify: true,
      silent: true,
    };
    new Notification(title, options);
  }
  if (settings.soundNotification) playSoftChime();
  if (settings.visualNotification) showVisual();
}
