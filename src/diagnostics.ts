import type { Snapshot } from './types';
export interface Finding { observation: string; explanation: string; strength: string; investigation: string }
export function diagnose(s?: Snapshot): Finding[] {
  if (!s) return [];
  const findings: Finding[] = [];
  if (s.cpu.value != null && s.cpu.value >= 90) findings.push({ observation: `System CPU utilization is ${s.cpu.value.toFixed(1)}%.`, explanation:'CPU contention may affect inference; this includes every application.', strength:'Low: one system-wide sample', investigation:'Inspect per-core activity and inference processes over multiple samples.' });
  for (const g of s.gpus) {
    if (g.vram_used.value != null && g.vram_total.value != null && g.vram_total.value > 0 && g.vram_used.value / g.vram_total.value >= .9) findings.push({ observation:`${g.name}: VRAM allocation exceeds 90%.`, explanation:'Limited device-memory headroom may constrain larger contexts or other workloads.', strength:'Moderate for memory pressure; low for causality', investigation:'Compare context size, loaded models and other GPU allocations.' });
    if (g.power.value != null && g.power_limit?.value != null && g.power_limit.value > 0 && g.power.value / g.power_limit.value >= .95) findings.push({ observation:`${g.name}: power is within 5% of its reported limit.`, explanation:'Power headroom is low; this alone does not prove throttling.', strength:'Low: no throttle-reason counter', investigation:'Inspect sustained clocks, temperature and a native profiler.' });
  }
  if (s.swap_used?.value != null && s.swap_used.value > 0) findings.push({ observation:`Allocated swap: ${(s.swap_used.value/1024**3).toFixed(2)} GiB.`, explanation:'Swap allocation is present; allocation does not establish active paging or an inference bottleneck.', strength:'Low: occupancy, not I/O rate', investigation:'Inspect OS page-in/page-out counters over time.' });
  return findings;
}
