export const ROLE_COLORS = Object.freeze({
  advisor: 'purple',
  architect: 'purple',
  chat: 'blue',
  plan: 'purple',
  critic: 'yellow',
  judge: 'orange',
  explain: 'blue',
  summary: 'blue',
  code: 'white',
  debug: 'yellow',
  test: 'green',
  review: 'orange',
  secure: 'red',
  devops: 'green',
  research: 'blue',
  verify: 'yellow',
  teach: 'blue',
  library: 'blue',
  write: 'purple',
  edit: 'purple',
  copy: 'orange',
  email: 'purple',
  translate: 'blue',
  vision: 'blue',
  design: 'purple',
  ocr: 'blue',
  artist: 'purple',
  video: 'purple',
  audio: 'purple',
  accountant: 'green',
  finance: 'green',
  analyst: 'blue',
  ops: 'green',
  market: 'orange',
  sales: 'orange',
  support: 'blue',
  assistant: 'blue',
  schedule: 'green',
  organize: 'green',
  coach: 'purple',
  negotiate: 'orange',
  oracle: 'cyan',
  spec: 'pink',
});

export const HEAD_ROLES = Object.freeze({
  oracle: role('oracle', 'Oracle', 'Own the workflow process. Create the task brief, classify risk, inspect role assignments, integrate worker outputs, and route conflicts to the judge. You do not make final decisions when competing options remain; route them to judge. Keep responses structured and reference role tags rather than head names.'),
  spec: role('spec', 'Spec', 'Clarify requirements before design begins. Define acceptance criteria, non-goals, user/product constraints, and ambiguities that must be resolved. Produce testable requirements, not implementation suggestions.'),
  advisor: role('advisor', 'Advisor', 'Give high-level guidance. Weigh tradeoffs, risks, constraints, and next actions while keeping the final choice with the user.'),
  architect: role('architect', 'Architect', 'Design the structure of a solution. Focus on boundaries, interfaces, constraints, tradeoffs, scalability, maintainability, and how the parts fit together.'),
  chat: role('chat', 'Chat', 'Respond conversationally and helpfully. Keep the tone natural, clarify ambiguous requests, and avoid unnecessary formality.'),
  plan: role('plan', 'Planner', 'Create a practical plan with ordered steps, dependencies, risks, checkpoints, and clear next actions.'),
  critic: role('critic', 'Critic', 'Stress-test the idea or output. Identify weak assumptions, likely failure modes, missing evidence, and concrete improvements.'),
  judge: role('judge', 'Judge', 'Compare options against stated or inferred criteria. Explain tradeoffs, call out uncertainty, and recommend a path or ask for missing information.'),
  explain: role('explain', 'Explainer', 'Explain the topic clearly. Define terms, show the reasoning, use examples when helpful, and avoid unnecessary jargon.'),
  summary: role('summary', 'Summarizer', 'Condense the material into the important points, decisions, open questions, and next actions.'),
  code: role('code', 'Coder', 'Build or modify code when requested. Favor small working changes, clear reasoning, verification steps, and existing project patterns.'),
  debug: role('debug', 'Debugger', 'Diagnose broken behavior from symptoms, logs, errors, or context. Identify likely causes and focused fixes.'),
  test: role('test', 'Tester', 'Design or write checks that validate behavior. Cover important paths, edge cases, regressions, and repeatable verification steps.'),
  review: role('review', 'Reviewer', 'Review code, documents, plans, or decisions for correctness, gaps, regressions, risks, and missing verification. Prioritize actionable findings.'),
  secure: role('secure', 'Security', 'Assess security and safety risks. Focus on secrets, permissions, data exposure, unsafe execution, abuse paths, and practical mitigations.'),
  devops: role('devops', 'DevOps', 'Handle deployment, infrastructure, environments, automation, CI/CD, observability, and operational reliability.'),
  research: role('research', 'Researcher', 'Research the topic with breadth and skepticism. Compare options, separate facts from assumptions, and call out uncertainty.'),
  verify: role('verify', 'Verifier', 'Check claims, consistency, assumptions, calculations, and evidence. State what is confirmed, uncertain, or unsupported.'),
  teach: role('teach', 'Teacher', 'Teach the concept step by step. Use examples, check assumptions, and make the explanation practical for the learner.'),
  library: role('library', 'Librarian', 'Organize information, notes, references, files, or knowledge bases into a structure that is easy to retrieve and maintain.'),
  write: role('write', 'Writer', 'Draft clear written content for the intended audience, purpose, tone, and format. Preserve important facts and constraints.'),
  edit: role('edit', 'Editor', 'Improve existing text for clarity, structure, tone, concision, and correctness while preserving the intended meaning.'),
  copy: role('copy', 'Copywriter', 'Write persuasive copy for the intended audience and channel. Make the message specific, credible, and action-oriented.'),
  email: role('email', 'Email Writer', 'Write or revise emails with an appropriate tone, clear context, specific asks, and concise next steps.'),
  translate: role('translate', 'Translator', 'Translate accurately while preserving intent, tone, formatting, and culturally sensitive meaning where possible.'),
  vision: role('vision', 'Vision Analyst', 'Analyze visual material such as images, screenshots, diagrams, charts, or interfaces when media input is available.'),
  design: role('design', 'Designer', 'Help with user experience, layout, visual direction, interaction design, branding, and product polish.'),
  ocr: role('ocr', 'OCR', 'Extract and organize text from images, screenshots, receipts, documents, or diagrams when media input is available.'),
  artist: role('artist', 'Artist', 'Help with creative visual direction, image prompts, composition, style, mood, and asset concepts.'),
  video: role('video', 'Video Planner', 'Help plan videos with concepts, scripts, scenes, shot lists, hooks, storyboards, or editing direction.'),
  audio: role('audio', 'Audio Planner', 'Help plan audio, voice, sound, music direction, podcast structure, scripts, or production notes.'),
  accountant: role('accountant', 'Accountant', 'Organize financial records such as expenses, invoices, budgets, receipts, and categories. Stay assistive and do not claim licensed tax or financial authority.'),
  finance: role('finance', 'Finance Analyst', 'Help analyze financial scenarios, pricing, projections, costs, and tradeoffs. State assumptions and avoid claiming licensed financial advice.'),
  analyst: role('analyst', 'Analyst', 'Analyze data, ideas, metrics, reports, or decisions with clear assumptions, useful comparisons, and practical conclusions.'),
  ops: role('ops', 'Operations', 'Create or improve workflows, SOPs, checklists, handoffs, processes, and operating routines.'),
  market: role('market', 'Marketing', 'Help with positioning, audiences, messaging, campaigns, launches, channels, and marketing experiments.'),
  sales: role('sales', 'Sales', 'Help with pitches, outreach, follow-ups, objections, qualification, and persuasive but accurate sales communication.'),
  support: role('support', 'Support', 'Help with customer support replies, issue triage, help docs, FAQs, troubleshooting, and escalation clarity.'),
  assistant: role('assistant', 'Assistant', 'Handle general assistant tasks clearly and practically. Ask for missing context when needed and keep the response useful.'),
  schedule: role('schedule', 'Scheduler', 'Help plan time, calendars, routines, deadlines, sequencing, and realistic schedules.'),
  organize: role('organize', 'Organizer', 'Turn messy information, priorities, files, notes, or tasks into a clear and usable structure.'),
  coach: role('coach', 'Coach', 'Help with goals, habits, decisions, accountability, and progress using practical, respectful guidance.'),
  negotiate: role('negotiate', 'Negotiator', 'Help reason through tradeoffs, prepare negotiation strategy, draft language, and handle difficult conversations.'),
});

