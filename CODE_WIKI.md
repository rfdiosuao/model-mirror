# Model Mirror - 模型网关照妖镜 Code Wiki

## 项目概览

**Model Mirror**（模型网关照妖镜）是一个本地 OpenAI-compatible API 网关/中转层，用于将多个上游 AI 模型提供商聚合为统一的本地 API 端点。它支持自定义模型别名、API Key 池管理、智能健康路由、流式转发以及模型智商探针测试。

| 属性 | 值 |
|------|-----|
| 项目名称 | model-mirror |
| 版本 | 0.1.0 |
| 运行时 | Node.js (ES Modules) |
| 核心框架 | Express.js 4.19.2 |
| 默认端口 | 4173 |
| 项目类型 | 全栈应用（后端 + 前端管理面板 + CLI 脚本工具） |

---

## 项目结构

```
模型网站测评/
├── server.js                  # 主服务器入口（后端核心）
├── providers.json             # 网关配置文件（提供商、模型、路由策略）
├── package.json               # 项目依赖与脚本
├── .gitignore                 # Git 忽略规则
│
├── data/
│   └── metrics.json           # 运行时指标数据（请求记录、健康分、探针结果）
│
├── public/                    # 前端静态资源
│   ├── index.html             # 管理面板 HTML
│   ├── app.js                 # 前端交互逻辑
│   └── styles.css             # 样式表
│
└── scripts/                   # CLI 工具脚本
    ├── probe-models.mjs       # 批量探针测试脚本
    └── stress-test.mjs        # 压力测试脚本
```

---

## 整体架构

### 架构设计图

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端 (OpenAI SDK 等)                    │
│              Base URL: http://localhost:4173/v1              │
│              API Key:  local-anything                        │
│              Model:    smart-chat / code-chat / ...          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Model Mirror 网关                          │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  认证层      │  │  路由选择器   │  │  健康/质量评分系统  │  │
│  │ requireLocal│  │ selectRoute  │  │ updateStats        │  │
│  │ Auth()      │  │              │  │ isCooling()        │  │
│  └─────────────┘  └──────┬───────┘  └────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                   请求转发层                            │  │
│  │  forwardJson() / proxyStreaming()                     │  │
│  │  - 非流式: JSON 转发 + Token 统计                      │  │
│  │  - 流式: SSE 流式代理                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  配置管理    │  │  探针系统     │  │  指标持久化         │  │
│  │ getConfig() │  │ buildProbes()│  │ metrics.json       │  │
│  │ sanitizeCfg │  │ runProbe()   │  │ saveMetrics()      │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Heang API    │ │ Provider B   │ │ Provider C   │
   │ api.heang.top│ │ ...          │ │ ...          │
   └──────────────┘ └──────────────┘ └──────────────┘
```

### 核心工作流程

1. **客户端请求** → 使用任意 OpenAI SDK 指向 `http://localhost:4173/v1`
2. **认证校验** → 验证 `localApiKey`（默认 `local-anything`）
3. **模型映射** → 将本地模型别名（如 `smart-chat`）映射到上游真实模型
4. **路由选择** → 根据健康分、质量分、策略选择最优上游路由
5. **请求转发** → 转发到上游提供商，支持流式/非流式
6. **指标更新** → 记录请求结果，更新健康分和质量分
7. **响应返回** → 将上游响应原样返回给客户端

---

## 后端模块详解 (server.js)

### 1. 配置管理模块

#### 核心函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `ensureFiles()` | L45-L93 | 初始化数据目录和默认配置文件 |
| `readJson(file, fallback)` | L33-L39 | 异步读取 JSON 文件，失败时返回默认值 |
| `writeJson(file, value)` | L41-L43 | 异步写入 JSON 文件（格式化输出） |
| `getConfig()` | L130-L133 | 读取并迁移配置，返回完整配置对象 |
| `migrateConfig(config)` | L95-L128 | 配置迁移：将旧版 `provider.models` 结构转换为新版 `models[].routes` 结构 |
| `sanitizeConfig(input, current)` | L653-L690 | 配置清洗与校验：规范化 provider 和 model 字段 |

#### 配置数据结构 (providers.json)

