import { invoke, Channel } from '@tauri-apps/api/core';
import type { BenchmarkResult, Progress, Snapshot } from './types';
export interface Capability { name: string; status: string; detail: string; reference: string }
export interface Counter { original_name: string; original_unit: string; original_value?: string; unit: string; value: number | null; category: string; reason: string | null }
export interface Kernel { id: string; name: string; counters: Counter[] }
export interface ProfileReport { schema: number; kernels: Kernel[]; warnings: string[] }
export type SessionState = 'Idle' | 'Preparing' | 'Running' | 'Processing' | 'Completed' | 'Failed' | 'Cancelled';
export interface Trial { promptRepeat: number; warmup: boolean; result: BenchmarkResult; hardware: Snapshot[]; wallSeconds: number }
export interface AnalysisSession { id: string; at: string; kind: 'profile' | 'experiment'; model: string; backend: string; gpu: string; profiler: string; state: SessionState; config: Record<string, unknown>; report?: ProfileReport; trials?: Trial[]; warnings: string[]; durationSeconds: number | null }
export const capabilities = () => invoke<Capability[]>('profiler_capabilities');
export const importProfile = (csv: string) => invoke<ProfileReport>('import_profile', { csv });
export const analysisStore = (action: 'load' | 'save' | 'delete' | 'get', session?: AnalysisSession, id?: string) => invoke<AnalysisSession[]>('analysis_store', { action, session, id });
export async function trial(endpoint: string, model: string, prompt: string, provider: string, output_tokens: number, context_length: number | null, onStarted: () => void) {
  const onProgress = new Channel<Progress>();
  onProgress.onmessage = message => { if (message.kind === 'started') onStarted(); };
  return invoke<BenchmarkResult>('run_experiment_trial', { endpoint, model, prompt, provider, onProgress, options: { output_tokens, context_length } });
}
export const fixedMaterial = 'A local inference system processes a prompt before generating each output token. Compare computation, memory traffic, and the effect of increasing context. Use the supplied material and explain the tradeoffs. ';
export const presets = [
  { name: 'Short prompt / short generation', repeats: [1], output: 64 },
  { name: 'Short prompt / long generation', repeats: [1], output: 512 },
  { name: 'Long prompt / short generation', repeats: [64], output: 64 },
  { name: 'Long prompt / long generation', repeats: [64], output: 512 },
  { name: 'Context-length scaling', repeats: [1, 8, 32, 64], output: 64 },
];
export function statistics(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const variance = v.length > 1 ? v.reduce((s, n) => s + (n - mean) ** 2, 0) / (v.length - 1) : null;
  return { count: v.length, min: v[0], max: v[v.length - 1], mean, median: (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2, variance, stddev: variance === null ? null : Math.sqrt(variance) };
}
export function kvBytes(layers: number, kvHeads: number, headDimension: number, context: number, bytesPerElement: number) {
  if (![layers, kvHeads, headDimension, context].every(n => Number.isSafeInteger(n) && n > 0) || ![0.5, 1, 2, 4].includes(bytesPerElement)) return null;
  const bytes = 2 * layers * kvHeads * headDimension * context * bytesPerElement;
  return Number.isSafeInteger(bytes) ? bytes : null;
}
export function aggregate(kernels: Kernel[]) {
  const groups = new Map<string, { name: string; calls: number; total: number | null; timedCalls: number }>();
  for (const k of kernels) {
    const g = groups.get(k.name) ?? { name: k.name, calls: 0, total: null, timedCalls: 0 };
    g.calls++;
    const duration = k.counters.find(c => c.original_name === 'gpu__time_duration.sum' && c.unit === 's')?.value;
    if (duration != null) { g.total = (g.total ?? 0) + duration; g.timedCalls++; }
    groups.set(k.name, g);
  }
  return [...groups.values()].map(g => ({ ...g, average: g.total === null ? null : g.total / g.timedCalls }));
}
export function findings(report: ProfileReport) {
  const occupancy = report.kernels.flatMap(k => k.counters.filter(c => c.original_name === 'sm__warps_active.avg.pct_of_peak_sustained_active' && c.unit === '%' && c.value !== null));
  if (!occupancy.length) return ['Insufficient profiling evidence'];
  const mean = statistics(occupancy.map(c => c.value))!.mean;
  return [`Occupancy: ${mean.toFixed(1)}% arithmetic mean across ${occupancy.length} collected launches. Method: unweighted launch-counter average. Possible explanation: launch dimensions or register/shared-memory limits. Confidence: low for causality. Limitation: selected instrumented launches, not a duration-weighted workload measure. Investigate launch dimensions and resource limits before concluding a bottleneck.`];
}
