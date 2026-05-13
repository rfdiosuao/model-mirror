const gateway = process.env.GATEWAY_ORIGIN || "http://localhost:4173";
const providerId = process.env.PROVIDER_ID || "heang";
const level = process.env.PROBE_LEVEL || "quick";
const models = (
  process.env.PROBE_MODELS ||
  "qwen3-max-2026-01-23,glm-5,qwen3-coder-plus,qwen3-coder-next,qwen3.6-plus,MiniMax-M2.7-highspeed,glm-4-flash,MiniMax-M2.5"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

async function probe(model) {
  const started = performance.now();
  try {
    const response = await fetch(`${gateway}/api/probe/${providerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, level })
    });
    const data = await response.json().catch(() => ({}));
    return {
      model,
      ok: response.ok && data.ok,
      score: data.score ?? 0,
      latencyMs: Math.round(performance.now() - started),
      failed: (data.results || []).filter((item) => !item.ok).map((item) => `${item.name}:${item.score}`),
      results: (data.results || []).map((item) => ({ name: item.name, score: item.score, ok: item.ok }))
    };
  } catch (error) {
    return {
      model,
      ok: false,
      score: 0,
      latencyMs: Math.round(performance.now() - started),
      failed: [error.message],
      results: []
    };
  }
}

const results = [];
for (const model of models) {
  results.push(await probe(model));
}

console.log(JSON.stringify({ providerId, level, results }, null, 2));
