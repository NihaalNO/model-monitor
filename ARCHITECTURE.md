# Architecture

Phase 03 adds isolated analysis workspaces and schema v2 summary/detail storage. See [PHASE_03_PROFILING_ARCHITECTURE.md](PHASE_03_PROFILING_ARCHITECTURE.md) for current boundaries; older schema-v1 descriptions below are historical. New profiling never enters ordinary sampling.

## Boundaries

The React WebView renders native command responses. It has no filesystem, shell, HTTP-plugin or GPU access. The Rust backend reads system counters and contacts a validated loopback Ollama endpoint. Browser preview disables native actions and shows unavailable metrics.

| File | Responsibility |
| --- | --- |
| src/App.tsx | Navigation, polling lifecycle, benchmark controls, preferences, bounded histories |
| src/types.ts | TypeScript contracts matching Rust serialized structures |
| src/services.ts | Typed invoke wrappers and streaming IPC channel |
| src/components/MetricCard.tsx | Value, classification, source and unavailable reason |
| src/components/Chart.tsx | Memoized ECharts lifecycle, resize and disposal |
| src/utils.ts | Settings validation, persistence, formatting and bounded append |
| src-tauri/src/lib.rs | Command registration, shared state, benchmark admission, shutdown cancellation |
| src-tauri/src/monitor.rs | Reused sysinfo / NVML instances and snapshots |
| src-tauri/src/platform.rs | Windows WMI / Linux DRM adapter inventory |
| src-tauri/src/ollama.rs | Loopback validation, HTTP client and model/version schemas |
| src-tauri/src/benchmark.rs | NDJSON streaming, API errors, cancellation and final-result assembly |
| src-tauri/src/metrics.rs | Common measurement contract and throughput / duration calculations |

## Native commands

- `sample_hardware()`: returns a timestamped Snapshot. Native calls run on a blocking worker rather than the UI thread. One mutex serializes access to reused monitor instances.
- `ollama_status(endpoint)`: concurrently fetches /api/version, /api/tags and /api/ps. Version failure means disconnected; model-list failures are separately reported, retaining successful lists.
- `run_benchmark(endpoint, model, prompt, onProgress)`: admits one benchmark globally, confirms the model is installed, opens /api/generate and returns final BenchmarkResult.
- `cancel_benchmark()`: cancels the active request through its CancellationToken.

The benchmark channel emits `started` after admission and `output` for response text. Cancel becomes enabled after the started acknowledgment, avoiding an early cancellation race. The token is checked during model discovery, request establishment and every stream read; cancellation wins when both select branches are ready. Closing the window requests cancellation. Dropping the HTTP response closes the local stream; Ollama governs server-side cleanup.

Custom commands are registered explicitly. The single local window has event subscription permissions only. No remote WebView, external script, shell plugin or unrestricted filesystem capability is configured.

## Sampling lifecycle

The frontend owns one recursive timeout, not an overlapping setInterval for hardware. Cleanup stops rescheduling; a shared in-flight guard handles development-mode effect remounts. Each iteration awaits the native sample before scheduling the next delay. CPU's first sample is unavailable because utilization needs a measurement interval.

The monitor initializes sysinfo for CPU/memory only, avoiding process enumeration. NVML is loaded once, and every GPU counter can fail independently. Adapter inventory is read once on startup. Linux reports vendor and PCI device identifier; Windows WMI reports display-adapter names. Inventory has no fabricated VRAM values.

Hardware samples are retained in a bounded ring represented by an array. Defaults: 1000 ms delay and 120 samples; settings bound retention to 600. All devices appear in native snapshots. Overview charts use GPU 0. Charts update from sample history, not token chunks, and animation is disabled.

While a benchmark is active, successful samples are also retained in a separate 600-sample in-memory buffer. The latest run's sample count is displayed. This buffer is not exported or persisted and does not attribute whole-system activity to the model. It includes client request/discovery time. Very short requests may have zero concurrent samples.

## Ollama contract

Model/version discovery uses five-second request limits. Connections have a three-second timeout. Inference uses a 30-minute maximum request duration and 512-token generation cap. Only installed names returned by /api/tags are accepted for generation.

