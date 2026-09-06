import { t, type TranslationKey } from './i18n';

export class CameraError extends Error {
  constructor(readonly translationKey: TranslationKey) {
    super(t(translationKey));
    this.name = 'CameraError';
  }
}

export class CameraController {
  private stream?: MediaStream;

  constructor(private readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('camera.error.unsupported');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20, max: 24 } },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        throw new CameraError('camera.error.permission');
      }
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new CameraError('camera.error.notFound');
      }
      throw new CameraError('camera.error.failed');
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.video.srcObject = null;
  }

  get active(): boolean {
    return Boolean(this.stream?.active);
  }
}
