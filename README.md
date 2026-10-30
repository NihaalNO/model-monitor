# Local AI Performance Monitor

A local desktop dashboard for Windows 11 and Linux, built with Tauri 2, Rust, React and TypeScript. Hardware samples are **system-wide**. Final token and prompt-processing rates come only from benchmarks initiated in this app.

**Status: Phase 03 import-first profiling and controlled experiments are implemented.** See [PHASE_03_REPORT.md](PHASE_03_REPORT.md) for acceptance and actual validation, including unverified live capture and deferred Linux runtime testing. Existing Phase 01/02 workflows are preserved.

Use **Experiments** for fixed short/long workloads and context scaling with warmups, repetitions, raw API results and statistics. Use **Profiler** to import documented Nsight Compute long-form raw CSV, inspect kernels/memory counters and browse saved reports without rerunning inference. Deep profiling does not automatically attach to processes or launch tools. Profiler installation, capture permissions and hardware support are optional and never assumed. See [requirements and limitations](PROFILING_LIMITATIONS.md) and [metric definitions](PROFILING_METRICS.md).

## Features

- Passive CPU utilization, logical CPU count, RAM used / available / total through sysinfo.
- Optional runtime-loaded NVIDIA NVML: utilization, VRAM used / free / total, temperature, power and graphics clock. Each failed counter has its own unavailable reason.
- Windows display-adapter inventory through WMI; Linux display-adapter vendor and PCI identification through DRM sysfs. Linux PCI IDs are not marketed GPU model names.
- Local Ollama version, installed models and loaded models; available quantization, parameter size and GPU residency metadata.
- Controlled streaming benchmark with independent prefill and decode rates, API durations, token counts and cancellation.
- Overview, Hardware, Models, Benchmark, Experiments, Profiler and Settings pages in the existing responsive light theme.
- Bounded histories: 120 hardware samples by default (30–600 configurable), last 20 completed throughput results, and up to 600 concurrent hardware samples for the latest benchmark.
- Metric classification, source and missing-data explanations. No random or simulated performance data.
- Loopback-only endpoints, redirects disabled, no shell or filesystem plugins, no telemetry uploads.

The first NVML GPU is shown on Overview; Hardware shows every NVML device. Adapter inventory can include integrated and virtual display devices.

## Stack

| Layer | Implementation |
| --- | --- |
| Desktop | Tauri 2 (Rust dependency minimum 2.12) |
| Native telemetry | sysinfo 0.33; nvml-wrapper 0.11; Windows wmi 0.18 |
| HTTP / cancellation | reqwest 0.12; Tokio; CancellationToken |
| UI | React 19; TypeScript; Vite 6; Tailwind 4 |
| Visualization | Apache ECharts 6; Lucide |
| Tests | Vitest 3, Testing Library; Rust unit tests |

Dependency ranges are declared and npm/Cargo lockfiles are now generated. Native runtime and Linux validation still require verification.

## Requirements

