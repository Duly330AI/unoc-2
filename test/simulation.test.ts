import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeviceType } from '../client/src/deviceTypes.ts';

test('device type normalization: canonical inputs pass through and unknown falls back', () => {
  assert.equal(normalizeDeviceType('CORE_ROUTER'), 'CORE_ROUTER');
  assert.equal(normalizeDeviceType('AON_SWITCH'), 'AON_SWITCH');
  assert.equal(normalizeDeviceType('BUSINESS_ONT'), 'BUSINESS_ONT');
  assert.equal(normalizeDeviceType('ODF'), 'ODF');
  assert.equal(normalizeDeviceType('UNKNOWN_TYPE'), 'SWITCH');
});
