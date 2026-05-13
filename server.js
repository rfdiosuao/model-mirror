import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 4173);
const dataDir = path.join(__dirname, "data");
const providersPath = path.join(__dirname, "providers.json");
const metricsPath = path.join(dataDir, "metrics.json");

app.use(express.json({ limit: "16mb" }));
app.use(express.static(path.join(__dirname, "public")));

const defaultMetrics = { requests: [], probes: {}, providers: {}, models: {}, routes: {} };

function nowIso() {
  return new Date().toISOString();
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Base URL is required");
  const url = new URL(trimmed);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Base URL must use http or https");
  return url.toString().replace(/\/+$/, "");
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(file, value) {
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(providersPath);
  } catch {
    await writeJson(providersPath, {
      localApiKey: "local-anything",
      routing: {
        strategy: "quality_first",
        minHealthScore: 45,
        minRouteQualityScore: 55,
        cooldownSeconds: 90
      },
      models: [
        {
          id: "smart-chat",
          label: "高质量聊天",
          description: "本地自定义模型名，可映射到多个上游真实模型。",
          enabled: true,
          routes: [
            {
              providerId: "provider-1",
              upstreamModel: "gpt-4.1",
              weight: 1,
              enabled: true
            }
          ]
        }
      ],
      providers: [
        {
          id: "provider-1",
          name: "Provider 1",
          baseUrl: "https://api.example.com",
          apiKeys: ["replace-me"],
          weight: 1,
          enabled: false,
          headers: {},
          tags: ["example"]
        }
      ]
    });
  }
  try {
    await fs.access(metricsPath);
  } catch {
    await writeJson(metricsPath, defaultMetrics);
  }
}

function migrateConfig(config) {
  config.routing ||= {};
  config.providers ||= [];
  config.models ||= [];

  if (!config.models.length) {
    const modelIds = new Set();
    for (const provider of config.providers) {
      for (const model of provider.models || []) {
        if (model && model !== "*") modelIds.add(model);
      }
    }
    config.models = [...modelIds].map((model) => ({
      id: model,
      label: model,
      description: "由旧 provider.models 自动迁移生成。",
      enabled: true,
      routes: config.providers
        .filter((provider) => provider.models?.includes(model) || provider.models?.includes("*"))
        .map((provider) => ({
          providerId: provider.id,
          upstreamModel: model,
          weight: Number(provider.weight || 1),
          enabled: true
        }))
    }));
  }

  for (const provider of config.providers) {
    delete provider.models;
    provider.headers ||= {};
  }
  return config;
}

async function getConfig() {
  await ensureFiles();
  return migrateConfig(await readJson(providersPath, {}));
}

async function getMetrics() {
  await ensureFiles();
  const metrics = await readJson(metricsPath, defaultMetrics);
  metrics.requests ||= [];
  metrics.probes ||= {};
  metrics.providers ||= {};
  metrics.models ||= {};
  metrics.routes ||= {};
  return metrics;
}

async function saveMetrics(metrics) {
  metrics.requests = metrics.requests.slice(-1000);
  await writeJson(metricsPath, metrics);
}

function publicProvider(provider, metrics = {}) {
  const stat = metrics.providers?.[provider.id] || {};
  return {
    ...provider,
    keyCount: (provider.apiKeys || []).length,
    healthScore: stat.healthScore ?? 60,
    lastLatencyMs: stat.lastLatencyMs ?? null,
    lastError: stat.lastError || "",
    cooldownUntil: stat.cooldownUntil || "",
    lastSeen: stat.lastSeen || "",
    requestCount: stat.requestCount || 0,
    successCount: stat.successCount || 0,
    failureCount: stat.failureCount || 0,
    inputTokens: stat.inputTokens || 0,
    outputTokens: stat.outputTokens || 0
  };
}

