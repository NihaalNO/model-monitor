import { invoke, isTauri } from '@tauri-apps/api/core';
import type { BenchmarkResult, Snapshot } from './types';
export interface SavedRun { id: string; at: string; result: BenchmarkResult; hardware: Snapshot[] }
const validMetric = (value: unknown): boolean => { if (!value || typeof value !== 'object') return false; const m = value as Record<string, unknown>; return (m.value === null || (typeof m.value === 'number' && Number.isFinite(m.value))) && typeof m.unit === 'string'; };
const keys = ['prefill_rate', 'decode_rate', 'total_duration'] as const;
const KEY = 'monitor-runs-v1';
export function loadRuns(): SavedRun[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is SavedRun => !!r && typeof r.id === 'string' && typeof r.at === 'string' && typeof r.result?.model === 'string' && Array.isArray(r.hardware) && keys.every(k => validMetric(r.result[k]))).slice(-20);
  } catch { return []; }
}
export function saveRuns(runs: SavedRun[]): void { localStorage.setItem(KEY, JSON.stringify(runs.slice(-20))); }
export async function exportRuns(runs: SavedRun[]): Promise<string> {
  const json = JSON.stringify({ version: 1, runs }, null, 2);
  if (isTauri()) {
    const path = await invoke<string | null>('export_benchmarks', { json });
    return path ? 'Export saved to ' + path : 'Export cancelled';
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, runs }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'model-monitor-runs.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'JSON download requested';
}
