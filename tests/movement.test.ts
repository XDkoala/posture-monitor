import assert from 'node:assert/strict';
import { MovementDetector } from '../src/movement';
import type { Point } from '../src/types';

function pose(dx = 0, dy = 0): Point[] {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  const set = (index: number, x: number, y: number) => { points[index] = { x: x + dx, y: y + dy, visibility: 1 }; };
  set(0, 0.5, 0.2);
  set(7, 0.43, 0.24);
  set(8, 0.57, 0.24);
  set(11, 0.35, 0.43);
  set(12, 0.65, 0.43);
  set(23, 0.40, 0.78);
  set(24, 0.60, 0.78);
  return points;
}

{
  const detector = new MovementDetector();
  let activeCount = 0;
  for (let frame = 0; frame < 120; frame += 1) {
    const jitter = Math.sin(frame * 0.7) * 0.002;
    const reading = detector.update(pose(jitter, -jitter * 0.5), frame * 67);
    if (reading.active) activeCount += 1;
  }
  assert.equal(activeCount, 0, 'natural sub-pixel jitter must not be classified as activity');
}

{
  const detector = new MovementDetector();
  let reading = detector.update(pose(), 0);
  for (let frame = 1; frame <= 8; frame += 1) {
    reading = detector.update(pose(frame * 0.006, frame * 0.001), frame * 67);
    assert.equal(reading.active, false, 'a gradual minor upper-body adjustment must remain stable');
  }
}

{
  const detector = new MovementDetector();
  detector.update(pose(), 0);
  const noisy = pose();
  noisy[7] = { ...noisy[7], x: noisy[7].x + 0.14 };
  const reading = detector.update(noisy, 67);
  assert.equal(reading.active, false, 'one unstable landmark must not trigger whole-body activity');
}

{
  const detector = new MovementDetector();
  detector.update(pose(), 0);
  detector.update(pose(0.06), 67);
  detector.update(pose(0.12), 134);
  const reading = detector.update(pose(0.18), 201);
  assert.equal(reading.active, true, 'three consecutive large upper-body displacements must trigger activity');
}

{
  const detector = new MovementDetector();
  detector.update(pose(), 0);
  const reading = detector.update(pose(0.15), 500);
  assert.equal(reading.comparable, false, 'frames separated by a background-sized gap must reset comparison');
  assert.equal(reading.active, false, 'a scheduler gap must not be treated as sudden movement');
}

console.log('Movement detector: 5 scenarios passed');
