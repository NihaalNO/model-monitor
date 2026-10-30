use crate::{metrics::GenerateChunk, ollama};
use serde::Deserialize;
#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Ollama,
    Llamacpp,
}
impl Provider {
    pub fn route(self) -> &'static str {
        if self == Self::Ollama {
            "api/generate"
        } else {
            "completion"
        }
    }
    pub fn request(self, model: &str, prompt: &str) -> serde_json::Value {
        if self == Self::Ollama {
            serde_json::json!({"model":model,"prompt":prompt,"stream":true,"options":{"num_predict":512}})
        } else {
            serde_json::json!({"model":model,"prompt":prompt,"stream":true,"n_predict":512})
        }
    }
}
#[derive(Clone, Default, Deserialize)]
pub struct WorkloadOptions {
    pub output_tokens: u32,
    pub context_length: Option<u32>,
}
impl WorkloadOptions {
    pub fn validate(&self, provider: Provider) -> Result<(), String> {
        if !(1..=4096).contains(&self.output_tokens) {
            return Err("Output tokens must be 1–4096".into());
        }
        if let Some(context) = self.context_length {
            if provider != Provider::Ollama {
                return Err("Context length is configured at llama.cpp server startup".into());
            }
            if !(256..=131072).contains(&context) {
                return Err("Context length must be 256–131072".into());
            }
        }
        Ok(())
    }
    pub fn request(&self, provider: Provider, model: &str, prompt: &str) -> serde_json::Value {
        let mut v = provider.request(model, prompt);
        if provider == Provider::Ollama {
            v["options"]["num_predict"] = self.output_tokens.into();
            v["options"]["seed"] = 42.into();
            v["options"]["temperature"] = 0.into();
            if let Some(n) = self.context_length {
                v["options"]["num_ctx"] = n.into();
            }
        } else {
            v["n_predict"] = self.output_tokens.into();
            v["seed"] = 42.into();
            v["temperature"] = 0.into();
            v["cache_prompt"] = false.into();
        }
        v
    }
}
pub async fn status(client: &reqwest::Client, base: &url::Url) -> ollama::Status {
    let result: Result<Vec<ollama::Model>, String> = async {
        let _: serde_json::Value = ollama::get_json(client, base, "health").await?;
        let models: serde_json::Value = ollama::get_json(client, base, "v1/models").await?;
        Ok(models["data"]
            .as_array()
            .ok_or("Missing model list")?
            .iter()
            .filter_map(|m| m["id"].as_str())
            .map(|id| ollama::Model {
                name: id.into(),
                size: None,
                size_vram: None,
                details: Default::default(),
                expires_at: None,
            })
            .collect())
    }
    .await;
    match result {Ok(models)=>ollama::Status{connected:true,version:None,installed:models.clone(),loaded:models,error:None,warnings:vec!["llama.cpp /completion uses the server's loaded model and raw prompt; load and total-request durations are unavailable.".into()]},Err(e)=>ollama::Status{connected:false,version:None,installed:vec![],loaded:vec![],error:Some(e),warnings:vec![]}}
}
pub fn parse(line: &[u8]) -> Result<Option<GenerateChunk>, String> {
    let text = std::str::from_utf8(line).map_err(|e| e.to_string())?.trim();
    if text.is_empty() || text.starts_with(':') || text == "data: [DONE]" {
        return Ok(None);
    }
    let text = text.strip_prefix("data:").unwrap_or(text).trim();
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if v.get("content").is_some() || v.get("stop").is_some() {
        if let Some(e) = v.get("error") {
            return Err(e.to_string());
        }
        let t = &v["timings"];
        let ns = |key: &str| {
            t[key]
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0 && *n < u64::MAX as f64 / 1e6)
                .map(|n| (n * 1e6) as u64)
        };
        Ok(Some(GenerateChunk {
            response: v["content"].as_str().unwrap_or("").into(),
            done: v["stop"].as_bool().unwrap_or(false),
            eval_count: t["predicted_n"].as_u64(),
            eval_duration: ns("predicted_ms"),
            prompt_eval_count: t["prompt_n"].as_u64(),
            prompt_eval_duration: ns("prompt_ms"),
            ..Default::default()
        }))
    } else {
        serde_json::from_value(v)
            .map(Some)
            .map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workload_options_validate_provider_settings() {
        let options = WorkloadOptions {
            output_tokens: 64,
            context_length: Some(4096),
        };
        assert!(options.validate(Provider::Ollama).is_ok());
        assert!(options.validate(Provider::Llamacpp).is_err());
        assert_eq!(
            options.request(Provider::Ollama, "m", "p")["options"]["num_ctx"],
            4096
        );
        assert_eq!(
            options.request(Provider::Ollama, "m", "p")["options"]["num_predict"],
            64
        );
        assert!(WorkloadOptions {
            output_tokens: 0,
            context_length: None
        }
        .validate(Provider::Ollama)
        .is_err());
    }
    #[test]
    fn normalizes_ms_without_inventing_total() {
        let c=parse(br#"data: {"content":"ok","stop":true,"timings":{"predicted_n":2,"predicted_ms":500.5}}"#).unwrap().unwrap();
        assert_eq!(c.eval_duration, Some(500500000));
        assert_eq!(c.total_duration, None);
        assert!(c.done);
    }
    #[test]
    fn supports_ollama_and_sse_keepalive() {
        assert!(parse(b": ping").unwrap().is_none());
        assert!(parse(b"data: [DONE]").unwrap().is_none());
        assert_eq!(
            parse(br#"{"response":"a","done":false}"#)
                .unwrap()
                .unwrap()
                .response,
            "a"
        );
    }
}
