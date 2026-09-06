import './styles.css';
import { CameraController, CameraError } from './camera';
import { PoseDetector } from './pose';
import { Calibrator } from './calibration';
import { POSE } from './config';
import { MetricsEma, formatDuration } from './math';
import { classifyPosture, computeRawMetrics, scoreMetrics } from './metrics';
import { PostureStateMachine } from './state-machine';
import { loadCalibration, loadSettings, saveCalibration, saveSettings, StatsStore } from './storage';
import { requestNotificationPermission, sendReminder } from './notifications';
import { drawDebug } from './debug-canvas';
import { BackgroundWindow } from './background-window';
import { MovementDetector, type MovementReading } from './movement';
import { VisualAlertController } from './visual-alert';
import { applyDocumentTranslations, getLanguage, setLanguage, t, type TranslationKey } from './i18n';
import type { CalibrationProfile, DailyStats, MachineSnapshot, ScoredMetrics, Settings, Severity } from './types';

const $ = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const video = $<HTMLVideoElement>('camera-video');
const canvas = $<HTMLCanvasElement>('debug-canvas');
const camera = new CameraController(video);
const detector = new PoseDetector();
const calibrator = new Calibrator();
const stateMachine = new PostureStateMachine();
const smoother = new MetricsEma(POSE.emaAlpha);
const stats = new StatsStore();
const backgroundWindow = new BackgroundWindow();
const movementDetector = new MovementDetector();
const visualAlert = new VisualAlertController();

let settings: Settings = loadSettings();
let baseline: CalibrationProfile | null = loadCalibration();
let running = false;
let detectorReady = false;
let calibrating = false;
let debugVisible = false;
let pauseUntil = 0;
let rafHandle = 0;
let rafOwner: Window | null = null;
let timerHandle = 0;
let lastInferenceAt = 0;
let lastAnalysisAt = 0;
let missingSince = 0;
let fpsFrames = 0;
let fpsStarted = performance.now();
let currentFps = 0;
let latestMetrics: ScoredMetrics | null = null;
let latestMachine: MachineSnapshot | null = null;
let displayedSeverity: Severity | 'idle' = 'idle';
let latestMovement: MovementReading | null = null;
let calibrationComplete = false;
let calibrationFailed = false;
let currentStatus: { label: TranslationKey; message?: TranslationKey; literalMessage?: string } = {
  label: 'status.notStarted.label',
  message: 'status.notStarted.message',
};

function renderCurrentStatus(): void {
  $('overall-label').textContent = t(currentStatus.label);
  $('status-message').textContent = currentStatus.literalMessage ?? (currentStatus.message ? t(currentStatus.message) : '');
}

function setStatus(label: TranslationKey, message: TranslationKey, severity: Severity | 'idle' = 'idle'): void {
  currentStatus = { label, message };
  displayedSeverity = severity;
  renderCurrentStatus();
  $('overall-dot').className = `overall-dot ${severity}`;
}

function setStatusWithMessage(label: TranslationKey, message: string, severity: Severity | 'idle'): void {
  currentStatus = { label, literalMessage: message };
  displayedSeverity = severity;
  renderCurrentStatus();
  $('overall-dot').className = `overall-dot ${severity}`;
}

function notificationIsEnabled(): boolean {
  return settings.desktopNotification && 'Notification' in window && Notification.permission === 'granted';
}

function syncBackgroundWindow(): void {
  backgroundWindow.render({
    severity: displayedSeverity,
    label: $('overall-label').textContent ?? t('pip.monitoring'),
    message: $('status-message').textContent ?? '',
    sessionTime: $('session-time').textContent ?? '00:00:00',
    visualAlert: visualAlert.isActive && settings.visualNotification,
  });
}

