import { diagnose } from './diagnostics';
import { ProcessTable } from './components/ProcessTable';
import { ProfilingWorkspace } from './components/ProfilingWorkspace';
import { loadRuns, initializeHistory, persistRun, comparisonWarnings, clearHistory, moreHistory, exportCsv, exportRuns, type SavedRun } from './history';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, Layers, FlaskConical, Settings2, RefreshCw, Play, Square, ArrowUpRight } from 'lucide-react';
import { MetricCard } from './components/MetricCard';
import { Chart } from './components/Chart';
import { desktop, sampleHardware, ollamaStatus, runBenchmark, cancelBenchmark } from './services';
import { boundedAppend, formatMetric, loadSettings, unavailable, validateSettings } from './utils';
import type { BenchmarkResult, Metric, OllamaStatus, Settings, Snapshot } from './types';

const navigation = [{ name: 'Overview', icon: Activity }, { name: 'Hardware', icon: Cpu }, { name: 'Models', icon: Layers }, { name: 'Benchmark', icon: FlaskConical }, { name: 'Experiments', icon: FlaskConical }, { name: 'Profiler', icon: Activity }, { name: 'Settings', icon: Settings2 }] as const;
type Page = typeof navigation[number]['name'];
const pendingStatus: OllamaStatus = { connected: false, version: null, installed: [], loaded: [], error: null, warnings: [] };

