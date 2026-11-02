# Design system

The November 2026 UI consolidation uses seven destinations: Home, Performance, Models, Tests, Analysis, History and Settings. Secondary navigation groups Quick Benchmark/Advanced Experiments, the five analysis views, and three history types. No phase badges, marketing slogans or tertiary tabs appear. See [UI_SIMPLIFICATION_REPORT.md](UI_SIMPLIFICATION_REPORT.md) for actual validation and local screenshots.

The existing light theme and Segoe UI Variable / Segoe UI system typeface are retained. This continuation refines shared components rather than replacing navigation or page structure.

## Tokens and hierarchy

`src/styles.css` defines surface (#fff), canvas (#f7f8fa), primary text (#243247), muted text (#586c84), borders (#dce3ed), accent (#2563eb), 6 px radius and 20 px panel spacing. Flat surfaces replace the accumulated legacy gradient/shadow overrides. Sidebar width is 204 px on standard desktops; at narrow widths it becomes a labelled-by-tooltip icon rail. Primary and secondary selections have shape/background cues as well as color.

UI body: 14 px, 1.5 line height. Page heading: 24 px. Metric values: 23 px with tabular numerals. Technical output retains Cascadia Code / Consolas monospace. Tables use tabular numerals and align numeric columns right. Cards have no shadows or accent gradients. The original laptop breakpoints and compact navigation remain.

## Charts and tables

Shared chart component has formatted unit-bearing tooltips, legends for multiple series, subtle grids, responsive ResizeObserver cleanup, and linked hardware time-chart interactions. Missing values remain null and lines do not connect across gaps. PCIe throughput is NVML-reported KB/s, not device-memory bandwidth. The process table sorts by PID/name/CPU/RAM and has no termination controls.

## States and accessibility

Home uses up to four available measurements rather than empty metric cards. It shows one benchmark action when generation throughput has not been measured. Historical rates carry model/time and a not-live label. Service connectivity and loaded-model status remain separate. Unsupported hardware counters do not mask other working counters. Performance shows one resource graph with a master resource list; technical details, process data and diagnostic evidence expand on request. Native button/link semantics, visible focus, current-navigation attributes, a skip-content link and secondary Left/Right/Home/End navigation support keyboard users.

Native/browser limitations, unavailable metrics and errors remain explicit. Form labels, keyboard focus and status messages are retained. Findings display measurements, uncertainty and investigation rather than a definitive bottleneck verdict.

## Visual verification

Edge on Windows rendered all seven main destinations at 1366×768, 1600×900 and 1920×1080; laptop secondary views and separate clearly labelled synthetic populated layouts were captured. Empty benchmark output height and redundant notices were corrected after inspection. Native-window launch approval timed out, so WebView-specific visual verification and manual native control interaction are not claimed. Linux runtime testing remains deferred. Screenshots are local QA artifacts, excluded from Git.