function updateBackgroundHealth(): void {
  const health = $('background-health');
  const title = health.querySelector('strong');
  const detail = health.querySelector('small');
  health.className = 'background-health idle';
  if (!running) {
    if (title) title.textContent = t('background.off.title');
    if (detail) detail.textContent = t('background.off.detail');
  } else if (isPaused()) {
    health.className = 'background-health warning';
    if (title) title.textContent = t('background.paused.title');
    if (detail) detail.textContent = t('background.paused.detail');
  } else if (lastAnalysisAt && Date.now() - lastAnalysisAt > POSE.backgroundStaleMs) {
    health.className = 'background-health error';
    if (title) title.textContent = t('background.limited.title');
    if (detail) detail.textContent = t('background.limited.detail');
  } else if (backgroundWindow.active) {
    health.className = 'background-health active';
    if (title) title.textContent = t('background.pip.title');
    if (detail) detail.textContent = t(notificationIsEnabled() ? 'background.pip.detail.enabled' : 'background.pip.detail.disabled', { fps: POSE.pictureInPictureFps });
  } else if (document.hidden) {
    health.className = 'background-health warning';
    if (title) title.textContent = t('background.compat.title');
    if (detail) detail.textContent = t('background.compat.detail', { fps: POSE.backgroundFps });
  } else {
    health.className = 'background-health active';
    if (title) title.textContent = t('background.foreground.title');
    if (detail) detail.textContent = t(backgroundWindow.supported ? 'background.foreground.detail' : 'background.unsupported.detail');
  }
  syncBackgroundWindow();
}

function metricText(severity: Severity): string {
  return t(severity === 'good' ? 'metric.normal' : severity === 'mild' ? 'metric.mild' : 'metric.bad');
}

function renderMetric(name: 'head' | 'shoulder' | 'torso', severity: Severity): void {
  $(`${name}-status`).textContent = metricText(severity);
  const chip = $(`${name}-chip`);
  chip.className = `chip ${severity}`;
  chip.textContent = t(severity === 'good' ? 'chip.good' : severity === 'mild' ? 'chip.mild' : 'chip.bad');
}

function renderMachine(snapshot: MachineSnapshot): void {
  renderMetric('head', snapshot.headNeck);
  renderMetric('shoulder', snapshot.shoulder);
  renderMetric('torso', snapshot.torso);
  if (snapshot.phase === 'COOLDOWN' && snapshot.overall === 'bad') {
    setStatus('status.adjust.label', 'status.cooldown.message', 'bad');
  } else if (snapshot.overall === 'bad') {
    setStatus('status.adjust.label', snapshot.phase === 'BAD_PENDING' ? 'status.pending.message' : 'status.adjust.message', 'bad');
  } else if (snapshot.overall === 'mild') {
    setStatus('status.mild.label', 'status.mild.message', 'mild');
  } else {
    setStatus('status.good.label', 'status.good.message', 'good');
  }
}

function showReminder(): void {
  visualAlert.trigger();
  renderVisualAlert();
}

function renderVisualAlert(): void {
  const active = visualAlert.isActive && settings.visualNotification;
  $('alert-banner').classList.toggle('visible', active);
  document.body.classList.toggle('visual-alert-active', active);
  syncBackgroundWindow();
}

function clearVisualAlert(): void {
  visualAlert.clear();
  renderVisualAlert();
}

function renderStats(value: DailyStats): void {
  $('session-time').textContent = formatDuration(value.totalValidMs);
  $('stat-total').textContent = value.totalValidMs < 3_600_000
    ? t('stats.minutes', { minutes: Math.floor(value.totalValidMs / 60_000) })
    : t('stats.hoursMinutes', {
      hours: Math.floor(value.totalValidMs / 3_600_000),
      minutes: Math.floor((value.totalValidMs % 3_600_000) / 60_000),
    });
  $('stat-reminders').textContent = String(value.reminderCount);
  const issueNames = { headNeck: t('issue.headNeck'), shoulder: t('issue.shoulder'), torso: t('issue.torso') };
  const issue = (Object.entries(value.issues) as [keyof typeof issueNames, number][]).sort((a, b) => b[1] - a[1])[0];
  $('stat-issue').textContent = issue && issue[1] > 0 ? issueNames[issue[0]] : t('stats.none');
  const total = Math.max(value.totalValidMs, 1);
  for (const severity of ['good', 'mild', 'bad'] as const) {
    const percentage = Math.round((value[`${severity}Ms`] / total) * 100);
    $(`${severity}-percent`).textContent = `${percentage}%`;
    $<HTMLElement>(`${severity}-bar`).style.width = `${percentage}%`;
  }
}

