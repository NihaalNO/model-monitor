import type { Metric, Settings } from './types';
export const DEFAULT_SETTINGS: Settings = { endpoint: 'http://127.0.0.1:11434', interval: 1000, history: 120, charts: true };
export const unavailable = (unit: string, reason = 'Waiting for a hardware sample'): Metric => ({ value: null, unit, reason, classification: 'unavailable', source: 'Not available' });
export function formatMetric(metric: Metric, digits = 1): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return 'Unavailable';
  if (metric.unit === 'bytes') return (metric.value / 1024 ** 3).toFixed(2) + ' GiB';
  return metric.value.toLocaleString(undefined, { maximumFractionDigits: digits }) + ' ' + metric.unit;
}
export function validateSettings(s: Settings): string | null {
  try {
    const u = new URL(s.endpoint.trim());
    // Match Rust policy: 127/8, localhost, or IPv6 loopback only.
    const loopback = u.hostname === 'localhost' || u.hostname === '[::1]' || /^127\.(\d{1,3}\.){2}\d{1,3}$/.test(u.hostname);
    if (!loopback || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return 'Use a loopback HTTP(S) endpoint without credentials or a path.';
  } catch { return 'Enter a valid local endpoint URL.'; }
  if (s.provider !== undefined && !['ollama','llamacpp'].includes(s.provider)) return 'Unknown inference provider.';
  if (typeof s.charts !== 'boolean') return 'Chart preference must be a boolean.';
  if (!Number.isInteger(s.interval) || s.interval < 500 || s.interval > 10000) return 'Sampling interval must be 500–10000 ms.';
  if (!Number.isInteger(s.history) || s.history < 30 || s.history > 600) return 'History must be 30–600 samples.';
  return null;
}
export function loadSettings(): Settings {
  try {
    const parsed: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('monitor-settings') || '{}') };
    return validateSettings(parsed) ? DEFAULT_SETTINGS : parsed;
  } catch { return DEFAULT_SETTINGS; }
}
export function boundedAppend<T>(history: T[], sample: T, limit: number): T[] { return [...history, sample].slice(-limit); }

