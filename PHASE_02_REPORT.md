# Phase 02 â€” saved benchmark comparison

Implemented a bounded local history of 20 successful runs with timestamps, finalized API metrics, and up to 600 concurrent hardware samples per run. Benchmark now includes a comparison table, JSON export, and explicit deletion. Prompts and response text are excluded from saved records. Storage failures are surfaced without failing inference. Added history parsing tests.

The development frontend is served on http://127.0.0.1:1420. Desktop startup and native compilation must be verified separately; a running Vite server does not establish a running Tauri app. Phase 02 scope is an initial implementation, not profiler coverage. Exact bandwidth, attention cost, and kernel attribution remain unavailable.

## Verification in updated environment

- npm run build: passed, including TypeScript checks. ECharts causes a non-fatal bundle-size warning.
- npm run lint: passed.
- npm test: 10 tests passed across three files, including malformed-history rejection and bounded saved-run round-trip.
- cargo check: passed (Windows).
- cargo fmt --check: passed after formatting native sources.
- git diff --check: passed.
- npm and Cargo lockfiles generated.
- Vite dev server is running at http://127.0.0.1:1420.
- The initial Tauri launch stalled checking the loopback URL. Retried using the supported --no-dev-server-wait option. Native executable built successfully and the Tauri runner launched target/debug/local-ai-performance-monitor.exe; desktop window visibility, hardware counters, live Ollama inference, and desktop JSON download remain unverified.
- Linux has not been tested.

Only this saved-run comparison scope is implemented for Phase 2. Profiler integrations and model-specific hardware attribution are not implemented. Local storage has a browser-dependent quota; if saving a large capture fails, the app reports it and preserves the completed result in the current session.

Final native verification: cargo test passed all 9 tests. The desktop executable built and launched through the Tauri development runner. Window rendering, live Ollama benchmarks and desktop export interaction remain unverified. Incremental-cache hard-link warnings were non-fatal; Cargo copied files instead.


## Phase 02 completion continuation — 28 October 2026

### Current-source baseline and preserved manual work

Started from clean commit f7398f2; no reset, cleanup or overwrite of owner work was performed. The previous commit contains the recent light theme, Segoe UI typography, reasoning stream support, finalized-output fallback, native JSON save dialog, and benchmark history fixes. Those implementations were reused. The owner-confirmed 13 Windows workflows (desktop rendering, navigation/laptop layout, Ollama discovery/inference, live hardware and concurrent sampling, cancellation, persisted history, comparison, valid JSON export and deletion) are accepted as established; unchanged manual tests were not repeated.

The earlier sections of this report remain a historical record. The source-first matrix in PHASE_02_GAP_AUDIT.md supersedes historical missing-feature assumptions.

### Added and extended

- Independently optional NVML memory clock, power limit, memory-controller activity and PCIe transmit/receive. Added swap capacity/occupancy and logical-CPU usage. PCIe throughput is not memory bandwidth.
- Supported inference executable discovery with PID, name, process CPU/RAM and status; compact sortable table; no termination controls. Process GPU memory is explicitly unavailable where reliable attribution has not been implemented.
- Native system-SQLite schema v1 in the Tauri application data directory. Transactional/idempotent legacy import preserves IDs/timestamps and keeps the old localStorage copy. A migration marker prevents deleted native history from reappearing. Invalid records are skipped without deleting the source. Future schema versions are rejected. Database retention has no 20-run cap. The UI loads 200-record pages; hardware capture retains its existing 600-sample bound. Browser-only preview retains its original 20-run fallback.
- CSV export complements existing JSON export. Exports query all native saved records rather than only the displayed page. CSV has explicit units/UTC timestamps, quote/newline escaping, formula-prefix hardening, and blank unavailable values. Existing native JSON export is preserved. Both native exports retain the existing 32 MiB safety limit and surface errors.
- Saved comparison metadata: backend, quantization if reported, prompt character length and SHA-256 digest (no raw prompt), output cap and hardware identity. Provider/settings/hardware mismatches and unknown context/cache state are warned about. Zero/missing baselines never produce an infinite percentage.
- Typed Ollama/llama.cpp provider selection defaults to Ollama, preserving previous callers. llama.cpp health/model discovery, streaming /completion, SSE keepalive handling, timing normalization and shared request cancellation are implemented. Missing load and total duration remain unavailable, with llama.cpp source labels. No models or backend services were installed/downloaded.
- Evidence-based CPU/VRAM pressure, power-headroom and swap-allocation findings give the observation, possible explanation, evidence strength and suggested investigation. They do not claim causal bottleneck attribution.