function renderDebug(): void {
  $('debug-fps').textContent = currentFps.toFixed(1);
  $('debug-confidence').textContent = latestMetrics ? `${Math.round(latestMetrics.confidence * 100)}%` : '—';
  $('debug-shoulder').textContent = latestMetrics ? latestMetrics.shoulderTilt.toFixed(3) : '—';
  $('debug-torso').textContent = latestMetrics ? latestMetrics.torsoLean.toFixed(3) : '—';
  $('debug-head').textContent = latestMetrics ? latestMetrics.headNeckScore.toFixed(2) : '—';
  $('debug-slouch').textContent = latestMetrics ? latestMetrics.slouchScore.toFixed(2) : '—';
  $('debug-phase').textContent = latestMachine?.phase ?? '—';
  $('debug-duration').textContent = `${((latestMachine?.abnormalDurationMs ?? 0) / 1000).toFixed(1)}s`;
  $('debug-cooldown').textContent = `${Math.ceil((latestMachine?.cooldownRemainingMs ?? 0) / 1000)}s`;
  $('debug-movement-raw').textContent = latestMovement ? latestMovement.rawScore.toFixed(3) : '—';
  $('debug-movement-filtered').textContent = latestMovement ? latestMovement.filteredScore.toFixed(3) : '—';
  $('debug-frame-delta').textContent = latestMovement?.comparable ? `${latestMovement.frameDeltaMs.toFixed(0)}ms` : t('debug.reset');
  $('debug-movement-frames').textContent = latestMovement ? String(latestMovement.consecutiveFrames) : '0';
  $('debug-visual-alert').textContent = t(visualAlert.isActive ? 'debug.active' : 'debug.inactive');
  $('debug-baseline').textContent = baseline
    ? `S ${baseline.shoulderTilt.toFixed(2)} / T ${baseline.torsoLean.toFixed(2)} / D ${baseline.shoulderHipDistance.toFixed(2)}`
    : t('debug.uncalibrated');
}

function isPaused(): boolean {
  return pauseUntil > Date.now();
}

function updatePauseButton(): void {
  const button = $<HTMLButtonElement>('pause-button');
  if (isPaused()) {
    button.textContent = t('action.resume', { minutes: Math.ceil((pauseUntil - Date.now()) / 60000) });
    setStatus('status.paused.label', 'status.paused.message', 'idle');
  } else {
    pauseUntil = 0;
    button.textContent = t('action.pause', { minutes: $<HTMLSelectElement>('pause-duration').value });
  }
}

function togglePause(durationMinutes?: number): void {
  if (isPaused()) pauseUntil = 0;
  else {
    const duration = durationMinutes ?? Number($<HTMLSelectElement>('pause-duration').value);
    pauseUntil = Date.now() + duration * 60_000;
  }
  stateMachine.suspend();
  clearVisualAlert();
  stats.idle();
  updatePauseButton();
  updateBackgroundHealth();
}

async function toggleBackgroundMode(): Promise<void> {
  const button = $<HTMLButtonElement>('background-button');
  if (backgroundWindow.active) {
    backgroundWindow.close();
    return;
  }
  if (!running) return;
  button.disabled = true;
  button.textContent = t('action.openingBackground');
  try {
    await backgroundWindow.open({
      onClosed: () => {
        button.disabled = !running;
        button.textContent = t('action.openBackground');
        button.classList.remove('background-active');
        movementDetector.reset();
        cancelScheduledLoop();
        scheduleNextLoop();
        updateBackgroundHealth();
      },
    });
    button.disabled = false;
    button.textContent = t('action.closeBackground');
    button.classList.add('background-active');
    movementDetector.reset();
    if ('Notification' in window && Notification.permission === 'granted' && !settings.desktopNotification) {
      settings = { ...settings, desktopNotification: true };
      saveSettings(settings);
      syncSettingsForm();
    }
    cancelScheduledLoop();
    scheduleNextLoop();
    updateBackgroundHealth();
  } catch (error) {
    button.disabled = false;
    button.textContent = t('action.retryBackground');
    setStatusWithMessage('status.pipFailed.label', error instanceof Error ? error.message : t('status.pipRejected.message'), 'mild');
    updateBackgroundHealth();
  }
}

