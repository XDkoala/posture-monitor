import assert from 'node:assert/strict';
import { getLanguage, setLanguage, t } from '../src/i18n';

setLanguage('zh-CN');
assert.equal(getLanguage(), 'zh-CN');
assert.equal(t('action.pause', { minutes: 30 }), '暂停 30 分钟');
assert.equal(t('calibration.complete', { count: 42 }), '校准完成：已从 42 个稳定样本建立个人基准。');

setLanguage('en');
assert.equal(getLanguage(), 'en');
assert.equal(t('action.pause', { minutes: 30 }), 'Pause for 30 min');
assert.equal(t('calibration.complete', { count: 42 }), 'Calibration complete: your baseline was built from 42 stable samples.');

console.log('i18n: Chinese, English, and interpolation passed');
