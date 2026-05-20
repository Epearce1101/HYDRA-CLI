import fs from 'node:fs';
import path from 'node:path';
import { acquireLock as acquireFileLock } from './lock.js';

export const SHARED_FILE = '.hydra';
export const LOCK_FILE = '.hydra.lock';
export const HYDRA_SECTIONS = Object.freeze([
  'PINNED',
  'DECISIONS',
  'MEMORY',
  'NOTES',
  'CONTEXT',
  'PERMISSIONS LOG',
  'BUDGET LOG',
]);

const ENTRY_RE = /^- ([^|]+) \| ([^|]+) \| (.*)$/;

export function defaultHydraFile() {
  return `[PINNED]
- 2026-05-11T00:00:00.000Z | HYDRA | Project name: Hydra CLI.
- 2026-05-11T00:00:00.000Z | HYDRA | Tagline: Cut one down, another spawns.
- 2026-05-11T00:00:00.000Z | HYDRA | The AI heads advise. Hydra coordinates. The user decides.

[DECISIONS]
- 2026-05-11T00:00:00.000Z | HYDRA | Hydra is local-first.
- 2026-05-11T00:00:00.000Z | HYDRA | Claude, Codex, and Gemini are fixed equal heads.
- 2026-05-11T00:00:00.000Z | HYDRA | Heads do not directly communicate with each other.
- 2026-05-11T00:00:00.000Z | HYDRA | Provider credentials belong in .hydra-state/.env or the shell environment only.
- 2026-05-11T00:00:00.000Z | HYDRA | .hydra is the shared project intelligence file; .hydra-state/ is private machine-local state.

[MEMORY]

[NOTES]
- 2026-05-11T00:00:00.000Z | HYDRA | Complete the remaining v2.1 specification after Section 5.
- 2026-05-11T00:00:00.000Z | HYDRA | Choose first provider SDK integration order.
- 2026-05-11T00:00:00.000Z | HYDRA | Define exact permission prompt UX.

[CONTEXT]
- 2026-05-11T00:00:00.000Z | HYDRA | Initial v2.1 spec excerpt captured in docs/spec-v2.1-excerpt.md.

[PERMISSIONS LOG]

[BUDGET LOG]
`;
}

export function getHydraFilePath(root = process.cwd()) {
  return path.join(root, SHARED_FILE);
}

export function getLockFilePath(root = process.cwd()) {
  return path.join(root, LOCK_FILE);
}

export function readHydraFile(root = process.cwd()) {
  const filePath = getHydraFilePath(root);
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const validation = validateHydraText(text);
  return {
    filePath,
    text,
    validation,
    sections: validation.sections,
  };
}

export function validateHydraFile(root = process.cwd()) {
  return readHydraFile(root).validation;
}

export function validateHydraText(text) {
  const errors = [];
  const sections = Object.fromEntries(HYDRA_SECTIONS.map((section) => [section, []]));
  const seenSections = [];
  let currentSection = null;

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const lineNumber = lineIndex + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\[([A-Z ]+)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1];
      if (!HYDRA_SECTIONS.includes(section)) {
        errors.push(`Line ${lineNumber}: unknown section [${section}].`);
      }
      seenSections.push(section);
      currentSection = section;
      continue;
    }

    if (!currentSection) {
      errors.push(`Line ${lineNumber}: content appears before [PINNED].`);
      continue;
    }

    const entry = parseEntryLine(line, lineNumber);
    if (!entry) {
      errors.push(`Line ${lineNumber}: malformed entry.`);
      continue;
    }

    sections[currentSection].push(entry);
  }

  const expected = HYDRA_SECTIONS.join(',');
  const actual = seenSections.join(',');
  if (actual !== expected) {
    errors.push(`Sections must appear exactly once in this order: ${expected}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    sections,
  };
}

export async function append_entry(section, author, content, root = process.cwd()) {
  const normalizedSection = normalizeSection(section);
  const cleanAuthor = normalizeAuthor(author);
  const cleanContent = normalizeContent(content);

  if (!cleanContent) {
    throw new Error('Cannot append an empty .hydra entry.');
  }

  const releaseLock = await acquireLock(root);
  try {
    const current = readHydraFile(root);
    if (!current.validation.valid) {
      throw new Error(`Cannot append to invalid .hydra file: ${current.validation.errors.join(' ')}`);
    }

    const nextSections = cloneSections(current.sections);
    nextSections[normalizedSection].push({
      timestamp: new Date().toISOString(),
      author: cleanAuthor,
      content: cleanContent,
    });

    fs.writeFileSync(current.filePath, serializeSections(nextSections), 'utf8');
  } finally {
    releaseLock();
  }
}

export const appendEntry = append_entry;

function parseEntryLine(line, lineNumber) {
  const match = line.match(ENTRY_RE);
  if (!match) {
    return null;
  }

  const timestamp = match[1].trim();
  const author = match[2].trim();
  const content = match[3].trim();

  if (!timestamp || Number.isNaN(Date.parse(timestamp)) || !author || !content) {
    return null;
  }

  return {
    lineNumber,
    timestamp,
    author,
    content,
    raw: line,
  };
}

function serializeSections(sections) {
  const blocks = [];
  for (const section of HYDRA_SECTIONS) {
    const lines = [`[${section}]`];
    for (const entry of sections[section]) {
      lines.push(`- ${entry.timestamp} | ${entry.author} | ${entry.content}`);
    }
    blocks.push(lines.join('\n'));
  }

  return `${blocks.join('\n\n')}\n`;
}

function cloneSections(sections) {
  return Object.fromEntries(
    HYDRA_SECTIONS.map((section) => [
      section,
      sections[section].map((entry) => ({
        timestamp: entry.timestamp,
        author: entry.author,
        content: entry.content,
      })),
    ]),
  );
}

function normalizeSection(section) {
  const normalized = String(section || '').replace(/^\[/, '').replace(/\]$/, '').toUpperCase();
  if (!HYDRA_SECTIONS.includes(normalized)) {
    throw new Error(`Unknown .hydra section "${section}". Expected ${HYDRA_SECTIONS.join(', ')}.`);
  }

  return normalized;
}

function normalizeAuthor(author) {
  const clean = String(author || 'USER').replaceAll('|', '/').trim();
  return clean || 'USER';
}

function normalizeContent(content) {
  return String(content || '').replace(/[\r\n\t]+/g, ' ').trim();
}

function acquireLock(root) {
  return acquireFileLock(getLockFilePath(root));
}
