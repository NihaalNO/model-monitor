import { ProfilingWorkspace } from './components/ProfilingWorkspace';
import { loadRuns, initializeHistory, persistRun, comparisonWarnings, clearHistory, moreHistory, exportCsv, exportRuns, type SavedRun } from './history';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, Layers, FlaskConical, Settings2, RefreshCw, Play, Square, Home, History, Search } from 'lucide-react';
import { MetricCard } from './components/MetricCard';
import { Chart } from './components/Chart';
import { desktop, sampleHardware, ollamaStatus, runBenchmark, cancelBenchmark } from './services';
import { boundedAppend, formatMetric, loadSettings, validateSettings } from './utils';
import type { BenchmarkResult, OllamaStatus, Settings, Snapshot } from './types';

import { HomePage } from './components/HomePage';
import { PerformancePage } from './components/PerformancePage';
import { SectionTabs } from './components/SectionTabs';
import { readRoute, routeHash, testViews, analysisViews, historyViews, type Page } from './navigation';

const navigation = [{ name: 'Home', icon: Home }, { name: 'Performance', icon: Cpu }, { name: 'Models', icon: Layers }, { name: 'Tests', icon: FlaskConical }, { name: 'Analysis', icon: Search }, { name: 'History', icon: History }, { name: 'Settings', icon: Settings2 }] as const;
const pendingStatus: OllamaStatus = { connected: false, version: null, installed: [], loaded: [], error: null, warnings: [] };

