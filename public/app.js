const $ = selector => document.querySelector(selector);
const messagesEl = $('#messages');
const form = $('#chatForm');
const input = $('#input');
const send = $('#send');
const reset = $('#reset');
const routeBadge = $('#routeBadge');
const providerStatus = $('#providerStatus');
const modelStatus = $('#modelStatus');
const diagnosticsEl = $('#diagnostics');
const downloadTrace = $('#downloadTrace');
const apiBaseInput = $('#apiBase');
const labTokenInput = $('#labToken');
const saveConnection = $('#saveConnection');
const clearConnection = $('#clearConnection');
const tabs = [...document.querySelectorAll('.tab')];
const chatPanel = $('#chatPanel');
const batchPanel = $('#batchPanel');
const batchFile = $('#batchFile');
const batchInput = $('#batchInput');
const concurrencyInput = $('#concurrency');
const loadBatch = $('#loadBatch');
const runBatch = $('#runBatch');
const stopBatch = $('#stopBatch');
const exportBatch = $('#exportBatch');
const clearBatch = $('#clearBatch');
const batchProgress = $('#batchProgress');
const batchSummary = $('#batchSummary');
const batchResults = $('#batchResults');

let history = [];
let queue = [];
let stopLaunching = false;

function cleanBase(value) { return (value || '').trim().replace(/\/$/, ''); }
function connection() {
  return {
    base: cleanBase(localStorage.getItem('giuliaApiBase') || ''),
    token: localStorage.getItem('giuliaLabToken') || ''
  };
}
function apiUrl(path) { const { base } = connection(); return `${base}${path}`; }
function apiHeaders(json = false) {
  const headers = {};
  if (json) headers['Content-Type'] = 'application/json';
  const { token } = connection();
  if (token) headers['X-Giulia-Lab-Token'] = token;
  return headers;
}
async function apiFetch(path, options = {}) {
  const headers = { ...apiHeaders(Boolean(options.body)), ...(options.headers || {}) };
  return fetch(apiUrl(path), { ...options, headers });
}
function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setConnectionInputs() {
  const { base, token } = connection();
  apiBaseInput.value = base;
  labTokenInput.value = token;
}
async function checkStatus() {
  providerStatus.textContent = 'Checking backend…';
  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const culture = data.knowledge?.cultural?.documents ?? '?';
    const business = data.knowledge?.business?.documents ?? '?';
    providerStatus.textContent = data.provider === 'mock' ? 'Mock brain connected' : 'Giulia backend connected';
    modelStatus.textContent = `provider=${data.provider} · model=${data.model} · router=${data.routerModel} · culture=${culture} docs · business=${business} docs`;
  } catch (error) {
    providerStatus.textContent = 'Backend unavailable';
    modelStatus.textContent = `${error.message}. Check Backend URL, token, CORS, and server status.`;
  }
}

saveConnection.addEventListener('click', async () => {
  localStorage.setItem('giuliaApiBase', cleanBase(apiBaseInput.value));
  localStorage.setItem('giuliaLabToken', labTokenInput.value.trim());
  await checkStatus();
});
clearConnection.addEventListener('click', async () => {
  localStorage.removeItem('giuliaApiBase');
  apiBaseInput.value = '';
  await checkStatus();
});

tabs.forEach(tab => tab.addEventListener('click', () => {
  tabs.forEach(t => t.classList.toggle('active', t === tab));
  const batch = tab.dataset.tab === 'batch';
  chatPanel.classList.toggle('hidden', batch);
  batchPanel.classList.toggle('hidden', !batch);
}));

reset.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '<div class="system-note">Conversation reset.</div>';
  diagnosticsEl.textContent = 'No run yet.';
  routeBadge.classList.add('hidden');
  input.focus();
});
downloadTrace.addEventListener('click', async () => {
  try {
    const res = await apiFetch('/api/runs/latest');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'giulia-latest-trace.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (error) { alert(`Trace download failed: ${error.message}`); }
});
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMessage('user', text);
  history.push({ role: 'user', content: text });
  input.value = '';
  send.disabled = true;
  send.textContent = 'Thinking…';
  try {
    const res = await apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: history }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    addMessage('assistant', data.reply);
    history.push({ role: 'assistant', content: data.reply });
    routeBadge.textContent = `route: ${data.route}`;
    routeBadge.classList.remove('hidden');
    diagnosticsEl.textContent = JSON.stringify({ runId: data.runId, route: data.route, diagnostics: data.diagnostics }, null, 2);
  } catch (error) { addMessage('assistant', `[Backend error] ${error.message}`); }
  finally { send.disabled = false; send.textContent = 'Send'; input.focus(); }
});

