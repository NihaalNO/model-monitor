mod benchmark;
mod metrics;
mod monitor;
mod ollama;
mod platform;
mod profiling;
mod providers;
mod storage;

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
    provider: Option<providers::Provider>,
) -> Result<ollama::Status, String> {
    let base = ollama::endpoint(&endpoint)?;
    if provider.unwrap_or_default() == providers::Provider::Llamacpp {
        return Ok(providers::status(&state.client, &base).await);
    }
    Ok(ollama::status(&state.client, &base).await)
}
#[tauri::command]
async fn run_benchmark(
    endpoint: String,
    model: String,
    prompt: String,
    on_progress: Channel<benchmark::Progress>,
    state: State<'_, AppState>,
    provider: Option<providers::Provider>,
) -> Result<metrics::BenchmarkResult, String> {
    execute_benchmark(endpoint, model, prompt, on_progress, state, provider, None).await
}
#[tauri::command]
async fn run_experiment_trial(
    endpoint: String,
    model: String,
    prompt: String,
    on_progress: Channel<benchmark::Progress>,
    state: State<'_, AppState>,
    provider: Option<providers::Provider>,
    options: providers::WorkloadOptions,
) -> Result<metrics::BenchmarkResult, String> {
    execute_benchmark(
        endpoint,
        model,
        prompt,
        on_progress,
        state,
        provider,
        Some(options),
    )
    .await
}
async fn execute_benchmark(
    endpoint: String,
    model: String,
    prompt: String,
    on_progress: Channel<benchmark::Progress>,
    state: State<'_, AppState>,
    provider: Option<providers::Provider>,
    options: Option<providers::WorkloadOptions>,
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
    let result = if options.is_none() {
        benchmark::run(
            &state.client,
            &endpoint,
            model,
            prompt,
            on_progress,
            cancel,
            provider.unwrap_or_default(),
        )
        .await
    } else {
        benchmark::run_configured(
            &state.client,
            &endpoint,
            model,
            prompt,
            on_progress,
            cancel,
            provider.unwrap_or_default(),
            options,
        )
        .await
    };
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
async fn profiler_capabilities() -> Result<Vec<profiling::Capability>, String> {
    tauri::async_runtime::spawn_blocking(profiling::capabilities)
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn import_profile(csv: String) -> Result<profiling::Report, String> {
    tauri::async_runtime::spawn_blocking(move || profiling::import(&csv))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn analysis_store(
    app: tauri::AppHandle,
    action: String,
    session: Option<serde_json::Value>,
    id: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let db = storage::Db::open(&path.join("benchmarks.sqlite3"))?;
        match action.as_str() {
            "save" => {
                let s = session.ok_or("Missing session")?;
                let id = s["id"]
                    .as_str()
                    .filter(|s| !s.is_empty() && s.len() <= 128)
                    .ok_or("Invalid session ID")?;
                let at = s["at"]
                    .as_str()
                    .filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
                    .ok_or("Invalid session timestamp")?;
                let kind = s["kind"]
                    .as_str()
                    .filter(|s| ["profile", "experiment"].contains(s))
                    .ok_or("Invalid session kind")?;
                let payload = s.to_string();
                if payload.len() > 8 * 1024 * 1024 {
                    return Err("Session exceeds 8 MiB".into());
                }
                let mut summary = s.clone();
                let obj = summary.as_object_mut().ok_or("Invalid session object")?;
                let details = serde_json::json!({"report":obj.remove("report"),"trials":obj.remove("trials")}).to_string();
                let summary = summary.to_string();
                db.query("BEGIN IMMEDIATE")?;
                let saved = (|| {
                // Enforce the cap under the same transaction as the write.
                if db
                    .query("SELECT count(*) FROM analysis_sessions")?
                    .first()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(200)
                    >= 200
                {
                    return Err(
                        "200-session limit reached. Export and delete a saved session first."
                            .into(),
                    );
                }
                db.execute_bound(
                    "INSERT INTO analysis_sessions(id,at,kind,payload) VALUES(?,?,?,?)",
                    &[id, at, kind, &summary],
                )?;
                db.execute_bound("INSERT INTO analysis_details(session_id,payload) VALUES(?,?)", &[id,&details])?;
                Ok::<(),String>(())
                })();
                match saved { Ok(()) => { db.query("COMMIT")?; }, Err(e) => { let _ = db.query("ROLLBACK"); return Err(e); } }
            }
            "delete" => db.execute_bound(
                "DELETE FROM analysis_sessions WHERE id=?",
                &[&id.ok_or("Missing ID")?],
            )?,
            "load" => {}
            "get" => {
                let id = id.ok_or("Missing session ID")?;
                let summary = db.query_bound("SELECT payload FROM analysis_sessions WHERE id=?", &[&id])?;
                let details = db.query_bound("SELECT payload FROM analysis_details WHERE session_id=?", &[&id])?;
                let mut s: serde_json::Value = serde_json::from_str(summary.first().ok_or("Session not found")?).map_err(|e|e.to_string())?;
                if let Some(d) = details.first() {
                    let d: serde_json::Value = serde_json::from_str(d).map_err(|e|e.to_string())?;
                    for key in ["report","trials"] { if !d[key].is_null() { s[key] = d[key].clone(); } }
                }
                return Ok(vec![s]);
            }
            _ => return Err("Unknown analysis action".into()),
        }
        db.query("SELECT payload FROM analysis_sessions ORDER BY at DESC,id LIMIT 200")?
            .into_iter()
            .map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
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
#[tauri::command]
async fn export_csv(csv: String) -> Result<Option<String>, String> {
    if csv.len() > 32 * 1024 * 1024 {
        return Err("CSV exceeds 32 MiB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("CSV", &["csv"])
            .set_file_name("model-monitor-runs.csv")
            .save_file()
        else {
            return Ok(None);
        };
        std::fs::write(&path, csv).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn benchmark_store(
    app: tauri::AppHandle,
    action: String,
    runs: Vec<serde_json::Value>,
    offset: Option<u32>,
) -> Result<Vec<serde_json::Value>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        let db = storage::Db::open(&path.join("benchmarks.sqlite3"))?;
        match action.as_str() {
            "migrate" => {
                storage::migrate(&db, &runs)?;
            }
            "save" => {
                if runs.len() != 1 {
                    return Err("Save expects one run".into());
                }
                db.query(&storage::insert_sql(&runs[0], false)?)?;
            }
            "delete" => {
                db.query("DELETE FROM runs;")?;
            }
            "load" | "export" => {}
            _ => return Err("Unknown storage action".into()),
        }
        db.query(&if action == "export" {
            "SELECT payload FROM runs ORDER BY at DESC,id;".into()
        } else {
            format!(
                "SELECT payload FROM runs ORDER BY at DESC,id LIMIT 200 OFFSET {};",
                offset.unwrap_or(0)
            )
        })?
        .into_iter()
        .map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        .collect()
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
            export_benchmarks,
            export_csv,
            benchmark_store,
            profiler_capabilities,
            import_profile,
            analysis_store,
            run_experiment_trial
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Local AI Performance Monitor");
}
