import { useState } from 'react';
import type { Metric, Snapshot } from '../types';
import { formatMetric } from '../utils';
import { diagnose } from '../diagnostics';
import { ProcessTable } from './ProcessTable';
import { Chart } from './Chart';

export function PerformancePage({ latest, samples, charts, active = true }: { latest?: Snapshot; samples: Snapshot[]; charts: boolean; active?: boolean }) {
  const [resource,setResource] = useState('cpu');
  const [gpuGraph,setGpuGraph] = useState<'utilization'|'temperature'|'power'>('utilization');
  const gpus = latest?.gpus ?? [];
  const resources = [
    {id:'cpu',name:'CPU',subtitle:latest?.cpu_name || 'Processor',metric:latest?.cpu,unit:'%',get:(s:Snapshot)=>s.cpu},
    {id:'ram',name:'Memory',subtitle:'System memory',metric:latest?.ram_used,unit:'GiB',get:(s:Snapshot)=>s.ram_used},
    ...gpus.flatMap((g,i)=>[
      {id:`gpu${i}`,name:`GPU ${i}`,subtitle:g.name,metric:g.utilization,unit:'%',get:(s:Snapshot)=>s.gpus[i]?.utilization},
      {id:`vram${i}`,name:`GPU ${i} memory`,subtitle:g.name,metric:g.vram_used,unit:'GiB',get:(s:Snapshot)=>s.gpus[i]?.vram_used},
    ]),
    {id:'swap',name:'Swap',subtitle:'Allocated, not paging activity',metric:latest?.swap_used,unit:'GiB',get:(s:Snapshot)=>s.swap_used},
  ];
  const selected = resources.find(r=>r.id === resource) ?? resources[0];
  const gpuIndex = Number(selected.id.replace(/^(gpu|vram)/,''));
  const gpu = Number.isInteger(gpuIndex) ? gpus[gpuIndex] : undefined;
  const isGpu = selected.id.startsWith('gpu');
  const graphUnit = isGpu ? gpuGraph === 'temperature' ? '°C' : gpuGraph === 'power' ? 'W' : '%' : selected.unit;
  const graphMetric = (s:Snapshot) => isGpu ? s.gpus[gpuIndex]?.[gpuGraph] : selected.get(s);
  const info: [string,Metric|undefined][] = selected.id === 'cpu' ? [['CPU usage',latest?.cpu]] : selected.id === 'ram' ? [['Memory used',latest?.ram_used],['Available',latest?.ram_available],['Total',latest?.ram_total]] : selected.id === 'swap' ? [['Swap allocated',latest?.swap_used],['Swap total',latest?.swap_total]] : selected.id.startsWith('vram') ? [['GPU memory used',gpu?.vram_used],['Available',gpu?.vram_available],['Total',gpu?.vram_total]] : [['Graphics processor usage',gpu?.utilization],['Temperature',gpu?.temperature],['Power consumption',gpu?.power]];
  const advanced: [string,Metric|undefined][] = gpu ? [['Core clock',gpu.core_clock],['Memory clock',gpu.memory_clock],['Power limit',gpu.power_limit],['Memory controller activity',gpu.memory_controller],['PCIe transmit',gpu.pcie_tx],['PCIe receive',gpu.pcie_rx]] : [];
  const showMetric = (metric?:Metric) => metric?.value != null ? formatMetric(metric) : metric?.reason || (latest ? 'Not reported by this device' : 'Waiting for native hardware data');
  const findings = diagnose(latest);
  return <>
    <div className="performance-layout">
      <nav className="resource-list" aria-label="Hardware resources">{resources.map(r=><button key={r.id} aria-current={selected.id === r.id ? 'page' : undefined} className={selected.id === r.id ? 'active' : ''} onClick={()=>setResource(r.id)}><span className="resource-icon" aria-hidden="true"/><span><strong>{r.name}</strong><small>{r.subtitle}</small><span>{r.metric?.value != null ? formatMetric(r.metric) : (r.metric || latest) ? 'Counter not reported' : 'Waiting for sample'}</span></span></button>)}</nav>
      <section className="resource-detail" aria-label={`${selected.name} details`}>
        <div className="section-heading"><div><h2>{selected.name}</h2><p>{selected.subtitle}</p></div><span>System-wide</span></div>
        {isGpu && <label className="graph-selector">Graph<select value={gpuGraph} onChange={e=>setGpuGraph(e.target.value as typeof gpuGraph)}><option value="utilization">Graphics processor usage</option><option value="temperature">Temperature</option><option value="power">Power consumption</option></select></label>}
        {active && charts && samples.some(s=>graphMetric(s)?.value != null) ? <Chart key={selected.id+gpuGraph} title={`${selected.name} ${isGpu ? gpuGraph === 'temperature' ? 'temperature' : gpuGraph === 'power' ? 'power consumption' : 'usage' : 'usage'} over time`} unit={graphUnit} series={[{name:selected.name,color:'#2563eb',values:samples.map(s=>{const value=graphMetric(s)?.value;return [s.timestamp_ms,value == null ? null : value/(graphUnit==='GiB'?1024**3:1)];})}]}/> : <p className="empty-inline">{!charts ? 'Charts are turned off in Settings.' : (latest && graphMetric(latest)?.reason) || 'Waiting for samples from the desktop app.'}</p>}
        <dl className="resource-stats">{info.map(([name,metric])=><div key={name}><dt title={metric?.source}>{name}</dt><dd>{showMetric(metric)}</dd></div>)}{selected.id==='cpu' && <div><dt>Logical processors</dt><dd>{latest?.logical_cpus ?? 'Not detected'}</dd></div>}</dl>
        <details><summary>Advanced counters and measurement sources</summary><dl className="technical-list">{[...info,...advanced].map(([name,metric])=><div key={name}><dt>{name}</dt><dd>{showMetric(metric)}<small>{metric?.source || 'No source available'} · {metric?.classification || 'unavailable'}</small></dd></div>)}</dl>{selected.id==='cpu' && <div className="core-grid">{latest?.per_core?.map((m,i)=><span key={i}>CPU {i}: {formatMetric(m)}</span>)}</div>}<p>GPU memory allocation, model residency, PCIe throughput and memory-controller activity are different measurements. These counters do not establish exact model-weight reads or attention cost.</p></details>
      </section>
    </div>
    {!gpus.length && <p className="inline-help">GPU counters: {latest?.gpu_status || 'No supported GPU telemetry detected yet. Other resources remain available.'}</p>}
    <details><summary>Inference processes</summary><ProcessTable sample={latest}/></details>
    <details><summary>Display adapters and system information</summary><p>{latest?.os || 'OS not detected'} · {latest?.arch || 'Architecture not detected'}</p>{latest?.adapters.map((a,i)=><p key={i}>{a.name} · {a.vendor} · {a.source}</p>)}<p>{latest?.adapter_status}</p></details>
    {findings.length>0 && <details id="performance-findings"><summary>Observations and investigation ({findings.length})</summary>{findings.map(f=><section className="finding-detail" key={f.observation}><h3>{f.observation}</h3><p>{f.explanation}</p><p>Evidence: {f.strength}</p><p>Next step: {f.investigation}</p></section>)}</details>}
  </>;
}
