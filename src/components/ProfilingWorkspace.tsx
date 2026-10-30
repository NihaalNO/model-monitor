import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { desktop, cancelBenchmark } from '../services';
import { capabilities, importProfile, analysisStore, trial, presets, fixedMaterial, statistics, aggregate, findings, kvBytes, type AnalysisSession, type Capability, type SessionState, type Trial } from '../profiling';
import type { Settings, Snapshot } from '../types';
import { Chart } from './Chart';

const number = (n: number | null | undefined, unit = '') => n == null ? 'Unavailable' : `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${unit}`;
export function ProfilingWorkspace({ mode, model, settings, sample, busy, onBusy }: { mode: 'profile' | 'experiment'; model: string; settings: Settings; sample?: Snapshot; busy: boolean; onBusy: (busy: boolean) => void }) {
  const [tab, setTab] = useState('Dashboard');
  const [caps, setCaps] = useState<Capability[]>([]);
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [selected, setSelected] = useState<AnalysisSession>();
  const [state, setState] = useState<SessionState>('Idle');
  const [error, setError] = useState('');
  const [preset, setPreset] = useState(0);
  const [warmups, setWarmups] = useState(1);
  const [repetitions, setRepetitions] = useState(3);
  const [context, setContext] = useState(8192);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'total' | 'name' | 'calls'>('total');
  const [ascending, setAscending] = useState(false);
  const [detail, setDetail] = useState('');
  const [architecture, setArchitecture] = useState([32, 8, 128, 8192, 2]);
  const cancelled = useRef(false);
  const active = useRef(false);
  const samples = useRef<Snapshot[]>([]);
  const currentSample = useRef(sample);
  currentSample.current = sample;
  useEffect(() => { if (active.current && sample && samples.current.length < 600) samples.current.push(sample); }, [sample]);
  useEffect(() => {
    if (desktop) {
      void capabilities().then(setCaps).catch(e => setError(String(e)));
      void analysisStore('load').then(setSessions).catch(e => setError(String(e)));
    }
  }, []);
  // The workspace stays mounted across navigation; cancellation stops admission between trials.
  const report = selected?.report;
  const groups = useMemo(() => aggregate(report?.kernels ?? []).filter(k => k.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'calls' ? a.calls - b.calls : (a.total ?? -1) - (b.total ?? -1)) * (ascending ? 1 : -1)), [report, filter, sort, ascending]);
  const measured = selected?.trials?.filter(t => !t.warmup) ?? [];
  const estimate = kvBytes(...architecture as [number, number, number, number, number]);
  async function save(session: AnalysisSession) {
    setSelected(session);
    try { setSessions(await analysisStore('save', session)); }
    catch (e) { setError(`Result retained in this view; persistence failed: ${String(e)}`); }
  }
  async function loadFile(file?: File) {
    if (!file || active.current || busy) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 8 * 1024 ** 2) { setError('Choose a Nsight Compute CSV up to 8 MiB. Binary .ncu-rep files must first be exported using ncu.'); return; }
    active.current = true; onBusy(true); cancelled.current = false; setError(''); setState('Preparing');
    try {
      const text = await file.text();
      if (cancelled.current) { setState('Cancelled'); return; }
      setState('Processing');
      const imported = await importProfile(text);
      if (cancelled.current) { setState('Cancelled'); return; }
      await save({ id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'profile', model, backend: settings.provider || 'ollama', gpu: 'Unverified — capture GPU not supplied by CSV', profiler: 'Nsight Compute — version unverified', state: 'Completed', config: { source: file.name, selectedModelIsUnverified: true, requestedMetrics: 'Unavailable: original capture configuration not supplied' }, report: imported, warnings: imported.warnings, durationSeconds: null });
      setState('Completed');
    } catch (e) { setError(String(e)); setState('Failed'); }
    finally { active.current = false; onBusy(false); }
  }
  async function run() {
    if (active.current || busy || !model) return;
    if (![warmups,repetitions,context].every(Number.isInteger) || warmups < 0 || warmups > 5 || repetitions < 2 || repetitions > 10 || context < 256 || context > 131072) { setError('Use 0–5 warmups, 2–10 repetitions, and context 256–131072.'); return; }
    active.current = true; onBusy(true); cancelled.current = false; setError(''); setState('Preparing');
    const trials: Trial[] = [];
    const started = performance.now();
    let terminal: SessionState = 'Completed';
    const warnings = ['Seed 42 and temperature 0 requested; backend determinism is not guaranteed. Prompt-cache state may affect prefill; Ollama cache behavior is not controlled.', 'Prompt sizes are fixed text repetitions, not token counts. Effective context, truncation, batch size, GPU offload, quantization and tokenizer/sampling timing boundaries are not independently verified.', 'Hardware samples are system-wide, bounded to 600 per trial. They are not process-attributed. Warmups are retained and excluded from summary statistics.'];
    try {
      for (const repeat of presets[preset].repeats) {
        for (let i = 0; i < warmups + repetitions; i++) {
          if (cancelled.current) { terminal = 'Cancelled'; break; }
          setState('Running'); samples.current = [];
          const begin = performance.now();
          const result = await trial(settings.endpoint, model, fixedMaterial.repeat(repeat), settings.provider || 'ollama', presets[preset].output, settings.provider === 'llamacpp' ? null : context, () => { if (cancelled.current) void cancelBenchmark().catch(e => setError(String(e))); });
          trials.push({ promptRepeat: repeat, warmup: i < warmups, result: { ...result, output: '' }, hardware: samples.current.slice(), wallSeconds: (performance.now() - begin) / 1000 });
        }
        if (cancelled.current) { terminal = 'Cancelled'; break; }
      }
    } catch (e) { terminal = cancelled.current ? 'Cancelled' : 'Failed'; warnings.push(String(e)); setError(String(e)); }
    if (cancelled.current) terminal = 'Cancelled';
    try {
      setState('Processing');
      await save({ id: crypto.randomUUID(), at: new Date().toISOString(), kind: 'experiment', model, backend: settings.provider || 'ollama', gpu: currentSample.current?.gpus.map(g => g.name).join(', ') || 'Unavailable', profiler: 'Unprofiled server API', state: terminal, config: { preset: presets[preset].name, promptRepeats: presets[preset].repeats, fixedMaterial, requestedOutputTokens: presets[preset].output, requestedContext: settings.provider === 'llamacpp' ? null : context, warmups, repetitions, samplingIntervalMs: settings.interval, batchSize: null, gpuOffload: null, quantization: null, seed: 42, temperature: 0 }, trials, warnings, durationSeconds: (performance.now() - started) / 1000 });
      setState(terminal);
    } finally { active.current = false; onBusy(false); }
  }
  async function cancel() { cancelled.current = true; if (mode === 'experiment') { try { await cancelBenchmark(); } catch(e) { setError(String(e)); } } }
  const tabs = mode === 'profile' ? ['Dashboard','Kernel Analysis','Memory Analysis','History'] : ['Dashboard','Attention Analysis','History'];
  return <div className="profiling-workspace">
    <div className="profiling-tabs" role="group" aria-label="Analysis views">{tabs.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); if (t === 'History' && desktop) void analysisStore('load').then(setSessions).catch(e => setError(String(e))); }}>{t}</button>)}</div>
    <div role="status" className="notice">{state} · {mode === 'profile' ? 'Opt-in report import; no live capture or process attachment.' : 'Controlled unprofiled benchmarks; existing single-run benchmarks remain available.'}</div>
    {error && <div role="alert" className="notice error">{error}</div>}
    {tab === 'Dashboard' && <>
      <section className="panel"><h2>{mode === 'profile' ? 'Deep Profiler' : 'Benchmark Experiments'}</h2><p>Selected model: {model || 'Select an installed model on the Models page'} · {sample?.gpus.map(g => g.name).join(', ') || 'GPU unavailable'}</p>
        {mode === 'profile' ? <><p>Import a long-form Nsight Compute raw CSV exported with <code>ncu --import capture.ncu-rep --page raw --csv --units base</code>. Capture metadata is unverified. Profiling replay can alter timings.</p><label>Profiler report (.csv)<input type="file" accept=".csv" disabled={!desktop || busy} onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ''; }}/></label></> : <div className="profiling-form">
          <label>Workload preset<select value={preset} disabled={busy} onChange={e => setPreset(Number(e.target.value))}>{presets.map((p,i) => <option key={p.name} value={i}>{p.name}</option>)}</select></label>
          <label>Warmup iterations<input type="number" min={0} max={5} value={warmups} disabled={busy} onChange={e => setWarmups(Number(e.target.value))}/></label>
          <label>Measured repetitions<input type="number" min={2} max={10} value={repetitions} disabled={busy} onChange={e => setRepetitions(Number(e.target.value))}/></label>
          <label>Requested context (Ollama only)<input type="number" min={256} max={131072} value={context} disabled={busy || settings.provider === 'llamacpp'} onChange={e => setContext(Number(e.target.value))}/></label>
          <p>Output cap: {presets[preset].output} tokens · Sampling: {settings.interval} ms. Quantization, batch size and GPU offload use backend configuration and are unverified here. llama.cpp context is a server-startup setting.</p>
          <button disabled={!desktop || busy || !model} onClick={() => void run()}>Run experiment</button>
        </div>}
        {active.current && <button onClick={() => void cancel()}>Cancel {mode === 'profile' ? 'import' : 'experiment'}</button>}
      </section>
      {mode === 'profile' && <section className="panel"><h2>Profiler availability</h2>{!desktop && <p>Unavailable in browser preview. Open the desktop app to discover local tools.</p>}<div className="table-scroll"><table className="run-table"><thead><tr><th>Capability</th><th>Status</th><th>Requirement / limitation</th></tr></thead><tbody>{caps.map(c => <tr key={c.name}><td><a href={c.reference} target="_blank" rel="noreferrer">{c.name}</a></td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table></div></section>}
    </>}
    {tab === 'Kernel Analysis' && <section className="panel"><h2>Kernel launches · {report?.kernels.length ?? 0} collected</h2><label>Filter kernel names<input value={filter} onChange={e => setFilter(e.target.value)}/></label><label>Sort<select value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="total">Collected total duration</option><option value="name">Kernel name</option><option value="calls">Calls</option></select></label><button onClick={() => setAscending(v => !v)}>{ascending ? 'Ascending' : 'Descending'}</button><div className="table-scroll"><table className="run-table"><thead><tr><th>Kernel name</th><th>Calls</th><th>Total collected time</th><th>Average collected time</th></tr></thead><tbody>{groups.slice(0,200).map(k => <tr key={k.name}><td><button onClick={() => setDetail(k.name)}>{k.name}</button></td><td>{k.calls}</td><td>{number(k.total,'s')} ({k.timedCalls}/{k.calls} timed)</td><td>{number(k.average,'s')}</td></tr>)}</tbody></table></div><p>Showing at most 200 names. Durations cover available counters only; missing launches are not zero.</p>{detail && <><h3>{detail}</h3>{report?.kernels.filter(k => k.name === detail).slice(0,10).map(k => <div key={k.id}><strong>Launch {k.id}</strong>{k.counters.map(c => <p key={c.original_name}>{c.original_name}: {number(c.value,c.unit)} · {c.reason || 'Nsight Compute imported counter'}</p>)}</div>)}</>}</section>}
    {tab === 'Memory Analysis' && <section className="panel"><h2>Imported memory and cache counters</h2><p>DRAM bandwidth, cache activity, NVML memory-controller utilization, PCIe throughput, VRAM allocation and model residency are separate measurements. Exact weight reads, memory-copy attribution and theoretical peak bandwidth are unavailable here.</p><div className="table-scroll"><table className="run-table"><thead><tr><th>Launch</th><th>Original metric</th><th>Value / source unit</th></tr></thead><tbody>{report?.kernels.flatMap(k => k.counters.filter(c => ['device_memory','l2_cache'].includes(c.category)).map(c => <tr key={k.id+c.original_name}><td>{k.id}</td><td>{c.original_name}</td><td>{number(c.value,c.unit)} · original: {c.original_unit} {c.reason}</td></tr>)).slice(0,500)}</tbody></table></div></section>}
    {tab === 'Attention Analysis' && <>
      <div className="notice">Context scaling is measured using backend-reported prompt tokens, which can reflect caching or truncation. End-of-prefill context and attention-specific time are unverified. These curves do not isolate attention cost.</div>
      <div className="chart-grid"><Chart title="Reported prompt tokens versus prefill latency" unit="s" numeric series={[{ name: 'Measured repetitions', color: '#2563eb', values: measured.filter(t => t.result.prompt_tokens.value !== null).map(t => [t.result.prompt_tokens.value!,t.result.prefill_duration.value]) }]}/><Chart title="Reported prompt tokens versus decode throughput" unit="tok/s" numeric series={[{ name: 'Measured repetitions', color: '#2563eb', values: measured.filter(t => t.result.prompt_tokens.value !== null).map(t => [t.result.prompt_tokens.value!,t.result.decode_rate.value]) }]}/></div>
      <section className="panel"><h2>KV-cache estimate · explicit architecture assumptions</h2><div className="profiling-form">{['Layers','KV heads (MHA/GQA/MQA)','Head dimension','Context tokens','Bytes per K/V element'].map((label,i) => <label key={label}>{label}<input type="number" min={i === 4 ? 0.5 : 1} step={i === 4 ? 0.5 : 1} value={architecture[i]} onChange={e => setArchitecture(a => a.map((n,j) => i === j ? Number(e.target.value) : n))}/></label>)}</div><p>{number(estimate === null ? null : estimate / 1024 ** 3,'GiB')} · Estimated, not measured: 2 × layers × KV heads × head dimension × context × bytes/element. Uniform K/V dimensions, one sequence, all layers cached. Excludes allocator overhead, quantization scales, padding, sliding windows and hybrid layers. Defaults are illustrative assumptions, not detected model metadata.</p></section>
    </>}
    {tab === 'History' && <section className="panel"><h2>Profiling and experiment history</h2><p>Up to 200 sessions; explicit deletion. Export before deleting. Selecting a report never reruns inference.</p>{sessions.filter(s => s.kind === mode).map(s => <div className="profiling-history" key={s.id}><button disabled={busy} onClick={() => void analysisStore('get', undefined, s.id).then(rows => { setSelected(rows[0]); setTab('Dashboard'); }).catch(e => setError(String(e)))}>{s.at} · {s.model || 'Unknown model'} · {s.state}</button><button disabled={busy} onClick={() => void analysisStore('delete', undefined, s.id).then(next => { setSessions(next); if (selected?.id === s.id) setSelected(undefined); }).catch(e => setError(String(e)))}>Delete session</button></div>)}</section>}
    {selected && <section className="panel"><h2>Selected {selected.kind} · {selected.state}</h2><p>{selected.model || 'Unknown model'} · {selected.backend} · {selected.gpu} · {selected.profiler} · Duration: {number(selected.durationSeconds,'s')}</p><button disabled={!desktop} onClick={() => void invoke('export_benchmarks', { json: JSON.stringify(selected,null,2) }).catch(e => setError(String(e)))}>Export selected report JSON</button>{selected.warnings.map((w,i) => <p key={i}>{w}</p>)}{report && findings(report).map(f => <p key={f}>{f}</p>)}
      {measured.length > 0 && <><h3>Throughput statistics by fixed prompt size · warmups excluded</h3>{[...new Set(measured.map(t => t.promptRepeat))].map(repeat => <div key={repeat}><strong>{repeat} text repetitions</strong>{(['prefill_rate','decode_rate'] as const).map(key => { const s = statistics(measured.filter(t => t.promptRepeat === repeat).map(t => t.result[key].value)); return <p key={key}>{key}: {s ? `n=${s.count}, min ${number(s.min)}, max ${number(s.max)}, mean ${number(s.mean)}, median ${number(s.median)}, sample SD ${number(s.stddev)} tok/s, sample variance ${number(s.variance)} (tok/s)²` : 'Unavailable'}</p>; })}</div>)}<details><summary>Raw trials (including warmups)</summary><div className="table-scroll"><table className="run-table"><thead><tr><th>Prompt size</th><th>Warmup</th><th>Reported tokens</th><th>Prefill</th><th>Decode</th><th>Wall time</th><th>Samples</th></tr></thead><tbody>{selected.trials?.map((t,i) => <tr key={i}><td>{t.promptRepeat}</td><td>{String(t.warmup)}</td><td>{number(t.result.prompt_tokens.value)}</td><td>{number(t.result.prefill_rate.value,'tok/s')}</td><td>{number(t.result.decode_rate.value,'tok/s')}</td><td>{number(t.wallSeconds,'s')}</td><td>{t.hardware.length}</td></tr>)}</tbody></table></div></details></>}
    </section>}
    {!selected && tab !== 'Dashboard' && <p className="notice">No report selected. Import a measured report or run an experiment; synthetic measurements are never displayed.</p>}
  </div>;
}
