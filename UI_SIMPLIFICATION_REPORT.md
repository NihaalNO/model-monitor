# UI simplification and navigation restructuring

Date: 2 November 2026. Baseline: clean `main` at `b67eec9`, tracking `origin/main`. Existing manual light-theme and Segoe UI typography changes were retained. No Rust source, native interface, database schema or stored user data was changed.

## Original problems and resulting behavior

- Home competed for attention with eight cards, five simultaneous hardware graphs, technical sources and findings. It now separates service connectivity, loaded model and app-observable activity; shows up to four available essential values; and offers one benchmark action when no finalized generation rate exists. Speed is explicitly labelled **Last benchmark**, with model/time and **not live speed**. External inference activity is never asserted.
- Hardware displayed every metric at once. Performance now uses a resource list and one focused resource graph, with CPU/memory, every detected GPU and its memory, and swap. GPU graph selection preserves usage, temperature and power trends. Statistics remain visible even when another counter is unsupported. Logical CPUs, counter sources, process monitoring, adapter inventory and diagnostic evidence use expandable sections.
- Tests and history were scattered across unrelated pages. The primary sidebar now has exactly seven destinations: Home, Performance, Models, Tests, Analysis, History, Settings. Tests has Quick Benchmark / Advanced Experiments; Analysis has Overview / Kernels / Memory / Attention / Profiler Sessions; History has Benchmark runs / Experiments / Profiling. No third navigation tier is introduced.
- Promotional branding, phase badges, uppercase section banners, gradients, repeated status strips and large empty output areas were removed. Existing light surfaces, subtle borders, 6 px corners, system typography and tabular numerals remain. Empty Attention charts are replaced by a functional setup action; KV assumptions remain labelled estimates.

## Reuse and new components

Reused `Chart`, `MetricCard` for expanded benchmark results, `ProcessTable`, the provider services, benchmark streaming/cancellation, hardware sampler, diagnostics, SQLite history and CSV/JSON export functions. `ProfilingWorkspace` accepts an externally controlled view while retaining its standalone internal navigation for compatibility. It stays mounted during page and tab changes, retaining experiments, imports, selections, filters, KV inputs and raw results. Capability requirements and session warnings move behind details. New components: `HomePage`, `PerformancePage`, `SectionTabs`; `navigation.ts` parses/validates current and legacy hash destinations. Browser Back/Forward works with hash changes. Previous Overview/Hardware/Benchmark/Experiments/Profiler names resolve to the reorganized destinations.

Quick benchmark state remains in App. Experiment/profile operation components stay mounted and the hardware sampler keeps running. Primary navigation remains usable during operations; a global return action locates the current test/import. Conflicting execution and settings mutations stay disabled. Performance resource selection is retained across primary navigation. Settings, models and inference backends retain their existing behavior. History retains pagination, comparison warnings, deletion and native export. No cancellation is triggered by navigation.

Keyboard users have labelled primary and secondary navigation, current-selection semantics, visible focus, native controls, a working skip-content link and Left/Right/Home/End shortcuts within secondary navigation. Secondary controls are navigation buttons rather than incorrectly emulating ARIA tab panels.

## Evidence and checks

- Baseline: 30 frontend tests and 23 Windows Rust tests passed.
- Final frontend suite: 42 tests, including 12 UI cases covering service/model states, empty models, historical speed labelling, four-metric bound, independent GPU counter failures, resource selection, legacy links, secondary navigation, keyboard focus and quick benchmark/experiment/import persistence across navigation.
- Frontend build/typecheck and lint passed. Temporary browser profiles were excluded from lint alongside existing generated directories; `.tmp` is already ignored by Git.
- Windows `cargo test`: 23 tests passed; `cargo build` passed. Rust code is unchanged. Existing live inference/backend manual tests were not repeated.
- `git diff --check`: passed. No local browser profiles, screenshots, databases, generated distributions, credentials or profiler traces are staged.
- Actual rendering: installed Microsoft Edge headless on Windows, not mocked DOM screenshots. All seven top-level destinations were captured at **1366×768, 1600×900 and 1920×1080**. All complex secondary views were additionally captured at laptop size. Browser captures correctly show native features as not checked/unavailable; they do not establish live hardware or inference success. Separate populated Home/Performance fixture renders are conspicuously labelled synthetic UI test data and never enter production views, persistence or performance claims.
- Visual iteration: reduced the empty Quick Benchmark output/prompt height after the first laptop capture; consolidated repeated no-report states; hid empty Attention charts; retained readable sidebar labels and local table scrolling; separated the Home chart legend from time-axis labels after populated fixture inspection. Inspection found no obvious page-level horizontal overflow or clipped primary navigation at the requested desktop sizes. Long tables and technical details intentionally scroll or expand.
- Native-window visual inspection was attempted through Computer Use, but the app approval timed out. Therefore no native-window screenshot, WebView-specific visual pass or manual native button interaction is claimed. Linux runtime validation remains deferred.

## Screenshots (local QA artifacts, excluded from Git)

The complete files are under `.tmp/ui-qa/`. Representative evidence:

- [Home, 1366×768](.tmp/ui-qa/home-1366.png)
- [Performance, 1366×768](.tmp/ui-qa/performance-1366.png)
- [Quick Benchmark after height correction](.tmp/ui-qa/tests-quick-benchmark-1366-final.png)
- [Analysis, 1600×900](.tmp/ui-qa/analysis-1600.png)
- [History, 1920×1080](.tmp/ui-qa/history-1920.png)
- [Top-level contact sheet](.tmp/ui-qa/contact-sheet.png)
- [Secondary-view contact sheet](.tmp/ui-qa/secondary-contact-sheet.png)
- [Populated Home fixture after legend correction — synthetic test data](.tmp/ui-qa/fixture-home-1366-final.png)
- [Populated Performance fixture — synthetic test data](.tmp/ui-qa/fixture-performance-1366.png)

## Acceptance and remaining limits

Implemented: clear Home status, explicit historical measurements, concise empty states, seven-destination hierarchy, full advanced measurement access, focused Performance layout, restrained styling, persistent operations, accessible navigation, automated checks and documentation. Browser desktop-size layout checks have rendering evidence. Native WebView rendering and manual native interaction remain unverified because of the approval timeout; populated full-app live-data layouts are not claimed. Existing profiler/counter coverage limitations remain unchanged. ECharts' existing bundle-size warning, npm's user-configuration warning and Cargo's incremental hard-link fallback are nonfatal.

Git synchronization uses the existing upstream without reset, force push or history rewriting. The final response records the resulting commit and independently checked remote status.
