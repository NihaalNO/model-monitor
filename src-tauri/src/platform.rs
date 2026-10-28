use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct Adapter {
    pub name: String,
    pub vendor: String,
    pub source: String,
}

#[cfg(target_os = "windows")]
pub fn adapters() -> Result<Vec<Adapter>, String> {
    #[derive(serde::Deserialize)]
    struct VideoController {
        #[serde(rename = "Name")]
        name: Option<String>,
        #[serde(rename = "AdapterCompatibility")]
        vendor: Option<String>,
    }
    // WMI 0.18 initializes COM internally. Connection remains local to this worker thread.
    let connection =
        wmi::WMIConnection::new().map_err(|e| format!("GPU inventory unavailable: {e}"))?;
    let rows: Vec<VideoController> = connection
        .raw_query("SELECT Name, AdapterCompatibility FROM Win32_VideoController")
        .map_err(|e| format!("GPU inventory unavailable: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|r| Adapter {
            name: r.name.unwrap_or_else(|| "Unnamed display adapter".into()),
            vendor: r.vendor.unwrap_or_else(|| "Unknown vendor".into()),
            source: "Windows WMI".into(),
        })
        .collect())
}

#[cfg(target_os = "linux")]
pub fn adapters() -> Result<Vec<Adapter>, String> {
    let entries = std::fs::read_dir("/sys/class/drm")
        .map_err(|e| format!("GPU inventory unavailable: {e}"))?;
    let mut result = vec![];
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("card") || !name[4..].chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let device = entry.path().join("device");
        let vendor_id = std::fs::read_to_string(device.join("vendor")).unwrap_or_default();
        let device_id = std::fs::read_to_string(device.join("device")).unwrap_or_default();
        let vendor = match vendor_id.trim() {
            "0x10de" => "NVIDIA",
            "0x1002" => "AMD",
            "0x8086" => "Intel",
            _ => "Unknown vendor",
        };
        result.push(Adapter {
            name: format!(
                "{vendor} display adapter ({name}, PCI {})",
                device_id.trim()
            ),
            vendor: vendor.into(),
            source: "Linux DRM sysfs; PCI ID, not a marketed model name".into(),
        });
    }
    Ok(result)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub fn adapters() -> Result<Vec<Adapter>, String> {
    Err("GPU inventory supports Windows and Linux only".into())
}
