# Phase 03 implementation plan

Baseline: main at f7398f2, tracking origin/main. Existing uncommitted Phase 02 sources and documentation are preserved and form the implementation baseline. No resets or cleanup.

1. Audit current provider, telemetry, SQLite and UI interfaces; run Windows automated baseline.
2. Add explicit capability inventory without installation, elevation or background profiling.
3. Extend existing request execution with bounded workload options; add sequential warmups/repetitions and deterministic context presets, raw results and statistics.
4. Implement import-first deep profiling using documented Nsight Compute long-form CSV. Validate identifiers, units and finite values; retain original metrics and unavailable reasons.
5. Add versioned SQLite session storage with bound parameters, bounded imports and explicit deletion; retain benchmark history.
6. Add compact Profiler and Experiments workspaces, kernel filtering/sorting, memory counter inspection, context charts and assumption-labelled KV estimates.
7. Verify Windows tests/build/lint/native checks, document actual coverage and deferred live capture/Linux tests, review diff, commit relevant changes and push existing remote.

Scope decision: no arbitrary command execution or process attachment. Live Nsight capture and llama-bench execution remain unverified integrations unless an actual executable/workload can be tested. Import processing launches no children, so child cleanup and capture cancellation are not claimed.