function publicProviderSafe(provider, metrics = {}) {
  const safe = publicProvider(provider, metrics);
  safe.apiKeys = (provider.apiKeys || []).map((key) => {
    const value = String(key);
    return value.length <= 10 ? "****" : `${value.slice(0, 6)}...${value.slice(-4)}`;
  });
  return safe;
}

function isCooling(stat) {
  return stat?.cooldownUntil && Date.parse(stat.cooldownUntil) > Date.now();
}

function modelHealth(metrics, localModelId) {
  const stat = metrics.models?.[localModelId] || {};
  return {
    requestCount: stat.requestCount || 0,
    successCount: stat.successCount || 0,
    failureCount: stat.failureCount || 0,
    inputTokens: stat.inputTokens || 0,
    outputTokens: stat.outputTokens || 0
  };
}

function publicModel(model, metrics) {
  return {
    ...model,
    routes: (model.routes || []).map((route) => ({
      ...route,
      ...(metrics.routes?.[routeKey(route.providerId, route.upstreamModel)] || {})
    })),
    ...modelHealth(metrics, model.id)
  };
}

function routeKey(providerId, upstreamModel) {
  return `${providerId}:${upstreamModel}`;
}

function routeQuality(metrics, route) {
  const stat = metrics.routes?.[routeKey(route.providerId, route.upstreamModel)] || {};
  return {
    qualityScore: stat.qualityScore ?? 60,
    lastProbeScore: stat.lastProbeScore ?? null,
    lastLatencyMs: stat.lastLatencyMs ?? null,
    lastError: stat.lastError || "",
    requestCount: stat.requestCount || 0,
    successCount: stat.successCount || 0,
    failureCount: stat.failureCount || 0
  };
}

function hasVisionInput(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.some((message) => {
    const content = message?.content;
    if (!Array.isArray(content)) return false;
    return content.some((part) => part?.type === "image_url" || part?.type === "input_image" || part?.image_url);
  });
}

function selectRoute(config, metrics, localModelId, strategy = config.routing?.strategy || "quality_first") {
  const localModel = config.models.find((model) => model.id === localModelId && model.enabled !== false);
  if (!localModel) throw new Error(`Local model is not configured: ${localModelId}`);

  const minHealth = Number(config.routing?.minHealthScore ?? 45);
  const minRouteQuality = Number(config.routing?.minRouteQualityScore ?? 55);
  const candidates = (localModel.routes || [])
    .filter((route) => route.enabled !== false)
    .map((route) => {
      const provider = config.providers.find((item) => item.id === route.providerId && item.enabled !== false);
      if (!provider || !provider.apiKeys?.length) return null;
      const stat = metrics.providers[provider.id] || {};
      const routeStat = routeQuality(metrics, route);
      if (routeStat.qualityScore < minRouteQuality) return null;
      const healthScore = Math.round((stat.healthScore ?? 60) * 0.45 + routeStat.qualityScore * 0.55);
      const latency = stat.lastLatencyMs ?? 3000;
      const routeWeight = Number(route.weight || 1);
      const providerWeight = Number(provider.weight || 1);
      const penalty = isCooling(stat) ? 1000 : 0;
      const score =
        strategy === "cost_first"
          ? routeWeight * providerWeight * 30 + healthScore * 0.55 - latency / 180 - penalty
          : strategy === "balanced"
            ? healthScore * 0.8 + routeWeight * providerWeight * 8 - latency / 220 - penalty
            : healthScore * 1.15 + routeWeight * providerWeight * 4 - latency / 260 - penalty;
      return { localModel, route, provider, stat, healthScore, score };
    })
    .filter(Boolean)
    .filter((item) => !isCooling(item.stat) && item.healthScore >= minHealth)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) throw new Error(`No healthy route is available for local model: ${localModelId}`);
  return candidates[0];
}

function pickApiKey(provider, stat = {}) {
  const keys = provider.apiKeys || [];
  const index = Number(stat.keyIndex || 0) % keys.length;
  return { key: keys[index], nextIndex: (index + 1) % keys.length };
}

