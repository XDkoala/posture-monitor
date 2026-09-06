import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { POSE } from './config';

export class PoseDetector {
  private landmarker?: PoseLandmarker;
  private lastVideoTime = -1;

  async load(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(POSE.wasmUrl);
    const options = {
      runningMode: 'VIDEO' as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputSegmentationMasks: false,
    };
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: POSE.modelUrl, delegate: 'GPU' },
      });
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: POSE.modelUrl, delegate: 'CPU' },
      });
    }
  }

  detect(video: HTMLVideoElement, timestamp: number): PoseLandmarkerResult | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    return this.landmarker.detectForVideo(video, timestamp);
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = undefined;
  }
}
