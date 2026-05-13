const baseUrl = process.env.GATEWAY_URL || "http://localhost:4173/v1";
const apiKey = process.env.GATEWAY_KEY || "local-anything";

async function loadModels() {
  if (process.env.STRESS_MODELS) {
    return process.env.STRESS_MODELS.split(",").map((item) => item.trim()).filter(Boolean);
  }
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await response.json();
  return (data.data || []).map((item) => item.id).filter(Boolean);
}

const models = await loadModels();
const prompts = [
  "Only output ROUTE-OK.",
  "Return JSON only: {\"ok\":true,\"n\":17}",
  "Calculate 37+58. Output the number only.",
  "Name one HTTP method. Output one uppercase word.",
  "Only output the exact string: MIRROR-STRESS"
];

async function requestOne(index) {
  const model = models[index % models.length];
  const prompt = prompts[index % prompts.length];
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 48,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await response.json().catch(() => ({}));
    const content = data?.choices?.[0]?.message?.content || "";
    return {
      index,
      model,
      status: response.status,
      ok: response.ok,
      upstreamModel: data.model || "",
      latencyMs: Math.round(performance.now() - started),
      content: content.slice(0, 120),
      error: data?.error?.message || ""
    };
  } catch (error) {
    return {
      index,
      model,
      status: 0,
      ok: false,
      upstreamModel: "",
      latencyMs: Math.round(performance.now() - started),
      content: "",
      error: error.message
    };
  }
}

async function runPool(total, concurrency) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < total) {
      const index = next++;
      results.push(await requestOne(index));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results.sort((a, b) => a.index - b.index);
}

const total = Number(process.env.STRESS_TOTAL || 25);
const concurrency = Number(process.env.STRESS_CONCURRENCY || 5);
const started = performance.now();
const results = await runPool(total, concurrency);
const grouped = {};
for (const result of results) {
  const key = `${result.model} -> ${result.upstreamModel || "none"}`;
  grouped[key] ||= { count: 0, ok: 0, fail: 0, latencies: [], errors: {} };
  grouped[key].count += 1;
  grouped[key].ok += result.ok ? 1 : 0;
  grouped[key].fail += result.ok ? 0 : 1;
  grouped[key].latencies.push(result.latencyMs);
  if (result.error) grouped[key].errors[result.error] = (grouped[key].errors[result.error] || 0) + 1;
}

for (const item of Object.values(grouped)) {
  item.avgLatencyMs = Math.round(item.latencies.reduce((sum, value) => sum + value, 0) / item.latencies.length);
  item.maxLatencyMs = Math.max(...item.latencies);
  delete item.latencies;
}

console.log(
  JSON.stringify(
    {
      total,
      concurrency,
      elapsedMs: Math.round(performance.now() - started),
      success: results.filter((item) => item.ok).length,
      failure: results.filter((item) => !item.ok).length,
      grouped,
      failures: results.filter((item) => !item.ok).slice(0, 10),
      samples: results.slice(0, 8)
    },
    null,
    2
  )
);
