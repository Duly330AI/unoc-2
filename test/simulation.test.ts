import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeviceType } from '../client/src/deviceTypes.ts';

test('device type normalization: legacy inputs map to canonical SCREAMING_SNAKE_CASE', () => {
  assert.equal(normalizeDeviceType('CoreRouter'), 'CORE_ROUTER');
  assert.equal(normalizeDeviceType('AONSwitch'), 'AON_SWITCH');
  assert.equal(normalizeDeviceType('BusinessONT'), 'BUSINESS_ONT');
  assert.equal(normalizeDeviceType('PatchPanel'), 'ODF');
  assert.equal(normalizeDeviceType('Amplifier'), 'NVT');
});