```json
{
  "localApiKey": "local-anything",       // 本地网关 API Key
  "routing": {
    "strategy": "quality_first",          // 路由策略: quality_first | balanced | cost_first
    "minHealthScore": 45,                 // 最低提供商健康分阈值
    "minRouteQualityScore": 55,           // 最低路由质量分阈值
    "visionModel": "vision-chat",         // 视觉请求强制路由的模型
    "cooldownSeconds": 90                 // 失败冷却时间（秒）
  },
  "models": [                            // 本地模型别名列表
    {
      "id": "smart-chat",                // 本地模型 ID
      "label": "Smart Chat",             // 显示名称
      "description": "...",              // 描述
      "enabled": true,                   // 是否启用
      "routes": [                        // 路由到上游的映射
        {
          "providerId": "heang",         // 上游提供商 ID
          "upstreamModel": "kimi-k2.5",  // 上游真实模型名
          "weight": 1,                   // 路由权重
          "enabled": true
        }
      ]
    }
  ],
  "providers": [                         // 上游提供商列表
    {
      "id": "heang",                     // 提供商唯一 ID
      "name": "Heang API",               // 显示名称
      "baseUrl": "https://api.heang.top",// API 基础 URL
      "apiKeys": ["sk-..."],             // API Key 池（支持多 Key 轮询）
      "weight": 1,                       // 提供商权重
      "enabled": true,                   // 是否启用
      "headers": {},                     // 自定义请求头
      "tags": ["relay"]                  // 标签
    }
  ]
}
```

### 2. 路由选择模块

#### 核心函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `selectRoute(config, metrics, localModelId, strategy)` | L230-L263 | 核心路由选择算法：根据策略、健康分、质量分选择最优路由 |
| `routeKey(providerId, upstreamModel)` | L204-L206 | 生成路由唯一标识键 `providerId:upstreamModel` |
| `routeQuality(metrics, route)` | L208-L219 | 获取路由质量统计数据 |
| `modelHealth(metrics, localModelId)` | L182-L191 | 获取本地模型健康统计数据 |
| `isCooling(stat)` | L178-L180 | 判断提供商是否处于冷却期 |

#### 路由选择算法

```
候选路由筛选:
  1. 本地模型必须启用
  2. 路由必须启用
  3. 提供商必须启用且有 API Key
  4. 路由质量分 >= minRouteQualityScore
  5. 提供商健康分 >= minHealthScore
  6. 不在冷却期内

评分公式 (按策略):
  quality_first: healthScore * 1.15 + weight * 4 - latency / 260 - penalty
  balanced:      healthScore * 0.8 + weight * 8 - latency / 220 - penalty
  cost_first:    weight * 30 + healthScore * 0.55 - latency / 180 - penalty

  penalty = 1000 (冷却中) / 0 (正常)

最终选择: 按 score 降序排序，取最高分候选
```

#### 健康分计算

```
提供商健康分 (updateStats):
  newHealth = previous * 0.78 + target * 0.22
  target: 成功=92, 429限流=35, 其他错误=20

路由质量分 (updateStats):
  newQuality = previous * 0.84 + target * 0.16
  target: 成功=88, 429限流=35, 其他错误=20

冷却机制:
  成功: 无冷却
  429: 冷却 180 秒
  其他错误: 冷却 90 秒
```

### 3. 请求转发模块

#### 核心函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `forwardJson(provider, apiKey, endpoint, body, timeoutMs)` | L310-L320 | 非流式 JSON 请求转发 |
| `proxyStreaming({req, res, config, metrics, chosen, key, nextIndex, body, started})` | L771-L829 | 流式 SSE 代理转发 |
| `fetchJson(url, options, timeoutMs)` | L279-L303 | 底层 fetch 封装，带超时控制 |
| `chatRequest({provider, apiKey, body, timeoutMs})` | L396-L398 | 聊天请求快捷方法 |

#### 流式转发流程

```
1. 建立到上游的 fetch 连接
2. 设置响应头 (Content-Type, Cache-Control, Connection)
3. 添加自定义头 (X-Model-Gateway-Provider, X-Model-Gateway-Upstream-Model)
4. 逐块读取上游 response.body 并写入 res
5. 请求结束后更新指标统计
```

#### 非流式转发流程

