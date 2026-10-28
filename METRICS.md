# Measurement reference

Hardware measurements are system-wide and include other applications. Software measurements below are available only for app-controlled Ollama benchmarks. An unavailable value is null and always has a reason; it is never replaced by zero.

| Metric | Definition / calculation | Unit | Source | Classification / limitation |
| --- | --- | --- | --- | --- |
| CPU utilization | Aggregate logical-CPU usage since previous refresh | % | sysinfo | Measured; first sample unavailable; includes all processes |
| Logical CPUs | Count of detected logical CPUs | count | sysinfo | Measured metadata |
| CPU name / OS / architecture | Native identity | text | sysinfo / Rust target constants | Measured metadata |
| RAM used | System memory used | bytes, displayed GiB | sysinfo | Measured; OS accounting differs across platforms |
| RAM available | OS estimate of memory available to workloads | bytes, displayed GiB | sysinfo | Measured API counter; not simply free memory |
| RAM total | Physical system memory | bytes, displayed GiB | sysinfo | Measured |
| GPU name / vendor | Native adapter identity | text | NVML / WMI / DRM sysfs | Measured metadata; Linux non-NVIDIA devices identified by PCI IDs |
| GPU utilization | Driver-reported GPU engine activity | % | NVML | Measured; driver sampling window; not bandwidth or attention cost |
| Dedicated VRAM used | Device-wide allocated memory | bytes, displayed GiB | NVML | Measured; WDDM / driver limitations apply |
| Dedicated VRAM total | Device-reported memory capacity | bytes, displayed GiB | NVML | Measured |
| Dedicated VRAM available | NVML memory free field | bytes, displayed GiB | NVML | Measured; not available from adapter inventory alone |
| GPU temperature | Driver GPU sensor temperature | °C | NVML | Measured when supported |
| GPU power | power_usage milliwatts / 1000 | W | NVML | Measured API counter with unit conversion; device/driver dependent |
| GPU core clock | Current graphics clock | MHz | NVML | Measured; cannot infer actual memory throughput |
| Installed model size | Stored model size reported in /api/tags | bytes, displayed GiB | Ollama | Measured metadata; not RAM consumption |
| Loaded model size | Loaded footprint as reported in /api/ps | bytes, displayed GiB | Ollama | Measured metadata, not a precise hardware allocation audit |
| Loaded GPU residency | size_vram from /api/ps | bytes, displayed GiB | Ollama | Measured metadata; may be absent |
| CPU residency bytes | Separate CPU residency of loaded weights | bytes | Not separately reported | Unavailable; do not assume size minus size_vram equals exact CPU allocation |
| Quantization / parameters | Model details fields | text | Ollama /api/tags | Measured metadata; absent fields show unavailable |
| Generated token count | eval_count from final done frame | tokens | Ollama /api/generate | Measured; not estimated from text length |
| Prompt token count | prompt_eval_count from final done frame | tokens | Ollama /api/generate | Measured; prompt cache can affect evaluated work |
| Decode duration | eval_duration / 1e9 | s | Ollama /api/generate | Derived unit conversion; not total latency |
| Prefill duration | prompt_eval_duration / 1e9 | s | Ollama /api/generate | Derived unit conversion |
| Generation throughput | eval_count × 1e9 / eval_duration | tok/s | Ollama final frame | Derived; unavailable if count missing or duration <= 0 |
| Prompt-processing throughput | prompt_eval_count × 1e9 / prompt_eval_duration | tok/s | Ollama final frame | Derived; same missing/zero safeguards |
| Loading duration | load_duration / 1e9 | s | Ollama /api/generate | Derived unit conversion; zero is a valid duration |
| Total request duration | total_duration / 1e9 | s | Ollama /api/generate | Derived unit conversion; excludes client transport overhead |
| Chart timestamp | System clock at native snapshot capture | Unix ms | Rust SystemTime | Measured; wall clock can jump |
| Memory bandwidth / speed | Actual bytes transferred per unit time | GB/s | No Phase 1 counter | Unavailable; utilization and clocks are insufficient |
| Exact weight-read traffic | Memory reads attributable to model weights | bytes/s | No Phase 1 attribution | Unavailable |
| Attention cost / FLOPs | Attention-specific operations or latency | FLOPs / time | No Phase 1 instrumentation | Unavailable |
| Kernel math paths | Per-operation tensor / CUDA / CPU execution path | categorical / timings | No Phase 1 profiler | Unavailable |

All rates use nanosecond API durations, with count × 1,000,000,000 / duration. Tests include missing durations, zero durations and zero token counts. Negative and non-integral durations/counts cannot deserialize into unsigned Rust counters.

No passive token-speed estimates are presented. Historical software charts contain only completed benchmark results. Failed/cancelled requests retain partial output but do not create a completed throughput result.