export default function App() {
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>(loadRuns);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [historyReady, setHistoryReady] = useState(!desktop);
  useEffect(() => { void initializeHistory().then(setSavedRuns).catch(e=>setHistoryError('History migration failed; legacy data retained: '+String(e))).finally(()=>setHistoryReady(true)); }, []);
  const [page, setPage] = useState<Page>('Overview');
  const [analysisBusy, setAnalysisBusy] = useState(false);
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
  endpointRef.current = settings.endpoint + '|' + (settings.provider || 'ollama');
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
    const connectionKey = endpoint + '|' + (settings.provider || 'ollama');
    setChecking(true);
    try {
      const next = await ollamaStatus(endpoint, settings.provider);
      if (endpointRef.current === connectionKey) {
        setStatus(next);
        setModel(current => next.installed.some(m => m.name === current) ? current : (next.installed[0]?.name || ''));
      }
    } catch (e) {
      if (endpointRef.current === connectionKey) setStatus({ ...pendingStatus, error: String(e) });
    } finally { connectionBusy.current = false; setChecking(false); }
  }, [settings.endpoint, settings.provider]);

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
    if (benchmarkBusy.current || analysisBusy) return;
    benchmarkBusy.current = true;
    activeSamples.current = []; setRecordedSamples(0);
    setRunning(true); setStarted(false); setCancelling(false); setOutput(''); setLastResult(null); setBenchmarkState('Running · model loading / prompt processing');
    try {
      const result = await runBenchmark(settings.endpoint, model, prompt, text => {
        setOutput(current => (current + text).slice(-131072));
        setBenchmarkState('Running · streaming output');
      }, () => setStarted(true), settings.provider);
      setOutput(result.output || 'The model returned no answer text. It may have used its token budget for reasoning.');
      const run: SavedRun = { id: crypto.randomUUID(), at: new Date().toISOString(), result: { ...result, output: '' }, hardware: activeSamples.current.slice(), context: { backend:settings.provider || 'ollama', quantization: status.installed.find(m=>m.name===model)?.details.quantization_level || null, promptCharacters:prompt.length, promptDigest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt)))).map(b=>b.toString(16).padStart(2,'0')).join(''), outputLimit:512, contextWindow:null, hardware:JSON.stringify({cpu:latest?.cpu_name,gpus:latest?.gpus.map(g=>g.name),ram:latest?.ram_total.value,os:latest?.os}) } };
      try { const next = await persistRun(run); setSavedRuns(next); setHistoryOffset(0); setHistoryError(''); } catch { setHistoryError('Could not save run: local storage is full or unavailable. Export existing runs before clearing history.'); }
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
      <nav aria-label="Main navigation">{navigation.map(n => <button key={n.name} disabled={analysisBusy} className={page === n.name ? 'nav-item active' : 'nav-item'} onClick={() => setPage(n.name)}><n.icon size={18}/>{n.name}{n.name === 'Benchmark' && running && <i className="dot"/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="tag measured">PHASE 03</span><p>Local inference.<br/>Visible performance.</p><small>No cloud telemetry</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="platform">{latest ? latest.os + ' · ' + latest.arch : desktop ? 'Detecting system…' : 'Browser preview'}</div><div className="connection"><span className="selected-model" title={model}>{model || 'No model selected'}</span><i className={'dot ' + (status.connected ? 'online' : 'offline')}/>{checking ? 'Checking inference service…' : status.connected ? (settings.provider === 'llamacpp' ? 'llama.cpp' : 'Ollama ' + (status.version || '')) : 'Inference service disconnected'}<button className="icon-button" aria-label="Retry inference connection" onClick={() => void refreshConnection()} disabled={checking || !desktop}><RefreshCw size={15}/></button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">LOCAL AI PERFORMANCE MONITOR</div><h1>{page === 'Overview' ? 'Overview' : page}</h1><p>{page === 'Overview' ? 'System-wide hardware telemetry and API-reported benchmark results.' : page === 'Benchmark' ? 'Measure prefill and decode separately with a controlled Ollama request.' : 'Measurements stay on this device.'}</p></div><span className="mode-badge"><i className={'dot ' + (running ? 'online' : '')}/>{running ? 'Integrated benchmark' : 'Passive monitoring'}</span></div>
        {!desktop && <div role="status" className="notice">Browser preview · Native telemetry and inference are unavailable here. Start the desktop app with <code>npm run tauri dev</code>.</div>}
        {hardwareError && <div role="alert" className="notice error">{hardwareError}. Displayed hardware values are unavailable until sampling recovers.</div>}
        {status.error && desktop && <div className="notice error">Ollama: {status.error}</div>}
        {status.warnings.map(w => <div className="notice" key={w}>{w}</div>)}
        <div hidden={page !== 'Experiments'}><ProfilingWorkspace mode="experiment" model={model} settings={settings} sample={latest} busy={running || analysisBusy} onBusy={setAnalysisBusy}/></div>
        <div hidden={page !== 'Profiler'}><ProfilingWorkspace mode="profile" model={model} settings={settings} sample={latest} busy={running || analysisBusy} onBusy={setAnalysisBusy}/></div>
        {page === 'Overview' && <>
          {diagnose(latest).map(f => <section className="notice" key={f.observation}><strong>{f.observation}</strong><p>{f.explanation}</p><small>Evidence: {f.strength}. Investigate: {f.investigation}</small></section>)}
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
          <ProcessTable sample={latest}/><section className="panel"><h2>Logical CPU utilization</h2><div className="core-grid">{latest?.per_core?.map((m,i)=><span key={i}>CPU {i}: {formatMetric(m)}</span>)}</div></section>
          <section className="panel"><h2>Detected display adapters</h2>{latest?.adapters.map((a,i) => <p key={i}>{a.name} · {a.vendor} · {a.source}</p>)}{!latest?.adapters.length && <p>{latest?.adapter_status || 'No adapters reported by the operating system yet'}</p>}</section>
          <section className="panel"><h2>{latest?.cpu_name || 'CPU & memory'}</h2><p>{latest?.os} · {latest?.arch} · {latest?.logical_cpus ?? '—'} logical CPUs</p><div className="metric-grid compact">{[['CPU utilization', latest?.cpu], ['RAM used', latest?.ram_used], ['RAM available', latest?.ram_available], ['RAM total', latest?.ram_total], ['Swap used', latest?.swap_used], ['Swap total', latest?.swap_total]].map(([label,m]) => <MetricCard key={String(label)} label={String(label)} metric={hardware(m as Metric | undefined,label === 'CPU utilization' ? '%' : 'bytes')}/>)}</div></section>
          {latest?.gpus.map((g,i) => <section className="panel" key={i}><h2>GPU {i} · {g.name}</h2><p>{g.vendor} · NVML · all measurements system-wide</p><div className="metric-grid compact">{[['Utilization',g.utilization],['VRAM used',g.vram_used],['VRAM total',g.vram_total],['VRAM available',g.vram_available],['Temperature',g.temperature],['Power',g.power],['Core clock',g.core_clock],['PCIe transmit',g.pcie_tx ?? unavailable('KB/s')],['PCIe receive',g.pcie_rx ?? unavailable('KB/s')],['Memory clock',g.memory_clock ?? unavailable('MHz')],['Power limit',g.power_limit ?? unavailable('W')],['Memory controller activity',g.memory_controller ?? unavailable('%')]].map(([label,m]) => <MetricCard key={String(label)} label={String(label)} metric={hardware(m as Metric, (m as Metric).unit)}/>)}</div></section>)}
          {(!latest?.gpus.length || latest.gpu_status) && <div className="notice">{latest?.gpu_status || 'GPU telemetry unavailable. NVIDIA driver and NVML are required. AMD/Intel performance counters are unavailable in Phase 1.'}</div>}
          <section className="panel"><h2>Outside Phase 1 measurement coverage</h2><p>Attention FLOPs, per-kernel math paths, exact model-weight memory traffic, and actual memory bandwidth are unavailable. GPU utilization and clock speed cannot establish those measurements.</p></section>
        </>}
        {page === 'Models' && <section className="panel"><div className="panel-heading"><h2>Installed models <span className="count">{status.installed.length}</span></h2><button onClick={() => void refreshConnection()} disabled={checking || !desktop}>Refresh</button></div>
          {!status.installed.length && <div className="empty"><Layers size={32}/><h3>No models reported by the inference service</h3><p>Start Ollama and install a model using Ollama. This app never downloads models.</p></div>}
          <div className="model-list">{status.installed.map(m => { const loaded = status.loaded.find(l => l.name === m.name); return <article className="model-row" key={m.name}><Layers size={22}/><div><strong>{m.name}</strong><small>{m.details.parameter_size || 'Parameters unavailable'} · {m.details.quantization_level || 'Quantization unavailable'} · {m.size == null ? 'Size unavailable' : (m.size/1024**3).toFixed(2)+' GiB on disk'}</small>{loaded && <small>Loaded footprint: {loaded.size == null ? 'Unavailable' : (loaded.size/1024**3).toFixed(2)+' GiB'} · GPU residency: {loaded.size_vram == null ? 'Unavailable' : (loaded.size_vram/1024**3).toFixed(2)+' GiB'} · CPU residency bytes: unavailable (not separately reported)</small>}</div><span className={'tag ' + (loaded ? 'measured' : '')}>{loaded ? 'Loaded' : 'Not loaded'}</span><button disabled={running} onClick={() => { setModel(m.name); setPage('Benchmark'); }}>Benchmark</button></article>; })}</div>
          {!!status.loaded.length && <details><summary>All currently loaded models ({status.loaded.length})</summary>{status.loaded.map(m => <p key={m.name}>{m.name} · VRAM {m.size_vram == null ? 'Unavailable' : (m.size_vram/1024**3).toFixed(2)+' GiB'} · expires {m.expires_at || 'Unavailable'}</p>)}</details>}
        </section>}
        {page === 'Benchmark' && <>
          <div className="benchmark-layout"><section className="panel"><h2>Integrated benchmark</h2><label htmlFor="model">Installed model</label><select id="model" value={model} disabled={running} onChange={e => setModel(e.target.value)}><option value="">Select a model</option>{status.installed.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select><label htmlFor="prompt">Prompt</label><textarea id="prompt" value={prompt} maxLength={32768} disabled={running} onChange={e => setPrompt(e.target.value)} rows={9}/><p className="hint">Up to 512 output tokens. Results depend on context, caching, model loading and other workloads.</p><div className="actions"><button className="primary" disabled={running || !historyReady || !desktop || !status.connected || !model || !prompt.trim()} onClick={() => void startBenchmark()}><Play size={16}/>Run benchmark</button><button disabled={!running || !started || cancelling} onClick={() => void cancel()}><Square size={14}/>{cancelling ? 'Cancelling…' : 'Cancel'}</button></div><p role="status" className="benchmark-status">{benchmarkState}{!running && recordedSamples > 0 ? ` · ${recordedSamples} concurrent hardware samples retained` : ''}</p></section>
          <section className="panel output-panel"><div className="panel-heading"><h2>Model output &amp; reasoning</h2><span>{running ? 'Streaming' : 'Text only'}</span></div><pre ref={outputRef}>{output || 'Output will appear here when a benchmark starts.'}</pre><p className="hint">Display retains the last 131,072 characters. Partial output has no finalized throughput measurement.</p></section></div>
          {lastResult && <div className="metric-grid">{(['prefill_rate','decode_rate','prompt_tokens','generated_tokens','prefill_duration','decode_duration','load_duration','total_duration'] as const).map(key => <MetricCard key={key} label={key.replaceAll('_',' ')} metric={lastResult[key]}/>)}</div>}
          <div className="notice subtle">Hardware monitoring continues during inference. Cancellation closes the active HTTP stream; immediate server-side GPU release depends on Ollama. Total duration is Ollama's reported request duration, excluding client transport overhead.</div>
        </>}
        {page === 'Benchmark' && <section className="panel"><div className="panel-heading"><h2>Saved benchmark comparison</h2><div className="actions"><button disabled={!savedRuns.length} onClick={() => { void exportCsv(savedRuns).then(setHistoryError).catch(e => setHistoryError(String(e))); }}>Export CSV</button><button disabled={!savedRuns.length} onClick={() => { void exportRuns(savedRuns).then(setHistoryError).catch(e => setHistoryError(String(e))); }}>Export JSON</button><button disabled={running || !savedRuns.length} onClick={() => { void clearHistory().then(()=>{setSavedRuns([]);setHistoryError('');}).catch(e=>setHistoryError(String(e))); }}>Delete saved runs</button></div></div><p className="hint">Successful runs persist in a native SQLite database (200 loaded per page), including up to 600 system-wide hardware samples per run. Prompts and generated text are excluded. Cache state and competing workloads can affect comparisons.</p>{savedRuns.length >= 2 && <div className="notice">{comparisonWarnings(savedRuns[0],savedRuns[1]).map(w=><p key={w}>{w}</p>)}</div>}{historyError && <p role="status">{historyError}</p>}<div style={{ overflowX:'auto' }}><table className="run-table"><thead><tr><th>Time</th><th>Model</th><th>Backend</th><th>Quantization</th><th>Prompt tokens</th><th>Output tokens</th><th>Prefill</th><th>Decode</th><th>Total</th><th>Samples</th></tr></thead><tbody>{savedRuns.slice().sort((a,b)=>b.at.localeCompare(a.at)).map(r => <tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.result.model}</td><td>{r.context?.backend || "Legacy / unknown"}</td><td>{r.context?.quantization || "Unavailable"}</td><td>{formatMetric(r.result.prompt_tokens)}</td><td>{formatMetric(r.result.generated_tokens)}</td><td>{formatMetric(r.result.prefill_rate)}</td><td>{formatMetric(r.result.decode_rate)}</td><td>{formatMetric(r.result.total_duration)}</td><td>{r.hardware.length}</td></tr>)}</tbody></table></div>{!savedRuns.length && <p>No saved runs yet.</p>}{desktop && historyOffset > 0 && <button onClick={()=>{void moreHistory(Math.max(0,historyOffset-200)).then(rows=>{setSavedRuns(rows);setHistoryOffset(current=>Math.max(0,current-200));}).catch(e=>setHistoryError(String(e)));}}>Newer runs</button>}{desktop && savedRuns.length >= 200 && <button onClick={()=>{void moreHistory(historyOffset+200).then(rows=>{setSavedRuns(rows);setHistoryOffset(current=>current+200);}).catch(e=>setHistoryError(String(e)));}}>Load older runs</button>}</section>}
        {page === 'Settings' && <section className="panel settings-panel"><h2>Monitoring preferences</h2><label htmlFor="provider">Inference provider</label><select id="provider" disabled={running} value={draft.provider || "ollama"} onChange={e=>setDraft({...draft,provider:e.target.value})}><option value="ollama">Ollama</option><option value="llamacpp">llama.cpp server</option></select><label htmlFor="endpoint">Local inference endpoint</label><input id="endpoint" value={draft.endpoint} disabled={running} onChange={e => setDraft({ ...draft, endpoint:e.target.value })}/><p className="hint">Loopback HTTP(S) endpoints only. Remote hosts and redirects are rejected.</p><label htmlFor="interval">Hardware sampling interval (ms)</label><input id="interval" type="number" min={500} max={10000} step={100} value={draft.interval} disabled={running} onChange={e => setDraft({ ...draft, interval:Number(e.target.value) })}/><label htmlFor="history">Retained hardware samples</label><input id="history" type="number" min={30} max={600} value={draft.history} disabled={running} onChange={e => setDraft({ ...draft, history:Number(e.target.value) })}/><label className="checkbox"><input type="checkbox" checked={draft.charts} disabled={running} onChange={e => setDraft({ ...draft, charts:e.target.checked })}/>Show live charts</label><button className="primary" disabled={running} onClick={saveSettings}>Save preferences</button><p role="status">{settingsError}</p><p className="hint">Preferences persist locally; completed benchmark history is stored in SQLite. Prompts and output remain in memory. Ollama discovery refreshes every 10 seconds. Sampling waits for the previous native call to finish.</p></section>}
      </main>
      <footer><span><i className="dot"/> Local device · no telemetry uploads</span><span>{latest ? 'Last hardware sample ' + new Date(latest.timestamp_ms).toLocaleTimeString() : 'Waiting for native telemetry'}{lastResult ? ' · last decode ' + formatMetric(lastResult.decode_rate) : ''}</span></footer>
    </div>
  </div>;
}

