<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

# Model Mirror

> A local OpenAI-compatible API gateway with model aliases, health-aware routing, API-key pools, streaming proxy support, and capability probes.

Model Mirror aggregates multiple upstream model providers behind one local endpoint. Clients use stable aliases such as `smart-chat` while the gateway selects an upstream route using availability and quality metrics.

## Features

- Custom aliases decoupled from upstream model names
- Health- and quality-aware routing with cooldowns
- Multi-key rotation for provider capacity
- JSON and SSE streaming proxy support
- Six built-in probe categories for model evaluation
- Web dashboard for routes, metrics, and configuration
- OpenAI SDK-compatible `/v1` endpoints

## Quick Start

Requires Node.js 18+.

```bash
git clone https://github.com/rfdiosuao/model-mirror.git
cd model-mirror
npm install
npm start
```

Open <http://localhost:4173>.

## API Example

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

OpenAI SDK:

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:4173/v1",
  apiKey: "local-anything"
});
```

## Configuration

Define providers, model aliases, keys, and routing metadata in [`providers.json`](providers.json). Keep production credentials out of version control and restrict the management interface to trusted networks.

See [`CODE_WIKI.md`](CODE_WIKI.md) for deeper implementation notes and [`reports-heang-probe.md`](reports-heang-probe.md) for probe output.

## License

The project README declares MIT licensing. Verify or add the repository's license file before redistribution.
