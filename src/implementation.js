const CHANGE_ALIASES = Object.freeze({
  add: 'add',
  create: 'add',
  new: 'add',
  edit: 'edit',
  update: 'edit',
  modify: 'edit',
  change: 'edit',
  delete: 'delete',
  remove: 'delete',
});

export function buildImplementationNotesPromptSection({ ownershipMap = null, roleTag = 'code' } = {}) {
  const tracks = Array.isArray(ownershipMap?.tracks)
    ? ownershipMap.tracks.filter((track) => String(track.owner_role || '').toLowerCase() === String(roleTag || '').toLowerCase())
    : [];
  const trackHint = tracks.length
    ? `Your likely track IDs: ${tracks.map((track) => track.track_id).join(', ')}. Pick the one that matches the files you are proposing to touch.`
    : 'Pick the track_id from the Ownership Map that matches the files you are proposing to touch.';

  return `IMPLEMENTATION NOTES REQUIRED:
At the end of your response, include EXACTLY one JSON object inside a \`\`\`json fence. This object is used by Oracle to validate your proposed file ownership. Do not invent files outside your assigned track unless they are listed in shared_files with a permissive rule.

${trackHint}

\`\`\`json
{
  "track_id": "<track from the Ownership Map>",
  "files_changed": [
    { "path": "<glob-matching path>", "change": "add|edit|delete", "reason": "<short reason>" }
  ],
  "summary": "<2-3 sentence implementation summary>",
  "assumptions": ["<explicit assumption strings; empty array is allowed>"],
  "rollback_notes": "<how to back this out>",
  "verification_suggested": [
    { "command": "<command to run>", "expected": "<expected result>" }
  ]
}
\`\`\``;
}

export function parseImplementationNotes(text) {
  const raw = String(text || '');
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fencedMatch) candidates.push(fencedMatch[1]);
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return {
        ok: true,
        track_id: typeof parsed.track_id === 'string' ? parsed.track_id.trim() : '',
        files_changed: normalizeFilesChanged(parsed.files_changed),
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
        assumptions: ensureStringArray(parsed.assumptions),
        rollback_notes: typeof parsed.rollback_notes === 'string' ? parsed.rollback_notes.trim() : '',
        verification_suggested: normalizeVerification(parsed.verification_suggested),
        raw,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    ok: false,
    track_id: '',
    files_changed: [],
    summary: 'Worker did not produce structured implementation notes.',
    assumptions: [],
    rollback_notes: '',
    verification_suggested: [],
    reason: 'implementation_notes_unparseable',
    raw,
  };
}

function normalizeFilesChanged(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const change = normalizeChange(entry.change);
      return {
        path: typeof entry.path === 'string' ? entry.path.trim().replace(/\\/g, '/') : '',
        change,
        reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
      };
    })
    .filter(Boolean);
}

function normalizeVerification(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { command: entry.trim(), expected: 'command succeeds' };
      }
      if (!entry || typeof entry !== 'object') return null;
      return {
        command: typeof entry.command === 'string' ? entry.command.trim() : '',
        expected: typeof entry.expected === 'string' ? entry.expected.trim() : '',
      };
    })
    .filter(Boolean);
}

function normalizeChange(value) {
  const raw = String(value || '').trim().toLowerCase();
  return CHANGE_ALIASES[raw] || raw;
}

function ensureStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}
