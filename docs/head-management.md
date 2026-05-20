# Head Management

Hydra heads are the AI back-ends you can route prompts to. Three are built in (Claude / Codex / Gemini). You can add up to **5** total (soft cap; `--force` allows more with a layout warning).

All head state lives in `.hydra-state/heads.json`. The `/hydra head` commands are the primary interface; hand-edits to that file work too.

## Commands

### List

```
/hydra head list          # alias: ls
```

Shows every head with provider, model, auth mode, callable state, `(custom)` marker, and the env var that holds its key.

### Add

```
/hydra head add <id> --provider <openai|anthropic|google-gemini|openai-compat> \
  [--key-env VAR]      \
  [--model MODEL]      \
  [--base-url URL]     \
  [--name "Name"]      \
  [--tag "[TAG]"]      \
  [--color COLOR]      \
  [--role "role text"] \
  [--force]
```

Rules:
- `<id>` must be lowercase alphanumeric (start with a letter, `-` / `_` allowed).
- `--provider`: `openai-compat` is an alias for `openai`; both accept any provider that speaks OpenAI's `/v1/chat/completions` shape. `subscription-*` providers cannot be added as custom heads (they wrap the official `claude` / `codex` CLIs, which are wired to the built-in heads).
- `--key-env` defaults to the provider's default env var (e.g. `OPENAI_API_KEY` for `openai`). Set it to whatever shell variable holds your key for the chosen provider — e.g. `OPENROUTER_API_KEY`.
- `--base-url` is honored by `openai`/`openai-compat`. Required for non-OpenAI endpoints.
- `--color` is a palette name (`orange / white / blue / purple / red / green / yellow`). Collisions warn but are allowed.
- `--force` lets you exceed the 5-head soft cap. The boot indicator may wrap to two lines or collapse to a count summary above 5.

Side effects: writes `.hydra-state/heads.json`, invalidates the health cache, and reminds you if the required env var is unset.

### Edit

```
/hydra head edit <id> [--model M] [--role R] [--base-url U] [--key-env V] [--name N] [--tag T] [--color C]
```

Partial update. Pass any subset of fields. For built-in heads, `providerId` and `envKey` are locked.

### Remove

```
/hydra head remove <id>
/remove head <slot>
```

Prompts y/N. Any configured head, including the original default heads, can be removed. Removing busts the health cache so the indicator immediately drops the head.

### Test

```
/hydra head test <id>
```

Runs the same probe as `/hydra doctor` against one head with a 20-second timeout. Reports `OK` or `FAILED` with the underlying reason (missing env var, network error, subscription CLI detail, etc.).

## Hand-editing `heads.json`

The file is a plain JSON document of the form:

```json
{
  "heads": [
    {
      "id": "llama",
      "name": "Llama",
      "tag": "[LLAMA]",
      "providerId": "openai",
      "envKey": "OPENROUTER_API_KEY",
      "defaultModel": "meta-llama/llama-3.3-70b-instruct",
      "defaultRole": null,
      "color": "purple",
      "baseUrl": "https://openrouter.ai/api/v1",
      "builtin": false
    }
  ]
}
```

Changes take effect on the next Hydra launch. The CLI's `normalizeHead` fills in any missing fields from built-in defaults when the id matches a built-in.
