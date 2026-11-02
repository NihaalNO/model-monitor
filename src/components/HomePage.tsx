import type { BenchmarkResult, Metric, OllamaStatus, Snapshot } from '../types';
import { formatMetric } from '../utils';
import { diagnose } from '../diagnostics';
import { Chart } from './Chart';

export function HomePage({ status, backend, checking, running, activity, latest, samples, result, measuredAt, charts, onBenchmark, onPerformance, onModels, nativeAvailable = true }: { nativeAvailable?: boolean; status: OllamaStatus; backend: string; checking: boolean; running: boolean; activity: string | null; latest?: Snapshot; samples: Snapshot[]; result: BenchmarkResult | null; measuredAt: string | null; charts: boolean; onBenchmark: () => void; onPerformance: () => void; onModels: () => void }) {
  const findings = diagnose(latest);
  // Swap allocation alone is informational, not an actionable alarm.
  const actionable = findings.find(f => !f.observation.startsWith('Allocated swap:'));
  const metrics: { label: string; metric: Metric; note?: string }[] = [];
  if (result?.decode_rate.value != null) metrics.push({label:'Last benchmark · generation',metric:result.decode_rate,note:`${result.model} · ${measuredAt ? new Date(measuredAt).toLocaleString() : 'Completed run'} · not live speed`});
  if (latest?.cpu.value != null) metrics.push({label:'CPU usage',metric:latest.cpu});
  if (latest?.gpus[0]?.utilization.value != null) metrics.push({label:'GPU usage',metric:latest.gpus[0].utilization});
  if (latest?.ram_used.value != null) metrics.push({label:'Memory used',metric:latest.ram_used});
  const series = [{name:'CPU',color:'#2563eb',values:samples.map(s => [s.timestamp_ms,s.cpu.value] as [number,number|null])}, ...(latest?.gpus[0]?.utilization.value != null ? [{name:'GPU',color:'#008575',values:samples.map(s => [s.timestamp_ms,s.gpus[0]?.utilization.value ?? null] as [number,number|null])}] : [])];
  return <>
    <section className="panel model-status" aria-label="Model status">
      <div><h2>{!nativeAvailable ? 'Connection not checked in browser preview' : checking && !status.connected ? 'Checking AI service…' : status.connected ? 'AI service connected' : 'AI service disconnected'}</h2><p>{backend}{status.version ? ` · ${status.version}` : ''}</p></div>
      <dl><div><dt>Loaded model</dt><dd>{!nativeAvailable ? 'Open the desktop app to check loaded models' : !status.connected ? 'Cannot check while disconnected' : status.warnings.some(w => w.startsWith('Loaded models:')) ? 'Loaded-model status temporarily unavailable' : status.loaded.length ? status.loaded.map(m=>m.name).join(', ') : 'No model loaded'}</dd></div><div><dt>Activity</dt><dd>{running ? 'Quick benchmark running in this app' : activity || 'No test running in this app'}</dd></div></dl>
      <button onClick={onModels}>View models &amp; connection</button>
    </section>
    {nativeAvailable && !status.connected && <p className="inline-help">Start {backend}, then check the connection in Models. Model availability is checked separately from service connectivity.</p>}
    {metrics.length > 0 && <section className="home-metrics" aria-label="Essential metrics">{metrics.slice(0,4).map(({label,metric,note}) => <article key={label} title={`${metric.source} · ${metric.classification}`}><h3>{label}</h3><strong>{formatMetric(metric)}</strong><p>{note || 'System-wide'}</p></article>)}</section>}
    {result?.decode_rate.value == null && <section className="benchmark-prompt"><div><h2>No benchmark measurement yet</h2><p>Run a short test to measure generation speed for a selected model.</p></div><button className="primary" onClick={onBenchmark}>Run Benchmark</button></section>}
    <div className="section-heading"><div><h2>System activity</h2><p>Usage across all applications on this computer.</p></div><button onClick={onPerformance}>View Performance</button></div>
    {charts && samples.some(s=>s.cpu.value != null || s.gpus[0]?.utilization.value != null) ? <Chart title="Processor activity" unit="%" series={series}/> : <p className="empty-inline">{charts ? 'Waiting for native hardware samples. Open the desktop app to monitor this computer.' : 'Charts are turned off in Settings. Current resource values remain available in Performance.'}</p>}
    {actionable && <section className="actionable"><div><h2>{actionable.observation}</h2><p>{actionable.explanation}</p></div><button onClick={onPerformance}>Investigate in Performance</button></section>}
  </>;
}
