# Phase 03 profiling architecture

Three isolated modes share existing telemetry and provider contracts:

| Mode | Execution boundary | Storage |
| --- | --- | --- |
| Live monitoring | Existing serialized sysinfo/NVML sampler; unchanged cadence | Existing frontend sample buffers |
| Controlled experiments | Sequential warmups and repetitions through existing benchmark admission/cancellation; validated WorkloadOptions | Analysis session summary plus separate detail payload |
| Deep profiling | Explicit user import of Nsight Compute raw long-form CSV; no executable launch or attachment | Analysis session summary plus separate detail payload |

`profiling.rs` owns capability discovery, CSV validation and metric normalization. `providers.rs` validates bounded output/context requests. `profiling.ts` defines typed IPC and pure statistics, aggregation, evidence and KV-estimate functions. `ProfilingWorkspace.tsx` owns UI session lifecycle and experiment sequencing. Existing single-run commands, final stream normalization and hardware sampling are reused.

Commands: `profiler_capabilities`, `import_profile`, `run_experiment_trial`, `analysis_store`. All filesystem parsing and database access run in native blocking workers. The frontend cannot execute commands or access arbitrary filesystem paths. No profiler dependency, privilege elevation or background capture is introduced. Tool discovery checks PATH metadata only; a found executable is Unverified until actually tested. NVML access denial is separate from missing devices. CUDA/CUPTI/counter permission/architecture/metric coverage stays Unverified.

Session UI states: Idle, Preparing, Running (server experiments), Processing, Completed, Failed, Cancelled. Imports skip Running because inference is not executed. Cancelling import suppresses result publication after parsing; it does not interrupt the bounded native parser. Experiment cancellation closes the current HTTP inference stream using the existing token and prevents additional trials. A Started acknowledgement closes the early-admission cancellation race. Navigation is disabled while an analysis is active; workspaces stay mounted across ordinary navigation. No profiler children exist to clean up. Active experiment shutdown inherits existing window-destruction cancellation.

SQLite schema v2 preserves `runs` and `metadata`, adding `analysis_sessions` and `analysis_details`. The detail row references the summary with ON DELETE CASCADE. Kernel records and experiment raw trials live in the detail JSON, separate from benchmark summary records; this is deliberately not a fully normalized per-counter relational schema. Prepared statements bind all new data values. Atomic summary/detail insertion and cap checking use BEGIN IMMEDIATE. Existing Phase 02 storage/migration behavior is retained. History loads summaries, then one selected detail report, rather than loading every trace. Limits: 8 MiB imported CSV, 5,000 launches, 50,000 counters, 8 MiB saved session and 200 sessions. Users explicitly delete records; no automatic history eviction. SQLite may reuse rather than immediately shrink freed pages.

Future capture adapters must supply authenticated tool/version/device capabilities, argument-based workload launching, process-tree ownership/cleanup, cancellation and measured capture metadata. No arbitrary shell-command API has been added. Binary reports must be exported by the vendor CLI; proprietary binary parsing is excluded.

References: [Nsight Compute CLI](https://docs.nvidia.com/nsight-compute/NsightComputeCli/), [profiling guide](https://docs.nvidia.com/nsight-compute/ProfilingGuide/), [llama-bench](https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench).
