# Heang model probe report

Date: 2026-05-14 Asia/Shanghai
Provider: heang (https://api.heang.top)
Probe level: quick

## Recommended for automatic routing

| Upstream model | Score | Notes |
| --- | ---: | --- |
| kimi-k2.5 | 100 | Passed basic, instruction, reasoning, JSON, tool calling |
| qwen3-coder-plus | 100 | Passed all quick probes; best code route |
| qwen3-max-2026-01-23 | 100 | Passed all quick probes; strong general route |

## Usable with caveats

| Upstream model | Score | Failed probes | Suggested use |
| --- | ---: | --- | --- |
| MiniMax-M2.5 | 83 | Tool calling | Cheap non-tool chat only |
| glm-4-flash | 83 | JSON mode | Fast/cheap simple tasks; avoid strict JSON |
| glm-4.7 | 83 | Tool calling | General fallback without tools |
| qwen3-coder-next | 83 | JSON mode | Code fallback; avoid strict JSON |
| qwen3.5-plus | 83 | Tool calling | General fallback without tools |
| qwen3.6-plus | 83 | Tool calling | General fallback without tools |
| glm-5 | 67 | JSON mode, tool calling | Manual/fallback only |

## Do not auto-route

| Upstream model | Score | Failed probes |
| --- | ---: | --- |
| MiniMax-M2.7 | 39 | Basic chat, reasoning, JSON mode |
| MiniMax-M2.7-highspeed | 17 | Basic chat, instruction, reasoning, JSON mode |
| tencent/hy3-preview-20260421 | 0 | All quick probes |

## Routing changes applied

- Added route quality gate: `routing.minRouteQualityScore = 55`.
- Added route-level metrics keyed by `providerId:upstreamModel`.
- `smart-chat` now prefers `kimi-k2.5`, then `qwen3-max-2026-01-23`.
- `code-chat` prefers `qwen3-coder-plus`; `qwen3-coder-next` is lower-weight fallback.
- `reasoning-chat` prefers `kimi-k2.5`, then `qwen3-max-2026-01-23`.
- `fast-chat` uses `glm-4-flash`; MiniMax highspeed removed from active route.
- Added `json-chat` using only 100-score routes.
- Added disabled `manual-lab` for poor/experimental routes.

## Vision routing update

- `qwen3.6-plus` was tested: score 83 in text probes. It passed basic/instruction/reasoning/JSON, failed tool calling.
- `glm-5` was tested: score 67 in text probes. It passed basic/instruction/reasoning, failed JSON mode and tool calling.
- Vision smoke test used a 16x16 red PNG via OpenAI-compatible `image_url` content.
- Correct visual answers: `kimi-k2.5`, `qwen3.6-plus`.
- Incorrect or non-vision answers in this test: `qwen3-max-2026-01-23`, `glm-5`, `glm-4.7`, `qwen3-coder-plus`.
- Added forced vision routing: requests containing `image_url` or `input_image` are routed to `routing.visionModel` (`vision-chat`) regardless of requested model.
- `vision-chat` routes: `kimi-k2.5` primary, `qwen3.6-plus` fallback.

## Tencent HY3 compatibility note

`tencent/hy3-preview-20260421` appears in `/v1/models`, but direct `/v1/chat/completions` calls failed in all tested forms:

- Plain text chat: `openai_error` / `bad_response_status_code`
- Text chat without temperature: `openai_error` / `bad_response_status_code`
- OpenAI content array text: `openai_error` / `bad_response_status_code`
- Vision `image_url`: `openai_error` / `bad_response_status_code`
- Streaming text: HTTP 500 from relay

Conclusion: the relay advertises the model, but it is not usable through this OpenAI-compatible chat endpoint with the current key/config. It stays disabled in `manual-lab` until the upstream provider documents a working endpoint or fixes backend routing.

## 200OK API probe report

Provider: okapi (https://api.200okapi.com)
Models advertised by `/v1/models`:

- gpt-5.4-mini
- gpt-5.4
- gpt-5.4-xhigh

Quick probe results:

| Upstream model | Score | Failed probes | Notes |
| --- | ---: | --- | --- |
| gpt-5.4-mini | 83 | Tool calling | Basic/instruction/reasoning/JSON passed |
| gpt-5.4 | 83 | Tool calling | Basic/instruction/reasoning/JSON passed |
| gpt-5.4-xhigh | 83 | Tool calling | Basic/instruction/reasoning/JSON passed |

Direct short request latency:

| Upstream model | Latency | Output |
| --- | ---: | --- |
| gpt-5.4-mini | ~3.9s | OKAPI-OK |
| gpt-5.4 | ~4.7s | OKAPI-OK |
| gpt-5.4-xhigh | ~5.0s | OKAPI-OK |

Gateway stress test for direct local aliases:

- `okapi-mini -> gpt-5.4-mini`: 2/2 success, avg ~4.9s
- `okapi-chat -> gpt-5.4`: 2/2 success, avg ~6.1s
- `okapi-xhigh` requested `gpt-5.4-xhigh`, but response `model` field reported `gpt-5.4`; 2/2 success, avg ~5.6s. Treat xhigh as not independently verified until upstream confirms returned model naming.

Routing decision:

- Added provider `okapi`.
- Added direct aliases: `okapi-mini`, `okapi-chat`, `okapi-xhigh`.
- Added low-weight backup routes to `smart-chat`, `reasoning-chat`, and `cheap-chat`.
- Did not add okapi to `json-chat` or `code-chat` primary routes because tool calling failed and no code-specific probe has been run.
