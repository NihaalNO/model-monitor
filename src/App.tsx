import { loadRuns, saveRuns, exportRuns, type SavedRun } from './history';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, Layers, FlaskConical, Settings2, RefreshCw, Play, Square, ArrowUpRight } from 'lucide-react';
import { MetricCard } from './components/MetricCard';
import { Chart } from './components/Chart';
import { desktop, sampleHardware, ollamaStatus, runBenchmark, cancelBenchmark } from './services';
import { boundedAppend, formatMetric, loadSettings, unavailable, validateSettings } from './utils';
import type { BenchmarkResult, Metric, OllamaStatus, Settings, Snapshot } from './types';

const navigation = [{ name: 'Overview', icon: Activity }, { name: 'Hardware', icon: Cpu }, { name: 'Models', icon: Layers }, { name: 'Benchmark', icon: FlaskConical }, { name: 'Settings', icon: Settings2 }] as const;
type Page = typeof navigation[number]['name'];
const pendingStatus: OllamaStatus = { connected: false, version: null, installed: [], loaded: [], error: null, warnings: [] };

export default function App() {
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>(loadRuns);
  const [historyError, setHistoryError] = useState('');
  const [page, setPage] = useState<Page>('Overview');
  const [settings, setSettings] = useState(loadSettings);
  const [draft, setDraft] = useState<Settings>(settings);
  const [settingsError, setSettingsError] = useState('');
  const [samples, setSamples] = useState<Snapshot[]>([]);
  const [hardwareError, setHardwareError] = useState('');
  const [status, setStatus] = useState<OllamaStatus>(pendingStatus);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Explain the difference between prompt processing and token generation in a local language model.');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [started, setStarted] = useState(false);
  const [recordedSamples, setRecordedSamples] = useState(0);
  const [benchmarkState, setBenchmarkState] = useState('Ready');
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [lastResult, setLastResult] = useState<BenchmarkResult | null>(null);
  const connectionBusy = useRef(false);
  const benchmarkBusy = useRef(false);
  const hardwareBusy = useRef(false);
  const activeSamples = useRef<Snapshot[]>([]);
  const endpointRef = useRef(settings.endpoint);
  endpointRef.current = settings.endpoint;
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (hardwareBusy.current) { timer = setTimeout(poll, settings.interval); return; }
      hardwareBusy.current = true;
      try {
        const sample = await sampleHardware();
        if (benchmarkBusy.current) activeSamples.current = boundedAppend(activeSamples.current, sample, 600);
        if (!disposed) { setSamples(h => boundedAppend(h, sample, settings.history)); setHardwareError(''); }
      } catch (e) { if (!disposed) setHardwareError(String(e)); }
      finally { hardwareBusy.current = false; }
      if (!disposed) timer = setTimeout(poll, settings.interval);
    };
    if (desktop) void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [settings.interval, settings.history]);

  const refreshConnection = useCallback(async () => {
    if (connectionBusy.current) return;
    connectionBusy.current = true;
    const endpoint = settings.endpoint;
    setChecking(true);
    try {
      const next = await ollamaStatus(endpoint);
      if (endpointRef.current === endpoint) {
        setStatus(next);
        setModel(current => next.installed.some(m => m.name === current) ? current : (next.installed[0]?.name || ''));
      }
    } catch (e) {
      if (endpointRef.current === endpoint) setStatus({ ...pendingStatus, error: String(e) });
    } finally { connectionBusy.current = false; setChecking(false); }
  }, [settings.endpoint]);

  useEffect(() => {
    setStatus(pendingStatus);
    void refreshConnection();
    const timer = setInterval(() => {
      void refreshConnection();
    }, 10000);
    return () => clearInterval(timer);
  }, [refreshConnection]);

  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [output, page]);
  const latest = samples.at(-1);
  const gpu = latest?.gpus[0];
  const software = (key: 'decode_rate' | 'prefill_rate'): Metric => lastResult ? lastResult[key] : unavailable(key.includes('rate') ? 'tok/s' : 's', 'Run an integrated benchmark to collect API-reported metrics');
  const hardware = (metric: Metric | undefined, unit: string): Metric => {
    if (hardwareError) return unavailable(unit, hardwareError);
    return metric ?? unavailable(unit, desktop ? (latest?.gpu_status || 'Waiting for hardware sample') : 'Launch the Tauri desktop app to collect native measurements');
  };
  const cards = [
    { label: 'Token generation · decode', metric: software('decode_rate'), accent: true },
    { label: 'Prompt processing · prefill', metric: software('prefill_rate'), accent: true },
    { label: 'CPU utilization', metric: hardware(latest?.cpu, '%') },
    { label: 'GPU 0 utilization', metric: hardware(gpu?.utilization, '%') },
    { label: 'System RAM used', metric: hardware(latest?.ram_used, 'bytes') },
    { label: 'GPU 0 VRAM used', metric: hardware(gpu?.vram_used, 'bytes') },
    { label: 'GPU 0 temperature', metric: hardware(gpu?.temperature, '°C') },
    { label: 'GPU 0 power', metric: hardware(gpu?.power, 'W') },
  ];
  const charts = useMemo(() => {
    const line = (get: (s: Snapshot) => Metric | undefined, divisor = 1): [number, number | null][] => samples.map(s => { const v = get(s)?.value; return [s.timestamp_ms, v == null ? null : v / divisor]; });
    return [
      { title:'CPU utilization', unit:'%', series:[{ name:'CPU', color:'#2563eb', values:line(s => s.cpu) }] },
      { title:'GPU 0 utilization', unit:'%', series:[{ name:'GPU 0', color:'#7c3aed', values:line(s => s.gpus[0]?.utilization) }] },
      { title:'System RAM used', unit:'GiB', series:[{ name:'RAM', color:'#0284c7', values:line(s => s.ram_used,1024 ** 3) }] },
      { title:'GPU 0 VRAM used', unit:'GiB', series:[{ name:'VRAM', color:'#b45309', values:line(s => s.gpus[0]?.vram_used,1024 ** 3) }] },
      { title:'GPU 0 temperature', unit:'°C', series:[{ name:'Temperature', color:'#dc2626', values:line(s => s.gpus[0]?.temperature) }] },
    ];
  }, [samples]);
  const throughputSeries = useMemo(() => [
    { name:'Decode', color:'#2563eb', values:results.map((r,i): [string,number|null] => [String(i+1)+' · '+r.model,r.decode_rate.value]) },
    { name:'Prefill', color:'#7c3aed', values:results.map((r,i): [string,number|null] => [String(i+1)+' · '+r.model,r.prefill_rate.value]) },
  ], [results]);
  async function startBenchmark() {
    if (benchmarkBusy.current) return;
    benchmarkBusy.current = true;
    activeSamples.current = []; setRecordedSamples(0);
    setRunning(true); setStarted(false); setCancelling(false); setOutput(''); setLastResult(null); setBenchmarkState('Running · model loading / prompt processing');
    try {
      const result = await runBenchmark(settings.endpoint, model, prompt, text => {
        setOutput(current => (current + text).slice(-131072));
        setBenchmarkState('Running · streaming output');
      }, () => setStarted(true));
      setOutput(result.output || 'The model returned no answer text. It may have used its token budget for reasoning.');
      const run: SavedRun = { id: crypto.randomUUID(), at: new Date().toISOString(), result: { ...result, output: '' }, hardware: activeSamples.current.slice() };
      const next = boundedAppend(savedRuns, run, 20);
      try { saveRuns(next); setSavedRuns(next); setHistoryError(''); } catch { setHistoryError('Could not save run: local storage is full or unavailable. Export existing runs before clearing history.'); }
      setLastResult(result); setResults(h => boundedAppend(h, result, 20)); setBenchmarkState('Complete · final Ollama metrics received');
    } catch (e) { setBenchmarkState(String(e)); }
    finally { setRecordedSamples(activeSamples.current.length); benchmarkBusy.current = false; setRunning(false); setCancelling(false); void refreshConnection(); }
  }
  async function cancel() {
    setCancelling(true);
    try { await cancelBenchmark(); setBenchmarkState('Cancellation requested · closing inference stream'); }
    catch (e) { setBenchmarkState(String(e)); setCancelling(false); }
  }
  function saveSettings() {
    const message = validateSettings(draft);
    if (message) { setSettingsError(message); return; }
    try { localStorage.setItem('monitor-settings', JSON.stringify(draft)); setSettings({ ...draft }); setSettingsError('Saved'); }
    catch { setSettingsError('Could not persist settings. Check local storage permissions.'); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Activity size={22}/></span><div>MODEL<span>MONITOR</span></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(n => <button key={n.name} className={page === n.name ? 'nav-item active' : 'nav-item'} onClick={() => setPage(n.name)}><n.icon size={18}/>{n.name}{n.name === 'Benchmark' && running && <i className="dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="tag measured">PHASE 02</span><p>Local inference.<br/>Visible performance.</p><small>No cloud telemetry</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="platform">{latest ? latest.os + ' · ' + latest.arch : desktop ? 'Detecting system…' : 'Browser preview'}</div><div className="connection"><span className="selected-model" title={model}>{model || 'No model selected'}</span><i className={'dot ' + (status.connected ? 'online' : 'offline')}/>{checking ? 'Checking Ollama…' : status.connected ? 'Ollama ' + status.version : 'Ollama disconnected'}<button className="icon-button" aria-label="Retry Ollama connection" onClick={() => void refreshConnection()} disabled={checking || !desktop}><RefreshCw size={15}/></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">LOCAL AI PERFORMANCE MONITOR</div><h1>{page === 'Overview' ? 'Your inference, in focus.' : page}</h1><p>{page === 'Overview' ? 'System-wide hardware telemetry and API-reported benchmark results.' : page === 'Benchmark' ? 'Measure prefill and decode separately with a controlled Ollama request.' : 'Measurements stay on this device.'}</p></div><span className="mode-badge"><i className={'dot ' + (running ? 'online' : '')}/>{running ? 'Integrated benchmark' : 'Passive monitoring'}</span></div>
        {!desktop && <div role="status" className="notice">Browser preview · Native telemetry and inference are unavailable here. Start the desktop app with <code>npm run tauri dev</code>.</div>}
        {hardwareError && <div role="alert" className="notice error">{hardwareError}. Displayed hardware values are unavailable until sampling recovers.</div>}
        {status.error && desktop && <div className="notice error">Ollama: {status.error}</div>}
        {status.warnings.map(w => <div className="notice" key={w}>{w}</div>)}
        {page === 'Overview' && <>
          <section className="section-caption"><span><i className="dot online"/> LIVE HARDWARE · SYSTEM-WIDE</span><span>{lastResult ? 'Software metrics: last completed benchmark · ' + lastResult.model : 'Software metrics: no benchmark yet'}</span></section>
          <div className="metric-grid">{cards.map(c => <MetricCard key={c.label} {...c}/>)}</div>
          <section className="panel system-strip"><div><Cpu size={20}/><span>{latest?.cpu_name || 'CPU detection pending'}<small>{latest ? latest.logical_cpus + ' logical CPUs' : 'Native hardware access required'}</small></span></div><div><Layers size={20}/><span>{gpu?.name || 'GPU telemetry unavailable'}<small>{latest?.gpu_status || 'NVML · optional NVIDIA adapter'}</small></span></div><button onClick={() => setPage('Hardware')}>Hardware details <ArrowUpRight size={16}/></button></section>
          {settings.charts && <div className="chart-grid">
            {charts.map(c => <Chart key={c.title} {...c} interval={settings.interval}/>)}
            <Chart title="Completed benchmark throughput" unit="tok/s" category series={throughputSeries}/>
          </div>}
          <div className="notice subtle">Hardware samples include all applications. Exact token rates are available only for benchmarks initiated here. {samples.length} / {settings.history} samples retained.</div>
        </>}
        {page === 'Hardware' && <>
          <section className="panel"><h2>Detected display adapters</h2>{latest?.adapters.map((a,i) => <p key={i}>{a.name} · {a.vendor} · {a.source}</p>)}{!latest?.adapters.length && <p>{latest?.adapter_status || 'No adapters reported by the operating system yet'}</p>}</section>
          <section className="panel"><h2>{latest?.cpu_name || 'CPU & memory'}</h2><p>{latest?.os} · {latest?.arch} · {latest?.logical_cpus ?? '—'} logical CPUs</p><div className="metric-grid compact">{[['CPU utilization', latest?.cpu], ['RAM used', latest?.ram_used], ['RAM available', latest?.ram_available], ['RAM total', latest?.ram_total]].map(([label,m]) => <MetricCard key={String(label)} label={String(label)} metric={hardware(m as Metric | undefined,label === 'CPU utilization' ? '%' : 'bytes')}/>)}</div></section>
          {latest?.gpus.map((g,i) => <section className="panel" key={i}><h2>GPU {i} · {g.name}</h2><p>{g.vendor} · NVML · all measurements system-wide</p><div className="metric-grid compact">{[['Utilization',g.utilization],['VRAM used',g.vram_used],['VRAM total',g.vram_total],['VRAM available',g.vram_available],['Temperature',g.temperature],['Power',g.power],['Core clock',g.core_clock]].map(([label,m]) => <MetricCard key={String(label)} label={String(label)} metric={hardware(m as Metric, (m as Metric).unit)}/>)}</div></section>)}
          {(!latest?.gpus.length || latest.gpu_status) && <div className="notice">{latest?.gpu_status || 'GPU telemetry unavailable. NVIDIA driver and NVML are required. AMD/Intel performance counters are unavailable in Phase 1.'}</div>}
          <section className="panel"><h2>Outside Phase 1 measurement coverage</h2><p>Attention FLOPs, per-kernel math paths, exact model-weight memory traffic, and actual memory bandwidth are unavailable. GPU utilization and clock speed cannot establish those measurements.</p></section>
        </>}
        {page === 'Models' && <section className="panel"><div className="panel-heading"><h2>Installed models <span className="count">{status.installed.length}</span></h2><button onClick={() => void refreshConnection()} disabled={checking || !desktop}>Refresh</button></div>
          {!status.installed.length && <div className="empty"><Layers size={32}/><h3>No installed models reported</h3><p>Start Ollama and install a model using Ollama. This app never downloads models.</p></div>}
          <div className="model-list">{status.installed.map(m => { const loaded = status.loaded.find(l => l.name === m.name); return <article className="model-row" key={m.name}><Layers size={22}/><div><strong>{m.name}</strong><small>{m.details.parameter_size || 'Parameters unavailable'} · {m.details.quantization_level || 'Quantization unavailable'} · {m.size == null ? 'Size unavailable' : (m.size/1024**3).toFixed(2)+' GiB on disk'}</small>{loaded && <small>Loaded footprint: {loaded.size == null ? 'Unavailable' : (loaded.size/1024**3).toFixed(2)+' GiB'} · GPU residency: {loaded.size_vram == null ? 'Unavailable' : (loaded.size_vram/1024**3).toFixed(2)+' GiB'} · CPU residency bytes: unavailable (not separately reported)</small>}</div><span className={'tag ' + (loaded ? 'measured' : '')}>{loaded ? 'Loaded' : 'Not loaded'}</span><button disabled={running} onClick={() => { setModel(m.name); setPage('Benchmark'); }}>Benchmark</button></article>; })}</div>
          {!!status.loaded.length && <details><summary>All currently loaded models ({status.loaded.length})</summary>{status.loaded.map(m => <p key={m.name}>{m.name} · VRAM {m.size_vram == null ? 'Unavailable' : (m.size_vram/1024**3).toFixed(2)+' GiB'} · expires {m.expires_at || 'Unavailable'}</p>)}</details>}
        </section>}
        {page === 'Benchmark' && <>
          <div className="benchmark-layout"><section className="panel"><h2>Integrated benchmark</h2><label htmlFor="model">Installed model</label><select id="model" value={model} disabled={running} onChange={e => setModel(e.target.value)}><option value="">Select a model</option>{status.installed.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select><label htmlFor="prompt">Prompt</label><textarea id="prompt" value={prompt} maxLength={32768} disabled={running} onChange={e => setPrompt(e.target.value)} rows={9}/><p className="hint">Up to 512 output tokens. Results depend on context, caching, model loading and other workloads.</p><div className="actions"><button className="primary" disabled={running || !desktop || !status.connected || !model || !prompt.trim()} onClick={() => void startBenchmark()}><Play size={16}/>Run benchmark</button><button disabled={!running || !started || cancelling} onClick={() => void cancel()}><Square size={14}/>{cancelling ? 'Cancelling…' : 'Cancel'}</button></div><p role="status" className="benchmark-status">{benchmarkState}{!running && recordedSamples > 0 ? ` · ${recordedSamples} concurrent hardware samples retained` : ''}</p></section>
          <section className="panel output-panel"><div className="panel-heading"><h2>Model output &amp; reasoning</h2><span>{running ? 'Streaming' : 'Text only'}</span></div><pre ref={outputRef}>{output || 'Output will appear here when a benchmark starts.'}</pre><p className="hint">Display retains the last 131,072 characters. Partial output has no finalized throughput measurement.</p></section></div>
          {lastResult && <div className="metric-grid">{(['prefill_rate','decode_rate','prompt_tokens','generated_tokens','prefill_duration','decode_duration','load_duration','total_duration'] as const).map(key => <MetricCard key={key} label={key.replaceAll('_',' ')} metric={lastResult[key]}/>)}</div>}
          <div className="notice subtle">Hardware monitoring continues during inference. Cancellation closes the active HTTP stream; immediate server-side GPU release depends on Ollama. Total duration is Ollama's reported request duration, excluding client transport overhead.</div>
        </>}
        {page === 'Benchmark' && <section className="panel"><div className="panel-heading"><h2>Saved benchmark comparison</h2><div className="actions"><button disabled={!savedRuns.length} onClick={() => { void exportRuns(savedRuns).then(setHistoryError).catch(e => setHistoryError(String(e))); }}>Export JSON</button><button disabled={running || !savedRuns.length} onClick={() => { try { saveRuns([]); setSavedRuns([]); setHistoryError(''); } catch { setHistoryError('Could not clear saved runs'); } }}>Delete saved runs</button></div></div><p className="hint">Last 20 successful runs persist on this device, including up to 600 system-wide hardware samples per run. Prompts and generated text are excluded. Cache state and competing workloads can affect comparisons.</p>{historyError && <p role="alert">{historyError}</p>}<div style={{ overflowX:'auto' }}><table className="run-table"><thead><tr><th>Time</th><th>Model</th><th>Prefill</th><th>Decode</th><th>Total</th><th>Samples</th></tr></thead><tbody>{savedRuns.slice().reverse().map(r => <tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.result.model}</td><td>{formatMetric(r.result.prefill_rate)}</td><td>{formatMetric(r.result.decode_rate)}</td><td>{formatMetric(r.result.total_duration)}</td><td>{r.hardware.length}</td></tr>)}</tbody></table></div>{!savedRuns.length && <p>No saved runs yet.</p>}</section>}
        {page === 'Settings' && <section className="panel settings-panel"><h2>Monitoring preferences</h2><label htmlFor="endpoint">Ollama endpoint</label><input id="endpoint" value={draft.endpoint} disabled={running} onChange={e => setDraft({ ...draft, endpoint:e.target.value })}/><p className="hint">Loopback HTTP(S) endpoints only. Remote hosts and redirects are rejected.</p><label htmlFor="interval">Hardware sampling interval (ms)</label><input id="interval" type="number" min={500} max={10000} step={100} value={draft.interval} disabled={running} onChange={e => setDraft({ ...draft, interval:Number(e.target.value) })}/><label htmlFor="history">Retained hardware samples</label><input id="history" type="number" min={30} max={600} value={draft.history} disabled={running} onChange={e => setDraft({ ...draft, history:Number(e.target.value) })}/><label className="checkbox"><input type="checkbox" checked={draft.charts} disabled={running} onChange={e => setDraft({ ...draft, charts:e.target.checked })}/>Show live charts</label><button className="primary" disabled={running} onClick={saveSettings}>Save preferences</button><p role="status">{settingsError}</p><p className="hint">Only preferences persist locally. Prompts, output and metric histories remain in memory. Ollama discovery refreshes every 10 seconds. Sampling waits for the previous native call to finish.</p></section>}
      </main>
      <footer><span><i className="dot"/> Local device · no telemetry uploads</span><span>{latest ? 'Last hardware sample ' + new Date(latest.timestamp_ms).toLocaleTimeString() : 'Waiting for native telemetry'}{lastResult ? ' · last decode ' + formatMetric(lastResult.decode_rate) : ''}</span></footer>
    </div>
  </div>;
}

