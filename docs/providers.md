# Providers

Each Hydra head is backed by a **provider** — the SDK / wire format used to talk to the AI service. Five providers ship with Hydra:

| Provider id          | Auth mode    | SDK                          | Supports `--base-url` | Default env var      |
|----------------------|--------------|------------------------------|------------------------|----------------------|
| `anthropic`          | api-key      | `@anthropic-ai/sdk`          | No                     | `ANTHROPIC_API_KEY`  |
| `openai`             | api-key      | `openai`                     | **Yes**                | `OPENAI_API_KEY`     |
| `google-gemini`      | api-key      | `@google/generative-ai`      | No                     | `GOOGLE_API_KEY`     |
| `subscription-claude`| subscription | spawns local `claude` CLI    | n/a                    | (none)               |
| `subscription-codex` | subscription | spawns local `codex` CLI     | n/a                    | (none)               |

The `openai-compat` provider name is an alias for `openai` — it accepts any service that speaks OpenAI's `/v1/chat/completions` API (which is most of them).

The `subscription-*` providers are wired only to the built-in Claude and Codex heads. You cannot add a custom head against them; subscription wrapping requires the official provider CLI to be installed and logged in.

## Worked examples

Each example assumes the env var named in `--key-env` is set in your shell or in `.hydra-state/.env`.

### OpenRouter

```
/hydra head add llama \
  --provider openai-compat \
  --key-env OPENROUTER_API_KEY \
  --base-url https://openrouter.ai/api/v1 \
  --model meta-llama/llama-3.3-70b-instruct \
  --color purple --tag "[LLAMA]"
```

### Groq

```
/hydra head add groq \
  --provider openai-compat \
  --key-env GROQ_API_KEY \
  --base-url https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile \
  --color red --tag "[GROQ]"
```

### Together AI

```
/hydra head add together \
  --provider openai-compat \
  --key-env TOGETHER_API_KEY \
  --base-url https://api.together.xyz/v1 \
  --model meta-llama/Llama-3.3-70B-Instruct-Turbo \
  --color green --tag "[TOG]"
```

### DeepSeek

```
/hydra head add deepseek \
  --provider openai-compat \
  --key-env DEEPSEEK_API_KEY \
  --base-url https://api.deepseek.com/v1 \
  --model deepseek-chat \
  --color yellow --tag "[DSEEK]"
```

### Local Ollama (with the OpenAI compatibility shim)

```
/hydra head add ollama \
  --provider openai-compat \
  --key-env OLLAMA_API_KEY \
  --base-url http://localhost:11434/v1 \
  --model llama3.3:70b \
  --color white --tag "[OLLAMA]"
```

Ollama does not actually check the key, but Hydra requires `--key-env` to point at *some* env var; set `OLLAMA_API_KEY=ollama` (or anything non-empty) and you're good.

### Anthropic (extra Claude head, non-subscription)

If you want a Claude head separate from the built-in (e.g. a different model or env var):

```
/hydra head add claude-opus \
  --provider anthropic \
  --key-env ANTHROPIC_API_KEY \
  --model claude-opus-4-7 \
  --color orange --tag "[OPUS]"
```

## Notes

- Env-var-set is verified at `/hydra head test <id>` time — `add` won't fail just because the variable is unset, it'll just remind you to set it.
- Color collisions are allowed but you'll see a warning. The boot indicator may be confusing if two heads share a color.
- The 5-head soft cap is enforced in `add`; pass `--force` to exceed.
- All HTTP traffic from `openai`/`openai-compat` adapters goes through Node's built-in `fetch` (via the `openai` SDK). There is no proxy support yet.