```
1. 调用 forwardJson 发送 POST 请求到上游
2. 解析响应中的 Token 使用量 (tokenUsageFromResponse)
3. 更新指标统计 (updateStats)
4. 记录请求日志到 metrics.requests
5. 返回上游响应给客户端
```

### 4. 探针测试模块

#### 核心函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `buildProbes(level)` | L433-L640 | 构建探针测试套件（按级别） |
| `runProbe(config, probe)` | L400-L431 | 执行单个探针测试 |
| `scoreProbe(result)` | L388-L394 | 探针评分转换 |
| `contentFromChat(data)` | L380-L382 | 从聊天响应提取内容 |
| `toolCallCount(data)` | L384-L386 | 统计工具调用次数 |

#### 探针测试套件

| 探针 ID | 名称 | 权重 | 测试内容 | 级别要求 |
|---------|------|------|----------|----------|
| `basic` | Basic chat | 18 | 精确 token 输出测试 | 所有级别 |
| `instruction` | Instruction following | 20 | JSON 格式指令遵循 | 所有级别 |
| `reasoning` | Reasoning sanity | 22 | 逻辑推理题（三人说谎悖论） | 所有级别 |
| `json` | JSON mode | 15 | JSON 对象生成测试 | 所有级别 |
| `tools` | Tool calling | 15 | 函数调用能力测试 | 所有级别 |
| `context` | Context retention | 10 | 大海捞针上下文测试 | standard/deep |

#### 探针评分等级

| 等级 | 分数 | 条件 |
|------|------|------|
| excellent | 100 | 完全正确 |
| good | 82 | 基本正确 |
| partial | 55 | 部分正确 |
| weak/fail | 0/28 | 错误或失败 |

#### 上下文测试 (context probe)

- **standard 级别**: 70 个文本块，在第 47 块隐藏 NEEDLE-7429
- **deep 级别**: 180 个文本块，在第 47 块隐藏 NEEDLE-7429
- 测试模型是否能从大量干扰文本中准确提取关键信息

### 5. 指标统计模块

#### 核心函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `getMetrics()` | L135-L144 | 读取指标数据 |
| `saveMetrics(metrics)` | L146-L149 | 保存指标数据（保留最近 1000 条请求） |
| `updateStats(metrics, provider, localModelId, result, nextIndex, usage)` | L330-L378 | 更新提供商、模型、路由的统计数据 |
| `tokenUsageFromResponse(data)` | L322-L328 | 从响应中提取 Token 使用量 |
| `summarizeError(result)` | L305-L308 | 错误信息摘要提取 |

#### 指标数据结构 (metrics.json)

```json
{
  "requests": [...],           // 最近请求记录（最多 1000 条）
  "probes": {},                // 探针测试结果 {providerId:model: 结果}
  "providers": {},             // 提供商统计 {providerId: 统计数据}
  "models": {},                // 本地模型统计 {modelId: 统计数据}
  "routes": {}                 // 路由质量 {providerId:upstreamModel: 统计数据}
}
```

#### 统计字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `healthScore` | number | 提供商健康分 (0-100) |
| `qualityScore` | number | 路由质量分 (0-100) |
| `lastLatencyMs` | number | 最近一次延迟（毫秒） |
| `lastError` | string | 最近一次错误信息 |
| `cooldownUntil` | string | 冷却截止时间 (ISO 8601) |
| `requestCount` | number | 总请求数 |
| `successCount` | number | 成功请求数 |
| `failureCount` | number | 失败请求数 |
| `inputTokens` | number | 累计输入 Token 数 |
| `outputTokens` | number | 累计输出 Token 数 |
| `keyIndex` | number | 当前使用的 API Key 索引（轮询） |

### 6. API 路由模块

#### REST API 端点

| 方法 | 路径 | 认证 | 功能 |
|------|------|------|------|
| `GET` | `/api/config` | 无 | 获取网关配置和实时指标 |
| `PUT` | `/api/config` | 无 | 更新网关配置 |
| `POST` | `/api/probe/:providerId` | 无 | 对指定提供商运行探针测试 |
| `GET` | `/v1/models` | 需要 localApiKey | 列出可用的本地模型别名 |
| `POST` | `/v1/chat/completions` | 需要 localApiKey | 聊天补全请求（核心代理端点） |

