//! Import-only profiling boundary. Never starts or attaches to a workload.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Serialize)]
pub struct Capability {
    pub name: String,
    pub status: String,
    pub detail: String,
    pub reference: String,
}
fn locate_tool(executable: &str, paths: &[std::path::PathBuf]) -> &'static str {
    let mut denied = false;
    for dir in paths {
        match dir.join(executable).metadata() {
            Ok(m) if m.is_file() => return "Unverified",
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => denied = true,
            _ => {}
        }
    }
    if denied {
        "Permission denied"
    } else {
        "Not detected"
    }
}
pub fn capabilities() -> Vec<Capability> {
    let mut result = Vec::new();
    for (name, executable, reference) in [
        (
            "Nsight Compute CLI",
            "ncu",
            "https://developer.nvidia.com/nsight-compute",
        ),
        (
            "Nsight Systems CLI",
            "nsys",
            "https://developer.nvidia.com/nsight-systems",
        ),
        (
            "llama-bench",
            "llama-bench",
            "https://github.com/ggml-org/llama.cpp/tree/master/tools/llama-bench",
        ),
    ] {
        let paths = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
            .unwrap_or_default();
        let executable = if cfg!(windows) {
            format!("{executable}.exe")
        } else {
            executable.into()
        };
        let status = locate_tool(&executable, &paths);
        result.push(Capability { name: name.into(), status: status.into(), detail: if status == "Unverified" { "Executable found on PATH; version, execution and device compatibility have not been verified." } else if status == "Permission denied" { "Access denied while checking an executable path. No elevation is attempted." } else { "Not found on PATH. It may be installed elsewhere; no software will be installed automatically." }.into(), reference: reference.into() });
    }
    let gpu = nvml_wrapper::Nvml::init().and_then(|n| n.device_count());
    let gpu_status = match &gpu {
        Ok(n) if *n > 0 => "Supported",
        Err(nvml_wrapper::error::NvmlError::NoPermission) => "Permission denied",
        _ => "Not detected",
    };
    result.push(Capability { name: "NVIDIA driver / NVML devices".into(), status: gpu_status.into(), detail: format!("NVML device discovery: {gpu:?}. This does not verify CUDA execution or profiler support."), reference: "https://developer.nvidia.com/nvidia-management-library-nvml".into() });
    for name in [
        "CUDA execution",
        "CUPTI",
        "Performance-counter permissions",
        "GPU architecture support",
        "Profiler metrics and sections",
    ] {
        result.push(Capability { name: name.into(), status: "Unverified".into(), detail: "Requires a tool/device-specific probe or real capture. Import-only mode does not establish this capability or elevate privileges.".into(), reference: "https://docs.nvidia.com/nsight-compute/ProfilingGuide/".into() });
    }
    result
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Counter {
    pub original_name: String,
    pub original_unit: String,
    pub original_value: String,
    pub value: Option<f64>,
    pub unit: String,
    pub category: String,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Kernel {
    pub id: String,
    pub name: String,
    pub counters: Vec<Counter>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    pub schema: u32,
    pub kernels: Vec<Kernel>,
    pub warnings: Vec<String>,
}

// RFC4180 quoting including embedded newlines. Logs are accepted only before the header.
fn csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rows = vec![];
    let mut row = vec![];
    let mut cell = String::new();
    let mut quoted = false;
    let mut closed = false;
    let mut chars = text.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cell.push('"');
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                cell.push(c);
            }
        } else {
            match c {
                '"' if cell.is_empty() && !closed => quoted = true,
                ',' => {
                    row.push(std::mem::take(&mut cell));
                    closed = false;
                }
                '\n' => {
                    row.push(std::mem::take(&mut cell));
                    rows.push(std::mem::take(&mut row));
                    closed = false;
                }
                '\r' if chars.peek() == Some(&'\n') => {}
                _ if closed || c == '"' => return Err("Invalid CSV quoting".into()),
                _ => cell.push(c),
            }
        }
    }
    if quoted {
        return Err("Unterminated CSV field".into());
    }
    if !cell.is_empty() || !row.is_empty() || closed {
        row.push(cell);
        rows.push(row);
    }
    Ok(rows)
}
fn normalize(name: &str, unit: &str, raw: &str) -> Result<Counter, String> {
    let category = if name == "gpu__time_duration.sum" {
        "duration"
    } else if name.starts_with("dram__") {
        "device_memory"
    } else if name.starts_with("lts__") {
        "l2_cache"
    } else if name.contains("warps_active") {
        "occupancy"
    } else if name.starts_with("sm__") || name.starts_with("smsp__") {
        "computation"
    } else {
        "other"
    };
    let mut counter = Counter {
        original_name: name.into(),
        original_unit: unit.into(),
        original_value: raw.into(),
        value: None,
        unit: unit.into(),
        category: category.into(),
        reason: None,
    };
    if matches!(
        raw.trim(),
        "" | "N/A" | "n/a" | "nan" | "-" | "Not supported"
    ) {
        counter.reason = Some("Counter unavailable in imported report".into());
        return Ok(counter);
    }
    let mut numeric = raw.trim().to_owned();
    if numeric.contains(',') {
        let parts: Vec<_> = numeric.split('.').collect();
        let groups: Vec<_> = parts[0].split(',').collect();
        if parts.len() > 2
            || groups[0].is_empty()
            || groups[0].len() > 3
            || !groups.iter().all(|g| g.bytes().all(|b| b.is_ascii_digit()))
            || !groups.iter().skip(1).all(|g| g.len() == 3)
            || parts
                .get(1)
                .is_some_and(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err("Ambiguous numeric grouping; export English/base-unit CSV".into());
        }
        numeric = numeric.replace(',', "");
    }
    let value: f64 = numeric
        .parse()
        .map_err(|_| format!("Invalid numeric value for {name}"))?;
    if !value.is_finite() || value < 0.0 {
        return Err(format!("Invalid counter value for {name}"));
    }
    // Never guess locale, percentage semantics or scale.
    let (factor, normalized) = match unit {
        "nsecond" | "ns" => (1e-9, "s"),
        "usecond" | "us" | "µs" => (1e-6, "s"),
        "msecond" | "ms" => (1e-3, "s"),
        "second" | "s" => (1.0, "s"),
        "byte/second" | "B/s" => (1.0, "B/s"),
        "Gbyte/second" => (1e9, "B/s"),
        "Mbyte/second" => (1e6, "B/s"),
        "Kbyte/second" => (1e3, "B/s"),
        "byte" | "bytes" => (1.0, "bytes"),
        "%" | "pct" => (1.0, "%"),
        "inst" | "cycle" | "sector" | "request" | "" => (1.0, unit),
        _ => {
            counter.reason =
                Some("Unsupported unit; original value retained without normalization".into());
            return Ok(counter);
        }
    };
    if !value.is_finite() || value < 0.0 || !(value * factor).is_finite() {
        return Err(format!("Invalid counter value for {name}"));
    }
    counter.value = Some(value * factor);
    counter.unit = normalized.into();
    Ok(counter)
}
pub fn import(text: &str) -> Result<Report, String> {
    if text.len() > 8 * 1024 * 1024 {
        return Err("Report exceeds 8 MiB".into());
    }
    let rows = csv(text)?;
    let header = rows
        .iter()
        .position(|r| r.iter().any(|c| c == "Metric Name") && r.iter().any(|c| c == "Kernel Name"))
        .ok_or("Expected Nsight Compute long-form CSV header")?;
    let columns = &rows[header];
    let col = |name| {
        columns
            .iter()
            .position(|s| s == name)
            .ok_or_else(|| format!("Missing column: {name}"))
    };
    let (id, name, metric, unit, value) = (
        col("ID")?,
        col("Kernel Name")?,
        col("Metric Name")?,
        col("Metric Unit")?,
        col("Metric Value")?,
    );
    let mut kernels: BTreeMap<String, Kernel> = BTreeMap::new();
    let mut seen = BTreeSet::new();
    let mut count = 0;
    for row in rows.iter().skip(header + 1) {
        if row.len() == 1 && row[0].trim().is_empty() {
            continue;
        }
        if row.len() != columns.len() {
            return Err("CSV column count changed".into());
        }
        if row[id].is_empty() || row[name].is_empty() || row[metric].is_empty() {
            return Err("Missing kernel or metric identifier".into());
        }
        let identity = ["Process ID", "Device", "Context", "Stream"]
            .iter()
            .map(|key| {
                columns
                    .iter()
                    .position(|c| c == key)
                    .map(|i| row[i].clone())
                    .unwrap_or_default()
            })
            .chain(std::iter::once(row[id].clone()))
            .collect::<Vec<_>>()
            .join(":");
        if !seen.insert((identity.clone(), row[metric].clone())) {
            return Err("Duplicate launch/metric pair; summary CSV is unsupported".into());
        }
        let kernel = kernels.entry(identity.clone()).or_insert_with(|| Kernel {
            id: identity,
            name: row[name].clone(),
            counters: vec![],
        });
        if kernel.name != row[name] {
            return Err("Conflicting kernel identifiers".into());
        }
        kernel
            .counters
            .push(normalize(&row[metric], &row[unit], &row[value])?);
        count += 1;
        if count > 50000 || kernels.len() > 5000 {
            return Err(
                "Report exceeds 50,000 counters or 5,000 launches; export a smaller selection"
                    .into(),
            );
        }
    }
    if kernels.is_empty() {
        return Err("No kernel measurements found".into());
    }
    Ok(Report { schema: 1, kernels: kernels.into_values().collect(), warnings: vec![
        "Imported Nsight Compute CSV; profiler version and capture timestamp are not established by this format. User metadata is unverified.".into(),
        "Instrumentation/replay timings are not normal inference throughput. Missing counters remain unavailable.".into(),
        "DRAM traffic includes weights, activations, KV cache and temporary buffers; exact weight reads and attention attribution are unavailable.".into(),
        "Kernel names and GGUF quantization alone do not establish arithmetic precision or tensor-core usage.".into(),
    ] })
}