function normalizeQuestion(value) { return String(value ?? '').trim(); }
function makeItem(question, id = crypto.randomUUID()) {
  return { id, question: normalizeQuestion(question), status: 'queued', reply: '', route: null, runId: null, diagnostics: null, error: null, startedAt: null, finishedAt: null };
}
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(line => {
    const out = []; let current = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { current += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(current); current = ''; }
      else current += ch;
    }
    out.push(current); return out;
  });
  const header = rows[0].map(x => x.trim().toLowerCase());
  const qIndex = header.findIndex(x => ['question','prompt','message','query'].includes(x));
  const start = qIndex >= 0 ? 1 : 0;
  const index = qIndex >= 0 ? qIndex : 0;
  return rows.slice(start).map(row => normalizeQuestion(row[index])).filter(Boolean);
}
function parseJson(text) {
  const value = JSON.parse(text);
  const rows = Array.isArray(value) ? value : Array.isArray(value.questions) ? value.questions : [];
  return rows.map(item => typeof item === 'string' ? item : item?.question ?? item?.prompt ?? item?.message ?? item?.query).map(normalizeQuestion).filter(Boolean);
}
function questionsFromText(text) { return text.split(/\r?\n/).map(normalizeQuestion).filter(Boolean); }
function replaceQueue(questions) {
  queue = questions.map(q => makeItem(q));
  renderQueue();
}
function renderQueue() {
  batchResults.innerHTML = '';
  for (const item of queue) {
    const details = document.createElement('details');
    details.className = 'batch-item';
    if (item.status === 'done' || item.status === 'error') details.open = false;
    const summary = document.createElement('summary');
    const state = document.createElement('span'); state.className = `state ${item.status}`; state.textContent = item.status;
    const q = document.createElement('span'); q.className = 'q'; q.textContent = item.question;
    summary.append(state, q); details.append(summary);
    if (item.reply) { const answer = document.createElement('div'); answer.className = 'batch-answer'; answer.textContent = item.reply; details.append(answer); }
    const meta = document.createElement('div'); meta.className = 'batch-meta';
    meta.textContent = [item.route && `route=${item.route}`, item.runId && `runId=${item.runId}`, item.error && `error=${item.error}`].filter(Boolean).join(' · ');
    if (meta.textContent) details.append(meta);
    batchResults.append(details);
  }
  const done = queue.filter(x => ['done','error'].includes(x.status)).length;
  const running = queue.filter(x => x.status === 'running').length;
  batchProgress.max = Math.max(queue.length, 1); batchProgress.value = done;
  batchSummary.textContent = queue.length ? `${done}/${queue.length} finished · ${running} running · ${queue.filter(x => x.status === 'queued').length} queued` : 'No questions queued.';
  exportBatch.disabled = !queue.some(x => ['done','error'].includes(x.status));
}

loadBatch.addEventListener('click', () => replaceQueue(questionsFromText(batchInput.value)));
batchFile.addEventListener('change', async () => {
  const file = batchFile.files?.[0]; if (!file) return;
  const text = await file.text();
  try {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const questions = ext === 'json' ? parseJson(text) : ext === 'csv' ? parseCsv(text) : questionsFromText(text);
    replaceQueue(questions);
    batchInput.value = questions.join('\n');
  } catch (error) { alert(`Could not parse ${file.name}: ${error.message}`); }
});

async function runItem(item) {
  item.status = 'running'; item.startedAt = new Date().toISOString(); renderQueue();
  try {
    const res = await apiFetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: item.question }] }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    Object.assign(item, { status: 'done', reply: data.reply, route: data.route, runId: data.runId, diagnostics: data.diagnostics || null });
  } catch (error) { item.status = 'error'; item.error = error.message; }
  finally { item.finishedAt = new Date().toISOString(); renderQueue(); }
}
async function worker() {
  while (!stopLaunching) {
    const item = queue.find(x => x.status === 'queued');
    if (!item) return;
    await runItem(item);
  }
}
runBatch.addEventListener('click', async () => {
  if (!queue.length) replaceQueue(questionsFromText(batchInput.value));
  if (!queue.length) return;
  stopLaunching = false; runBatch.disabled = true; stopBatch.disabled = false;
  const concurrency = Math.max(1, Math.min(16, Number(concurrencyInput.value) || 4));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  runBatch.disabled = false; stopBatch.disabled = true; renderQueue();
});
stopBatch.addEventListener('click', () => { stopLaunching = true; stopBatch.disabled = true; batchSummary.textContent += ' · stopping after current requests'; });
clearBatch.addEventListener('click', () => { stopLaunching = true; queue = []; batchInput.value = ''; batchFile.value = ''; renderQueue(); });
exportBatch.addEventListener('click', () => {
  const payload = { exportedAt: new Date().toISOString(), backend: connection().base || location.origin, count: queue.length, results: queue };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `giulia-batch-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; a.click(); URL.revokeObjectURL(a.href);
});

setConnectionInputs();
renderQueue();
checkStatus();
