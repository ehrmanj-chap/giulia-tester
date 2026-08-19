import crypto from 'node:crypto';

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function nowId() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `${iso}-${crypto.randomBytes(3).toString('hex')}`;
}

export function safeJsonParse(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function latestUserMessage(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}
