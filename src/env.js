import fs from 'node:fs';
import path from 'node:path';

export function loadDotEnv(root = process.cwd(), env = process.env) {
  const envFiles = [
    path.join(root, '.hydra-state', '.env'),
    path.join(root, '.env'),
  ];

  let loaded = false;
  for (const envFile of envFiles) {
    loaded = loadDotEnvFile(envFile, env) || loaded;
  }

  return loaded;
}

function loadDotEnvFile(envFile, env) {
  if (!fs.existsSync(envFile)) {
    return false;
  }

  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unquote(trimmed.slice(equalsIndex + 1).trim());
    if (key && env[key] === undefined) {
      env[key] = value;
    }
  }

  return true;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
