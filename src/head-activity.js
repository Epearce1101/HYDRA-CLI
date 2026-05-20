const activity = new Map();
const listeners = new Set();
const responseHistory = [];
const RESPONSE_HISTORY_LIMIT = 50;

export function markStart(headId, info = {}) {
  const now = Date.now();
  const previous = activity.get(headId) || {};
  activity.set(headId, {
    ...previous,
    inFlight: true,
    startedAt: now,
    endedAt: null,
    role: info.role || previous.role || null,
    model: info.model || previous.model || null,
    prompt: info.prompt || previous.prompt || null,
  });
  notify();
}

export function markEnd(headId, info = {}) {
  const now = Date.now();
  const previous = activity.get(headId) || {};
  activity.set(headId, {
    ...previous,
    inFlight: false,
    endedAt: now,
    lastDurationMs: previous.startedAt ? now - previous.startedAt : null,
    lastTokens: info.tokens ?? previous.lastTokens ?? null,
    lastPreview: info.preview || previous.lastPreview || null,
    lastText: info.text || previous.lastText || null,
    lastModel: info.model || previous.model || previous.lastModel || null,
    lastError: info.error || null,
  });
  if (info.text || info.error) {
    responseHistory.push({
      headId,
      at: now,
      prompt: info.prompt || previous.prompt || null,
      text: info.text || '',
      preview: info.preview || '',
      error: info.error || null,
      model: info.model || previous.model || previous.lastModel || null,
      tokens: info.tokens ?? null,
      durationMs: previous.startedAt ? now - previous.startedAt : null,
    });
    while (responseHistory.length > RESPONSE_HISTORY_LIMIT) {
      responseHistory.shift();
    }
  }
  notify();
}

export function recordSystemResponse({ prompt, text, error = null }) {
  responseHistory.push({
    headId: '_system',
    at: Date.now(),
    prompt: prompt || null,
    text: text || '',
    preview: '',
    error: error || null,
    model: null,
    tokens: null,
    durationMs: null,
  });
  while (responseHistory.length > RESPONSE_HISTORY_LIMIT) {
    responseHistory.shift();
  }
  notify();
}

export function getActivity(headId) {
  return activity.get(headId) || null;
}

export function getAllActivity() {
  return Object.fromEntries(activity.entries());
}

export function getRecentResponses(limit = 10) {
  if (!Number.isFinite(limit)) {
    return [...responseHistory];
  }
  return responseHistory.slice(-Math.max(0, limit));
}

export function resetActivity() {
  activity.clear();
  responseHistory.length = 0;
  notify();
}

export function subscribeActivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    try { listener(); } catch { /* ignore listener errors */ }
  }
}
