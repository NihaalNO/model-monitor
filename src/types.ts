export type Classification = 'measured' | 'derived' | 'estimated' | 'unavailable';
export interface Metric { value: number | null; unit: string; classification: Classification; source: string; reason: string | null }
export interface Gpu { name: string; vendor: string; utilization: Metric; vram_used: Metric; vram_total: Metric; vram_available: Metric; temperature: Metric; power: Metric; core_clock: Metric }
export interface Snapshot { timestamp_ms: number; os: string; arch: string; cpu_name: string; logical_cpus: number; cpu: Metric; ram_used: Metric; ram_available: Metric; ram_total: Metric; gpus: Gpu[]; gpu_status: string | null; adapters: { name: string; vendor: string; source: string }[]; adapter_status: string | null }
export interface Model { name: string; size: number | null; size_vram: number | null; details: { parameter_size?: string; quantization_level?: string; family?: string }; expires_at: string | null }
export interface OllamaStatus { connected: boolean; version: string | null; installed: Model[]; loaded: Model[]; error: string | null; warnings: string[] }
export interface BenchmarkResult { output?: string; model: string; generated_tokens: Metric; prompt_tokens: Metric; decode_rate: Metric; prefill_rate: Metric; decode_duration: Metric; prefill_duration: Metric; total_duration: Metric; load_duration: Metric }
export interface Settings { endpoint: string; interval: number; history: number; charts: boolean }
export type Progress = { kind: 'output'; text: string } | { kind: 'started' };

