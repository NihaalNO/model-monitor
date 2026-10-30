import { useMemo, useState } from 'react';
import type { Snapshot } from '../types';
export function ProcessTable({ sample }: { sample?: Snapshot }) {
 const [sort, setSort] = useState<'pid'|'name'|'cpu_percent'|'ram_bytes'>('cpu_percent');
 const rows = useMemo(() => [...(sample?.processes || [])].sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : b[sort]-a[sort]), [sample,sort]);
 return <section className="panel"><div className="panel-heading"><h2>Inference processes</h2><label>Sort <select value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="cpu_percent">CPU</option><option value="ram_bytes">RAM</option><option value="pid">PID</option><option value="name">Name</option></select></label></div><p className="hint">CPU is per process and may exceed 100% across logical CPUs. GPU allocation attribution is unavailable. No process-control actions are exposed.</p><div className="table-scroll"><table className="run-table"><thead><tr><th>PID</th><th>Process</th><th>CPU %</th><th>RAM GiB</th><th>Status</th></tr></thead><tbody>{rows.map(p=><tr key={p.pid}><td>{p.pid}</td><td>{p.name}</td><td>{p.cpu_percent.toFixed(1)}</td><td>{(p.ram_bytes/1024**3).toFixed(2)}</td><td>{p.status}</td></tr>)}</tbody></table></div>{!rows.length && <p>No recognized inference processes in the latest sample.</p>}</section>;
}
