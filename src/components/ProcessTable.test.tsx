import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProcessTable } from './ProcessTable';
import type { Snapshot } from '../types';
afterEach(cleanup);
it('shows an explicit empty state',()=>{render(<ProcessTable/>);expect(screen.getByText('No recognized inference processes in the latest sample.')).toBeTruthy();});
it('sorts inference processes without process controls',()=>{
 const processes=[{pid:1,name:'ollama',cpu_percent:2,ram_bytes:1024,status:'Run'},{pid:2,name:'llama-server',cpu_percent:90,ram_bytes:512,status:'Run'}];
 render(<ProcessTable sample={{processes} as unknown as Snapshot}/>);
 expect(screen.getAllByRole('row')[1].textContent).toContain('llama-server');
 fireEvent.change(screen.getByLabelText('Sort'),{target:{value:'ram_bytes'}});
 expect(screen.getAllByRole('row')[1].textContent).toContain('ollama');
 expect(screen.queryByRole('button')).toBeNull();
});