#[cfg(test)]
mod tests {
    use super::*;
    const HEADER: &str = "ID,Kernel Name,Metric Name,Metric Unit,Metric Value\n";
    #[test]
    fn missing_tools_are_not_reported_as_installed() {
        assert_eq!(locate_tool("missing-profiler", &[]), "Not detected");
        let executable = std::env::current_exe().unwrap();
        assert_eq!(
            locate_tool(
                executable.file_name().unwrap().to_str().unwrap(),
                &[executable.parent().unwrap().to_owned()]
            ),
            "Unverified"
        );
    }
    #[test]
    fn grouped_numbers_and_units_are_explicit() {
        assert_eq!(
            normalize("dram__bytes.sum.per_second", "Gbyte/second", "1,234.5")
                .unwrap()
                .value,
            Some(1234500000000.0)
        );
        assert!(normalize("x", "ns", "1,2").is_err());
        assert!(normalize("x", "unknown", "inf").is_err());
        assert_eq!(
            normalize("x", "unknown", "42").unwrap().original_value,
            "42"
        );
    }
    #[test]
    fn units_missing_and_export() {
        let r = import(&(HEADER.to_owned()+"0,gemm,gpu__time_duration.sum,nsecond,2500\n0,gemm,dram__bytes.sum.per_second,byte/second,N/A\n")).unwrap();
        assert_eq!(r.kernels.len(), 1);
        assert_eq!(r.kernels[0].counters[0].value, Some(0.0000025));
        assert_eq!(r.kernels[0].counters[1].value, None);
        assert_eq!(
            serde_json::from_str::<Report>(&serde_json::to_string(&r).unwrap())
                .unwrap()
                .schema,
            1
        );
    }
    #[test]
    fn invalid_inputs() {
        for s in ["garbage", "ID,Kernel Name\n0,a", "\"unterminated"] {
            assert!(import(s).is_err());
        }
        for v in ["NaN", "inf", "-1", "1e999"] {
            assert!(
                import(&(HEADER.to_owned() + &format!("0,a,gpu__time_duration.sum,ns,{v}")))
                    .is_err()
            );
        }
        assert!(import(&(HEADER.to_owned() + "0,a,x,inst,1\n0,a,x,inst,2")).is_err());
    }
    #[test]
    fn quoted_names_and_unknown_units() {
        let r = import(&(HEADER.to_owned() + "0,\"kernel<int, float>\",x,mystery,3")).unwrap();
        assert_eq!(r.kernels[0].name, "kernel<int, float>");
        assert!(r.kernels[0].counters[0].reason.is_some());
    }
    #[test]
    fn capability_statuses_are_explicit() {
        assert!(capabilities().iter().all(|c| [
            "Supported",
            "Unsupported",
            "Not installed",
            "Permission denied",
            "Not detected",
            "Unverified"
        ]
        .contains(&c.status.as_str())));
    }
}