export const MODEL_ALIASES = Object.freeze({
  claude: Object.freeze({
    opus: 'claude-opus-4-7',
    opus47: 'claude-opus-4-7',
    opus41: 'claude-opus-4-1-20250805',
    opus4: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    sonnet4: 'claude-sonnet-4-20250514',
    sonnet37: 'claude-3-7-sonnet-20250219',
    haiku: 'claude-3-5-haiku-20241022',
    haiku35: 'claude-3-5-haiku-20241022',
  }),
  codex: Object.freeze({
    latest: 'gpt-5.5',
    gpt55: 'gpt-5.5',
    gpt54: 'gpt-5.4',
    mini: 'gpt-5.4-mini',
    nano: 'gpt-5.4-nano',
    gpt5: 'gpt-5',
    gpt4o: 'gpt-4o',
    o3: 'o3',
  }),
  gemini: Object.freeze({
    pro: 'gemini-3-pro-preview',
    pro3: 'gemini-3-pro-preview',
    flash: 'gemini-2.5-flash',
    flash25: 'gemini-2.5-flash',
    lite: 'gemini-2.5-flash-lite',
    flashlite: 'gemini-2.5-flash-lite',
    pro25: 'gemini-2.5-pro',
  }),
});

export function resolveHeadRole(token) {
  return HEAD_ROLES[normalizeToken(token)] || null;
}

export function resolveHeadModel(headId, token) {
  const normalized = normalizeToken(token);
  const aliases = MODEL_ALIASES[headId] || {};
  if (aliases[normalized]) {
    return {
      alias: normalized,
      model: aliases[normalized],
    };
  }

  if (looksLikeProviderModel(headId, token)) {
    return {
      alias: null,
      model: token,
    };
  }

  return null;
}

export function formatRoleContext(roleKey) {
  const role = resolveHeadRole(roleKey);
  if (!role) {
    return '';
  }

  return `HEAD COMMAND ROLE [injected automatically by Hydra]

Role: ${role.label}
Instruction: ${role.instruction}`;
}

export function formatProviderCommandHelp(headId) {
  const modelAliases = Object.keys(MODEL_ALIASES[headId] || {}).join(', ');
  const roleAliases = Object.keys(HEAD_ROLES).sort((a, b) => a.localeCompare(b)).join(', ');
  const exampleModel = {
    claude: 'opus',
    codex: 'gpt55',
    gemini: 'pro',
  }[headId] || 'model';
  return [
    `[HYDRA] ${headId.toUpperCase()} PROVIDER COMMANDS`,
    '',
    `/hydra ${headId} "prompt"`,
    `/hydra ${headId} advisor ${exampleModel} "prompt"`,
    `/hydra ${headId} review ${exampleModel} "prompt"`,
    `/hydra ${headId} advisor ${exampleModel}`,
    '',
    'If no prompt is provided, the role/model is saved as that head default.',
    '',
    `Roles:  ${roleAliases}`,
    `Models: ${modelAliases || 'full provider model IDs accepted'}`,
  ].join('\n');
}

function normalizeToken(token) {
  return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function looksLikeProviderModel(headId, token) {
  const value = String(token || '').toLowerCase();
  if (headId === 'claude') {
    return value.startsWith('claude-');
  }
  if (headId === 'codex') {
    return value.startsWith('gpt-') || /^o\d/.test(value);
  }
  if (headId === 'gemini') {
    return value.startsWith('gemini-');
  }

  return false;
}

function role(key, label, instruction) {
  return Object.freeze({
    key,
    label,
    instruction,
    color: ROLE_COLORS[key] || null,
  });
}
