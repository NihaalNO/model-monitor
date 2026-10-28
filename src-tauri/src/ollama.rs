use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::{Host, Url};

pub fn endpoint(input: &str) -> Result<Url, String> {
    let url = Url::parse(input.trim()).map_err(|_| "Enter a valid http://127.0.0.1:11434 URL")?;
    let local = match url.host() {
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        Some(Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        _ => false,
    };
    if !local
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Only loopback HTTP(S) endpoints without credentials, paths, queries or fragments are supported".into());
    }
    Ok(url)
}
pub fn client() -> Result<Client, String> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Details {
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
    pub family: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Model {
    pub name: String,
    pub size: Option<u64>,
    pub size_vram: Option<u64>,
    #[serde(default)]
    pub details: Details,
    pub expires_at: Option<String>,
}
#[derive(Default, Deserialize)]
pub struct ModelList {
    #[serde(default)]
    pub models: Vec<Model>,
}
#[derive(Deserialize)]
struct Version {
    version: String,
}
#[derive(Serialize)]
pub struct Status {
    pub connected: bool,
    pub version: Option<String>,
    pub installed: Vec<Model>,
    pub loaded: Vec<Model>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}
pub async fn get_json<T: serde::de::DeserializeOwned>(
    client: &Client,
    base: &Url,
    path: &str,
) -> Result<T, String> {
    client
        .get(base.join(path).map_err(|e| e.to_string())?)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| format!("Invalid Ollama response: {e}"))
}
pub async fn status(client: &Client, base: &Url) -> Status {
    let (version, installed, loaded) = tokio::join!(
        get_json::<Version>(client, base, "api/version"),
        get_json::<ModelList>(client, base, "api/tags"),
        get_json::<ModelList>(client, base, "api/ps")
    );
    let mut warnings = vec![];
    let connected = version.is_ok();
    let error = version.as_ref().err().cloned();
    if let Err(e) = &installed {
        warnings.push(format!("Installed models: {e}"));
    }
    if let Err(e) = &loaded {
        warnings.push(format!("Loaded models: {e}"));
    }
    Status {
        connected,
        version: version.ok().map(|v| v.version),
        installed: installed.unwrap_or_default().models,
        loaded: loaded.unwrap_or_default().models,
        error,
        warnings,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_local_endpoints() {
        for url in [
            "http://127.0.0.1:11434",
            "http://localhost:11434/",
            "http://[::1]:11434",
        ] {
            assert!(endpoint(url).is_ok());
        }
        for url in [
            "https://example.com",
            "file:///tmp/x",
            "http://localhost.evil",
            "http://user@localhost",
            "http://localhost/api",
            "http://localhost/?x=1",
        ] {
            assert!(endpoint(url).is_err(), "{url}");
        }
    }
    #[test]
    fn parses_model_lists() {
        let list: ModelList = serde_json::from_str(r#"{"models":[{"name":"qwen:test","size":123,"details":{"quantization_level":"Q4_K_M"},"size_vram":100}]}"#).unwrap();
        assert_eq!(list.models[0].size_vram, Some(100));
        assert_eq!(
            list.models[0].details.quantization_level.as_deref(),
            Some("Q4_K_M")
        );
        let empty: ModelList = serde_json::from_str(r#"{"models":[]}"#).unwrap();
        assert!(empty.models.is_empty());
    }
}