function handleUnavailable(reason: 'missing' | 'unstable' | 'movement'): void {
  stateMachine.suspend();
  stats.idle();
  if (reason !== 'movement') movementDetector.reset();
  if (reason === 'missing' || reason === 'unstable') clearVisualAlert();
  if (reason === 'missing') setStatus('status.missing.label', 'status.missing.message', 'idle');
  if (reason === 'unstable') setStatus('status.unstable.label', 'status.unstable.message', 'idle');
  if (reason === 'movement') setStatus('status.movement.label', 'status.movement.message', 'idle');
}

function finishCalibration(): void {
  calibrating = false;
  const profile = calibrator.finish();
  if (!profile) {
    calibrationFailed = true;
    $('calibration-feedback').textContent = t('calibration.insufficient');
    $('calibration-start').textContent = t('calibration.retry');
    $('calibration-start').removeAttribute('disabled');
    return;
  }
  baseline = profile;
  calibrationComplete = true;
  calibrationFailed = false;
  saveCalibration(profile);
  smoother.reset();
  stateMachine.reset();
  $('debug-baseline').textContent = `S ${profile.shoulderTilt.toFixed(2)} / T ${profile.torsoLean.toFixed(2)} / D ${profile.shoulderHipDistance.toFixed(2)}`;
  $('calibrate-button').textContent = t('action.recalibrate');
  $('calibration-feedback').textContent = t('calibration.complete', { count: profile.sampleCount });
  $('calibration-progress').style.width = '100%';
  $('calibration-start').textContent = t('calibration.done');
  $('calibration-start').removeAttribute('disabled');
  setStatus('status.calibrationDone.label', 'status.calibrationDone.message', 'good');
  window.setTimeout(closeCalibration, 1100);
}

function processResult(timestamp: number): void {
  const result = detector.detect(video, timestamp);
  if (!result) return;
  lastAnalysisAt = Date.now();
  fpsFrames += 1;
  if (timestamp - fpsStarted >= 1000) {
    currentFps = (fpsFrames * 1000) / (timestamp - fpsStarted);
    fpsFrames = 0;
    fpsStarted = timestamp;
  }

  const points = result.landmarks[0];
  if (!points) {
    missingSince ||= timestamp;
    if (timestamp - missingSince > 700) handleUnavailable('missing');
    return;
  }
  missingSince = 0;
  if (debugVisible) drawDebug(canvas, video, points);
  const raw = computeRawMetrics({ points, timestamp });
  if (!raw) return handleUnavailable('missing');
  if (raw.confidence < POSE.confidenceThreshold) return handleUnavailable('unstable');
  latestMovement = movementDetector.update(points, timestamp);
  raw.movement = latestMovement.filteredScore;
  if (debugVisible) renderDebug();
  if (latestMovement.active) return handleUnavailable('movement');

  const smoothed = smoother.update(raw);
  if (calibrating) {
    calibrator.add(raw);
    $('calibration-progress').style.width = `${calibrator.progress * 100}%`;
    $('calibration-feedback').textContent = t('calibration.sampling', { progress: Math.round(calibrator.progress * 100) });
    if (calibrator.ready) finishCalibration();
    return;
  }
  if (!baseline) {
    setStatus('status.awaitCalibration.label', 'status.awaitCalibration.message', 'idle');
    return;
  }

  latestMetrics = scoreMetrics(smoothed, baseline);
  const posture = classifyPosture(latestMetrics, settings.sensitivity);
  latestMachine = stateMachine.update(posture, settings);
  visualAlert.update(posture.overall);
  renderMachine(latestMachine);
  renderVisualAlert();
  renderStats(stats.tick(posture));
  if (latestMachine.shouldRemind) {
    stats.addReminder();
    renderStats(stats.snapshot);
    sendReminder(settings, showReminder);
  }
  if (debugVisible) renderDebug();
}

