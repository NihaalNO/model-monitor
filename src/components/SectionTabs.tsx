export function SectionTabs({ label, values, selected, onSelect }: { label: string; values: string[]; selected: string; onSelect: (value: string) => void }) {
  return <nav className="section-tabs" aria-label={label}>{values.map((value,index) => <button key={value} aria-current={selected === value ? 'page' : undefined} className={selected === value ? 'active' : ''} onClick={() => onSelect(value)} onKeyDown={event => {
    const next = event.key === 'ArrowRight' ? (index+1)%values.length : event.key === 'ArrowLeft' ? (index+values.length-1)%values.length : event.key === 'Home' ? 0 : event.key === 'End' ? values.length-1 : null;
    if (next === null) return;
    event.preventDefault();
    (event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement | undefined)?.focus();
    onSelect(values[next]);
  }}>{value}</button>)}</nav>;
}
