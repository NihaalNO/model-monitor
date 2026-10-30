# Profiling metric contract

Every imported counter retains original name, unit and text value; normalized numeric value is nullable, accompanied by a reason. Unknown units are retained without guessing. Missing markers never become zero. Non-finite/negative numeric values are rejected. English thousands grouping is supported only when structurally valid; ambiguous locale formatting fails. Only long-form raw CSV is supported: ID, Kernel Name, Metric Name, Metric Unit, Metric Value columns are required. Process/device/context/stream columns participate in launch identity when provided. Duplicate launch/metric rows, conflicting kernel names and changing row shapes fail.

| Measurement | Normalization / source | Interpretation |
| --- | --- | --- |
| gpu__time_duration.sum | nsecond/usecond/msecond/second → seconds | Collected launch duration; instrumented/replayed |
| dram__* | Original metric semantics; byte/second → B/s, decimal K/M/G scaling | Aggregate device-memory traffic; never exact weight reads |
| lts__* | Original names and supported units | L2 counters; hit rate only when the actual metric reports it |
| sm__/smsp__* | Original counter and units | Computation activity; no math-path inference from kernel names |
| sm__warps_active.avg.pct_of_peak_sustained_active | Percent | Occupancy evidence, not proof of causality |
| Other counters | Retained and shown in launch details | Unsupported unit = unavailable normalization |

Kernel calls count distinct imported launch IDs, not metric rows. Aggregated time sums only available duration counters and shows timed/total calls; average divides by timed calls. No duration is synthesized for unmeasured launches. Compute throughput, FP16/FP32/integer/tensor activity are inspectable only if present in the original counters; no architecture-specific instruction interpretation is asserted.

Benchmark presets use fixed text repeated 1 or 64 times; context scaling uses 1/8/32/64 repetitions. Output caps are 64 or 512 tokens. Backend-reported prompt counts remain authoritative and may vary with tokenizer, cache and truncation. Seed 42 and temperature zero are requests, not guaranteed deterministic results. Ollama context is requested through num_ctx; llama.cpp context/batch/offloading remain server settings. llama.cpp cache_prompt=false is requested; Ollama prompt-cache state is uncontrolled.

Raw trials retain prefill/decode rates, token counts, load/total durations where reported, wall time and concurrent hardware samples. Up to 600 hardware samples per trial are system-wide. Summaries exclude warmups and group by fixed prompt size. Mean/min/max/median use available finite rates; sample variance uses n−1; SD and variance are unavailable for n<2. Raw API timing scope is inherited from Phase 02; tokenization/sampling inclusion is not independently established. Profiled and normal inference timings must not be treated as equivalent.

KV storage estimate = 2 × layers × KV heads × head dimension × context × bytes per element. KV heads explicitly supports MHA/GQA/MQA differences. Bytes/element 0.5/1/2/4 is an idealized storage assumption; quantization scale/padding overhead is excluded. Assumes one sequence, uniform full-cache layers and equal K/V dimensions. Hybrid/sliding-window architectures require additional metadata and are not modeled. Default inputs are illustrative assumptions, not detected architecture. Attention FLOPs and attention-specific kernel time remain unavailable.

NVML memory-controller activity (%), PCIe rates (KB/s), VRAM allocation (bytes), backend model residency (metadata), profiler DRAM throughput (B/s), and theoretical device peak bandwidth (unavailable) remain distinct.
