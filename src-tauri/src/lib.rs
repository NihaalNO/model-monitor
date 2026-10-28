mod benchmark;
mod metrics;
mod monitor;
mod ollama;
mod platform;

use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, Manager, State};
use tokio_util::sync::CancellationToken;

struct AppState {
    monitor: Arc<Mutex<Option<monitor::Monitor>>>,
    benchmark: tokio::sync::Mutex<Option<CancellationToken>>,
    client: reqwest::Client,
}
#[tauri::command]
async fn sample_hardware(state: State<'_, AppState>) -> Result<monitor::Snapshot, String> {
    let monitor = Arc::clone(&state.monitor);
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = monitor.lock().map_err(|_| "Hardware monitor lock failed")?;
        let instance = guard.get_or_insert_with(monitor::Monitor::new);
        Ok(instance.sample())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn ollama_status(
    endpoint: String,
    state: State<'_, AppState>,
) -> Result<ollama::Status, String> {
    let base = ollama::endpoint(&endpoint)?;
    Ok(ollama::status(&state.client, &base).await)
}
#[tauri::command]
async fn run_benchmark(
    endpoint: String,
    model: String,
    prompt: String,
    on_progress: Channel<benchmark::Progress>,
    state: State<'_, AppState>,
) -> Result<metrics::BenchmarkResult, String> {
    let cancel = CancellationToken::new();
    {
        let mut active = state.benchmark.lock().await;
        if active.is_some() {
            return Err("A benchmark is already running".into());
        }
        *active = Some(cancel.clone());
    }
    let _ = on_progress.send(benchmark::Progress::Started);
    let result = benchmark::run(&state.client, &endpoint, model, prompt, on_progress, cancel).await;
    *state.benchmark.lock().await = None;
    result
}
#[tauri::command]
async fn cancel_benchmark(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(cancel) = state.benchmark.lock().await.as_ref() {
        cancel.cancel();
    }
    Ok(())
}
#[tauri::command]
async fn export_benchmarks(json: String) -> Result<Option<String>, String> {
    if json.len() > 32 * 1024 * 1024 {
        return Err("Export exceeds 32 MiB".into());
    }
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Export benchmark history")
            .add_filter("JSON", &["json"])
            .set_file_name("model-monitor-runs.json")
            .save_file()
        else {
            return Ok(None);
        };
        std::fs::write(&path, json).map_err(|e| format!("Could not save export: {e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            monitor: Arc::new(Mutex::new(None)),
            benchmark: tokio::sync::Mutex::new(None),
            client: ollama::client().expect("Could not initialize local HTTP client"),
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppState>();
                let active = state.benchmark.try_lock();
                if let Ok(guard) = active {
                    if let Some(token) = guard.as_ref() {
                        token.cancel();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sample_hardware,
            ollama_status,
            run_benchmark,
            cancel_benchmark,
            export_benchmarks
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Local AI Performance Monitor");
}
