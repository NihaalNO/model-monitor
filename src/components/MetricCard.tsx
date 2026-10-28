import type { Metric } from '../types';
import { formatMetric } from '../utils';
export function MetricCard({ label, metric, accent = false }: { label: string; metric: Metric; accent?: boolean }) {
  return <article className={'metric-card ' + (accent ? 'accent' : '')}>
    <div className="eyebrow">{label}</div>
    <strong className={metric.value === null ? 'missing' : ''}>{formatMetric(metric)}</strong>
    <div className="metric-foot"><span className={'tag ' + metric.classification}>{metric.classification}</span><span title={metric.source}>{metric.source}</span></div>
    {metric.value === null && <p className="reason">{metric.reason}</p>}
  </article>;
}