NDJSON decoding buffers incomplete bytes until newline, so split UTF-8 and split network frames are handled before JSON decoding. A complete final frame without a trailing newline is accepted. Frames above 1 MiB, invalid JSON, explicit API errors and streams ending without done=true become errors. Only the final done frame produces benchmark rates. Output is text, never evaluated as HTML or executable code. Thinking fields are not displayed separately in this MVP.

Decode throughput = eval_count × 1e9 / eval_duration.
Prefill throughput = prompt_eval_count × 1e9 / prompt_eval_duration.
Zero/missing duration yields unavailable, never infinity. All durations are converted from nanoseconds to seconds for display.

The final total duration is Ollama's reported duration, not a browser-wall-clock latency. Transport overhead is not added. Prompt caching may reduce prompt evaluation work. Loaded model size_vram is residency metadata, not measured VRAM utilization or model-specific bandwidth.

## Settings and security

Both frontend and backend validate URLs. Only HTTP(S) loopback addresses and localhost are accepted; credentials, non-root paths, query strings and fragments are rejected. Rust disables proxies and redirects. Remote endpoint support is intentionally excluded, so no silent non-loopback request occurs.

Preferences are validated on load and stored locally; prompt and metric histories are ephemeral. Settings changes are disabled during benchmarks. There is no backend polling daemon to leak after shutdown. Error messages go to the UI; no telemetry service exists.

## Measurement model

Each Metric carries value (nullable), unit, classification, source and reason (nullable). Classifications are measured, derived, estimated and unavailable. Phase 1 does not produce estimates. Missing or unsupported counters retain an explanation. Whole-system hardware and request-specific software metrics are displayed separately.

## References checked during implementation

- [Tauri Rust commands](https://v2.tauri.app/develop/calling-rust/)
- [Tauri IPC Channel](https://v2.tauri.app/reference/javascript/api/namespacecore/)
- [sysinfo 0.33 System](https://docs.rs/sysinfo/0.33.1/sysinfo/struct.System.html)
- [nvml-wrapper 0.11](https://docs.rs/crate/nvml-wrapper/0.11.0)
- [WMI connection](https://docs.rs/wmi/latest/wmi/struct.WMIConnection.html)
- [Ollama generation API](https://docs.ollama.com/api/generate)


## Phase 02 continuation

- `storage.rs`: dynamically loads system SQLite (winsqlite3.dll on Windows, libsqlite3.so.0 on Linux) via libloading. Each connection remains within one blocking worker; no SQLite handle crosses threads. Schema version is checked before mutation. Migration holds BEGIN IMMEDIATE, imports validated legacy records with INSERT OR IGNORE, and records a marker only with the successful transaction. The legacy browser copy is retained. Database deletion does not remove that marker, preventing re-import after deletion. SQL string values use quote escaping and CString rejects embedded NUL. Future schema versions are rejected.
- `benchmark_store` command: app-owned data directory, fixed filename benchmarks.sqlite3; no caller-supplied DB path. Single-run saves, 200-record pages, unlimited database retention, whole-history export. Disk failures surface to the UI. Local browser preview retains the legacy bounded fallback. Raw prompt is excluded; generated output is stripped before DB save.
- `providers.rs`: typed provider selection defaults to Ollama for backwards compatibility. llama.cpp uses /health, /v1/models and /completion. NDJSON/SSE frames share final-metric normalization and cancellation. Server-side load/total timings remain unavailable where not exposed. No model download or service installation occurs.
- `monitor.rs` adds reused sysinfo process refresh, per-core and swap counters and independent optional NVML counters. Process CPU semantics differ from aggregate CPU; GPU attribution is not fabricated. All polling stays in the existing serialized worker path.
- Saved comparison context stores backend, quantization when reported, prompt character length/digest, output cap and hardware identity; no raw prompt. Unknown context-window/cache state always produces an observational-comparison caveat.
- `diagnostics.ts` is pure and conservative; it describes sampled evidence and possible causes without declaring a utilization sample to be a definitive bottleneck.

Existing sections describing browser-only persistence and missing process refresh are historical Phase 1 descriptions, superseded by this section.