#### 请求/响应示例

**GET /api/config**
```json
{
  "ok": true,
  "routing": { "strategy": "quality_first", ... },
  "localApiKey": "local-anything",
  "models": [ { "id": "smart-chat", "routes": [...], ... } ],
  "providers": [ { "id": "heang", "healthScore": 78, ... } ],
  "recentRequests": [ ... ]
}
```

**POST /v1/chat/completions**
```bash
curl http://localhost:4173/v1/chat/completions \
  -H "Authorization: Bearer local-anything" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart-chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### 7. 辅助工具函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `normalizeBaseUrl(baseUrl)` | L25-L31 | 规范化基础 URL（去除尾部斜杠，验证协议） |
| `nowIso()` | L21-L23 | 获取当前 ISO 8601 时间戳 |
| `publicProvider(provider, metrics)` | L151-L167 | 生成公开的提供商信息（含指标） |
| `publicProviderSafe(provider, metrics)` | L169-L176 | 生成安全的提供商信息（API Key 脱敏） |
| `publicModel(model, metrics)` | L193-L202 | 生成公开的模型信息（含路由和指标） |
| `pickApiKey(provider, stat)` | L265-L269 | 轮询选择 API Key |
| `authHeaders(apiKey, extra)` | L271-L277 | 生成认证请求头 |
| `hasVisionInput(body)` | L221-L228 | 检测请求是否包含视觉输入 |
| `requireLocalAuth(req, config)` | L642-L651 | 本地网关认证校验 |

---

## 前端模块详解 (public/)

### 1. HTML 结构 (index.html)

#### 页面布局

```
┌─────────────────────────────────────────────────────┐
│  Hero 区域                                           │
│  - 项目标题 "模型网关照妖镜"                           │
│  - 描述文本                                          │
│  - 端点信息卡片 (Base URL, Local API Key)            │
├─────────────────────────────────────────────────────┤
│  Grid 双栏布局                                       │
│  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │ 本地模型名面板        │  │ 网关设置面板          │  │
│  │ - 模型列表           │  │ - 本地 API Key       │  │
│  │ - 添加模型按钮        │  │ - 路由策略选择        │  │
│  │                     │  │ - 最低健康分          │  │
│  │                     │  │ - 最低路由质量分       │  │
│  │                     │  │ - 视觉强制模型         │  │
│  │                     │  │ - 保存配置按钮         │  │
│  │                     │  │ - 使用示例代码         │  │
│  └─────────────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  上游与 Key 池面板                                    │
│  - 提供商列表                                        │
│  - 添加上游按钮                                      │
│  - 每个提供商卡片包含:                                │
│    * 启用开关 / 名称 / 删除按钮                       │
│    * ID / 名称 / Base URL / 权重 / API Keys         │
│    * 健康分 / 延迟 / Key 数量 / Tokens / 异常信息    │
│    * 探针测试输入框 + 运行按钮 + 结果展示             │
├─────────────────────────────────────────────────────┤
│  最近路由记录面板                                     │
│  - 请求列表 (模型 / 上游模型 / 提供商 / 状态 / 延迟)  │
│  - 刷新按钮                                          │
└─────────────────────────────────────────────────────┘
```

#### HTML 模板

| 模板 ID | 用途 |
|---------|------|
| `modelTemplate` | 本地模型卡片模板 |
| `providerTemplate` | 上游提供商卡片模板 |

### 2. JavaScript 逻辑 (app.js)

#### 状态管理

```javascript
let state = {
  localApiKey: "local-anything",
  routing: { strategy: "quality_first", minHealthScore: 45 },
  models: [],
  providers: [],
  recentRequests: []
};
```

#### 核心函数

| 函数 | 职责 |
|------|------|
| `api(path, options)` | 封装 fetch 请求，统一错误处理 |
| `loadConfig()` | 从服务器加载配置并渲染 |
| `saveConfig()` | 保存当前配置到服务器 |
| `renderSettings()` | 渲染网关设置表单 |
| `renderModels()` | 渲染本地模型列表（含路由管理） |
| `renderProviders()` | 渲染上游提供商列表（含探针测试） |
| `renderRequests()` | 渲染最近请求记录 |
| `newProvider()` | 创建新的提供商对象 |
| `newModel()` | 创建新的模型对象 |
| `providerOptions(selectedId)` | 生成提供商下拉选项 HTML |
| `splitLines(value)` | 将多行文本分割为数组 |
| `escapeHtml(value)` | HTML 转义（防 XSS） |

#### 交互流程

```
页面加载
  │
  ▼
