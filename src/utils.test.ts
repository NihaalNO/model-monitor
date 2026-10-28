import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings, unavailable, formatMetric, boundedAppend } from './utils';
describe('configuration validation', () => {
  it('accepts loopback endpoints', () => { for (const endpoint of ['http://127.0.0.1:11434','http://localhost:11434','http://[::1]:11434']) expect(validateSettings({ ...DEFAULT_SETTINGS, endpoint })).toBeNull(); });
  it('rejects remote endpoints, credentials, paths and invalid intervals', () => {
    for (const endpoint of ['https://evil.example','http://localhost.evil','file:///etc/passwd','http://user@localhost','http://localhost/api','http://localhost/?q=1']) expect(validateSettings({ ...DEFAULT_SETTINGS, endpoint })).not.toBeNull();
    for (const interval of [0,499,10001,NaN,1000.1]) expect(validateSettings({ ...DEFAULT_SETTINGS, interval })).not.toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, history:601 })).not.toBeNull();
  });
});
describe('metric presentation and retention', () => {
  it('preserves unavailable data instead of displaying zero', () => { expect(formatMetric(unavailable('%','No driver'))).toBe('Unavailable'); });
  it('bounds the sample ring', () => { expect(boundedAppend([1,2,3],4,3)).toEqual([2,3,4]); });
  it('formats memory in binary GiB', () => { expect(formatMetric({ ...unavailable('bytes'), value:1024 ** 3, classification:'measured' })).toBe('1.00 GiB'); });
});

