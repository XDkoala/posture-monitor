import assert from 'node:assert/strict';
import { VisualAlertController } from '../src/visual-alert';

{
  const alert = new VisualAlertController();
  assert.equal(alert.update('bad', 0), false, 'BAD alone must not bypass the configured reminder delay');
  alert.trigger();
  assert.equal(alert.update('bad', 100), true, 'confirmed BAD must keep the visual alert active');
  assert.equal(alert.update('mild', 200), true, 'the alert must not clear at the start of recovery');
  assert.equal(alert.update('good', 699), true, '499 ms of recovery is not enough to clear the alert');
  assert.equal(alert.update('good', 700), false, '500 ms of continuous GOOD/MILD must clear the alert');
}

{
  const alert = new VisualAlertController();
  alert.trigger();
  alert.update('mild', 100);
  alert.update('bad', 400);
  assert.equal(alert.update('good', 500), true, 'returning to BAD must reset recovery confirmation');
  assert.equal(alert.update('good', 999), true, 'recovery must be continuous after the latest BAD frame');
  assert.equal(alert.update('mild', 1000), false, 'mixed GOOD/MILD recovery may clear after 500 ms');
}

console.log('Visual alert controller: 2 scenarios passed');