- Node.js 22 LTS or later with npm.
- Current stable Rust with Cargo and rustfmt.
- Platform requirements from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
- Optional: a running [Ollama](https://ollama.com/) service with an installed text-generation model.
- Optional: supported NVIDIA GPU and driver exposing NVML. CUDA Toolkit is not required by this implementation.

### Windows 11

Install Rust using its MSVC toolchain, Visual Studio Build Tools with **Desktop development with C++** and the Windows SDK, and Microsoft Edge WebView2 Runtime. Open a fresh terminal after installation. Check:

```powershell
rustc --version
cargo --version
node --version
npm --version
```

### Linux

Install Rust and your distribution's Tauri / WebKitGTK development prerequisites. For Debian / Ubuntu, the official prerequisites include:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev
```

Other distributions need their equivalent packages. Use the official prerequisite page for the current platform list.

## Run

From this project directory:

```bash
npm install
npm run tauri dev
```

If Ollama is installed but not running, start it separately with `ollama serve`. If it is already running in the tray, do not start a second server. The default endpoint is `http://127.0.0.1:11434`.

The app will not download models. Select an existing installed model, enter a prompt on Benchmark and run. Generation is capped at 512 output tokens; Ollama's model/context defaults otherwise apply.

`npm run dev` opens only a browser preview on `http://127.0.0.1:1420`. Browser mode explicitly marks native monitoring and inference unavailable; it is not a fallback hardware collector.

## Development commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

The last command builds a desktop executable; installer bundling is disabled for this MVP. Review and commit the generated package-lock.json and Cargo.lock after a successful dependency installation.

## Preferences and data

Settings allows loopback endpoint, hardware sample delay (500–10000 ms), sample retention and chart visibility. Hardware polling waits for the previous native call to finish, so the actual interval is sample time plus the configured delay. Ollama discovery runs every 10 seconds and can be retried manually.

Only preferences persist in the WebView's local storage. Metrics, prompts, output and benchmark results stay in application memory and reset on restart. The service receives benchmark prompts locally. Remote endpoints are rejected rather than allowed after a warning.

## Troubleshooting

- **Cannot find cargo / linker:** install Rust and platform build prerequisites; restart the terminal.
- **ENOTFOUND during npm install:** fix registry DNS/network access; do not interpret a failed install as a source-build result.
- **Ollama disconnected:** check that the service runs, its port matches Settings, and local firewall rules permit access. Try `http://127.0.0.1:11434/api/version` in your browser.
- **NVML unavailable:** install a supported NVIDIA driver; CPU/RAM monitoring should continue. NVML initialization is attempted once per app session; restart after repairing the driver.
- **Missing GPU counter:** some devices, WDDM modes and driver versions do not expose every counter. Unavailable is distinct from zero.
- **No model selected:** install a model with Ollama separately, then refresh Models.
- **Cancelled output:** partial text is retained but no final throughput is fabricated. HTTP stream cancellation does not guarantee immediate server-side resource release.
- **Different repeated rates:** model loading, prompt caching, thermal state and other workloads change results. Prefill metrics describe what Ollama actually evaluated.

See [ARCHITECTURE.md](ARCHITECTURE.md), [METRICS.md](METRICS.md) and [PHASE_01_REPORT.md](PHASE_01_REPORT.md).


## Phase 02 additions

Successful benchmarks now retain finalized results and hardware captures locally (last 20 runs). The Benchmark page provides a comparison table, JSON export and deletion. Prompts and output remain ephemeral. This supersedes Phase 1 documentation stating that all metric histories reset on restart. See PHASE_02_REPORT.md.

## Phase 02 continuation (28 October 2026)

The owner has verified the original 13 Windows workflows; this continuation preserves them and uses automated regression checks rather than asking for repeated confirmation.

Added native SQLite history with idempotent migration (legacy browser data retained), CSV export, process sorting, per-core/swap and optional expanded GPU/PCIe counters, llama.cpp provider selection and conservative diagnostics. History pages load 200 records without a database retention cap. JSON/CSV exports read the entire native history. Browser preview retains the old bounded fallback.

Select Ollama or llama.cpp in Settings and configure the matching loopback endpoint (typically 11434 or 8080). llama.cpp must already be running with a loaded model. Its native completion endpoint uses raw prompts; timings are normalized only where actually supplied. No models or servers are installed automatically.

SQLite uses the app data directory and system runtime: winsqlite3.dll on Windows, libsqlite3.so.0 on Linux (install the distribution SQLite runtime if absent). Migration errors leave legacy history untouched. Prompts/output are not stored in SQLite. Preserve the database when upgrading. See PHASE_02_GAP_AUDIT.md, DESIGN_SYSTEM.md and PHASE_02_REPORT.md for remaining validation limits. Earlier README statements about only browser storage or a dark theme are historical; the current design is light.
