import { afterEach, expect, it } from 'vitest';
import { loadRuns, saveRuns } from './history';
afterEach(() => localStorage.clear());
it('rejects malformed saved data', () => { localStorage.setItem('monitor-runs-v1', '{broken'); expect(loadRuns()).toEqual([]); localStorage.setItem('monitor-runs-v1', '[{}]'); expect(loadRuns()).toEqual([]); });
it('stores an empty history', () => { saveRuns([]); expect(loadRuns()).toEqual([]); });

it('round-trips finalized results and bounds retention to 20', () => {
  const metric = { value: 3, unit: 'tok/s', classification: 'derived' as const, source: 'Ollama', reason: null };
  const result = { model: 'test', generated_tokens: metric, prompt_tokens: metric, decode_rate: metric, prefill_rate: metric, decode_duration: metric, prefill_duration: metric, total_duration: metric, load_duration: metric };
  saveRuns(Array.from({ length: 25 }, (_, i) => ({ id: String(i), at: new Date().toISOString(), result, hardware: [] })));
  expect(loadRuns()).toHaveLength(20);
  expect(loadRuns()[0].id).toBe('5');
  expect(loadRuns()[19].result.decode_rate.value).toBe(3);
});
