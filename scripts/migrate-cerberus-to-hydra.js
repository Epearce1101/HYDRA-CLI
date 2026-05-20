#!/usr/bin/env node
// One-shot migration: Cerberus CLI → Hydra CLI.
//
// Run once from inside a project directory that has a legacy `.cerberus-state/`
// directory and/or `.cerberus` shared file. The script is idempotent: re-running
// after a successful migration is a no-op.
//
// What it does:
//   1. Moves `.cerberus-state/` → `.hydra-state/` (renames keys CERBERUS_* → HYDRA_* in private .env).
//   2. Moves `.cerberus` → `.hydra`.
//   3. Seeds `.hydra-state/heads.json` from the registry's built-ins (Phase 3 schema).
//   4. Prints a follow-up checklist for the global npm link and memory pointers.
//
// It does NOT:
//   - Rename the project directory (do that manually after verifying).
//   - Touch the global npm link (re-run `npm link` after the rename).
//   - Modify your Claude memory directory.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const oldState = path.join(root, '.cerberus-state');
const newState = path.join(root, '.hydra-state');
const oldShared = path.join(root, '.cerberus');
const newShared = path.join(root, '.hydra');

const summary = [];

function log(line) {
  console.log(`[migrate] ${line}`);
}

function moveStateDir() {
  if (!fs.existsSync(oldState)) {
    log('.cerberus-state/ not found — skipping state move.');
    return;
  }
  if (fs.existsSync(newState)) {
    log('.hydra-state/ already exists — refusing to overwrite. Resolve by hand.');
    process.exit(1);
  }
  fs.renameSync(oldState, newState);
  summary.push('moved .cerberus-state/ -> .hydra-state/');
}

function rewriteEnvFile() {
  const envPath = path.join(newState, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  const next = raw
    .replace(/^CERBERUS_/gm, 'HYDRA_')
    .replace(/(^|\s)CERBERUS_/g, '$1HYDRA_');
  if (next !== raw) {
    fs.writeFileSync(envPath, next, 'utf8');
    summary.push('rewrote CERBERUS_* -> HYDRA_* in .hydra-state/.env');
  }
}

function moveSharedFile() {
  if (!fs.existsSync(oldShared)) {
    log('.cerberus shared file not found — skipping shared move.');
    return;
  }
  if (fs.existsSync(newShared)) {
    log('.hydra shared file already exists — refusing to overwrite. Resolve by hand.');
    process.exit(1);
  }
  fs.renameSync(oldShared, newShared);
  summary.push('moved .cerberus -> .hydra');
}

function seedHeadsRegistry() {
  const headsFile = path.join(newState, 'heads.json');
  if (fs.existsSync(headsFile)) {
    log('heads.json already present — leaving as-is.');
    return;
  }
  if (!fs.existsSync(newState)) return;
  // Minimal Phase 3 seed: three built-ins. The full schema is filled in by
  // src/heads.js's normalizeHead() on first read; we only need a valid stub.
  const seed = {
    heads: [
      { id: 'claude', providerId: 'anthropic', envKey: 'ANTHROPIC_API_KEY', builtin: true },
      { id: 'codex', providerId: 'openai', envKey: 'OPENAI_API_KEY', builtin: true },
      { id: 'gemini', providerId: 'google-gemini', envKey: 'GOOGLE_API_KEY', builtin: true },
    ],
  };
  fs.writeFileSync(headsFile, JSON.stringify(seed, null, 2), 'utf8');
  summary.push('seeded .hydra-state/heads.json with built-ins');
}

function printSummary() {
  console.log('');
  if (summary.length === 0) {
    console.log('[migrate] Nothing to migrate. Project is already on Hydra layout.');
    return;
  }
  console.log('[migrate] Migration complete:');
  for (const item of summary) console.log(`  - ${item}`);
  console.log('');
  console.log('[migrate] Follow-up checklist (do these yourself):');
  console.log('  1. Rename project directory if it is still named "cerberus cli" / similar.');
  console.log('  2. Run `npm unlink -g cerberus-cli` then `npm link` from the new project root.');
  console.log('  3. Update Claude memory pointers in ~/.claude/projects/.../memory/ to reference the new path.');
  console.log('  4. Verify with: `hydra doctor` and `npm run smoke`.');
}

moveStateDir();
rewriteEnvFile();
moveSharedFile();
seedHeadsRegistry();
printSummary();
