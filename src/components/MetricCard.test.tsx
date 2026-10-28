import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MetricCard } from './MetricCard';
import { unavailable } from '../utils';
afterEach(cleanup);
it('shows an unavailable metric with its reason and source', () => {
  render(<MetricCard label="GPU power" metric={{ ...unavailable('W','NVML driver is unavailable'), source:'NVML' }}/>);
  expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(screen.getByText('NVML driver is unavailable')).toBeTruthy();
  expect(screen.getByText('NVML')).toBeTruthy();
});
it('renders a real zero utilization as zero', () => {
  render(<MetricCard label="CPU" metric={{ ...unavailable('%'), value:0, reason:null, classification:'measured' }}/>);
  expect(screen.getByText('0 %')).toBeTruthy();
  expect(screen.queryByText('Unavailable')).toBeNull();
});

