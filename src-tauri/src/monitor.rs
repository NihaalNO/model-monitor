use crate::metrics::Metric;
use nvml_wrapper::{
    enum_wrappers::device::{Clock, PcieUtilCounter, TemperatureSensor},
    Nvml,
};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Serialize)]
pub struct Gpu {
    pub name: String,
    pub vendor: String,
    pub utilization: Metric,
    pub vram_used: Metric,
    pub vram_total: Metric,
    pub vram_available: Metric,
    pub temperature: Metric,
    pub power: Metric,
    pub core_clock: Metric,
    pub memory_clock: Metric,
    pub power_limit: Metric,
    pub memory_controller: Metric,
    pub pcie_tx: Metric,
    pub pcie_rx: Metric,
}
#[derive(Serialize)]
pub struct InferenceProcess {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub ram_bytes: u64,
    pub status: String,
    pub gpu_memory: Metric,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub timestamp_ms: u64,
    pub os: String,
    pub arch: String,
    pub cpu_name: String,
    pub logical_cpus: usize,
    pub cpu: Metric,
    pub ram_used: Metric,
    pub ram_available: Metric,
    pub ram_total: Metric,
    pub swap_used: Metric,
    pub swap_total: Metric,
    pub per_core: Vec<Metric>,
    pub processes: Vec<InferenceProcess>,
    pub gpus: Vec<Gpu>,
    pub gpu_status: Option<String>,
    pub adapters: Vec<crate::platform::Adapter>,
    pub adapter_status: Option<String>,
}
pub struct Monitor {
    system: System,
    nvml: Result<Nvml, String>,
    primed: bool,
    inventory: Result<Vec<crate::platform::Adapter>, String>,
}
impl Monitor {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_memory();
        Self { system, nvml: Nvml::init().map_err(|e| format!("NVML unavailable: {e}. Install a supported NVIDIA driver; non-NVIDIA GPU telemetry is unavailable in Phase 1.")), primed: false, inventory: crate::platform::adapters() }
    }
    pub fn sample(&mut self) -> Snapshot {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
        let cpu = if self.primed {
            Metric::measured(
                self.system.global_cpu_usage() as f64,
                "%",
                "sysinfo · system-wide",
            )
        } else {
            Metric::unavailable("%", "sysinfo", "Waiting for a second CPU sample")
        };
        self.primed = true;
        let mut gpus = vec![];
        let mut gpu_status = None;
        match &self.nvml {
            Err(e) => gpu_status = Some(e.clone()),
            Ok(nvml) => match nvml.device_count() {
                Err(e) => gpu_status = Some(format!("NVML device enumeration failed: {e}")),
                Ok(count) => {
                    if count == 0 {
                        gpu_status = Some("No NVIDIA devices detected. Non-NVIDIA GPU telemetry is unavailable in Phase 1.".into());
                    }
                    for index in 0..count {
                        match nvml.device_by_index(index) {
                            Err(e) => {
                                gpu_status = Some(format!("GPU {index} could not be read: {e}"))
                            }
                            Ok(d) => {
                                let memory = d.memory_info();
                                let memory_metric = |field: &str| match &memory {
                                    Ok(m) => Metric::measured(
                                        match field {
                                            "used" => m.used,
                                            "total" => m.total,
                                            _ => m.free,
                                        } as f64,
                                        "bytes",
                                        "NVML · system-wide",
                                    ),
                                    Err(e) => Metric::unavailable("bytes", "NVML", e.to_string()),
                                };
                                gpus.push(Gpu {
                                    name: d
                                        .name()
                                        .unwrap_or_else(|_| format!("NVIDIA GPU {index}")),
                                    vendor: "NVIDIA".into(),
                                    utilization: nv_metric(
                                        d.utilization_rates().map(|v| v.gpu as f64),
                                        "%",
                                    ),
                                    vram_used: memory_metric("used"),
                                    vram_total: memory_metric("total"),
                                    vram_available: memory_metric("free"),
                                    temperature: nv_metric(
                                        d.temperature(TemperatureSensor::Gpu).map(|v| v as f64),
                                        "°C",
                                    ),
                                    power: nv_metric(
                                        d.power_usage().map(|v| v as f64 / 1000.0),
                                        "W",
                                    ),
                                    pcie_tx: nv_metric(
                                        d.pcie_throughput(PcieUtilCounter::Send).map(|v| v as f64),
                                        "KB/s",
                                    ),
                                    pcie_rx: nv_metric(
                                        d.pcie_throughput(PcieUtilCounter::Receive)
                                            .map(|v| v as f64),
                                        "KB/s",
                                    ),
                                    memory_clock: nv_metric(
                                        d.clock_info(Clock::Memory).map(|v| v as f64),
                                        "MHz",
                                    ),
                                    power_limit: nv_metric(
                                        d.power_management_limit().map(|v| v as f64 / 1000.0),
                                        "W",
                                    ),
                                    memory_controller: nv_metric(
                                        d.utilization_rates().map(|v| v.memory as f64),
                                        "%",
                                    ),
                                    core_clock: nv_metric(
                                        d.clock_info(Clock::Graphics).map(|v| v as f64),
                                        "MHz",
                                    ),
                                });
                            }
                        }
                    }
                }
            },
        }
        Snapshot {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.into()),
            arch: std::env::consts::ARCH.into(),
            cpu_name: self
                .system
                .cpus()
                .first()
                .map(|c| c.brand().to_string())
                .unwrap_or_else(|| "Unknown CPU".into()),
            logical_cpus: self.system.cpus().len(),
            cpu: cpu.clone(),
            ram_used: Metric::measured(
                self.system.used_memory() as f64,
                "bytes",
                "sysinfo · system-wide",
            ),
            ram_available: Metric::measured(
                self.system.available_memory() as f64,
                "bytes",
                "sysinfo · system-wide",
            ),
            ram_total: Metric::measured(
                self.system.total_memory() as f64,
                "bytes",
                "sysinfo · system-wide",
            ),
            swap_used: Metric::measured(
                self.system.used_swap() as f64,
                "bytes",
                "sysinfo system-wide",
            ),
            swap_total: Metric::measured(
                self.system.total_swap() as f64,
                "bytes",
                "sysinfo system-wide",
            ),
            per_core: self
                .system
                .cpus()
                .iter()
                .map(|c| {
                    if cpu.value.is_some() {
                        Metric::measured(c.cpu_usage() as f64, "%", "sysinfo logical CPU")
                    } else {
                        Metric::unavailable("%", "sysinfo", "Waiting for CPU interval")
                    }
                })
                .collect(),
            processes: self
                .system
                .processes()
                .iter()
                .filter_map(|(pid, p)| {
                    let name = p.name().to_string_lossy().into_owned();
                    let lower = name.to_lowercase();
                    if ![
                        "ollama",
                        "llama-server",
                        "llama-cli",
                        "llama.cpp",
                        "lm studio",
                        "lm-studio",
                    ]
                    .iter()
                    .any(|n| lower.contains(n))
                    {
                        return None;
                    }
                    Some(InferenceProcess {
                        pid: pid.as_u32(),
                        name,
                        cpu_percent: p.cpu_usage(),
                        ram_bytes: p.memory(),
                        status: format!("{:?}", p.status()),
                        gpu_memory: Metric::unavailable(
                            "bytes",
                            "NVML process accounting",
                            "Not reliably attributable across platforms and WDDM",
                        ),
                    })
                })
                .collect(),
            gpus,
            gpu_status,
            adapters: self.inventory.as_ref().cloned().unwrap_or_default(),
            adapter_status: self.inventory.as_ref().err().cloned(),
        }
    }
}
fn nv_metric(result: Result<f64, nvml_wrapper::error::NvmlError>, unit: &str) -> Metric {
    match result {
        Ok(v) => Metric::measured(v, unit, "NVML · system-wide"),
        Err(e) => Metric::unavailable(unit, "NVML", e.to_string()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_counter_remains_unavailable() {
        let m = nv_metric(Err(nvml_wrapper::error::NvmlError::NotSupported), "KB/s");
        assert!(m.value.is_none());
        assert!(m.reason.is_some());
    }
    #[test]
    fn absent_nvml_keeps_cpu_and_ram_available() {
        let mut m = Monitor::new();
        m.nvml = Err("NVML not installed".into());
        let s = m.sample();
        assert!(s.gpus.is_empty());
        assert_eq!(s.gpu_status.as_deref(), Some("NVML not installed"));
        assert!(s.ram_total.value.unwrap() > 0.0);
        assert!(serde_json::to_value(s).unwrap()["ram_used"]["value"].is_number());
    }
}