function authHeaders(apiKey, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function fetchJson(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
      headers: response.headers,
      data,
      text
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeError(result) {
  const message = result?.data?.error?.message || result?.data?.message || result?.data?.raw || result?.text;
  return typeof message === "string" ? message.slice(0, 500) : "";
}

async function forwardJson(provider, apiKey, endpoint, body, timeoutMs = 120000) {
  return fetchJson(
    `${normalizeBaseUrl(provider.baseUrl)}${endpoint}`,
    {
      method: "POST",
      headers: authHeaders(apiKey, provider.headers || {}),
      body: JSON.stringify(body)
    },
    timeoutMs
  );
}

function tokenUsageFromResponse(data) {
  return {
    inputTokens: Number(data?.usage?.prompt_tokens || data?.usage?.input_tokens || 0),
    outputTokens: Number(data?.usage?.completion_tokens || data?.usage?.output_tokens || 0),
    totalTokens: Number(data?.usage?.total_tokens || 0)
  };
}

function updateStats(metrics, provider, localModelId, result, nextIndex, usage = {}) {
  const providerStat = metrics.providers[provider.id] || {};
  const previous = providerStat.healthScore ?? 60;
  const target = result.ok ? 92 : result.status === 429 ? 35 : 20;
  const cooldownSeconds = result.ok ? 0 : result.status === 429 ? 180 : 90;
  metrics.providers[provider.id] = {
    ...providerStat,
    keyIndex: nextIndex,
    healthScore: Math.round(previous * 0.78 + target * 0.22),
    lastLatencyMs: result.latencyMs,
    lastStatus: result.status,
    lastError: result.ok ? "" : summarizeError(result),
    cooldownUntil: cooldownSeconds ? new Date(Date.now() + cooldownSeconds * 1000).toISOString() : "",
    lastSeen: nowIso(),
    requestCount: (providerStat.requestCount || 0) + 1,
    successCount: (providerStat.successCount || 0) + (result.ok ? 1 : 0),
    failureCount: (providerStat.failureCount || 0) + (result.ok ? 0 : 1),
    inputTokens: (providerStat.inputTokens || 0) + Number(usage.inputTokens || 0),
    outputTokens: (providerStat.outputTokens || 0) + Number(usage.outputTokens || 0)
  };

  const modelStat = metrics.models[localModelId] || {};
  metrics.models[localModelId] = {
    ...modelStat,
    requestCount: (modelStat.requestCount || 0) + 1,
    successCount: (modelStat.successCount || 0) + (result.ok ? 1 : 0),
    failureCount: (modelStat.failureCount || 0) + (result.ok ? 0 : 1),
    inputTokens: (modelStat.inputTokens || 0) + Number(usage.inputTokens || 0),
    outputTokens: (modelStat.outputTokens || 0) + Number(usage.outputTokens || 0),
    lastSeen: nowIso()
  };

  if (result.upstreamModel) {
    const key = routeKey(provider.id, result.upstreamModel);
    const routeStat = metrics.routes[key] || {};
    const previous = routeStat.qualityScore ?? 60;
    const target = result.ok ? 88 : result.status === 429 ? 35 : 20;
    metrics.routes[key] = {
      ...routeStat,
      qualityScore: Math.round(previous * 0.84 + target * 0.16),
      lastLatencyMs: result.latencyMs,
      lastError: result.ok ? "" : summarizeError(result),
      lastSeen: nowIso(),
      requestCount: (routeStat.requestCount || 0) + 1,
      successCount: (routeStat.successCount || 0) + (result.ok ? 1 : 0),
      failureCount: (routeStat.failureCount || 0) + (result.ok ? 0 : 1)
    };
  }
}

function contentFromChat(data) {
  return data?.choices?.[0]?.message?.content || "";
}

function toolCallCount(data) {
  return data?.choices?.[0]?.message?.tool_calls?.length || 0;
}

function scoreProbe(result) {
  if (!result.ok) return 0;
  if (result.grade === "excellent") return 100;
  if (result.grade === "good") return 82;
  if (result.grade === "partial") return 55;
  return 28;
}

async function chatRequest({ provider, apiKey, body, timeoutMs }) {
  return forwardJson(provider, apiKey, "/v1/chat/completions", body, timeoutMs);
}

async function runProbe(config, probe) {
  const started = performance.now();
  try {
    const response = await probe.run(config);
    const judged = probe.judge(response);
    return {
      id: probe.id,
      name: probe.name,
      weight: probe.weight,
      ok: response.ok && judged.ok,
      status: response.status,
      latencyMs: response.latencyMs,
      grade: judged.grade,
      score: scoreProbe({ ok: response.ok && judged.ok, grade: judged.grade }),
      evidence: judged.evidence,
      error: response.ok ? "" : summarizeError(response)
    };
  } catch (error) {
    return {
      id: probe.id,
      name: probe.name,
      weight: probe.weight,
      ok: false,
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      grade: "fail",
      score: 0,
      evidence: "",
      error: error.name === "AbortError" ? "Request timed out" : error.message
    };
  }
}

function buildProbes(level) {
  const probes = [
    {
      id: "basic",
      name: "Basic chat",
      weight: 18,
      run: ({ provider, apiKey, model }) =>
        chatRequest({
          provider,
          apiKey,
          timeoutMs: 45000,
          body: {
            model,
            temperature: 0,
            max_tokens: 80,
            messages: [{ role: "user", content: "Only output this exact token: MIRROR_PASS_1729" }]
          }
        }),
      judge: (response) => {
        const content = contentFromChat(response.data);
        return {
          ok: /MIRROR_PASS_1729/.test(content),
          grade: /MIRROR_PASS_1729/.test(content) ? "excellent" : "weak",
          evidence: content.slice(0, 240)
        };
      }
    },
    {
      id: "instruction",
      name: "Instruction following",
      weight: 20,
      run: ({ provider, apiKey, model }) =>
        chatRequest({
          provider,
          apiKey,
          timeoutMs: 60000,
          body: {
            model,
            temperature: 0,
            max_tokens: 160,
            messages: [
              {
                role: "user",
                content:
                  'Calculate 19*23. Return JSON only: {"answer": number, "unit": "mirror"}. No markdown.'
              }
            ]
          }
        }),
      judge: (response) => {
        const content = contentFromChat(response.data);
        try {
          const parsed = JSON.parse(content);
          const ok = parsed.answer === 437 && parsed.unit === "mirror";
          return { ok, grade: ok ? "excellent" : "partial", evidence: content.slice(0, 240) };
        } catch {
          return { ok: false, grade: "weak", evidence: content.slice(0, 240) };
        }
      }
    },
    {
      id: "reasoning",
      name: "Reasoning sanity",
      weight: 22,
      run: ({ provider, apiKey, model }) =>
        chatRequest({
          provider,
          apiKey,
          timeoutMs: 80000,
          body: {
            model,
            temperature: 0,
            max_tokens: 260,
            messages: [
              {
                role: "user",
                content:
                  "A says B is lying. B says C is lying. C says both A and B are lying. Exactly one person tells the truth. Output the truthful person and one short reason."
              }
            ]
          }
        }),
      judge: (response) => {
        const content = contentFromChat(response.data);
        const excellent = /\bB\b/.test(content) && /truth|true/i.test(content);
        const good = /\bB\b/.test(content);
        return {
          ok: excellent || good,
          grade: excellent ? "excellent" : good ? "good" : "weak",
          evidence: content.slice(0, 320)
        };
      }
    },
    {
      id: "json",
      name: "JSON mode",
      weight: 15,
      run: ({ provider, apiKey, model }) =>
        chatRequest({
          provider,
          apiKey,
          timeoutMs: 60000,
          body: {
            model,
            temperature: 0,
            max_tokens: 180,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "user",
                content:
                  "Return a JSON object with keys score, label, flags. score=91, label=mirror, flags is an array of two strings."
              }
            ]
          }
        }),
      judge: (response) => {
        const content = contentFromChat(response.data);
        try {
          const parsed = JSON.parse(content);
          const ok = parsed.score === 91 && parsed.label === "mirror" && Array.isArray(parsed.flags);
          return { ok, grade: ok ? "excellent" : "partial", evidence: content.slice(0, 260) };
        } catch {
          return { ok: false, grade: "weak", evidence: content.slice(0, 260) };
        }
      }
    },
    {
      id: "tools",
      name: "Tool calling",
      weight: 15,
      run: ({ provider, apiKey, model }) =>
        chatRequest({
          provider,
          apiKey,
          timeoutMs: 60000,
          body: {
            model,
            temperature: 0,
            max_tokens: 160,
            tools: [
              {
                type: "function",
                function: {
                  name: "rate_model",
                  description: "Record a synthetic score.",
                  parameters: {
                    type: "object",
                    properties: {
                      score: { type: "integer" },
                      label: { type: "string" }
                    },
                    required: ["score", "label"]
                  }
                }
              }
            ],
            tool_choice: { type: "function", function: { name: "rate_model" } },
            messages: [{ role: "user", content: "Call the function with score 88 and label full." }]
          }
        }),
      judge: (response) => {
        const calls = toolCallCount(response.data);
        const args = response.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments || "";
        const ok = calls > 0 && /88/.test(args) && /full/.test(args);
        return {
          ok,
          grade: ok ? "excellent" : calls > 0 ? "partial" : "weak",
          evidence: calls > 0 ? args.slice(0, 260) : contentFromChat(response.data).slice(0, 260)
        };
      }
    }
  ];

  if (level !== "quick") {
    probes.push({
      id: "context",
      name: "Context retention",
      weight: 10,
      run: ({ provider, apiKey, model }) => {
        const hay = Array.from({ length: level === "deep" ? 180 : 70 }, (_, i) => {
          const mark = i === 47 ? "NEEDLE-7429" : `block-${i}`;
          return `${mark}: ${"alpha beta gamma delta ".repeat(32)}`;
        }).join("\n");
        return chatRequest({
          provider,
          apiKey,
          timeoutMs: 90000,
          body: {
            model,
            temperature: 0,
            max_tokens: 80,
            messages: [{ role: "user", content: `${hay}\n\nWhat are the four digits after NEEDLE? Output digits only.` }]
          }
        });
      },
      judge: (response) => {
        const content = contentFromChat(response.data);
        return {
          ok: /7429/.test(content),
          grade: /7429/.test(content) ? "excellent" : "weak",
          evidence: content.slice(0, 240)
        };
      }
    });
  }
  return probes;
}

