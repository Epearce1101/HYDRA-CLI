# Migrating from Cerberus CLI

Hydra CLI replaces Cerberus CLI. There is no coexistence layer — Hydra is a hard cutover with no `CERBERUS_*` env-var fallback and no `/cerberus` command alias.

If you have an existing Cerberus install, this is the one-time migration.

## What's renamed

| Cerberus                  | Hydra                       |
|---------------------------|-----------------------------|
| `cerberus-cli` package    | `hydra-cli` package         |
| `cerberus` global command | `hydra` global command      |
| `/cerberus` slash prefix  | `/hydra` slash prefix       |
| `CERBERUS_*` env vars     | `HYDRA_*` env vars          |
| `.cerberus-state/`        | `.hydra-state/`             |
| `.cerberus` shared file   | `.hydra` shared file        |
| `cerberus-file.js`        | `hydra-file.js`             |
| `[CERBERUS]` log prefix   | `[HYDRA]` log prefix        |

## Migration steps

From inside your old Cerberus project directory:

```powershell
node scripts/migrate-cerberus-to-hydra.js
```

The script will:

1. Move `.cerberus-state/` → `.hydra-state/`.
2. Rewrite `CERBERUS_*` → `HYDRA_*` keys in `.hydra-state/.env`.
3. Move `.cerberus` → `.hydra`.
4. Seed `.hydra-state/heads.json` with the three built-in heads (Claude / Codex / Gemini).
5. Print a follow-up checklist.

It is idempotent. Re-running after a successful migration is a no-op.

## After the script

Do these manually:

1. **Rename the project directory** if it is still named like `cerberus cli`.
   ```powershell
   # PowerShell example
   Move-Item "E:\cerberus cli" "E:\hydra cli"
   ```

2. **Re-link the global command.**
   ```powershell
   npm unlink -g cerberus-cli
   cd "E:\hydra cli"
   npm link
   ```
   Verify with `cmd /c where hydra`.

3. **Update Claude memory pointers** (only relevant if you use Claude Code for this project). In `~\.claude\projects\<id>\memory\`:
   - Rename `project_cerberus.md` → `project_hydra.md`.
   - Update `MEMORY.md` to point at `project_hydra.md` and the new project path.
   - Update any references to `.cerberus` / `.cerberus-state` inside those files.

4. **Verify.**
   ```powershell
   hydra doctor
   npm run smoke
   ```
   The doctor should show your existing heads connected, the subscription agreement should still be accepted, and your saved lead head should still be selected.

## What does not carry over

- Global `cerberus` shell aliases or scripts you wrote against the old name.
- Anything outside `.cerberus-state/` and `.cerberus` (the script does not touch the rest of the project).
- A no-op for state that was already on Hydra layout (the script is safe to run multiple times).
