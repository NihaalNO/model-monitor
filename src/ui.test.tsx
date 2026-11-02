import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenchmarkResult, OllamaStatus, Snapshot, Metric } from './types';
import { readRoute } from './navigation';
vi.mock('./components/Chart', () => ({Chart:({title}: {title:string})=><div role="img" aria-label={title}/> }));
vi.mock('./services', () => ({desktop:true,sampleHardware:vi.fn(),ollamaStatus:vi.fn(),runBenchmark:vi.fn(),cancelBenchmark:vi.fn().mockResolvedValue(undefined)}));
vi.mock('./history', () => ({loadRuns:()=>[],initializeHistory:vi.fn().mockResolvedValue([]),persistRun:vi.fn().mockResolvedValue([]),comparisonWarnings:()=>[],clearHistory:vi.fn(),moreHistory:vi.fn(),exportCsv:vi.fn(),exportRuns:vi.fn()}));
vi.mock('./profiling', async original => ({...await original<typeof import('./profiling')>(), capabilities:vi.fn().mockResolvedValue([]),analysisStore:vi.fn().mockResolvedValue([]),trial:vi.fn(),importProfile:vi.fn()}));
import { sampleHardware, ollamaStatus, runBenchmark, cancelBenchmark } from './services';
import { trial, importProfile, type ProfileReport } from './profiling';
import { HomePage } from './components/HomePage';
import { PerformancePage } from './components/PerformancePage';
import { SectionTabs } from './components/SectionTabs';
import App from './App';
const metric = (value:number|null,unit='%'):Metric => ({value,unit,classification:value===null?'unavailable':'measured',source:'Synthetic test fixture',reason:value===null?'Driver does not expose this counter':null});
const snapshot:Snapshot={timestamp_ms:1000,os:'Windows',arch:'x86_64',cpu_name:'Test CPU',logical_cpus:8,cpu:metric(30),ram_used:metric(4*1024**3,'bytes'),ram_available:metric(12*1024**3,'bytes'),ram_total:metric(16*1024**3,'bytes'),gpus:[{name:'Test GPU',vendor:'NVIDIA',utilization:metric(null),vram_used:metric(2*1024**3,'bytes'),vram_total:metric(8*1024**3,'bytes'),vram_available:metric(6*1024**3,'bytes'),temperature:metric(45,'°C'),power:metric(35,'W'),core_clock:metric(1000,'MHz')}],gpu_status:null,adapters:[],adapter_status:null};
const model={name:'fixture-model',size:1000,size_vram:null,details:{},expires_at:null};
const connected:OllamaStatus={connected:true,version:'test',installed:[model],loaded:[],error:null,warnings:[]};
const result:BenchmarkResult={model:model.name,decode_rate:metric(12,'tok/s'),prefill_rate:metric(40,'tok/s'),generated_tokens:metric(12,'tokens'),prompt_tokens:metric(40,'tokens'),prefill_duration:metric(1,'s'),decode_duration:metric(1,'s'),total_duration:metric(2,'s'),load_duration:metric(0,'s')};
beforeEach(()=>{window.history.replaceState(null,'','/');localStorage.clear();vi.clearAllMocks();vi.mocked(sampleHardware).mockResolvedValue(snapshot);vi.mocked(ollamaStatus).mockResolvedValue(connected);});
afterEach(cleanup);
const homeProps={status:connected,backend:'Ollama',checking:false,running:false,activity:null,latest:snapshot,samples:[snapshot],result:null,measuredAt:null,charts:true,onBenchmark:vi.fn(),onPerformance:vi.fn(),onModels:vi.fn()};
describe('simple Home status and measurements',()=>{
  it('distinguishes connected service from no loaded model, without unavailable cards',()=>{
    render(<HomePage {...homeProps}/>);
    expect(screen.getByText('AI service connected')).toBeTruthy();expect(screen.getByText('No model loaded')).toBeTruthy();
    expect(screen.getByText('No test running in this app')).toBeTruthy();expect(screen.queryByText('Unavailable')).toBeNull();
    fireEvent.click(screen.getByText('Run Benchmark'));expect(homeProps.onBenchmark).toHaveBeenCalled();
  });
  it('labels throughput historical and shows at most four essential measurements',()=>{
    render(<HomePage {...homeProps} status={{...connected,loaded:[model]}} result={result} measuredAt="2026-11-02T10:00:00Z"/>);
    expect(screen.getByText('Last benchmark · generation')).toBeTruthy();expect(screen.getByText(/not live speed/)).toBeTruthy();
    expect(within(screen.getByLabelText('Essential metrics')).getAllByRole('article').length).toBeLessThanOrEqual(4);
    expect(screen.queryByText('No benchmark measurement yet')).toBeNull();
  });
  it('does not present disconnected loaded metadata as current state',()=>{
    render(<HomePage {...homeProps} status={{...connected,connected:false,loaded:[model]}}/>);
    expect(screen.getByText('AI service disconnected')).toBeTruthy();expect(screen.getByText('Cannot check while disconnected')).toBeTruthy();
  });
  it('keeps service availability distinct from a failed loaded-model query',()=>{
    render(<HomePage {...homeProps} status={{...connected,warnings:['Loaded models: temporary API error']}}/>);
    expect(screen.getByText('AI service connected')).toBeTruthy();expect(screen.getByText('Loaded-model status temporarily unavailable')).toBeTruthy();expect(screen.queryByText('No model loaded')).toBeNull();
  });
});
it('selects resources and keeps working GPU memory visible when utilization is unsupported',()=>{
  render(<PerformancePage latest={snapshot} samples={[snapshot]} charts/>);
  expect(screen.getAllByRole('img')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:/GPU 0 memory/}));
  expect(screen.getByLabelText('GPU 0 memory details')).toBeTruthy();expect(screen.getAllByText('2.00 GiB').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button',{name:/GPU 0 Test GPU Counter/}));
  expect(screen.getAllByText('Driver does not expose this counter').length).toBeGreaterThan(0);
  expect(screen.getAllByText('45 °C').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Graph'),{target:{value:'temperature'}});expect(screen.getByRole('img',{name:'GPU 0 temperature over time'})).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Graph'),{target:{value:'power'}});expect(screen.getByRole('img',{name:'GPU 0 power consumption over time'})).toBeTruthy();
});
it('resolves previous destinations and guards malformed deep links',()=>{
  expect(readRoute('#/hardware').page).toBe('Performance');expect(readRoute('#/benchmark')).toEqual({page:'Tests',view:'Quick Benchmark'});
  expect(readRoute('#/experiments')).toEqual({page:'Tests',view:'Advanced Experiments'});expect(readRoute('#/profiler').page).toBe('Analysis');
  expect(readRoute('#/analysis/kernels')).toEqual({page:'Analysis',view:'Kernels'});expect(readRoute('#%E0%A4')).toEqual({page:'Home'});
});
it('supports keyboard navigation and visible focus across secondary destinations',()=>{
  const change=vi.fn();render(<SectionTabs label="Keyboard views" values={['Overview','Kernels','Memory']} selected="Overview" onSelect={change}/>);
  const buttons=within(screen.getByRole('navigation',{name:'Keyboard views'})).getAllByRole('button');
  buttons[0].focus();fireEvent.keyDown(buttons[0],{key:'ArrowRight'});expect(document.activeElement).toBe(buttons[1]);expect(change).toHaveBeenLastCalledWith('Kernels');
  fireEvent.keyDown(buttons[1],{key:'End'});expect(document.activeElement).toBe(buttons[2]);expect(change).toHaveBeenLastCalledWith('Memory');
  fireEvent.keyDown(buttons[2],{key:'Home'});expect(document.activeElement).toBe(buttons[0]);
});
it('navigates all seven destinations and secondary views with accessible selection',async()=>{
  render(<App/>);const nav=screen.getByRole('navigation',{name:'Main navigation'});
  expect(within(nav).getAllByRole('button')).toHaveLength(7);
  fireEvent.click(within(nav).getByRole('button',{name:'Analysis'}));
  expect(screen.getByRole('navigation',{name:'Analysis views'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Kernels'}));
  expect(screen.getByRole('button',{name:'Kernels'}).getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(nav).getByRole('button',{name:'Tests'}));
  expect(screen.getByRole('button',{name:'Quick Benchmark'})).toBeTruthy();
  fireEvent.click(within(nav).getByRole('button',{name:'History'}));expect(screen.getByText('No saved runs yet.')).toBeTruthy();
  await waitFor(()=>expect(ollamaStatus).toHaveBeenCalled());
});
it('preserves a running quick benchmark and typed prompt across navigation',async()=>{
  let complete:(r:BenchmarkResult)=>void=()=>{};
  vi.mocked(runBenchmark).mockImplementation((_endpoint,_model,_prompt,_output,started)=>{started();return new Promise(resolve=>{complete=resolve;});});
  render(<App/>);const nav=screen.getByRole('navigation',{name:'Main navigation'});
  fireEvent.click(within(nav).getByRole('button',{name:'Tests'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Run benchmark'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Prompt'),{target:{value:'Keep this prompt'}});fireEvent.click(screen.getByRole('button',{name:'Run benchmark'}));
  await waitFor(()=>expect(runBenchmark).toHaveBeenCalledOnce());
  fireEvent.click(within(nav).getByRole('button',{name:'Home'}));expect(screen.getByText('Quick benchmark running in this app')).toBeTruthy();
  fireEvent.click(screen.getByText('Return to active operation'));expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('Keep this prompt');expect(cancelBenchmark).not.toHaveBeenCalled();
  complete(result);await waitFor(()=>expect(screen.getByText(/Complete ·/)).toBeTruthy());
});
it('preserves an advanced experiment while switching primary and secondary destinations',async()=>{
  let complete:(r:BenchmarkResult)=>void=()=>{};
  vi.mocked(trial).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValue(result);
  render(<App/>);const nav=screen.getByRole('navigation',{name:'Main navigation'});
  fireEvent.click(within(nav).getByRole('button',{name:'Tests'}));fireEvent.click(screen.getByRole('button',{name:'Advanced Experiments'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Run experiment'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Run experiment'}));await waitFor(()=>expect(trial).toHaveBeenCalledOnce());
  fireEvent.click(within(nav).getByRole('button',{name:'Performance'}));expect(screen.getByText(/Advanced experiment in progress/)).toBeTruthy();expect(cancelBenchmark).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Return to active operation'));complete(result);await waitFor(()=>expect(screen.getByText(/Selected experiment · Completed/)).toBeTruthy());expect(trial).toHaveBeenCalledTimes(4);
});
it('keeps a pending profiler import alive across navigation',async()=>{
  let finish:(report:ProfileReport)=>void=()=>{};
  vi.mocked(importProfile).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<App/>);const nav=screen.getByRole('navigation',{name:'Main navigation'});fireEvent.click(within(nav).getByRole('button',{name:'Analysis'}));
  const file=new File(['test-only synthetic CSV'],'fixture.csv',{type:'text/csv'});Object.defineProperty(file,'text',{value:()=>Promise.resolve('test-only synthetic CSV')});
  fireEvent.change(screen.getByLabelText('Profiler report (.csv)'),{target:{files:[file]}});await waitFor(()=>expect(importProfile).toHaveBeenCalledOnce());
  fireEvent.click(within(nav).getByRole('button',{name:'Home'}));expect(screen.getByText('Importing a profiler report')).toBeTruthy();
  expect(cancelBenchmark).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Return to active operation'));
  finish({schema:1,kernels:[],warnings:['Synthetic test-only import']});await waitFor(()=>expect(screen.getByText('Selected profile · Completed')).toBeTruthy());
});
it('explains a connected backend with no installed model separately from disconnection',async()=>{
  vi.mocked(ollamaStatus).mockResolvedValueOnce({...connected,installed:[]});render(<App/>);
  fireEvent.click(within(screen.getByRole('navigation',{name:'Main navigation'})).getByRole('button',{name:'Models'}));
  await waitFor(()=>expect(screen.getByText('No model installed')).toBeTruthy());expect(screen.getByText('Service available · no model loaded')).toBeTruthy();
});
