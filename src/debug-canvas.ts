import type { Point } from './types';
import { LANDMARK } from './metrics';

const CONNECTIONS: [number, number][] = [
  [0, 7], [0, 8], [7, 11], [8, 12], [11, 12], [11, 23], [12, 24], [23, 24],
];

export function drawDebug(canvas: HTMLCanvasElement, video: HTMLVideoElement, points: Point[]): void {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, width, height);
  context.lineWidth = 3;
  context.strokeStyle = 'rgba(114, 237, 190, .9)';
  for (const [from, to] of CONNECTIONS) {
    const a = points[from];
    const b = points[to];
    if (!a || !b || (a.visibility ?? 1) < 0.4 || (b.visibility ?? 1) < 0.4) continue;
    context.beginPath();
    context.moveTo(a.x * width, a.y * height);
    context.lineTo(b.x * width, b.y * height);
    context.stroke();
  }
  context.fillStyle = '#f6fbf7';
  for (const point of points) {
    if ((point.visibility ?? 1) < 0.5) continue;
    context.beginPath();
    context.arc(point.x * width, point.y * height, 3.5, 0, Math.PI * 2);
    context.fill();
  }
  const shoulderCenter = center(points[LANDMARK.leftShoulder], points[LANDMARK.rightShoulder]);
  const hipCenter = center(points[LANDMARK.leftHip], points[LANDMARK.rightHip]);
  context.fillStyle = '#f3c76b';
  for (const point of [shoulderCenter, hipCenter]) {
    context.beginPath();
    context.arc(point.x * width, point.y * height, 7, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = '#f3c76b';
  context.beginPath();
  context.moveTo(shoulderCenter.x * width, shoulderCenter.y * height);
  context.lineTo(hipCenter.x * width, hipCenter.y * height);
  context.stroke();
  context.restore();
}

function center(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