export default function App() {
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>(loadRuns);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [historyReady, setHistoryReady] = useState(!desktop);
  useEffect(() => { void initializeHistory().then(setSavedRuns).catch(e=>setHistoryError('History migration failed; legacy data retained: '+String(e))).finally(()=>setHistoryReady(true)); }, []);
  const [route, setRoute] = useState(() => readRoute(window.location.hash));
  const page = route.page;
  function navigate(page: Page, view?: string) { const hash = routeHash(page, view); setRoute(readRoute(hash)); window.location.hash = hash; }
  useEffect(() => { const change = () => setRoute(readRoute(window.location.hash)); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const view = route.view;
  const [analysisOwner, setAnalysisOwner] = useState<'experiment' | 'profile' | null>(null);
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
  const [measuredAt, setMeasuredAt] = useState<string | null>(null);
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
    if (!desktop || connectionBusy.current) return;
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
      setMeasuredAt(new Date().toISOString()); setLastResult(result); setResults(h => boundedAppend(h, result, 20)); setBenchmarkState('Complete · final ' + (settings.provider === 'llamacpp' ? 'llama.cpp' : 'Ollama') + ' metrics received');
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
  const experimentVisible = (page === 'Tests' && view === 'Advanced Experiments') || (page === 'Analysis' && view === 'Attention') || (page === 'History' && view === 'Experiments');
  const profileVisible = (page === 'Analysis' && view !== 'Attention') || (page === 'History' && view === 'Profiling');
  const experimentView = page === 'Analysis' && view === 'Attention' ? 'Attention Analysis' : page === 'History' && view === 'Experiments' ? 'History' : 'Dashboard';
  const profileView = page === 'History' || view === 'Profiler Sessions' ? 'History' : view === 'Kernels' ? 'Kernel Analysis' : view === 'Memory' ? 'Memory Analysis' : 'Dashboard';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
    <aside className="sidebar">
      <div className="brand"><Activity size={19}/><span>AI Performance Monitor</span></div>
      <nav aria-label="Main navigation">{navigation.map(n => <button key={n.name} title={n.name} aria-label={n.name} aria-current={page === n.name ? 'page' : undefined} className={page === n.name ? 'nav-item active' : 'nav-item'} onClick={() => navigate(n.name)}><n.icon size={18}/><span>{n.name}</span></button>)}</nav>
      <div className="sidebar-bottom"><small>On this computer</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>Local AI Performance Monitor</span><div className="connection">{!desktop ? 'Preview · connection not checked' : status.connected ? 'Service connected' : checking ? 'Checking service…' : 'Service disconnected'}<button className="icon-button" aria-label="Retry inference connection" onClick={() => void refreshConnection()} disabled={checking || !desktop}><RefreshCw size={15}/></button></div></header>
      <main id="main-content" tabIndex={-1}>
        <div className="page-heading"><h1>{page}</h1></div>
        {!desktop && <p className="preview-notice">Browser preview · Open the desktop app for hardware monitoring and inference.</p>}
        {hardwareError && <div role="alert" className="notice error">Monitoring temporarily interrupted: {hardwareError}. Retained charts show previous samples.</div>}
        {(running || analysisBusy) && <div className="operation-status" role="status"><span>{running ? 'Quick benchmark running' : analysisOwner === 'experiment' ? 'Advanced experiment in progress' : 'Profiler import in progress'} · You can browse without interrupting it.</span><button onClick={() => navigate(running || analysisOwner === 'experiment' ? 'Tests' : 'Analysis', running ? 'Quick Benchmark' : analysisOwner === 'experiment' ? 'Advanced Experiments' : 'Overview')}>Return to active operation</button></div>}
        {page === 'Tests' && <SectionTabs label="Test views" values={testViews} selected={view || testViews[0]} onSelect={v => navigate('Tests',v)}/>}
        {page === 'Analysis' && <SectionTabs label="Analysis views" values={analysisViews} selected={view || analysisViews[0]} onSelect={v => navigate('Analysis',v)}/>}
        {page === 'History' && <SectionTabs label="History views" values={historyViews} selected={view || historyViews[0]} onSelect={v => navigate('History',v)}/>}
        {page === 'Home' && <HomePage nativeAvailable={desktop} status={status} checking={checking} backend={settings.provider === 'llamacpp' ? 'llama.cpp' : 'Ollama'} running={running} activity={analysisBusy ? analysisOwner === 'experiment' ? 'Advanced experiment running in this app' : 'Importing a profiler report' : null} latest={hardwareError ? undefined : latest} samples={samples} result={lastResult} measuredAt={measuredAt} charts={settings.charts} onBenchmark={() => navigate('Tests','Quick Benchmark')} onPerformance={() => navigate('Performance')} onModels={() => navigate('Models')}/>}
        <div hidden={page !== 'Performance'}><PerformancePage active={page === 'Performance'} latest={hardwareError ? undefined : latest} samples={samples} charts={settings.charts}/></div>
        <div hidden={!experimentVisible}><ProfilingWorkspace mode="experiment" view={experimentView} onViewChange={v => navigate(v === 'History' ? 'History' : v === 'Attention Analysis' ? 'Analysis' : 'Tests',v === 'History' ? 'Experiments' : v === 'Attention Analysis' ? 'Attention' : 'Advanced Experiments')} model={model} settings={settings} sample={latest} busy={running || analysisBusy} onBusy={b => {setAnalysisBusy(b);setAnalysisOwner(b ? 'experiment' : null);}}/></div>
        <div hidden={!profileVisible}><ProfilingWorkspace mode="profile" view={profileView} onViewChange={v => navigate(v === 'History' ? 'History' : 'Analysis',v === 'History' ? 'Profiling' : v === 'Kernel Analysis' ? 'Kernels' : v === 'Memory Analysis' ? 'Memory' : 'Overview')} model={model} settings={settings} sample={latest} busy={running || analysisBusy} onBusy={b => {setAnalysisBusy(b);setAnalysisOwner(b ? 'profile' : null);}}/></div>
        {page === 'Models' && <section className="panel"><h2>Connection</h2><p>{settings.provider === "llamacpp" ? "llama.cpp" : "Ollama"} · {status.connected ? "Connected" : "Disconnected"} · {settings.endpoint}</p><p>{status.connected ? status.warnings.some(w => w.startsWith("Loaded models:")) ? "Service connected · loaded-model status could not be checked" : status.loaded.length ? `${status.loaded.length} model(s) loaded` : "Service available · no model loaded" : "Loaded models cannot be checked while disconnected"}</p>{status.error && <p role="alert">{status.error}</p>}<details><summary>Backend details and warnings</summary>{status.warnings.map(w => <p key={w}>{w}</p>)}<p>External inference activity is not reported by these APIs.</p></details><div className="panel-heading"><h2>Installed models <span className="count">{status.installed.length}</span></h2><button onClick={() => void refreshConnection()} disabled={checking || !desktop}>Refresh</button></div>
          {!status.installed.length && <div className="empty"><Layers size={32}/><h3>{!desktop ? "Open the desktop app to discover models" : !status.connected ? "AI service disconnected" : status.warnings.some(w => w.startsWith("Installed models:")) ? "Model list temporarily unavailable" : "No model installed"}</h3><p>{!status.connected ? "Start your local inference service and check the connection settings." : "Install a model using your inference backend, then refresh this list. This app never downloads models."}</p><button onClick={() => navigate("Settings")}>Connection settings</button></div>}
          <div className="model-list">{status.installed.map(m => { const loaded = status.connected ? status.loaded.find(l => l.name === m.name) : undefined; return <article className="model-row" key={m.name}><Layers size={22}/><div><strong>{m.name}</strong><small>{m.details.parameter_size || 'Parameters unavailable'} · {m.details.quantization_level || 'Quantization unavailable'} · {m.size == null ? 'Size unavailable' : (m.size/1024**3).toFixed(2)+' GiB on disk'}</small>{loaded && <small>Loaded footprint: {loaded.size == null ? 'Unavailable' : (loaded.size/1024**3).toFixed(2)+' GiB'} · GPU residency: {loaded.size_vram == null ? 'Unavailable' : (loaded.size_vram/1024**3).toFixed(2)+' GiB'} · CPU residency bytes: unavailable (not separately reported)</small>}</div><span className={'tag ' + (loaded ? 'measured' : '')}>{loaded ? 'Loaded' : 'Not loaded'}</span><button disabled={running || analysisBusy} onClick={() => { setModel(m.name); navigate('Tests', 'Quick Benchmark'); }}>Benchmark</button></article>; })}</div>
          {status.connected && !!status.loaded.length && <details><summary>All currently loaded models ({status.loaded.length})</summary>{status.loaded.map(m => <p key={m.name}>{m.name} · VRAM {m.size_vram == null ? 'Unavailable' : (m.size_vram/1024**3).toFixed(2)+' GiB'} · expires {m.expires_at || 'Unavailable'}</p>)}</details>}
        </section>}
        {page === 'Tests' && view === 'Quick Benchmark' && <>{desktop && (!status.connected || !model) && <div className="notice"><p>{!status.connected ? 'Connect your local AI service before starting a benchmark.' : 'No installed model is selected. Choose a model before starting a benchmark.'}</p><button onClick={() => navigate('Models')}>Check models and connection</button></div>}
          <div className="benchmark-layout"><section className="panel"><h2>Quick Benchmark</h2><label htmlFor="model">Installed model</label><select id="model" value={model} disabled={running || analysisBusy} onChange={e => setModel(e.target.value)}><option value="">Select a model</option>{status.installed.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select><label htmlFor="prompt">Prompt</label><textarea id="prompt" value={prompt} maxLength={32768} disabled={running || analysisBusy} onChange={e => setPrompt(e.target.value)} rows={6}/><p className="hint">Up to 512 output tokens. Results depend on context, caching, model loading and other workloads.</p><div className="actions"><button className="primary" disabled={running || analysisBusy || !historyReady || !desktop || !status.connected || !model || !prompt.trim()} onClick={() => void startBenchmark()}><Play size={16}/>Run benchmark</button><button disabled={!running || !started || cancelling} onClick={() => void cancel()}><Square size={14}/>{cancelling ? 'Cancelling…' : 'Cancel'}</button></div><p role="status" className="benchmark-status">{benchmarkState}{!running && recordedSamples > 0 ? ` · ${recordedSamples} concurrent hardware samples retained` : ''}</p></section>
          <section className={"panel output-panel" + (!output && !running ? " empty-output" : "")}><div className="panel-heading"><h2>Model output &amp; reasoning</h2><span>{running ? 'Streaming' : 'Text only'}</span></div><pre ref={outputRef}>{output || 'Output will appear here when a benchmark starts.'}</pre><p className="hint">Display retains the last 131,072 characters. Partial output has no finalized throughput measurement.</p></section></div>
          {lastResult && <details><summary>Completed benchmark measurements</summary><div className="metric-grid">{(['prefill_rate','decode_rate','prompt_tokens','generated_tokens','prefill_duration','decode_duration','load_duration','total_duration'] as const).map(key => <MetricCard key={key} label={key.replaceAll('_',' ')} metric={lastResult[key]}/>)}</div></details>}
          <div className="notice subtle">Hardware monitoring continues during inference. Cancellation closes the active HTTP stream; immediate server-side GPU release depends on the backend. Timing scopes depend on the selected backend; missing durations are left unmeasured.</div>
        </>}
        {page === 'History' && view === 'Benchmark runs' && <section className="panel"><div className="panel-heading"><h2>Benchmark runs & comparison</h2><div className="actions"><button disabled={!savedRuns.length} onClick={() => { void exportCsv(savedRuns).then(setHistoryError).catch(e => setHistoryError(String(e))); }}>Export CSV</button><button disabled={!savedRuns.length} onClick={() => { void exportRuns(savedRuns).then(setHistoryError).catch(e => setHistoryError(String(e))); }}>Export JSON</button><button disabled={running || analysisBusy || !savedRuns.length} onClick={() => { void clearHistory().then(()=>{setSavedRuns([]);setHistoryError('');}).catch(e=>setHistoryError(String(e))); }}>Delete saved runs</button></div></div><p className="hint">Successful runs persist in a native SQLite database (200 loaded per page), including up to 600 system-wide hardware samples per run. Prompts and generated text are excluded. Cache state and competing workloads can affect comparisons.</p>{savedRuns.length >= 2 && <div className="notice">{comparisonWarnings(savedRuns[0],savedRuns[1]).map(w=><p key={w}>{w}</p>)}</div>}{historyError && <p role="status">{historyError}</p>}<div style={{ overflowX:'auto' }}><table className="run-table"><thead><tr><th>Time</th><th>Model</th><th>Backend</th><th>Quantization</th><th>Prompt tokens</th><th>Output tokens</th><th>Prefill</th><th>Decode</th><th>Total</th><th>Samples</th></tr></thead><tbody>{savedRuns.slice().sort((a,b)=>b.at.localeCompare(a.at)).map(r => <tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.result.model}</td><td>{r.context?.backend || "Legacy / unknown"}</td><td>{r.context?.quantization || "Unavailable"}</td><td>{formatMetric(r.result.prompt_tokens)}</td><td>{formatMetric(r.result.generated_tokens)}</td><td>{formatMetric(r.result.prefill_rate)}</td><td>{formatMetric(r.result.decode_rate)}</td><td>{formatMetric(r.result.total_duration)}</td><td>{r.hardware.length}</td></tr>)}</tbody></table></div>{!savedRuns.length && <div className="empty-inline"><p>No saved runs yet.</p><button onClick={() => navigate("Tests","Quick Benchmark")}>Run a benchmark</button></div>}{desktop && historyOffset > 0 && <button onClick={()=>{void moreHistory(Math.max(0,historyOffset-200)).then(rows=>{setSavedRuns(rows);setHistoryOffset(current=>Math.max(0,current-200));}).catch(e=>setHistoryError(String(e)));}}>Newer runs</button>}{desktop && savedRuns.length >= 200 && <button onClick={()=>{void moreHistory(historyOffset+200).then(rows=>{setSavedRuns(rows);setHistoryOffset(current=>current+200);}).catch(e=>setHistoryError(String(e)));}}>Load older runs</button>}</section>}
        {page === 'History' && view === 'Benchmark runs' && results.length > 0 && settings.charts && <Chart title="Completed benchmarks in this app session" unit="tok/s" category series={throughputSeries}/>}
        {page === 'Settings' && <section className="panel settings-panel"><h2>Monitoring preferences</h2><label htmlFor="provider">Inference provider</label><select id="provider" disabled={running || analysisBusy} value={draft.provider || "ollama"} onChange={e=>setDraft({...draft,provider:e.target.value})}><option value="ollama">Ollama</option><option value="llamacpp">llama.cpp server</option></select><label htmlFor="endpoint">Local inference endpoint</label><input id="endpoint" value={draft.endpoint} disabled={running || analysisBusy} onChange={e => setDraft({ ...draft, endpoint:e.target.value })}/><p className="hint">Loopback HTTP(S) endpoints only. Remote hosts and redirects are rejected.</p><label htmlFor="interval">Hardware sampling interval (ms)</label><input id="interval" type="number" min={500} max={10000} step={100} value={draft.interval} disabled={running || analysisBusy} onChange={e => setDraft({ ...draft, interval:Number(e.target.value) })}/><label htmlFor="history">Retained hardware samples</label><input id="history" type="number" min={30} max={600} value={draft.history} disabled={running || analysisBusy} onChange={e => setDraft({ ...draft, history:Number(e.target.value) })}/><label className="checkbox"><input type="checkbox" checked={draft.charts} disabled={running || analysisBusy} onChange={e => setDraft({ ...draft, charts:e.target.checked })}/>Show live charts</label><button className="primary" disabled={running || analysisBusy} onClick={saveSettings}>Save preferences</button><p role="status">{settingsError}</p><p className="hint">Preferences persist locally; completed benchmark history is stored in SQLite. Prompts and output remain in memory. Ollama discovery refreshes every 10 seconds. Sampling waits for the previous native call to finish.</p></section>}
      </main>
      <footer><span>No cloud telemetry</span><span>{latest ? 'Last hardware sample ' + new Date(latest.timestamp_ms).toLocaleTimeString() : 'Native hardware samples not yet available'}</span></footer>
    </div>
  </div>;
}
