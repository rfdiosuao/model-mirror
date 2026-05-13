const modelList = document.querySelector("#modelList");
const providerList = document.querySelector("#providerList");
const requestList = document.querySelector("#requestList");
const localKey = document.querySelector("#localKey");
const localApiKeyInput = document.querySelector("#localApiKeyInput");
const strategyInput = document.querySelector("#strategyInput");
const minHealthInput = document.querySelector("#minHealthInput");
const minRouteQualityInput = document.querySelector("#minRouteQualityInput");
const visionModelInput = document.querySelector("#visionModelInput");
const addModelButton = document.querySelector("#addModel");
const addProviderButton = document.querySelector("#addProvider");
const saveConfigButton = document.querySelector("#saveConfig");
const refreshButton = document.querySelector("#refresh");
const modelTemplate = document.querySelector("#modelTemplate");
const providerTemplate = document.querySelector("#providerTemplate");

let state = {
  localApiKey: "local-anything",
  routing: { strategy: "quality_first", minHealthScore: 45 },
  models: [],
  providers: [],
  recentRequests: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || data.error?.message || "请求失败");
  return data;
}

function newProvider() {
  return {
    id: `provider-${Date.now()}`,
    name: "New Provider",
    baseUrl: "https://api.example.com",
    apiKeys: [],
    weight: 1,
    enabled: true,
    headers: {},
    tags: []
  };
}

function newModel() {
  return {
    id: `local-${Date.now()}`,
    label: "New Local Model",
    description: "",
    enabled: true,
    routes: []
  };
}

function splitLines(value) {
  return String(value || "")
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function providerOptions(selectedId) {
  return state.providers
    .map((provider) => {
      const selected = provider.id === selectedId ? "selected" : "";
      return `<option value="${escapeHtml(provider.id)}" ${selected}>${escapeHtml(provider.name || provider.id)}</option>`;
    })
    .join("");
}

function renderModels() {
  modelList.innerHTML = "";
  state.models.forEach((model, index) => {
    const node = modelTemplate.content.firstElementChild.cloneNode(true);
    const title = node.querySelector('[data-role="title"]');
    title.textContent = model.id || "Local Model";
    node.querySelector('[data-role="requests"]').textContent = `请求 ${model.requestCount || 0}`;
    node.querySelector('[data-role="success"]').textContent = `成功 ${model.successCount || 0}`;
    node.querySelector('[data-role="tokens"]').textContent = `Tokens ${(model.inputTokens || 0) + (model.outputTokens || 0)}`;

    node.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      if (input.type === "checkbox") input.checked = model[field] !== false;
      else input.value = model[field] ?? "";
      input.addEventListener("input", () => {
        if (input.type === "checkbox") model[field] = input.checked;
        else model[field] = input.value;
        if (field === "id") title.textContent = model.id || "Local Model";
      });
    });

    const routesBox = node.querySelector('[data-role="routes"]');
    function drawRoutes() {
      routesBox.innerHTML = (model.routes || [])
        .map(
          (route, routeIndex) => `
          <div class="route-row" data-route="${routeIndex}">
            <label class="toggle">
              <input data-route-field="enabled" type="checkbox" ${route.enabled !== false ? "checked" : ""} />
              <span>启用</span>
            </label>
            <select data-route-field="providerId">${providerOptions(route.providerId)}</select>
            <input data-route-field="upstreamModel" value="${escapeHtml(route.upstreamModel || "")}" placeholder="上游真实模型名" />
            <input data-route-field="weight" type="number" min="0" step="0.1" value="${route.weight || 1}" />
            <button class="danger small" data-action="removeRoute" type="button">删</button>
          </div>`
        )
        .join("");
      routesBox.querySelectorAll(".route-row").forEach((row) => {
        const route = model.routes[Number(row.dataset.route)];
        row.querySelectorAll("[data-route-field]").forEach((input) => {
          const field = input.dataset.routeField;
          input.addEventListener("input", () => {
            if (input.type === "checkbox") route[field] = input.checked;
            else if (field === "weight") route[field] = Number(input.value || 1);
            else route[field] = input.value;
          });
        });
        row.querySelector('[data-action="removeRoute"]').addEventListener("click", () => {
          model.routes.splice(Number(row.dataset.route), 1);
          drawRoutes();
        });
      });
    }

    node.querySelector('[data-action="addRoute"]').addEventListener("click", () => {
      model.routes ||= [];
      model.routes.push({
        providerId: state.providers[0]?.id || "",
        upstreamModel: "",
        weight: 1,
        enabled: true
      });
      drawRoutes();
    });

    node.querySelector('[data-action="remove"]').addEventListener("click", () => {
      state.models.splice(index, 1);
      renderModels();
    });

    drawRoutes();
    modelList.appendChild(node);
  });
}