function requireLocalAuth(req, config) {
  const expected = config.localApiKey || "local-anything";
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (expected && token && token !== expected) {
    const error = new Error("Invalid local gateway API key");
    error.status = 401;
    throw error;
  }
}

function sanitizeConfig(input, current) {
  const next = {
    localApiKey: input.localApiKey || current.localApiKey || "local-anything",
    routing: { ...current.routing, ...(input.routing || {}) },
    models: Array.isArray(input.models) ? input.models : current.models,
    providers: Array.isArray(input.providers) ? input.providers : current.providers
  };

  next.providers = next.providers.map((provider) => ({
    ...provider,
    id: String(provider.id || provider.name || randomUUID()).replace(/[^\w.-]/g, "-"),
    name: String(provider.name || provider.id || "Provider"),
    baseUrl: normalizeBaseUrl(provider.baseUrl),
    apiKeys: (provider.apiKeys || []).map(String).filter(Boolean),
    weight: Number(provider.weight || 1),
    enabled: provider.enabled !== false,
    headers: provider.headers && typeof provider.headers === "object" ? provider.headers : {},
    tags: Array.isArray(provider.tags) ? provider.tags : []
  }));

  const providerIds = new Set(next.providers.map((provider) => provider.id));
  next.models = next.models.map((model) => ({
    id: String(model.id || model.label || randomUUID()).trim(),
    label: String(model.label || model.id || "").trim(),
    description: String(model.description || ""),
    enabled: model.enabled !== false,
    routes: (model.routes || [])
      .filter((route) => providerIds.has(route.providerId))
      .map((route) => ({
        providerId: route.providerId,
        upstreamModel: String(route.upstreamModel || model.id || "").trim(),
        weight: Number(route.weight || 1),
        enabled: route.enabled !== false
      }))
  }));

  return next;
}

