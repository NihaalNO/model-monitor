import { describe, expect, it } from 'vitest';
import { aggregate, findings, kvBytes, presets, statistics, type Kernel } from './profiling';
describe('controlled experiment calculations', () => {
  it('uses sample variance and excludes missing values without filling zeros', () => {
    expect(statistics([1,2,3,null,NaN])).toEqual({ count:3,min:1,max:3,mean:2,median:2,variance:1,stddev:1 });
    expect(statistics([4,6])?.median).toBe(5);
    expect(statistics([7])?.stddev).toBeNull();
    expect(statistics([null,Infinity])).toBeNull();
  });
  it('provides four fixed workloads and increasing context material', () => {
    expect(presets).toHaveLength(5);
    expect(presets[4].repeats).toEqual([1,8,32,64]);
    expect(presets[1].output).toBeGreaterThan(presets[0].output);
  });
  it('accounts for KV rather than query heads and quantized storage assumptions', () => {
    expect(kvBytes(32,8,128,8192,2)).toBe(1073741824);
    expect(kvBytes(32,1,128,8192,2)).toBe(134217728);
    expect(kvBytes(32,8,128,8192,0.5)).toBe(268435456);
    expect(kvBytes(0,8,128,8192,2)).toBeNull();
    expect(kvBytes(32,8,128,8192,3)).toBeNull();
  });
});
describe('profiler evidence', () => {
  it('counts launches separately from metrics, and averages only timed launches', () => {
    const kernels: Kernel[] = [{id:'1',name:'kernel',counters:[{original_name:'gpu__time_duration.sum',original_unit:'ns',unit:'s',value:2,category:'duration',reason:null}]}, {id:'2',name:'kernel',counters:[]}];
    expect(aggregate(kernels)).toEqual([{name:'kernel',calls:2,total:2,timedCalls:1,average:2}]);
    expect(aggregate([{id:'3',name:'unknown',counters:[]}])[0].total).toBeNull();
  });
  it('does not infer tensor or attention execution from names', () => {
    expect(findings({schema:1,kernels:[{id:'1',name:'tensor_attention_fp16',counters:[]}],warnings:[]})).toEqual(['Insufficient profiling evidence']);
  });
});
