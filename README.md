# Model Mirror - 模型网关照妖镜

> Local OpenAI-compatible API gateway with health-based routing, model aliasing, and AI probe testing.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/rfdiosuao/model-mirror)](https://github.com/rfdiosuao/model-mirror)

---

## 简介

**Model Mirror** 是一个轻量级的本地 AI 模型网关，作为 OpenAI-compatible API 的中转层，将多个上游 AI 模型提供商聚合为统一的本地 API 端点。

### 核心能力

- **模型别名映射** - 使用自定义模型名（如 `smart-chat`），无需记忆上游真实模型名
- **智能健康路由** - 基于实时健康分和质量分自动选择最优上游路由
- **API Key 池管理** - 支持多 Key 轮询，提高并发能力
- **流式转发** - 完整支持 SSE 流式响应代理
- **智商探针测试** - 内置 6 种探针测试，量化评估模型能力
- **可视化面板** - 内置 Web 管理界面，零配置操作

---

## 快速开始

### 环境要求

- Node.js 18+（支持 ES Modules 和原生 fetch）

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/rfdiosuao/model-mirror.git
cd model-mirror

# 安装依赖
npm install

# 启动服务
npm start
```

服务启动后访问：`http://localhost:4173`

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

### 配合 OpenAI SDK 使用

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:4173/v1",
  apiKey: "local-anything"
});

const response = await client.chat.completions.create({
  model: "smart-chat",
  messages: [{ role: "user", content: "你好" }]
});

console.log(response.choices[0].message.content);
```

---

## 架构设计

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

---

## 配置说明

### providers.json 配置结构

```json
{
  "localApiKey": "local-anything",
  "routing": {
    "strategy": "quality_first",
    "minHealthScore": 45,
    "minRouteQualityScore": 55,
    "visionModel": "vision-chat",
    "cooldownSeconds": 90
  },
  "models": [
    {
      "id": "smart-chat",
      "label": "Smart Chat",
      "description": "General high-quality local model alias.",
      "enabled": true,
      "routes": [
        {
          "providerId": "heang",
          "upstreamModel": "kimi-k2.5",
          "weight": 1,
          "enabled": true
        }
      ]
    }
  ],
  "providers": [
    {
      "id": "heang",
      "name": "Heang API",
      "baseUrl": "https://api.heang.top",
      "apiKeys": ["sk-..."],
      "weight": 1,
      "enabled": true,
      "headers": {},
      "tags": ["relay"]
    }
  ]
}
```

### 路由策略

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| `quality_first` | 优先选择健康分和质量分高的路由 | 追求最佳回答质量 |
| `balanced` | 平衡质量和权重 | 日常使用 |
| `cost_first` | 优先选择权重高的路由 | 成本敏感场景 |

### 健康评分机制

- **提供商健康分**：`newHealth = previous * 0.78 + target * 0.22`
  - 成功：target = 92
  - 429 限流：target = 35
  - 其他错误：target = 20

- **路由质量分**：`newQuality = previous * 0.84 + target * 0.16`
  - 成功：target = 88
  - 429 限流：target = 35
  - 其他错误：target = 20

- **冷却机制**：
  - 成功：无冷却
  - 429：冷却 180 秒
  - 其他错误：冷却 90 秒

---

## API 文档

### REST API

| 方法 | 路径 | 认证 | 功能 |
|------|------|------|------|
| `GET` | `/api/config` | 无 | 获取网关配置和实时指标 |
| `PUT` | `/api/config` | 无 | 更新网关配置 |
| `POST` | `/api/probe/:providerId` | 无 | 对指定提供商运行探针测试 |
| `GET` | `/v1/models` | 需要 localApiKey | 列出可用的本地模型别名 |
| `POST` | `/v1/chat/completions` | 需要 localApiKey | 聊天补全请求（核心代理端点） |

### 探针测试 API

```bash
curl -X POST http://localhost:4173/api/probe/heang \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kimi-k2.5",
    "level": "quick"
  }'
```

**探针级别：**
- `quick` - 快速测试（5 个基础探针）
- `standard` - 标准测试（6 个探针，含上下文测试）
- `deep` - 深度测试（6 个探针，更长的上下文干扰）

---

## 探针测试系统

内置 6 种探针测试，全面评估模型能力：

| 探针 | 权重 | 测试内容 |
|------|------|----------|
| **Basic chat** | 18 | 精确 token 输出测试 |
| **Instruction following** | 20 | JSON 格式指令遵循 |
| **Reasoning sanity** | 22 | 逻辑推理题（三人说谎悖论） |
| **JSON mode** | 15 | JSON 对象生成测试 |
| **Tool calling** | 15 | 函数调用能力测试 |
| **Context retention** | 10 | 大海捞针上下文测试 |

### 运行批量探针测试

```bash
# 使用脚本批量测试
PROVIDER_ID=heang PROBE_MODELS="kimi-k2.5,qwen3-max" node scripts/probe-models.mjs

# 自定义网关地址和测试级别
GATEWAY_ORIGIN=http://localhost:4173 PROVIDER_ID=heang PROBE_LEVEL=standard \
  PROBE_MODELS="kimi-k2.5,qwen3-max,glm-4-flash" node scripts/probe-models.mjs
```

---

## 压力测试

```bash
# 默认配置（25 请求，5 并发）
node scripts/stress-test.mjs

# 自定义配置
STRESS_TOTAL=100 STRESS_CONCURRENCY=20 node scripts/stress-test.mjs

# 指定测试模型
STRESS_MODELS="smart-chat,code-chat" STRESS_TOTAL=50 STRESS_CONCURRENCY=10 \
  node scripts/stress-test.mjs
```

**输出示例：**

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
      "maxLatencyMs": 3000
    }
  }
}
```

---

## 项目结构

```
model-mirror/
├── server.js                  # 主服务器入口（后端核心）
├── providers.json             # 网关配置文件
├── package.json               # 项目依赖与脚本
├── .gitignore                 # Git 忽略规则
│
├── data/
│   └── metrics.json           # 运行时指标数据
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

## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js 18+ (ES Modules) |
| 后端框架 | Express.js 4.19.2 |
| 前端 | 原生 HTML/CSS/JavaScript |
| HTTP 客户端 | 原生 fetch API |
| 数据存储 | JSON 文件 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4173` | 服务端口 |
| `GATEWAY_ORIGIN` | `http://localhost:4173` | 网关地址（探针脚本用） |
| `GATEWAY_URL` | `http://localhost:4173/v1` | 网关 API 地址（压力测试用） |
| `GATEWAY_KEY` | `local-anything` | 本地 API Key（压力测试用） |

---

## 设计亮点

### 1. 本地模型别名系统

用户无需知道上游真实模型名，只需使用本地定义的别名（如 `smart-chat`），网关自动映射到最优上游模型。

### 2. 多策略路由

支持 `quality_first`、`balanced`、`cost_first` 三种路由策略，适应不同场景需求。

### 3. 自适应健康评分

使用指数移动平均 (EMA) 算法，避免单次失败导致剧烈波动。

### 4. API Key 轮询

支持一个提供商配置多个 API Key，自动轮询使用，提高并发能力。

### 5. 视觉请求自动路由

检测请求中是否包含 `image_url` 类型内容，自动路由到配置的 `visionModel`。

### 6. 配置迁移兼容

自动将旧版配置结构迁移到新版结构，保证向后兼容。

---

## 许可证

MIT License
