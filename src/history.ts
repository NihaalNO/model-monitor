import { invoke, isTauri } from '@tauri-apps/api/core';
import type { BenchmarkResult, Snapshot } from './types';
export interface SavedRun { id: string; at: string; result: BenchmarkResult; hardware: Snapshot[]; context?: RunContext }
export interface RunContext { backend: string; quantization: string | null; promptCharacters: number; promptDigest: string; outputLimit: number; contextWindow: number | null; hardware: string }
const validMetric = (value: unknown): boolean => { if (!value || typeof value !== 'object') return false; const m = value as Record<string, unknown>; return (m.value === null || (typeof m.value === 'number' && Number.isFinite(m.value))) && typeof m.unit === 'string'; };
const keys = ['prefill_rate', 'decode_rate', 'total_duration'] as const;
const KEY = 'monitor-runs-v1';
export function loadRuns(limit = 20): SavedRun[] {
  try { const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is SavedRun => !!r && typeof r.id === 'string' && typeof r.at === 'string' && typeof r.result?.model === 'string' && Array.isArray(r.hardware) && keys.every(k => validMetric(r.result[k]))).slice(-limit);
  } catch { return []; }
}
export function saveRuns(runs: SavedRun[]): void { localStorage.setItem(KEY, JSON.stringify(runs.slice(-20))); }
export async function exportRuns(runs: SavedRun[]): Promise<string> {
  if (isTauri()) runs = await invoke('benchmark_store',{action:'export',runs:[],offset:0});
  const json = JSON.stringify({ version: 1, runs }, null, 2);
  if (isTauri()) {
    const path = await invoke<string | null>('export_benchmarks', { json });
    return path ? 'Export saved to ' + path : 'Export cancelled';
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, runs }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'model-monitor-runs.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'JSON download requested';
}

export function csvRuns(runs: SavedRun[]): string {
  const cell = (v: unknown) => { const text = v == null ? '' : String(v); const safe = /^[=+@-]/.test(text) ? "'" + text : text; return '"' + safe.replaceAll('"', '""') + '"'; };
  const rows: unknown[][] = [['id','timestamp_utc','model','prefill_tokens_per_second','decode_tokens_per_second','total_seconds','prompt_tokens','generated_tokens']];
  for (const r of runs) rows.push([r.id, new Date(r.at).toISOString(), r.result.model, r.result.prefill_rate.value, r.result.decode_rate.value, r.result.total_duration.value, r.result.prompt_tokens.value, r.result.generated_tokens.value]);
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export async function exportCsv(runs: SavedRun[]): Promise<string> {
  if (isTauri()) runs = await invoke('benchmark_store',{action:'export',runs:[],offset:0});
  const text = csvRuns(runs);
  if (isTauri()) { const path = await invoke<string | null>('export_csv', { csv: text }); return path ? 'CSV saved to ' + path : 'Export cancelled'; }
  const url = URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download='model-monitor-runs.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); return 'CSV download requested';
}

export async function initializeHistory(): Promise<SavedRun[]> {
 if (!isTauri()) return loadRuns();
 return invoke('benchmark_store',{action:'migrate',runs:loadRuns(Number.MAX_SAFE_INTEGER),offset:0});
}
export async function persistRun(run: SavedRun): Promise<SavedRun[]> {
 if (!isTauri()) { const next=[...loadRuns(),run]; saveRuns(next); return next; }
 return invoke('benchmark_store',{action:'save',runs:[run],offset:0});
}
export async function clearHistory(): Promise<void> {
 if (isTauri()) { await invoke('benchmark_store',{action:'delete',runs:[],offset:0}); return; }
 saveRuns([]);
}
export async function moreHistory(offset:number): Promise<SavedRun[]> {return invoke('benchmark_store',{action:'load',runs:[],offset});}

export function comparisonWarnings(a: SavedRun, b: SavedRun): string[] {
 if (!a.context || !b.context) return ['Legacy run: provider, settings and hardware metadata are incomplete.'];
 const keys: (keyof RunContext)[] = ['backend','quantization','promptDigest','outputLimit','hardware'];
 const warnings = keys.filter(k=>a.context![k]!==b.context![k]).map(k=>`Different ${k}; throughput is not a controlled comparison.`);
 if (a.context.contextWindow == null || b.context.contextWindow == null) warnings.push('Context window and cache state are not recorded by the backend; results are observational.');
 return warnings;
}
export function decodeChange(a: SavedRun,b: SavedRun): number | null {const base=a.result.decode_rate.value, next=b.result.decode_rate.value;return base!=null && next!=null && base>0 ? (next/base-1)*100 : null;}
