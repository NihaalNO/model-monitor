use libloading::Library;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;
type Callback =
    Option<unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int>;
pub struct Db {
    handle: *mut c_void,
    _library: Library,
    exec: unsafe extern "C" fn(
        *mut c_void,
        *const c_char,
        Callback,
        *mut c_void,
        *mut *mut c_char,
    ) -> c_int,
    close: unsafe extern "C" fn(*mut c_void) -> c_int,
}
impl Drop for Db {
    fn drop(&mut self) {
        unsafe {
            (self.close)(self.handle);
        }
    }
}
impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        unsafe {
            let name = if cfg!(windows) {
                "winsqlite3.dll"
            } else {
                "libsqlite3.so.0"
            };
            let library = Library::new(name).map_err(|e| e.to_string())?;
            let open = library
                .get::<unsafe extern "C" fn(*const c_char, *mut *mut c_void) -> c_int>(
                    b"sqlite3_open\0",
                )
                .map_err(|e| e.to_string())?;
            let exec = *library.get(b"sqlite3_exec\0").map_err(|e| e.to_string())?;
            let close: unsafe extern "C" fn(*mut c_void) -> c_int =
                *library.get(b"sqlite3_close\0").map_err(|e| e.to_string())?;
            let path =
                CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
            let mut handle = std::ptr::null_mut();
            if open(path.as_ptr(), &mut handle) != 0 {
                if !handle.is_null() {
                    close(handle);
                }
                return Err("Cannot open benchmark database".into());
            }
            let db = Self {
                handle,
                _library: library,
                exec,
                close,
            };
            if db
                .query("PRAGMA user_version;")?
                .first()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
                > 2
            {
                return Err("Database schema is newer than this app".into());
            }
            db.query("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, at TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS analysis_sessions(id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS analysis_details(session_id TEXT PRIMARY KEY REFERENCES analysis_sessions(id) ON DELETE CASCADE, payload TEXT NOT NULL); PRAGMA user_version=2; COMMIT;")?;
            Ok(db)
        }
    }
    /// Bound text parameters, keeping Phase 03 payloads out of SQL source.
    pub fn execute_bound(&self, sql: &str, params: &[&str]) -> Result<(), String> {
        self.query_bound(sql, params).map(|_| ())
    }
    pub fn query_bound(&self, sql: &str, params: &[&str]) -> Result<Vec<String>, String> {
        unsafe {
            type Prepare = unsafe extern "C" fn(
                *mut c_void,
                *const c_char,
                c_int,
                *mut *mut c_void,
                *mut *const c_char,
            ) -> c_int;
            type Bind = unsafe extern "C" fn(
                *mut c_void,
                c_int,
                *const c_char,
                c_int,
                Option<unsafe extern "C" fn(*mut c_void)>,
            ) -> c_int;
            type Step = unsafe extern "C" fn(*mut c_void) -> c_int;
            type Column = unsafe extern "C" fn(*mut c_void, c_int) -> *const c_char;
            let column = self
                ._library
                .get::<Column>(b"sqlite3_column_text\0")
                .map_err(|e| e.to_string())?;
            let prepare = self
                ._library
                .get::<Prepare>(b"sqlite3_prepare_v2\0")
                .map_err(|e| e.to_string())?;
            let bind = self
                ._library
                .get::<Bind>(b"sqlite3_bind_text\0")
                .map_err(|e| e.to_string())?;
            let step = self
                ._library
                .get::<Step>(b"sqlite3_step\0")
                .map_err(|e| e.to_string())?;
            let finalize = self
                ._library
                .get::<Step>(b"sqlite3_finalize\0")
                .map_err(|e| e.to_string())?;
            let sql = CString::new(sql).map_err(|e| e.to_string())?;
            let values: Vec<CString> = params
                .iter()
                .map(|s| CString::new(*s))
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            let mut stmt = std::ptr::null_mut();
            if prepare(
                self.handle,
                sql.as_ptr(),
                -1,
                &mut stmt,
                std::ptr::null_mut(),
            ) != 0
            {
                return Err("SQLite prepare failed".into());
            }
            let result = (|| {
                for (i, s) in values.iter().enumerate() {
                    if bind(stmt, (i + 1) as c_int, s.as_ptr(), -1, None) != 0 {
                        return Err("SQLite bind failed".into());
                    }
                }
                let mut rows = vec![];
                loop {
                    match step(stmt) {
                        101 => return Ok(rows),
                        100 => {
                            let text = column(stmt, 0);
                            if !text.is_null() {
                                rows.push(CStr::from_ptr(text).to_string_lossy().into_owned());
                            }
                        }
                        _ => return Err("SQLite statement failed".into()),
                    }
                }
            })();
            finalize(stmt);
            result
        }
    }
    pub fn query(&self, sql: &str) -> Result<Vec<String>, String> {
        unsafe extern "C" fn collect(
            ctx: *mut c_void,
            n: c_int,
            values: *mut *mut c_char,
            _names: *mut *mut c_char,
        ) -> c_int {
            if n > 0 && !(*values).is_null() {
                (*(ctx as *mut Vec<String>))
                    .push(CStr::from_ptr(*values).to_string_lossy().into_owned());
            }
            0
        }
        let sql = CString::new(sql).map_err(|e| e.to_string())?;
        let mut rows: Vec<String> = vec![];
        let status = unsafe {
            (self.exec)(
                self.handle,
                sql.as_ptr(),
                Some(collect),
                &mut rows as *mut _ as *mut c_void,
                std::ptr::null_mut(),
            )
        };
        if status != 0 {
            return Err(format!(
                "SQLite operation failed ({status}); transaction not confirmed"
            ));
        }
        Ok(rows)
    }
}
fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}
pub fn insert_sql(run: &serde_json::Value, ignore: bool) -> Result<String, String> {
    let id = run["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Invalid run ID")?;
    let at = run["at"]
        .as_str()
        .filter(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok())
        .ok_or("Invalid timestamp")?;
    if !run["result"]["model"].is_string() || !run["hardware"].is_array() {
        return Err("Invalid saved run".into());
    }
    let mut safe = run.clone();
    safe["result"]["output"] = serde_json::Value::String(String::new());
    safe.as_object_mut().ok_or("Invalid run")?.remove("prompt");
    Ok(format!(
        "INSERT {} INTO runs VALUES ({},{},{}) {};",
        if ignore { "OR IGNORE" } else { "" },
        quote(id),
        quote(at),
        quote(&safe.to_string()),
        if ignore {
            ""
        } else {
            "ON CONFLICT(id) DO UPDATE SET at=excluded.at,payload=excluded.payload"
        }
    ))
}
pub fn migrate(db: &Db, runs: &[serde_json::Value]) -> Result<usize, String> {
    db.query("BEGIN IMMEDIATE;")?;
    let result = (|| {
        if !db
            .query("SELECT value FROM metadata WHERE key='legacy-v1';")?
            .is_empty()
        {
            return Ok(0);
        }
        let mut skipped = 0;
        for run in runs {
            match insert_sql(run, true) {
                Ok(sql) => {
                    db.query(&sql)?;
                }
                Err(_) => skipped += 1,
            }
        }
        db.query("INSERT INTO metadata VALUES('legacy-v1','done');")?;
        Ok(skipped)
    })();
    match result {
        Ok(n) => {
            db.query("COMMIT;")?;
            Ok(n)
        }
        Err(e) => {
            let _ = db.query("ROLLBACK;");
            Err(e)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn version_two_preserves_runs_and_binds_payloads() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        assert_eq!(db.query("PRAGMA user_version").unwrap(), vec!["2"]);
        db.execute_bound(
            "INSERT INTO analysis_sessions VALUES(?,?,?,?)",
            &[
                "id'1",
                "2026-10-30T00:00:00Z",
                "profile",
                "{\"name\":\"a'; DROP TABLE runs;--\"}",
            ],
        )
        .unwrap();
        assert_eq!(db.query("SELECT count(*) FROM runs").unwrap(), vec!["0"]);
        assert_eq!(
            db.query("SELECT count(*) FROM analysis_sessions").unwrap(),
            vec!["1"]
        );
        db.execute_bound(
            "INSERT INTO analysis_details VALUES(?,?)",
            &["id'1", "{\"kernels\":[]}"],
        )
        .unwrap();
        assert_eq!(
            db.query_bound(
                "SELECT payload FROM analysis_details WHERE session_id=?",
                &["id'1"]
            )
            .unwrap(),
            vec!["{\"kernels\":[]}"]
        );
        assert!(db
            .execute_bound(
                "INSERT INTO analysis_details VALUES(?,?)",
                &["unrelated", "{}"]
            )
            .is_err());
        db.execute_bound("DELETE FROM analysis_sessions WHERE id=?", &["id'1"])
            .unwrap();
        assert_eq!(
            db.query("SELECT count(*) FROM analysis_sessions").unwrap(),
            vec!["0"]
        );
        assert_eq!(
            db.query("SELECT count(*) FROM analysis_details").unwrap(),
            vec!["0"]
        );
    }
    #[test]
    fn upgrades_v1_preserving_history_and_rejects_future_schema() {
        let path = std::env::temp_dir().join(format!(
            "model-monitor-upgrade-{}.sqlite3",
            std::process::id()
        ));
        {
            let db = Db::open(&path).unwrap();
            db.query(
                "DROP TABLE analysis_details; DROP TABLE analysis_sessions; PRAGMA user_version=1;",
            )
            .unwrap();
            db.execute_bound(
                "INSERT INTO runs VALUES(?,?,?)",
                &["prior-run", "2026-10-30T00:00:00Z", "{}"],
            )
            .unwrap();
        }
        {
            let db = Db::open(&path).unwrap();
            assert_eq!(db.query("PRAGMA user_version").unwrap(), vec!["2"]);
            assert_eq!(db.query("SELECT id FROM runs").unwrap(), vec!["prior-run"]);
            db.query("PRAGMA user_version=99").unwrap();
        }
        assert!(Db::open(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn disk_storage_reopens_without_a_retention_cap() {
        let file =
            std::env::temp_dir().join(format!("model-monitor-test-{}.sqlite3", std::process::id()));
        {
            let db = Db::open(&file).unwrap();
            for i in 0..25 {
                let r = serde_json::json!({"id":i.to_string(),"at":"2026-10-28T00:00:00Z","result":{"model":"m"},"hardware":[]});
                db.query(&insert_sql(&r, false).unwrap()).unwrap();
            }
        }
        {
            let db = Db::open(&file).unwrap();
            assert_eq!(db.query("SELECT count(*) FROM runs").unwrap(), vec!["25"]);
        }
        std::fs::remove_file(file).unwrap();
    }
    #[test]
    fn migration_is_idempotent_and_survives_delete() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        let run = serde_json::json!({"id":"a'1","at":"2026-10-28T00:00:00Z","result":{"model":"test","output":"private"},"hardware":[]});
        assert_eq!(migrate(&db, &[run, serde_json::json!({})]).unwrap(), 1);
        assert_eq!(db.query("SELECT count(*) FROM runs").unwrap(), vec!["1"]);
        assert!(!db.query("SELECT payload FROM runs").unwrap()[0].contains("private"));
        db.query("DELETE FROM runs;").unwrap();
        assert_eq!(migrate(&db, &[]).unwrap(), 0);
        assert_eq!(db.query("SELECT count(*) FROM runs").unwrap(), vec!["0"]);
    }
}
