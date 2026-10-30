import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:vi.fn()}));
import { invoke } from '@tauri-apps/api/core';
import { exportRuns, exportCsv, initializeHistory } from './history';
const call=vi.mocked(invoke);
afterEach(()=>{vi.resetAllMocks();localStorage.clear();});
it('exports all native records as valid JSON rather than the current page',async()=>{
 const records=[{id:'retained-native-record'}];call.mockResolvedValueOnce(records).mockResolvedValueOnce('C:/export.json');
 expect(await exportRuns([])).toContain('C:/export.json');
 expect(call.mock.calls[0][1]).toEqual({action:'export',runs:[],offset:0});
 expect(JSON.parse((call.mock.calls[1][1] as {json:string}).json)).toEqual({version:1,runs:records});
});
it('propagates native save failures',async()=>{call.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('disk full'));await expect(exportRuns([])).rejects.toThrow('disk full');});
it('treats cancelled CSV save as cancellation',async()=>{call.mockResolvedValueOnce([]).mockResolvedValueOnce(null);expect(await exportCsv([])).toBe('Export cancelled');expect(call.mock.calls[1][0]).toBe('export_csv');});
it('does not remove legacy data after a failed migration',async()=>{localStorage.setItem('monitor-runs-v1','[]');call.mockRejectedValueOnce(new Error('locked'));await expect(initializeHistory()).rejects.toThrow('locked');expect(localStorage.getItem('monitor-runs-v1')).toBe('[]');});
