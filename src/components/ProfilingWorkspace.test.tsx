import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../services', () => ({ desktop:false, cancelBenchmark:vi.fn() }));
vi.mock('./Chart', () => ({ Chart:() => <div>Measured chart</div> }));
import { ProfilingWorkspace } from './ProfilingWorkspace';
afterEach(cleanup);
describe('profiling unavailable states', () => {
  const settings = {endpoint:'http://127.0.0.1:11434',interval:1000,history:120,charts:true};
  it('disables native imports and explicitly describes browser limitations', () => {
    render(<ProfilingWorkspace mode="profile" model="" settings={settings} busy={false} onBusy={() => {}}/>);
    expect((screen.getByLabelText('Profiler report (.csv)') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Unavailable in browser preview/)).toBeTruthy();
    fireEvent.click(screen.getByText('Kernel Analysis'));
    expect(screen.getByText(/No report selected/)).toBeTruthy();
  });
  it('disables benchmark execution without native access or a model', () => {
    render(<ProfilingWorkspace mode="experiment" model="" settings={settings} busy={false} onBusy={() => {}}/>);
    expect((screen.getByText('Run experiment') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Attention Analysis'));
    expect(screen.getByText(/Defaults are illustrative assumptions/)).toBeTruthy();
  });
});