### UI refinement

Existing light surfaces, typeface, navigation, component contracts and laptop breakpoints retained. Added shared CSS tokens, restrained 24 px headings, denser 23 px tabular metrics, flatter cards without gradients/shadows, numeric table alignment, process sort controls, comparison metadata columns, chart unit formatting/legends and linked hardware chart interactions. Missing chart samples remain null. Legacy literal styles remain; complete CSS replacement was intentionally avoided.

### Verification

Baseline: frontend production build, lint, 10 frontend tests and offline Rust check passed before extending behavior.
Continuation: frontend build/typecheck/lint passed; new tests cover CSV escaping/missing values/timestamps, comparison guards, conservative diagnostics, process-table empty/sort states and existing metric cards. Rust check, native debug executable build and unit tests passed on Windows. Storage tests cover idempotent migration, invalid records, non-restoration after deletion, raw-output removal, disk reopening and retention beyond 20 runs. Provider tests cover Ollama parsing and llama.cpp SSE/ms normalization without fabricated timings. Existing cancellation/NVML-unavailable tests pass. Final command totals are appended below after the final run.

Non-fatal warnings: ECharts bundle size, Cargo incremental-cache hard-link fallback, and npm environment proxy setting. The first introduced SQLite compile error (missing function-pointer type annotation) was corrected before checks passed.

### Remaining gaps and limits

- No live llama.cpp server was available; discovery/inference/cancellation integration is implemented but live behavior remains unverified.
- New device counters depend on driver/hardware support. Reliable GPU process attribution, swap I/O rate, kernel paths, attention FLOPs, actual weight-read traffic and DRAM bandwidth are not implemented.
- Diagnostics do not use throttle reasons, establish offload causality or claim universally faster models. Context window and cache state remain unknown where not provided.
- Modified pages have source/component QA only. No GUI tooling or screenshots were available; no new desktop visual verification is claimed.
- Linux code paths were inspected only. Linux requires libsqlite3.so.0 plus existing Tauri system dependencies; no Linux compilation/runtime test ran.
- Native CSV save-dialog interaction and real-history WebView-to-database migration were not manually exercised; SQLite behavior is tested against actual Windows SQLite with synthetic records.
- Local system-SQLite availability is required; failures keep legacy history intact and are visible to the user. Large exports above 32 MiB are rejected rather than silently truncated.

### Completion assessment

Phase 02 now has implementations for the major requested functional gaps, with automated Windows evidence. It is not declared fully accepted: Linux, modified-page visual QA, live llama.cpp and new native CSV/migration interaction remain unverified. Existing verified Windows behavior was preserved in source and protected by regressions, rather than assumed to constitute validation of new workflows.


### Final executed results

| Command | Outcome |
| --- | --- |
| npm run typecheck | Passed |
| npm run build | Passed; TypeScript and Vite production output, non-fatal bundle-size warning |
| npm run lint | Passed |
| npm test | 21 passed across 6 files |
| cargo check --offline --manifest-path src-tauri/Cargo.toml | Passed on Windows |
| cargo build --offline --manifest-path src-tauri/Cargo.toml | Passed; native debug executable built, not launched |
| cargo test --offline --manifest-path src-tauri/Cargo.toml | 14 passed, no failures |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | Passed |
| git diff --check | Passed |

No development servers or application windows were started for this continuation. No commits or pushes were performed. Source changes are left reviewable in the working tree. llama.cpp API contract reference: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md. GUI/screenshots and Linux checks were unavailable; no visual or Linux runtime success is claimed.
