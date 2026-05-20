const EXACT_SHORT_NAMES = Object.freeze({
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-1-20250805': 'Opus 4.1',
  'claude-opus-4-20250514': 'Opus 4',
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-3-7-sonnet-20250219': 'Sonnet 3.7',
  'claude-3-5-haiku-20241022': 'Haiku 3.5',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.4-nano': 'GPT-5.4 Nano',
  'gpt-5': 'GPT-5',
  'gpt-4o': 'GPT-4o',
  o3: 'O3',
  'gemini-3-pro-preview': 'Gemini 3 Pro',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Flash 2.5',
  'gemini-2.5-flash-lite': 'Flash Lite',
  'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
  'nvidia/nemotron-trinity-plus': 'TrinityPlus',
});

export function formatModelShortName(model) {
  const value = String(model || '').trim();
  if (!value) {
    return 'n/a';
  }

  const lower = value.toLowerCase();
  if (EXACT_SHORT_NAMES[lower]) {
    return EXACT_SHORT_NAMES[lower];
  }

  const displayLower = lower.replace(/:free$/, '');

  const claude = displayLower.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
  if (claude) {
    return [titleWord(claude[1]), claude[2], claude[3]].filter(Boolean).join(' ');
  }

  const gpt = displayLower.match(/^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano|turbo))?/);
  if (gpt) {
    return `GPT-${gpt[1]}${gpt[2] ? ` ${titleWord(gpt[2])}` : ''}`;
  }

  const gemini = displayLower.match(/^gemini-(\d+(?:\.\d+)?)-([a-z0-9-]+)/);
  if (gemini) {
    return titleSlug(gemini[2].replace(/-preview$/, ''));
  }

  const slug = displayLower.includes('/') ? displayLower.split('/').at(-1) : displayLower;
  const legacyGeminiFlash = slug.match(/^gemini-flash-(\d+(?:\.\d+)?)-(\d+)b$/);
  if (legacyGeminiFlash) {
    return `Flash ${legacyGeminiFlash[1]} ${legacyGeminiFlash[2]}B`;
  }

  const versionedGemini = slug.match(/^gemini-(\d+(?:\.\d+)?)-([a-z0-9-]+)$/);
  if (versionedGemini) {
    const name = titleSlug(versionedGemini[2].replace(/-\d{3}$/, '').replace(/-preview$/, ''));
    return [name, versionedGemini[1]].filter(Boolean).join(' ');
  }

  const llama = slug.match(/llama-?(\d+(?:\.\d+)?)?-?(\d+)b/i);
  if (llama) {
    return ['Llama', llama[1], `${llama[2]}B`].filter(Boolean).join(' ');
  }

  if (slug.includes('nemotron-trinity-plus')) {
    return 'TrinityPlus';
  }

  return titleSlug(slug)
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bApi\b/g, 'API')
    .replace(/\b(\d+)b\b/gi, '$1B');
}

function titleSlug(value) {
  return String(value || '')
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map(titleWord)
    .join(' ');
}

function titleWord(value) {
  const text = String(value || '');
  if (!text) return '';
  if (/^\d+(?:\.\d+)?$/.test(text)) return text;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
