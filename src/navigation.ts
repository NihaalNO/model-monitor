export const pages = ['Home', 'Performance', 'Models', 'Tests', 'Analysis', 'History', 'Settings'] as const;
export type Page = typeof pages[number];
export type Route = { page: Page; view?: string };
export const testViews = ['Quick Benchmark', 'Advanced Experiments'];
export const analysisViews = ['Overview', 'Kernels', 'Memory', 'Attention', 'Profiler Sessions'];
export const historyViews = ['Benchmark runs', 'Experiments', 'Profiling'];
export function readRoute(hash: string): Route {
  let path: string;
  try { path = decodeURIComponent(hash.replace(/^#\/?/, '')); } catch { return { page: 'Home' }; }
  const [name = '', view] = path.split('/');
  const aliases: Record<string, Route> = { overview:{page:'Home'}, hardware:{page:'Performance'}, benchmark:{page:'Tests',view:'Quick Benchmark'}, experiments:{page:'Tests',view:'Advanced Experiments'}, profiler:{page:'Analysis',view:'Overview'} };
  if (aliases[name.toLowerCase()]) return aliases[name.toLowerCase()];
  const page = pages.find(p => p.toLowerCase() === name.toLowerCase()) ?? 'Home';
  const choices = page === 'Tests' ? testViews : page === 'Analysis' ? analysisViews : page === 'History' ? historyViews : [];
  return { page, ...(choices.length ? { view: choices.find(v => v.toLowerCase().replaceAll(' ','-') === view?.toLowerCase()) ?? choices[0] } : {}) };
}
export function routeHash(page: Page, view?: string) { return '#/' + page.toLowerCase() + (view ? '/' + view.toLowerCase().replaceAll(' ','-') : ''); }