loadConfig() ──→ GET /api/config
  │
  ├── renderSettings()    → 渲染网关设置
  ├── renderModels()      → 渲染模型列表（含路由编辑）
  ├── renderProviders()   → 渲染提供商列表（含探针测试）
  └── renderRequests()    → 渲染请求记录

用户修改配置
  │
  ▼
saveConfig() ──→ PUT /api/config
  │
  └── loadConfig() → 重新加载并渲染

用户运行探针
  │
  ▼
saveConfig() → POST /api/probe/:providerId → 显示结果 → loadConfig()
```

### 3. 样式设计 (styles.css)

#### 设计系统

| 变量 | 值 | 用途 |
|------|-----|------|
| `--ink` | #151515 | 主文字色 |
| `--muted` | #69645d | 次要文字色 |
| `--paper` | #f2eee4 | 背景色 |
| `--panel` | #fffaf0 | 面板背景色 |
| `--red` | #bc2e2e | 强调/错误色 |
| `--gold` | #d49a28 | 金色点缀 |
| `--green` | #247752 | 成功色 |
| `--blue` | #245f92 | 链接/信息色 |
| `--line` | #1a171133 | 边框色 |
| `--shadow` | 0 20px 55px #2d24172b | 阴影 |

#### 响应式断点

- `max-width: 900px`: 所有网格布局切换为单列

---

## 脚本工具详解 (scripts/)

### 1. 批量探针测试 (probe-models.mjs)

#### 功能

对指定提供商的多个上游模型批量运行探针测试，输出 JSON 格式结果。

#### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_ORIGIN` | `http://localhost:4173` | 网关地址 |
| `PROVIDER_ID` | `heang` | 要测试的提供商 ID |
| `PROBE_LEVEL` | `quick` | 探针级别 (quick/standard/deep) |
| `PROBE_MODELS` | 多个模型逗号分隔 | 要测试的模型列表 |

#### 使用示例

```bash
PROVIDER_ID=heang PROBE_MODELS="kimi-k2.5,qwen3-max" node scripts/probe-models.mjs
```

#### 输出格式

```json
{
  "providerId": "heang",
  "level": "quick",
  "results": [
    {
      "model": "kimi-k2.5",
      "ok": true,
      "score": 100,
      "latencyMs": 5000,
      "failed": [],
      "results": [
        { "name": "Basic chat", "score": 100, "ok": true },
        ...
      ]
    }
  ]
}
```

### 2. 压力测试 (stress-test.mjs)

#### 功能

对网关发起并发请求，测试路由稳定性和性能，输出统计报告。

#### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_URL` | `http://localhost:4173/v1` | 网关 API 地址 |
| `GATEWAY_KEY` | `local-anything` | 本地 API Key |
| `STRESS_MODELS` | 自动从 /v1/models 获取 | 要测试的模型列表（逗号分隔） |
| `STRESS_TOTAL` | 25 | 总请求数 |
| `STRESS_CONCURRENCY` | 5 | 并发数 |

#### 使用示例

```bash
STRESS_TOTAL=50 STRESS_CONCURRENCY=10 node scripts/stress-test.mjs
```

#### 输出格式

```json
{
  "total": 50,
  "concurrency": 10,
  "elapsedMs": 12000,
  "success": 48,
  "failure": 2,
  "grouped": {
    "smart-chat -> kimi-k2.5": {
      "count": 20,
      "ok": 19,
      "fail": 1,
      "avgLatencyMs": 1500,
      "maxLatencyMs": 3000,
      "errors": { "timeout": 1 }
    }
  },
  "failures": [...],
  "samples": [...]
}
```

#### 并发模型

使用 `Promise.all` + worker 池模式实现并发控制：

```
worker 池 (concurrency 个 worker)
  │
  ├── 共享 next 计数器
  ├── 每个 worker 循环获取下一个任务
  └── 所有任务完成后汇总结果
```

---