function cancelScheduledLoop(): void {
  if (rafHandle && rafOwner) {
    try {
      rafOwner.cancelAnimationFrame(rafHandle);
    } catch {
      // A Picture-in-Picture window can close between scheduler ticks.
    }
  }
  if (timerHandle) window.clearTimeout(timerHandle);
  rafHandle = 0;
  rafOwner = null;
  timerHandle = 0;
}

function scheduleNextLoop(): void {
  if (!running) return;
  cancelScheduledLoop();
  const pipWindow = backgroundWindow.schedulerWindow;
  if (pipWindow) {
    rafOwner = pipWindow;
    rafHandle = pipWindow.requestAnimationFrame(loop);
  } else if (document.hidden) {
    timerHandle = window.setTimeout(() => loop(), 1000 / POSE.backgroundFps);
  } else {
    rafOwner = window;
    rafHandle = window.requestAnimationFrame(loop);
  }
}

function loop(): void {
  if (!running) return;
  const timestamp = performance.now();
  updatePauseButton();
  if (isPaused()) {
    stats.idle();
  } else {
    const targetFps = backgroundWindow.active
      ? POSE.pictureInPictureFps
      : document.hidden ? POSE.backgroundFps : POSE.targetFps;
    if (timestamp - lastInferenceAt >= 1000 / targetFps) {
      lastInferenceAt = timestamp;
      processResult(timestamp);
    }
  }
  if (calibrating) {
    $('calibration-progress').style.width = `${calibrator.progress * 100}%`;
    if (calibrator.ready) finishCalibration();
  }
  updateBackgroundHealth();
  scheduleNextLoop();
}

async function startMonitoring(): Promise<void> {
  if (running) return;
  const button = $<HTMLButtonElement>('start-button');
  button.disabled = true;
  button.textContent = t('action.starting');
  setStatus('status.preparing.label', 'status.preparing.message', 'idle');
  try {
    await camera.start();
    if (!detectorReady) {
      setStatus('status.loadingModel.label', 'status.loadingModel.message', 'idle');
      await detector.load();
      detectorReady = true;
    }
    running = true;
    button.textContent = t('action.stopMonitoring');
    button.disabled = false;
    $('calibrate-button').removeAttribute('disabled');
    $('pause-button').removeAttribute('disabled');
    $('debug-toggle').removeAttribute('disabled');
    if (backgroundWindow.supported) $('background-button').removeAttribute('disabled');
    else $('background-button').textContent = t('action.backgroundUnsupported');
    setStatus(
      baseline ? 'status.detecting.label' : 'status.awaitCalibration.label',
      baseline ? 'status.detecting.message' : 'status.awaitCalibration.message',
      'idle',
    );
    lastAnalysisAt = Date.now();
    movementDetector.reset();
    scheduleNextLoop();
    updateBackgroundHealth();
    if (!baseline) openCalibration();
  } catch (error) {
    camera.stop();
    button.textContent = t('action.retryStart');
    button.disabled = false;
    if (error instanceof CameraError) setStatus('status.startFailed.label', error.translationKey, 'bad');
    else setStatusWithMessage('status.startFailed.label', error instanceof Error ? error.message : t('status.unknownError.message'), 'bad');
  }
}

function stopMonitoring(): void {
  running = false;
  cancelScheduledLoop();
  backgroundWindow.close();
  movementDetector.reset();
  clearVisualAlert();
  camera.stop();
  stateMachine.suspend();
  stats.idle();
  $<HTMLButtonElement>('start-button').textContent = t('action.startCamera');
  $('calibrate-button').setAttribute('disabled', '');
  $('pause-button').setAttribute('disabled', '');
  $('debug-toggle').setAttribute('disabled', '');
  $('background-button').setAttribute('disabled', '');
  $('background-button').textContent = t('action.openBackground');
  setStatus('status.stopped.label', 'status.stopped.message', 'idle');
  updateBackgroundHealth();
}

function openCalibration(): void {
  if (!running) return;
  $('calibration-modal').classList.remove('hidden');
  $('calibration-progress-wrap').classList.add('hidden');
  $('calibration-progress').style.width = '0';
  calibrationComplete = false;
  calibrationFailed = false;
  $('calibration-feedback').textContent = t('calibration.ready');
  $('calibration-start').textContent = t('calibration.start');
  $('calibration-start').removeAttribute('disabled');
}

