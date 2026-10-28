use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Classification {
    Measured,
    Derived,
    Estimated,
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Metric {
    pub value: Option<f64>,
    pub unit: String,
    pub classification: Classification,
    pub source: String,
    pub reason: Option<String>,
}
impl Metric {
    pub fn measured(value: f64, unit: &str, source: &str) -> Self {
        Self {
            value: Some(value),
            unit: unit.into(),
            classification: Classification::Measured,
            source: source.into(),
            reason: None,
        }
    }
    pub fn unavailable(unit: &str, source: &str, reason: impl Into<String>) -> Self {
        Self {
            value: None,
            unit: unit.into(),
            classification: Classification::Unavailable,
            source: source.into(),
            reason: Some(reason.into()),
        }
    }
    pub fn optional(value: Option<u64>, unit: &str, source: &str) -> Self {
        value
            .map(|v| Self::measured(v as f64, unit, source))
            .unwrap_or_else(|| Self::unavailable(unit, source, "Not reported by the API"))
    }
}

pub fn throughput(count: Option<u64>, duration_ns: Option<u64>) -> Metric {
    match (count, duration_ns) {
        (Some(c), Some(d)) if d > 0 => Metric {
            value: Some(c as f64 * 1_000_000_000.0 / d as f64),
            unit: "tok/s".into(),
            classification: Classification::Derived,
            source: "Ollama token count / evaluation duration".into(),
            reason: None,
        },
        _ => Metric::unavailable(
            "tok/s",
            "Ollama",
            "Token count or positive evaluation duration not reported",
        ),
    }
}
pub fn seconds(duration_ns: Option<u64>) -> Metric {
    match duration_ns {
        Some(n) => {
            let mut m = Metric::measured(
                n as f64 / 1_000_000_000.0,
                "s",
                "Ollama duration (ns converted to s)",
            );
            m.classification = Classification::Derived;
            m
        }
        None => Metric::unavailable("s", "Ollama", "Duration not reported"),
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct GenerateChunk {
    #[serde(default)]
    pub response: String,
    #[serde(default)]
    pub thinking: String,
    #[serde(default)]
    pub done: bool,
    pub error: Option<String>,
    pub eval_count: Option<u64>,
    pub eval_duration: Option<u64>,
    pub prompt_eval_count: Option<u64>,
    pub prompt_eval_duration: Option<u64>,
    pub total_duration: Option<u64>,
    pub load_duration: Option<u64>,
}
#[derive(Clone, Serialize)]
pub struct BenchmarkResult {
    pub output: String,
    pub model: String,
    pub generated_tokens: Metric,
    pub prompt_tokens: Metric,
    pub decode_rate: Metric,
    pub prefill_rate: Metric,
    pub decode_duration: Metric,
    pub prefill_duration: Metric,
    pub total_duration: Metric,
    pub load_duration: Metric,
}
impl BenchmarkResult {
    pub fn from_chunk(model: String, c: GenerateChunk) -> Self {
        Self {
            output: c.response.clone(),
            model,
            generated_tokens: Metric::optional(c.eval_count, "tokens", "Ollama"),
            prompt_tokens: Metric::optional(c.prompt_eval_count, "tokens", "Ollama"),
            decode_rate: throughput(c.eval_count, c.eval_duration),
            prefill_rate: throughput(c.prompt_eval_count, c.prompt_eval_duration),
            decode_duration: seconds(c.eval_duration),
            prefill_duration: seconds(c.prompt_eval_duration),
            total_duration: seconds(c.total_duration),
            load_duration: seconds(c.load_duration),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rates_and_durations() {
        assert_eq!(throughput(Some(20), Some(2_000_000_000)).value, Some(10.0));
        assert_eq!(seconds(Some(500_000_000)).value, Some(0.5));
        assert_eq!(seconds(Some(0)).value, Some(0.0));
        assert_eq!(throughput(Some(0), Some(1)).value, Some(0.0));
    }
    #[test]
    fn missing_or_zero_duration() {
        for (c, d) in [(None, Some(1)), (Some(1), None), (Some(1), Some(0))] {
            assert_eq!(throughput(c, d).classification, Classification::Unavailable);
        }
        assert_eq!(seconds(None).value, None);
    }
    #[test]
    fn final_response_parsing() {
        let chunk: GenerateChunk = serde_json::from_str(
            r#"{"done":true,"eval_count":10,"eval_duration":1000000000,"prompt_eval_count":4}"#,
        )
        .unwrap();
        assert!(chunk.done);
        let result = BenchmarkResult::from_chunk("test".into(), chunk);
        assert_eq!(result.decode_rate.value, Some(10.0));
        assert_eq!(result.prefill_rate.value, None);
    }
    #[test]
    fn serialization_preserves_missing_data() {
        let v =
            serde_json::to_value(Metric::unavailable("%", "NVML", "Driver unavailable")).unwrap();
        assert!(v["value"].is_null());
        assert_eq!(v["classification"], "unavailable");
    }
}
