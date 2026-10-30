import { invoke, Channel, isTauri } from '@tauri-apps/api/core';
import type { BenchmarkResult, OllamaStatus, Progress, Snapshot } from './types';
export const desktop = isTauri();
function requireDesktop() { if (!desktop) throw new Error('Native monitoring requires the desktop app. Launch with npm run tauri dev. Browser preview does not supply hardware metrics.'); }
export async function sampleHardware(): Promise<Snapshot> { requireDesktop(); return invoke('sample_hardware'); }
export async function ollamaStatus(endpoint: string, provider = 'ollama'): Promise<OllamaStatus> { requireDesktop(); return invoke('ollama_status', { endpoint, provider }); }
export async function runBenchmark(endpoint: string, model: string, prompt: string, onOutput: (text: string) => void, onStarted: () => void, provider = 'ollama'): Promise<BenchmarkResult> {
  requireDesktop();
  const onProgress = new Channel<Progress>();
  onProgress.onmessage = message => { if (message.kind === 'output') onOutput(message.text); else if (message.kind === 'started') onStarted(); };
  return invoke('run_benchmark', { endpoint, model, prompt, onProgress, provider });
}
export async function cancelBenchmark(): Promise<void> { requireDesktop(); return invoke('cancel_benchmark'); }