function closeCalibration(): void {
  if (calibrating) return;
  $('calibration-modal').classList.add('hidden');
}

function startCalibration(): void {
  if (calibrationComplete) return closeCalibration();
  calibrator.start();
  calibrating = true;
  stateMachine.suspend();
  movementDetector.reset();
  clearVisualAlert();
  $('calibration-progress-wrap').classList.remove('hidden');
  $('calibration-start').setAttribute('disabled', '');
  $('calibration-start').textContent = t('calibration.hold');
}

function toggleDebug(): void {
  debugVisible = !debugVisible;
  $('debug-toggle').textContent = t(debugVisible ? 'camera.hide' : 'camera.show');
  $('camera-stage').classList.toggle('hidden', !debugVisible);
  $('camera-placeholder').classList.toggle('hidden', debugVisible);
  $('debug-data').classList.toggle('hidden', !debugVisible);
  if (!debugVisible) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}

function openSettings(): void {
  $('settings-panel').classList.add('open');
  $('settings-panel').setAttribute('aria-hidden', 'false');
  $('drawer-backdrop').classList.remove('hidden');
}

function closeSettings(): void {
  $('settings-panel').classList.remove('open');
  $('settings-panel').setAttribute('aria-hidden', 'true');
  $('drawer-backdrop').classList.add('hidden');
}

function syncSettingsForm(): void {
  $<HTMLSelectElement>('setting-mode').value = settings.mode;
  $<HTMLSelectElement>('setting-delay').value = String(settings.reminderDelaySeconds);
  $<HTMLSelectElement>('setting-sensitivity').value = settings.sensitivity;
  $<HTMLSelectElement>('setting-cooldown').value = String(settings.cooldownSeconds);
  $<HTMLInputElement>('setting-desktop').checked = settings.desktopNotification;
  $<HTMLInputElement>('setting-sound').checked = settings.soundNotification;
  $<HTMLInputElement>('setting-visual').checked = settings.visualNotification;
  $<HTMLSelectElement>('setting-delay').disabled = settings.mode === 'relaxed';
  $('notification-state').textContent = t(!('Notification' in window)
    ? 'notification.unsupported'
    : Notification.permission === 'granted'
      ? 'notification.granted'
      : Notification.permission === 'denied'
        ? 'notification.denied'
        : 'notification.default');
}

function renderTodayDate(): void {
  $('today-date').textContent = new Intl.DateTimeFormat(getLanguage(), { month: 'short', day: 'numeric' }).format(new Date());
}

function renderLanguageDependentControls(): void {
  $<HTMLButtonElement>('start-button').textContent = running ? t('action.stopMonitoring') : t('action.startCamera');
  $('calibrate-button').textContent = baseline ? t('action.recalibrate') : t('action.startCalibration');
  $('background-button').textContent = backgroundWindow.active
    ? t('action.closeBackground')
    : backgroundWindow.supported ? t('action.openBackground') : t('action.backgroundUnsupported');
  $('debug-toggle').textContent = t(debugVisible ? 'camera.hide' : 'camera.show');
  if (!latestMachine) {
    for (const name of ['head', 'shoulder', 'torso'] as const) $(`${name}-status`).textContent = t('metric.waiting');
  }
  updatePauseButton();

  if (calibrating) {
    $('calibration-start').textContent = t('calibration.hold');
    $('calibration-feedback').textContent = t('calibration.sampling', { progress: Math.round(calibrator.progress * 100) });
  } else if (calibrationComplete && baseline) {
    $('calibration-start').textContent = t('calibration.done');
    $('calibration-feedback').textContent = t('calibration.complete', { count: baseline.sampleCount });
  } else if (calibrationFailed) {
    $('calibration-start').textContent = t('calibration.retry');
    $('calibration-feedback').textContent = t('calibration.insufficient');
  } else {
    $('calibration-start').textContent = t('calibration.start');
    $('calibration-feedback').textContent = t('calibration.ready');
  }
}

