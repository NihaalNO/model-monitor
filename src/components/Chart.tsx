import { memo, useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
export interface Series { name: string; color: string; values: [number | string, number | null][] }
export const Chart = memo(function Chart({ title, unit, series, category = false, numeric = false, interval }: { title: string; unit: string; series: Series[]; category?: boolean; numeric?: boolean; interval?: number }) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!element.current) return;
    chart.current = echarts.init(element.current, undefined, { renderer: 'canvas' });
    if (!category && !numeric) { chart.current.group = 'hardware-timeline'; echarts.connect('hardware-timeline'); }
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(element.current);
    return () => { observer.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, [category, numeric]);
  useEffect(() => {
    chart.current?.setOption({
      animation: false, textStyle: { color: '#586c84', fontFamily: 'system-ui' },
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => typeof value === 'number' ? value.toFixed(2) + ' ' + unit : 'Unavailable' }, legend: { show: series.length > 1, bottom:0, textStyle:{color:'#586c84'} }, grid: { left: 48, right: 20, top: 16, bottom: 30 },
      xAxis: { type: category ? 'category' : numeric ? 'value' : 'time', min: numeric ? 0 : undefined, axisLabel: { color: '#586c84' }, axisLine: { lineStyle: { color: '#dce3ed' } } },
      yAxis: { type: 'value', min: 0, ...(unit === '%' ? { max: 100 } : {}), splitLine: { lineStyle: { color: '#e7edf5' } }, axisLabel: { color: '#586c84' } },
      series: series.map(s => ({ name: s.name, type: category ? 'bar' : 'line', data: numeric ? [...s.values].sort((a,b) => Number(a[0])-Number(b[0])) : s.values, showSymbol: numeric, connectNulls: false, lineStyle: { width: 2 }, itemStyle: { color: s.color }, areaStyle: { opacity: .06 }, barMaxWidth: 32 })),
    }, true);
  }, [series, category, numeric, unit]);
  const hasData = series.some(s => s.values.some(v => v[1] !== null));
  return <section className="panel chart-panel"><div className="panel-heading"><h3>{title}</h3><span>{unit}{interval ? ' · ' + interval + ' ms target' : ''}</span></div><div ref={element} className="chart" role="img" aria-label={title + ' chart in ' + unit}/>{!hasData && <p className="chart-empty">No measured samples yet</p>}</section>;
});
