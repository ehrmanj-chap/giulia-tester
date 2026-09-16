import { DEFAULT_BACKENDS } from './backend-defaults.js';

const $ = selector => document.querySelector(selector);

const AGENTS = {
  giulia: {
    name: 'Giulia',
    glyph: '🇮🇹',
    description: 'Italian cultural + business intelligence',
    backendHint: 'Giulia requires an explicit hosted backend URL. GitHub Pages is static and is never treated as the API.'
  },
  mei: {
    name: 'Mei',
    glyph: '🇯🇵',
    description: 'Japanese cultural + business intelligence',
    backendHint: 'Mei defaults to the hosted Vercel backend. You can override the URL here for testing.'
  }
};

const STORAGE_KEY = 'culturalAgentLab.connections.v1';
const agentSelect = $('#agentSelect');
const agentGlyph = $('#agentGlyph');
const agentName = $('#agentName');
const agentDescription = $('#agentDescription');
const backendStatus = $('#backendStatus');
const routeBadge = $('#routeBadge');
const backendUrl = $('#backendUrl');
const backendHint = $('#backendHint');
const labToken = $('#labToken');
const saveConnection = $('#saveConnection');
const clearConnection = $('#clearConnection');
const checkBackendButton = $('#checkBackend');
const messagesEl = $('#messages');
const form = $('#chatForm');
const input = $('#input');
const send = $('#send');
const resetChat = $('#resetChat');
const diagnostics = $('#diagnostics');

const histories = { giulia: [], mei: [] };
let selectedAgent = 'giulia';

function loadConnections() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      giulia: { base: saved.giulia?.base ?? DEFAULT_BACKENDS.giulia, token: saved.giulia?.token ?? localStorage.getItem('giuliaLabToken') ?? '' },
      mei: { base: saved.mei?.base || DEFAULT_BACKENDS.mei, token: saved.mei?.token ?? '' }
    };
  } catch {
    return {
      giulia: { base: DEFAULT_BACKENDS.giulia, token: '' },
      mei: { base: DEFAULT_BACKENDS.mei, token: '' }
    };
  }
}

let connections = loadConnections();

function persistConnections() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
}

function cleanBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function connection(agentId = selectedAgent) {
  return connections[agentId] || { base: DEFAULT_BACKENDS[agentId] || '', token: '' };
}

function resolvedBase(agentId = selectedAgent) {
  return connection(agentId).base || null;
}

function apiUrl(path, agentId = selectedAgent) {
  const base = resolvedBase(agentId);
  if (base === null) throw new Error(`${AGENTS[agentId].name} backend is not configured.`);
  return `${base}${path}`;
}

function apiHeaders(json = false, agentId = selectedAgent) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const token = connection(agentId).token;
  if (token) headers['X-Giulia-Lab-Token'] = token;
  return headers;
}

async function apiFetch(path, options = {}, agentId = selectedAgent) {
  const headers = { ...apiHeaders(Boolean(options.body), agentId), ...(options.headers || {}) };
  return fetch(apiUrl(path, agentId), { ...options, headers });
}

function setBackendState(text, tone = 'neutral') {
  backendStatus.textContent = text;
  backendStatus.className = `status-pill ${tone}`;
}

function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = content;
  messagesEl.appendChild(el);
}

function renderMessages() {
  messagesEl.innerHTML = '';
  const history = histories[selectedAgent];
  if (!history.length) {
    const note = document.createElement('div');
    note.className = 'system-note';
    note.textContent = `${AGENTS[selectedAgent].name} conversation ready.`;
    messagesEl.appendChild(note);
  } else {
    for (const message of history) addMessage(message.role, message.content);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function syncConnectionInputs() {
  const current = connection();
  backendUrl.value = current.base;
  labToken.value = current.token;
  backendHint.textContent = AGENTS[selectedAgent].backendHint;
}

function renderAgent() {
  const agent = AGENTS[selectedAgent];
  agentGlyph.textContent = agent.glyph;
  agentName.textContent = agent.name;
  agentDescription.textContent = agent.description;
  input.placeholder = `Ask ${agent.name}…`;
  routeBadge.classList.add('hidden');
  diagnostics.textContent = 'No run yet.';
  syncConnectionInputs();
  renderMessages();

  if (resolvedBase() === null) {
    setBackendState('Backend not configured', 'warn');
    send.disabled = true;
  } else {
    setBackendState('Not checked', 'neutral');
    send.disabled = false;
    checkBackend();
  }
}

async function checkBackend() {
  if (resolvedBase() === null) {
    setBackendState('Backend not configured', 'warn');
    send.disabled = true;
    return;
  }

  setBackendState('Checking…', 'neutral');
  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const culture = data.knowledge?.cultural?.documents ?? '?';
    const business = data.knowledge?.business?.documents ?? '?';
    setBackendState(`Connected · C ${culture} · B ${business}`, 'ok');
    send.disabled = false;
  } catch (error) {
    setBackendState(`Unavailable · ${error.message}`, 'bad');
    send.disabled = true;
  }
}

agentSelect.addEventListener('change', () => {
  selectedAgent = agentSelect.value;
  renderAgent();
  input.focus();
});

saveConnection.addEventListener('click', async () => {
  connections[selectedAgent] = {
    base: cleanBase(backendUrl.value) || DEFAULT_BACKENDS[selectedAgent] || '',
    token: labToken.value.trim()
  };
  persistConnections();
  syncConnectionInputs();
  await checkBackend();
});

clearConnection.addEventListener('click', () => {
  connections[selectedAgent] = {
    base: DEFAULT_BACKENDS[selectedAgent] || '',
    token: ''
  };
  persistConnections();
  syncConnectionInputs();
  renderAgent();
});

checkBackendButton.addEventListener('click', checkBackend);

resetChat.addEventListener('click', () => {
  histories[selectedAgent] = [];
  routeBadge.classList.add('hidden');
  diagnostics.textContent = 'No run yet.';
  renderMessages();
  input.focus();
});

input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || resolvedBase() === null) return;

  const agentAtSend = selectedAgent;
  histories[agentAtSend].push({ role: 'user', content: text });
  input.value = '';
  renderMessages();
  send.disabled = true;
  send.textContent = 'Thinking…';

  try {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messages: histories[agentAtSend] })
    }, agentAtSend);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    histories[agentAtSend].push({ role: 'assistant', content: data.reply });
    if (selectedAgent === agentAtSend) {
      routeBadge.textContent = `route: ${data.route ?? 'unknown'}`;
      routeBadge.classList.remove('hidden');
      diagnostics.textContent = JSON.stringify({ agent: agentAtSend, runId: data.runId, route: data.route, diagnostics: data.diagnostics }, null, 2);
      renderMessages();
    }
  } catch (error) {
    histories[agentAtSend].push({ role: 'assistant', content: `[Backend error] ${error.message}` });
    if (selectedAgent === agentAtSend) renderMessages();
  } finally {
    if (selectedAgent === agentAtSend) {
      send.disabled = resolvedBase() === null;
      send.textContent = 'Send';
      input.focus();
    }
  }
});

agentSelect.value = selectedAgent;
renderAgent();
