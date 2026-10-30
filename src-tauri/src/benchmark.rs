use crate::{
    metrics::{BenchmarkResult, GenerateChunk},
    ollama,
};
use futures_util::StreamExt;
use serde::Serialize;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Progress {
    Started,
    Output { text: String },
}

pub async fn run(
    client: &reqwest::Client,
    endpoint: &str,
    model: String,
    prompt: String,
    channel: Channel<Progress>,
    cancel: CancellationToken,
    provider: crate::providers::Provider,
) -> Result<BenchmarkResult, String> {
    run_configured(
        client, endpoint, model, prompt, channel, cancel, provider, None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn run_configured(
    client: &reqwest::Client,
    endpoint: &str,
    model: String,
    prompt: String,
    channel: Channel<Progress>,
    cancel: CancellationToken,
    provider: crate::providers::Provider,
    options: Option<crate::providers::WorkloadOptions>,
) -> Result<BenchmarkResult, String> {
    if let Some(ref options) = options {
        options.validate(provider)?;
    }
    let base = ollama::endpoint(endpoint)?;
    if model.trim().is_empty() || prompt.trim().is_empty() {
        return Err("Select a model and enter a prompt".into());
    }
    if prompt.len() > 131_072 {
        return Err("Prompt must be at most 128 KiB".into());
    }
    // Verify installation before inference, so this app never requests an implicit model pull.
    if provider == crate::providers::Provider::Ollama {
        let models: ollama::ModelList = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err("Benchmark cancelled".into()),
            result = ollama::get_json(client,&base,"api/tags") => result?,
        };
        if !models.models.iter().any(|m| m.name == model) {
            return Err("Selected model is no longer installed".into());
        }
    }
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("Benchmark cancelled".into()),
        result = client.post(base.join(provider.route()).map_err(|e|e.to_string())?)
            .timeout(Duration::from_secs(1800))
            .json(&options.as_ref().map(|o|o.request(provider,&model,&prompt)).unwrap_or_else(||provider.request(&model,&prompt))).send() =>
            result.map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?,
    };
    let mut stream = response.bytes_stream();
    let mut pending = Vec::new();
    let mut output = String::new();
    loop {
        let next = tokio::select! {
        biased;
            _ = cancel.cancelled() => return Err("Benchmark cancelled".into()),
            result = stream.next() => result,
        };
        match next {
            Some(Ok(bytes)) => {
                pending.extend_from_slice(&bytes);
                while let Some(end) = pending.iter().position(|b| *b == b'\n') {
                    let line: Vec<u8> = pending.drain(..=end).collect();
                    if let Some(done) = process_line(&line, &channel, &mut output)? {
                        let mut result = BenchmarkResult::from_chunk(model, done);
                        result.output = output;
                        if provider == crate::providers::Provider::Llamacpp {
                            for m in [
                                &mut result.generated_tokens,
                                &mut result.prompt_tokens,
                                &mut result.decode_rate,
                                &mut result.prefill_rate,
                                &mut result.decode_duration,
                                &mut result.prefill_duration,
                                &mut result.total_duration,
                                &mut result.load_duration,
                            ] {
                                m.source = m.source.replace("Ollama", "llama.cpp");
                            }
                        }
                        return Ok(result);
                    }
                }
                if pending.len() > 1_048_576 {
                    return Err("Ollama stream frame exceeds 1 MiB".into());
                }
            }
            Some(Err(e)) => return Err(e.to_string()),
            None => {
                if let Some(done) = process_line(&pending, &channel, &mut output)? {
                    let mut result = BenchmarkResult::from_chunk(model, done);
                    result.output = output;
                    if provider == crate::providers::Provider::Llamacpp {
                        for m in [
                            &mut result.generated_tokens,
                            &mut result.prompt_tokens,
                            &mut result.decode_rate,
                            &mut result.prefill_rate,
                            &mut result.decode_duration,
                            &mut result.prefill_duration,
                            &mut result.total_duration,
                            &mut result.load_duration,
                        ] {
                            m.source = m.source.replace("Ollama", "llama.cpp");
                        }
                    }
                    return Ok(result);
                }
                return Err("Ollama stream ended without final performance metrics".into());
            }
        }
    }
}
fn process_line(
    line: &[u8],
    channel: &Channel<Progress>,
    output: &mut String,
) -> Result<Option<GenerateChunk>, String> {
    if line.len() > 1_048_576 {
        return Err("Ollama stream frame exceeds 1 MiB".into());
    }
    if line.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    let Some(chunk) = crate::providers::parse(line)? else {
        return Ok(None);
    };
    if let Some(error) = &chunk.error {
        return Err(error.clone());
    }
    let text = if chunk.thinking.is_empty() {
        chunk.response.clone()
    } else {
        chunk.thinking.clone() + &chunk.response
    };
    if !text.is_empty() {
        output.push_str(&text);
        if output.len() > 524288 {
            let mut cut = output.len() - 524288;
            while !output.is_char_boundary(cut) {
                cut += 1;
            }
            output.drain(..cut);
        }
        channel
            .send(Progress::Output { text })
            .map_err(|_| "Output channel closed")?;
    }
    Ok(if chunk.done { Some(chunk) } else { None })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancelled_benchmark_returns_before_contacting_server() {
        let token = CancellationToken::new();
        token.cancel();
        let channel = Channel::<Progress>::new(|_| Ok(()));
        let result = run(
            &ollama::client().unwrap(),
            "http://127.0.0.1:1",
            "installed-model".into(),
            "hello".into(),
            channel,
            token,
            crate::providers::Provider::Ollama,
        )
        .await;
        assert!(matches!(result, Err(e) if e == "Benchmark cancelled"));
    }
    #[test]
    fn stream_frames_parse_and_propagate_errors() {
        let channel = Channel::<Progress>::new(|_| Ok(()));
        assert!(process_line(b"\n", &channel, &mut String::new())
            .unwrap()
            .is_none());
        assert!(process_line(
            br#"{"response":"hello","done":false}"#,
            &channel,
            &mut String::new()
        )
        .unwrap()
        .is_none());
        assert!(
            process_line(
                br#"{"done":true,"eval_count":3}"#,
                &channel,
                &mut String::new()
            )
            .unwrap()
            .unwrap()
            .done
        );
        assert!(
            process_line(br#"{"error":"model failed"}"#, &channel, &mut String::new()).is_err()
        );
        assert!(process_line(b"not json", &channel, &mut String::new()).is_err());
    }
}