## 依赖关系

### 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| express | ^4.19.2 | HTTP 服务器框架，提供路由和静态文件服务 |

### Node.js 内置模块

| 模块 | 用途 |
|------|------|
| `node:fs/promises` | 异步文件读写 |
| `node:path` | 路径处理 |
| `node:crypto` | UUID 生成 |
| `node:url` | URL 解析 (fileURLToPath) |

### 浏览器 API (前端)

| API | 用途 |
|-----|------|
| `fetch` | HTTP 请求 |
| `document.querySelector` | DOM 操作 |
| `document.createElement` | 动态元素创建 |
| `HTMLTemplateElement` | 模板克隆 |

---

## 项目运行方式

### 环境要求

- Node.js 18+ (支持 ES Modules 和原生 fetch)

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
# 开发/生产模式（相同）
npm start
# 或
npm run dev
# 或直接
node server.js
```

服务启动后访问: `http://localhost:4173`

### 自定义端口

```bash
PORT=3000 npm start
```

### 使用网关 API

```bash
# 列出可用模型
curl http://localhost:4173/v1/models \
  -H "Authorization: Bearer local-anything"

# 发送聊天请求（非流式）
curl http://localhost:4173/v1/chat/completions \
  -H "Authorization: Bearer local-anything" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart-chat",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# 发送聊天请求（流式）
curl http://localhost:4173/v1/chat/completions \
  -H "Authorization: Bearer local-anything" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart-chat",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### 运行探针测试

```bash
# 通过 API
curl -X POST http://localhost:4173/api/probe/heang \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi-k2.5", "level": "quick"}'

# 通过脚本
node scripts/probe-models.mjs
```

### 运行压力测试

```bash
node scripts/stress-test.mjs
```

---

## 关键设计模式

### 1. 本地模型别名系统

用户不需要知道上游真实模型名，只需使用本地定义的别名（如 `smart-chat`），网关自动映射到最优上游模型。

### 2. 多策略路由

- **quality_first**: 优先选择健康分和质量分高的路由
- **balanced**: 平衡质量和权重
- **cost_first**: 优先选择权重高的路由（可理解为成本/优先级）

### 3. 自适应健康评分

使用指数移动平均 (EMA) 算法，新结果权重较低，历史分数权重较高，避免单次失败导致剧烈波动。

### 4. API Key 轮询

支持一个提供商配置多个 API Key，自动轮询使用，提高并发能力。

### 5. 视觉请求自动路由

检测请求中是否包含 `image_url` 类型内容，自动路由到配置的 `visionModel`。

### 6. 配置迁移兼容

`migrateConfig()` 函数自动将旧版配置结构（`provider.models`）迁移到新版结构（`models[].routes`），保证向后兼容。

---

## 数据流图

```
客户端请求
    │
    ▼
┌─────────────────────────────────────────┐
│  POST /v1/chat/completions              │
│  1. requireLocalAuth() 认证              │
│  2. 检测视觉输入 → hasVisionInput()      │
│  3. selectRoute() 选择最优路由           │
│  4. pickApiKey() 选择 API Key           │
│  5. 转发请求:                            │
│     - 流式: proxyStreaming()             │
│     - 非流式: forwardJson()              │
│  6. updateStats() 更新指标               │
│  7. saveMetrics() 持久化                 │
│  8. 返回响应                             │
└─────────────────────────────────────────┘
```

---

## 文件职责总结

| 文件 | 类型 | 职责 |
|------|------|------|
| `server.js` | 后端入口 | Express 服务器、API 路由、业务逻辑、探针系统 |
| `providers.json` | 配置 | 网关配置：提供商、模型、路由策略 |
| `data/metrics.json` | 数据 | 运行时指标：请求记录、健康分、探针结果 |
| `public/index.html` | 前端 | 管理面板 HTML 结构 |
| `public/app.js` | 前端 | 管理面板交互逻辑、配置 CRUD |
| `public/styles.css` | 前端 | 管理面板样式 |
| `scripts/probe-models.mjs` | 脚本 | 批量探针测试 CLI 工具 |
| `scripts/stress-test.mjs` | 脚本 | 压力测试 CLI 工具 |
| `package.json` | 配置 | 项目元数据、依赖、启动脚本 |
