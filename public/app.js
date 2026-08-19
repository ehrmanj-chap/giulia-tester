const messagesEl = document.querySelector('#messages');
const form = document.querySelector('#chatForm');
const input = document.querySelector('#input');
const send = document.querySelector('#send');
const reset = document.querySelector('#reset');
const routeBadge = document.querySelector('#routeBadge');
const providerStatus = document.querySelector('#providerStatus');
const modelStatus = document.querySelector('#modelStatus');
const diagnosticsEl = document.querySelector('#diagnostics');
const downloadTrace = document.querySelector('#downloadTrace');
let history = [];

function addMessage(role, content) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = content;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const culture = data.knowledge?.cultural?.documents ?? '?';
    const business = data.knowledge?.business?.documents ?? '?';
    providerStatus.textContent = data.provider === 'mock' ? 'Mock brain connected' : 'Local Qwen connected';
    modelStatus.textContent = `provider=${data.provider} · model=${data.model} · router=${data.routerModel} · culture=${culture} docs · business=${business} docs`;
  } catch (error) {
    providerStatus.textContent = 'Local backend unavailable';
    modelStatus.textContent = error.message;
  }
}

reset.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '<div class="system-note">Conversation reset.</div>';
  diagnosticsEl.textContent = 'No run yet.';
  routeBadge.classList.add('hidden');
  input.focus();
});

downloadTrace.addEventListener('click', () => { window.location.href = '/api/runs/latest'; });
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
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    addMessage('assistant', data.reply);
    history.push({ role: 'assistant', content: data.reply });
    routeBadge.textContent = `route: ${data.route}`;
    routeBadge.classList.remove('hidden');
    diagnosticsEl.textContent = JSON.stringify({ runId: data.runId, route: data.route, diagnostics: data.diagnostics }, null, 2);
  } catch (error) {
    addMessage('assistant', `[Local backend error] ${error.message}`);
  } finally {
    send.disabled = false;
    send.textContent = 'Send';
    input.focus();
  }
});

checkStatus();