app.get("/api/config", async (_req, res) => {
  const config = await getConfig();
  const metrics = await getMetrics();
  res.json({
    ok: true,
    routing: config.routing,
    localApiKey: config.localApiKey || "local-anything",
    models: config.models.map((model) => publicModel(model, metrics)),
    providers: config.providers.map((provider) => publicProvider(provider, metrics)),
    recentRequests: metrics.requests.slice(-80).reverse()
  });
});

app.put("/api/config", async (req, res) => {
  const current = await getConfig();
  const next = sanitizeConfig(req.body, current);
  await writeJson(providersPath, next);
  res.json({ ok: true });
});

app.post("/api/probe/:providerId", async (req, res) => {
  const config = await getConfig();
  const metrics = await getMetrics();
  const provider = config.providers.find((item) => item.id === req.params.providerId);
  if (!provider) return res.status(404).json({ ok: false, error: "Provider not found" });
  const stat = metrics.providers[provider.id] || {};
  const { key, nextIndex } = pickApiKey(provider, stat);
  const model = String(req.body.model || "").trim();
  if (!model) return res.status(400).json({ ok: false, error: "Probe upstream model is required" });

  const level = ["quick", "standard", "deep"].includes(req.body.level) ? req.body.level : "quick";
  const results = [];
  for (const probe of buildProbes(level)) {
    results.push(await runProbe({ provider, apiKey: key, model }, probe));
  }
  const totalWeight = results.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(results.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
  const metricKey = routeKey(provider.id, model);
  const routeStat = metrics.routes[metricKey] || {};
  metrics.providers[provider.id] = {
    ...stat,
    keyIndex: nextIndex,
    healthScore: Math.round((stat.healthScore ?? 60) * 0.35 + score * 0.65),
    lastLatencyMs: Math.round(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length),
    lastError: results.find((item) => !item.ok)?.error || "",
    lastSeen: nowIso()
  };
  metrics.routes[metricKey] = {
    ...routeStat,
    qualityScore: Math.round((routeStat.qualityScore ?? 60) * 0.25 + score * 0.75),
    lastProbeScore: score,
    lastLatencyMs: Math.round(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length),
    lastError: results.find((item) => !item.ok)?.error || "",
    lastSeen: nowIso()
  };
  metrics.probes[`${provider.id}:${model}`] = { at: nowIso(), score, level, results };
  await saveMetrics(metrics);
  res.json({ ok: true, score, provider: publicProviderSafe(provider, metrics), results });
});

app.get("/v1/models", async (req, res) => {
  try {
    const config = await getConfig();
    requireLocalAuth(req, config);
    res.json({
      object: "list",
      data: config.models
        .filter((model) => model.enabled !== false)
        .map((model) => ({
          id: model.id,
          object: "model",
          owned_by: "local-gateway"
        }))
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: { message: error.message } });
  }
});

async function proxyStreaming({ req, res, config, metrics, chosen, key, nextIndex, body, started }) {
  const url = `${normalizeBaseUrl(chosen.provider.baseUrl)}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(key, chosen.provider.headers || {}),
    body: JSON.stringify(body)
  });

  res.status(response.status);
  res.setHeader("Content-Type", response.headers.get("content-type") || "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Model-Gateway-Provider", chosen.provider.id);
  res.setHeader("X-Model-Gateway-Upstream-Model", chosen.route.upstreamModel);

  let bytes = 0;
  let upstreamError = "";
  try {
    if (!response.ok) {
      const text = await response.text();
      upstreamError = text.slice(0, 500);
      res.write(text);
    } else if (response.body) {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        res.write(chunk);
      }
    }
  } finally {
    res.end();
  }

  const result = {
    ok: response.ok,
    status: response.status,
    latencyMs: Math.round(performance.now() - started),
    upstreamModel: chosen.route.upstreamModel,
    data: upstreamError ? { error: { message: upstreamError } } : null,
    text: upstreamError
  };
  const statsModel = chosen.localModel?.id || req.body.model;
  updateStats(metrics, chosen.provider, statsModel, result, nextIndex);
  metrics.requests.push({
    at: nowIso(),
    model: statsModel,
    requestedModel: req.body.model,
    forcedModel: statsModel !== req.body.model ? statsModel : "",
    upstreamModel: chosen.route.upstreamModel,
    providerId: chosen.provider.id,
    providerName: chosen.provider.name,
    status: response.status,
    ok: response.ok,
    stream: true,
    bytes,
    latencyMs: result.latencyMs,
    error: upstreamError
  });
  await saveMetrics(metrics);
}

app.post("/v1/chat/completions", async (req, res) => {
  const started = performance.now();
  let chosen = null;
  try {
    const config = await getConfig();
    requireLocalAuth(req, config);
    const metrics = await getMetrics();
    const requestedModelId = String(req.body.model || "");
    const forcedVision = hasVisionInput(req.body);
    const localModelId = forcedVision ? config.routing?.visionModel || "vision-chat" : requestedModelId;
    chosen = selectRoute(config, metrics, localModelId, req.query.strategy);
    const stat = metrics.providers[chosen.provider.id] || {};
    const { key, nextIndex } = pickApiKey(chosen.provider, stat);
    const body = { ...req.body, model: chosen.route.upstreamModel };

    if (body.stream === true) {
      await proxyStreaming({ req, res, config, metrics, chosen, key, nextIndex, body, started });
      return;
    }

    const result = await forwardJson(chosen.provider, key, "/v1/chat/completions", body, 180000);
    result.upstreamModel = chosen.route.upstreamModel;
    const usage = tokenUsageFromResponse(result.data);
    updateStats(metrics, chosen.provider, localModelId, result, nextIndex, usage);
    metrics.requests.push({
      at: nowIso(),
      model: localModelId,
      requestedModel: requestedModelId,
      forcedModel: forcedVision ? localModelId : "",
      upstreamModel: chosen.route.upstreamModel,
      providerId: chosen.provider.id,
      providerName: chosen.provider.name,
      status: result.status,
      ok: result.ok,
      stream: false,
      latencyMs: result.latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      error: result.ok ? "" : summarizeError(result)
    });
    await saveMetrics(metrics);
    res.status(result.status || 502).json(result.data);
  } catch (error) {
    const metrics = await getMetrics();
    metrics.requests.push({
      at: nowIso(),
      model: req.body?.model || "",
      requestedModel: req.body?.model || "",
      providerId: chosen?.provider?.id || "",
      providerName: chosen?.provider?.name || "",
      status: error.status || 500,
      ok: false,
      stream: Boolean(req.body?.stream),
      latencyMs: Math.round(performance.now() - started),
      error: error.message
    });
    await saveMetrics(metrics);
    res.status(error.status || 500).json({ error: { message: error.message } });
  }
});

app.listen(port, async () => {
  await ensureFiles();
  console.log(`Model Gateway running at http://localhost:${port}`);
});
