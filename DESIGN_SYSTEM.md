# Design system

Phase 03 preserves these tokens, typography and responsive panels. Two sidebar entries consolidate Experiments (Dashboard/Attention/History) and Profiler (Dashboard/Kernel/Memory/History). Native unavailable states, tabular counter tables, labelled inputs, keyboard-operable sorting/filtering and zero-based numeric context charts extend the existing components. Only collected values appear; blank states explain required actions. Automated component checks pass; manual desktop rendering remains unverified.

The existing light theme and Segoe UI Variable / Segoe UI system typeface are retained. This continuation refines shared components rather than replacing navigation or page structure.

## Tokens and hierarchy

`src/styles.css` defines surface (#fff), canvas (#f4f6fa), primary text (#243247), muted text (#586c84), borders (#dce3ed), accent (#2563eb), 6 px radius and 20 px panel spacing. Existing component-specific rules remain for compatibility; complete removal of legacy literal colors is not claimed.

UI body: 14 px, 1.5 line height. Page heading: 24 px. Metric values: 23 px with tabular numerals. Technical output retains Cascadia Code / Consolas monospace. Tables use tabular numerals and align numeric columns right. Cards have no shadows or accent gradients. The original laptop breakpoints and compact navigation remain.

## Charts and tables

Shared chart component has formatted unit-bearing tooltips, legends for multiple series, subtle grids, responsive ResizeObserver cleanup, and linked hardware time-chart interactions. Missing values remain null and lines do not connect across gaps. PCIe throughput is NVML-reported KB/s, not device-memory bandwidth. The process table sorts by PID/name/CPU/RAM and has no termination controls.

## States and accessibility

Native/browser limitations, unavailable metrics and errors remain explicit. Form labels, keyboard focus and status messages are retained. Findings display measurements, uncertainty and investigation rather than a definitive bottleneck verdict.

## Visual verification

The owner-verified original Windows laptop layout is accepted. This continuation has source/component review and automated regression checks only. No GUI interaction or screenshots of modified pages were available; actual rendering at multiple sizes remains unverified.
