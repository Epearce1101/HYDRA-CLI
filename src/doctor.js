import fs from 'node:fs';
import { stdout as output } from 'node:process';
import { colorize, systemLine, terminalWidth } from './logo.js';
import { detectConnectedHeads, listHeads } from './heads.js';
import { listProviders } from './providers.js';
import { ensureProjectState } from './project.js';
import { verifyHead } from './health.js';
import { formatBudgetDoctorLine } from './budget.js';
import { readHydraFile } from './hydra-file.js';
import { getNicknameEntries } from './command-registry.js';
import { MODEL_ALIASES } from './provider-commands.js';
import { formatModelShortName } from './model-display.js';
import {
  connectionDisplay,
  formatActiveHeadHeader,
  formatHeadShortLabel,
  formatHeadStatusPrefix,
  headDisplayColor,
  subscriptionStatusDetail,
} from './head-display.js';
import { truncateText } from './text-utils.js';

export async function runDoctor() {
  const paths = ensureProjectState();
  const heads = detectConnectedHeads();

  console.log(systemLine('System health'));
  console.log(`Project root: ${paths.root}`);
  console.log(`State dir:    ${paths.stateDir}`);
  console.log(`Shared file:  ${paths.sharedFile}`);
  console.log('');
  printConnectionStatus(heads);
  console.log('');
  printProjectFileHealth();
  console.log('');
  console.log(systemLine('Provider connection tests'));

  for (const head of heads) {
    if (!head.connected) {
      console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag.padEnd(10), headDisplayColor(head))} SKIPPED              ${head.envKey ? `${head.envKey} not set` : 'no auth configured'}`);
      continue;
    }

    if (head.authMode === 'subscription' && !head.callable) {
      const detail = subscriptionStatusDetail(head);
      console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag.padEnd(10), headDisplayColor(head))} ${colorize('LINKED', 'yellow').padEnd(20)} ${detail}`);
      continue;
    }

    if (!head.callable) {
      console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag.padEnd(10), headDisplayColor(head))} SKIPPED              not callable in current auth mode`);
      continue;
    }

    const result = await verifyHead(head, { timeoutMs: 20000 });
    const ok = result.verified;
    const status = ok ? colorize('OK', 'green') : colorize('FAILED', 'yellow');
    const reason = !ok && result.error ? ` reason: ${result.error}` : '';
    const via = head.authMode === 'subscription' ? ` via ${head.subscriptionBinary}` : '';
    console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag.padEnd(10), headDisplayColor(head))} ${status.padEnd(20)} model: ${formatHeadShortLabel(head)} (${head.model})${via}${reason}`);
  }

  console.log('');
  console.log(systemLine(formatBudgetDoctorLine()));
}

export function printHeads() {
  const nicknames = getNicknameEntries(listHeads());
  for (const head of detectConnectedHeads()) {
    const display = connectionDisplay(head);
    const aliases = nicknames
      .filter((entry) => entry.head.id === head.id)
      .map((entry) => entry.reserved ? `${entry.alias} (disabled)` : entry.alias);
    console.log(formatActiveHeadHeader(head));
    console.log(`  Provider: ${head.providerId || 'unknown'}`);
    console.log(`  Model: ${formatHeadShortLabel(head)} (${head.model || head.defaultModel || 'n/a'})`);
    console.log(`  Primary role: ${head.role || head.defaultRole || 'n/a'}`);
    console.log(`  Nicknames: ${aliases.length ? aliases.join(', ') : 'none'}`);
    console.log(`  Callable: ${head.callable ? 'yes' : 'no'} (${display.label.toLowerCase()})`);
    console.log('');
  }
}

export function printConnectionStatus(heads, width = terminalWidth(output)) {
  for (const head of heads) {
    const display = connectionDisplay(head);
    const status = colorize(display.label, display.color);
    const model = head.connected ? `model: ${formatHeadShortLabel(head)}` : '';
    if (width < 60) {
      console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag, headDisplayColor(head))} ${status}`);
      console.log(`  ${truncateText(head.connectionLabel, width - 2)}`);
      if (model) {
        console.log(`  ${truncateText(model, width - 2)}`);
      }
      continue;
    }

    console.log(`${formatHeadStatusPrefix(head)}${colorize(head.tag.padEnd(10), headDisplayColor(head))} ${status.padEnd(20)} ${head.connectionLabel.padEnd(14)} ${model}`);
  }
}

export function printProjectFileHealth() {
  const hydraFile = readHydraFile();
  const validation = hydraFile.validation.valid ? colorize('OK', 'green') : colorize('FAILED', 'yellow');
  console.log(systemLine('Project file checks'));
  console.log(`.hydra          ${validation}${hydraFile.validation.valid ? '' : ` ${hydraFile.validation.errors.join(' ')}`}`);
  console.log(`.hydra-state/   ${gitignoreStatus('.hydra-state/')}`);
  console.log(`.env               ${gitignoreStatus('.env')}`);
}

export function printModels() {
  console.log('[HYDRA] MODELS');
  console.log('');
  for (const head of detectConnectedHeads()) {
    const aliases = Object.keys(MODEL_ALIASES[head.id] || {});
    console.log(formatActiveHeadHeader(head));
    console.log(`  Active model:  ${formatHeadShortLabel(head)} (${head.model || 'n/a'})`);
    console.log(`  Default model: ${formatModelShortName(head.defaultModel)} (${head.defaultModel || 'n/a'})`);
    console.log(`  Aliases:       ${aliases.length ? aliases.join(', ') : 'full provider model IDs accepted'}`);
  }
}

export function printProviders() {
  console.log('[HYDRA] PROVIDERS');
  console.log('');
  for (const provider of listProviders()) {
    console.log(`${provider.id.padEnd(20)} ${provider.label}`);
    console.log(`  Auth: ${provider.auth}`);
    console.log(`  Base URL override: ${provider.supportsBaseUrl ? 'yes' : 'no'}`);
  }
}

function gitignoreStatus(pattern) {
  const ignored = isGitignored(pattern);
  return ignored ? colorize('IGNORED', 'green') : colorize('NOT IGNORED', 'yellow');
}

function isGitignored(pattern) {
  if (!fs.existsSync('.gitignore')) {
    return false;
  }

  const normalized = pattern.replace(/\\/g, '/').replace(/\/$/, '');
  return fs.readFileSync('.gitignore', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .some((line) => {
      const gitignorePattern = line.replace(/\\/g, '/').replace(/\/$/, '');
      return gitignorePattern === normalized || gitignorePattern === `${normalized}/`;
    });
}