function renderProviders() {
  providerList.innerHTML = "";
  state.providers.forEach((provider, index) => {
    const node = providerTemplate.content.firstElementChild.cloneNode(true);
    const title = node.querySelector('[data-role="title"]');
    title.textContent = provider.name || provider.id;
    node.querySelector('[data-role="health"]').textContent = `健康分 ${provider.healthScore ?? "--"}`;
    node.querySelector('[data-role="latency"]').textContent = `延迟 ${provider.lastLatencyMs ? `${provider.lastLatencyMs}ms` : "--"}`;
    node.querySelector('[data-role="keys"]').textContent = `Key ${provider.keyCount ?? provider.apiKeys?.length ?? 0}`;
    node.querySelector('[data-role="tokens"]').textContent = `Tokens ${(provider.inputTokens || 0) + (provider.outputTokens || 0)}`;
    node.querySelector('[data-role="error"]').textContent = provider.lastError ? `异常：${provider.lastError}` : "";

    node.querySelectorAll("[data-field]").forEach((input) => {
      const field = input.dataset.field;
      if (field === "apiKeysText") input.value = (provider.apiKeys || []).join("\n");
      else if (input.type === "checkbox") input.checked = provider[field] !== false;
      else input.value = provider[field] ?? "";
      input.addEventListener("input", () => {
        if (field === "apiKeysText") provider.apiKeys = splitLines(input.value);
        else if (input.type === "checkbox") provider[field] = input.checked;
        else if (field === "weight") provider[field] = Number(input.value || 1);
        else provider[field] = input.value;
        if (field === "name") title.textContent = provider.name || provider.id;
      });
    });

    node.querySelector('[data-action="remove"]').addEventListener("click", () => {
      state.providers.splice(index, 1);
      renderProviders();
      renderModels();
    });

    node.querySelector('[data-action="probe"]').addEventListener("click", async () => {
      const resultBox = node.querySelector('[data-role="probeResult"]');
      const button = node.querySelector('[data-action="probe"]');
      const model = node.querySelector('[data-role="probeModel"]').value.trim();
      const level = node.querySelector('[data-role="probeLevel"]').value;
      button.disabled = true;
      resultBox.textContent = "探针运行中...";
      try {
        await saveConfig();
        const data = await api(`/api/probe/${encodeURIComponent(provider.id)}`, {
          method: "POST",
          body: JSON.stringify({ model, level })
        });
        resultBox.innerHTML = `<strong>${data.score}/100</strong> ${data.results
          .map((item) => `${escapeHtml(item.name)} ${item.score}`)
          .join(" · ")}`;
        await loadConfig();
      } catch (error) {
        resultBox.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    providerList.appendChild(node);
  });
}

function renderRequests() {
  requestList.innerHTML = state.recentRequests.length
    ? state.recentRequests
        .map(
          (item) => `
      <article class="request ${item.ok ? "ok" : "bad"}">
        <strong>${escapeHtml(item.model || "unknown")}</strong>
        <span>${escapeHtml(item.upstreamModel || "-")}</span>
        <span>${escapeHtml(item.providerName || item.providerId || "no provider")}</span>
        <span>${item.status || "--"}</span>
        <span>${item.stream ? "stream" : "json"} · ${item.latencyMs || "--"}ms</span>
        <small>${escapeHtml(item.error || item.at || "")}</small>
      </article>`
        )
        .join("")
    : `<div class="empty">还没有路由记录。用任意 OpenAI SDK 请求本地 /v1/chat/completions 后会出现在这里。</div>`;
}

function renderSettings() {
  localKey.textContent = state.localApiKey || "local-anything";
  localApiKeyInput.value = state.localApiKey || "local-anything";
  strategyInput.value = state.routing?.strategy || "quality_first";
  minHealthInput.value = state.routing?.minHealthScore ?? 45;
  minRouteQualityInput.value = state.routing?.minRouteQualityScore ?? 55;
  visionModelInput.value = state.routing?.visionModel || "vision-chat";
}

async function loadConfig() {
  const data = await api("/api/config");
  state = {
    localApiKey: data.localApiKey,
    routing: data.routing,
    models: data.models || [],
    providers: data.providers || [],
    recentRequests: data.recentRequests || []
  };
  renderSettings();
  renderModels();
  renderProviders();
  renderRequests();
}

async function saveConfig() {
  state.localApiKey = localApiKeyInput.value || "local-anything";
  state.routing = {
    ...state.routing,
    strategy: strategyInput.value,
    minHealthScore: Number(minHealthInput.value || 45),
    minRouteQualityScore: Number(minRouteQualityInput.value || 55),
    visionModel: visionModelInput.value || "vision-chat"
  };
  await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      localApiKey: state.localApiKey,
      routing: state.routing,
      models: state.models,
      providers: state.providers
    })
  });
}

addModelButton.addEventListener("click", () => {
  state.models.unshift(newModel());
  renderModels();
});

addProviderButton.addEventListener("click", () => {
  state.providers.unshift(newProvider());
  renderProviders();
  renderModels();
});

saveConfigButton.addEventListener("click", async () => {
  saveConfigButton.disabled = true;
  saveConfigButton.textContent = "保存中";
  try {
    await saveConfig();
    await loadConfig();
    saveConfigButton.textContent = "已保存";
    setTimeout(() => (saveConfigButton.textContent = "保存配置"), 900);
  } catch (error) {
    alert(error.message);
    saveConfigButton.textContent = "保存配置";
  } finally {
    saveConfigButton.disabled = false;
  }
});

refreshButton.addEventListener("click", loadConfig);

loadConfig().catch((error) => {
  modelList.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