function toggleLanguage(): void {
  setLanguage(getLanguage() === 'zh-CN' ? 'en' : 'zh-CN');
  applyDocumentTranslations();
  renderCurrentStatus();
  if (latestMachine) {
    renderMetric('head', latestMachine.headNeck);
    renderMetric('shoulder', latestMachine.shoulder);
    renderMetric('torso', latestMachine.torso);
  } else {
    for (const name of ['head', 'shoulder', 'torso'] as const) $(`${name}-status`).textContent = t('metric.waiting');
  }
  renderTodayDate();
  renderStats(stats.snapshot);
  renderDebug();
  syncSettingsForm();
  renderLanguageDependentControls();
  updateBackgroundHealth();
}

async function readSettingsForm(): Promise<void> {
  const desktopToggle = $<HTMLInputElement>('setting-desktop');
  if (desktopToggle.checked) {
    const permission = await requestNotificationPermission();
    desktopToggle.checked = permission === 'granted';
  }
  settings = {
    mode: $<HTMLSelectElement>('setting-mode').value as Settings['mode'],
    reminderDelaySeconds: Number($<HTMLSelectElement>('setting-delay').value) as Settings['reminderDelaySeconds'],
    sensitivity: $<HTMLSelectElement>('setting-sensitivity').value as Settings['sensitivity'],
    cooldownSeconds: Number($<HTMLSelectElement>('setting-cooldown').value) as Settings['cooldownSeconds'],
    desktopNotification: desktopToggle.checked,
    soundNotification: $<HTMLInputElement>('setting-sound').checked,
    visualNotification: $<HTMLInputElement>('setting-visual').checked,
  };
  if (!settings.visualNotification) visualAlert.clear();
  saveSettings(settings);
  syncSettingsForm();
  renderVisualAlert();
  updateBackgroundHealth();
}

function beginStartFlow(): void {
  if (running) return stopMonitoring();
  if (!localStorage.getItem('posture-monitor.onboarded')) $('onboarding').classList.remove('hidden');
  else void startMonitoring();
}

$('start-button').addEventListener('click', beginStartFlow);
$('onboarding-continue').addEventListener('click', () => {
  localStorage.setItem('posture-monitor.onboarded', 'true');
  $('onboarding').classList.add('hidden');
  void startMonitoring();
});
$('calibrate-button').addEventListener('click', openCalibration);
$('calibration-start').addEventListener('click', startCalibration);
$('calibration-close').addEventListener('click', closeCalibration);
$('debug-toggle').addEventListener('click', toggleDebug);
$('background-button').addEventListener('click', () => void toggleBackgroundMode());
$('settings-button').addEventListener('click', openSettings);
$('language-button').addEventListener('click', toggleLanguage);
$('settings-close').addEventListener('click', closeSettings);
$('drawer-backdrop').addEventListener('click', closeSettings);
$('pause-duration').addEventListener('change', updatePauseButton);
$('pause-button').addEventListener('click', () => togglePause());
for (const id of ['setting-mode', 'setting-delay', 'setting-sensitivity', 'setting-cooldown', 'setting-desktop', 'setting-sound', 'setting-visual']) {
  $(id).addEventListener('change', () => void readSettingsForm());
}
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    openCalibration();
  }
  if (event.key === 'Escape') {
    closeSettings();
    closeCalibration();
  }
});
document.addEventListener('visibilitychange', () => {
  if (!running || backgroundWindow.active) return;
  movementDetector.reset();
  cancelScheduledLoop();
  scheduleNextLoop();
  updateBackgroundHealth();
});
window.addEventListener('beforeunload', () => {
  cancelScheduledLoop();
  backgroundWindow.close();
  stats.save();
  detector.close();
  camera.stop();
});

applyDocumentTranslations();
renderCurrentStatus();
renderTodayDate();
syncSettingsForm();
renderStats(stats.snapshot);
renderDebug();
renderLanguageDependentControls();
updateBackgroundHealth();
if (baseline) {
  $('calibrate-button').textContent = t('action.recalibrate');
  $('debug-baseline').textContent = `S ${baseline.shoulderTilt.toFixed(2)} / T ${baseline.torsoLean.toFixed(2)} / D ${baseline.shoulderHipDistance.toFixed(2)}`;
}
