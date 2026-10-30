import { describe, expect, it } from 'vitest';
import { csvRuns, comparisonWarnings, decodeChange, type SavedRun } from './history';
import { diagnose } from './diagnostics';
import { unavailable } from './utils';
import type { Snapshot } from './types';
const metric = { ...unavailable('tok/s'),value:0 };
const run: SavedRun = { id:'a',at:'2026-10-28T00:00:00Z',result:{model:'=test,"x"',generated_tokens:metric,prompt_tokens:metric,decode_rate:metric,prefill_rate:metric,decode_duration:metric,prefill_duration:metric,total_duration:metric,load_duration:metric},hardware:[] };
describe('CSV and comparison',()=>{
 it('escapes quotes, guards spreadsheet formulas and preserves zero',()=>{const csv=csvRuns([run]);expect(csv).toContain(`"'=test,""x"""`);expect(csv).toContain('"0"');expect(csv).toContain('2026-10-28T00:00:00.000Z');});
 it('renders unavailable metrics as blank cells',()=>{expect(csvRuns([{...run,result:{...run.result,decode_rate:unavailable('tok/s')}}])).toContain(',"",');});
 it('does not divide by zero and warns for legacy metadata',()=>{expect(decodeChange(run,run)).toBeNull();expect(comparisonWarnings(run,run)[0]).toContain('Legacy');});
});
describe('conservative findings',()=>{
 it('does not diagnose without evidence',()=>{expect(diagnose()).toEqual([]);expect(diagnose({cpu:unavailable('%'),gpus:[]} as unknown as Snapshot)).toEqual([]);});
 it('labels swap occupancy as uncertain rather than paging rate',()=>{const f=diagnose({cpu:unavailable('%'),gpus:[],swap_used:{...unavailable('bytes'),value:1024}} as unknown as Snapshot);expect(f[0].explanation).toContain('does not establish active paging');});
});
