const STOP = new Set([
  'a','an','and','are','as','at','be','been','but','by','can','could','do','does','for','from','had','has','have','how','i','if','in','into','is','it','its','may','more','most','not','of','on','or','our','should','so','than','that','the','their','then','there','these','they','this','to','was','we','were','what','when','where','which','who','why','will','with','would','you','your',
  'al','alla','anche','che','con','da','dal','dalla','dei','del','della','di','e','gli','i','il','in','la','le','lo','ma','nel','nella','o','per','si','sono','su','tra','un','una'
]);

export function tokenize(text = '') {
  return [...String(text).toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)]
    .map(m => m[0].replace(/[’]/g, "'"))
    .filter(t => t.length > 1 && !STOP.has(t));
}

export function chunkText(text, { targetChars = 1800, overlapChars = 220 } = {}) {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) return [];
  const paras = normalized.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const p of paras) {
    if (current && current.length + p.length + 2 > targetChars) {
      chunks.push(current.trim());
      const tail = current.slice(Math.max(0, current.length - overlapChars));
      current = `${tail}\n\n${p}`;
    } else {
      current += `${current ? '\n\n' : ''}${p}`;
    }
    while (current.length > targetChars * 1.8) {
      chunks.push(current.slice(0, targetChars).trim());
      current = current.slice(Math.max(0, targetChars - overlapChars)).trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function buildKnowledgeIndex(documents) {
  const chunks = [];
  for (const doc of documents) {
    const title = doc.title || doc.file;
    chunkText(doc.text).forEach((text, i) => {
      const tokens = tokenize(`${title} ${doc.file} ${text}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      chunks.push({ file: doc.file, title, chunk: i + 1, text, tokens, tf });
    });
  }
  const df = new Map();
  for (const chunk of chunks) {
    for (const t of new Set(chunk.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  return { chunks, df, count: chunks.length };
}

export function retrieveKnowledge(kb, query, { maxChunks = 6, maxChars = 10500 } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !kb?.index?.chunks?.length) return { compiled: '', selected: [], query };
  const qSet = new Set(qTokens);
  const N = kb.index.chunks.length;
  const phrase = String(query || '').toLowerCase().trim();
  const scored = kb.index.chunks.map(chunk => {
    let score = 0;
    const hayTitle = `${chunk.title} ${chunk.file}`.toLowerCase();
    const hayText = chunk.text.toLowerCase();
    for (const t of qSet) {
      const tf = chunk.tf.get(t) || 0;
      if (!tf) continue;
      const df = kb.index.df.get(t) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += idf * (1 + Math.log(1 + tf));
      if (hayTitle.includes(t)) score += idf * 1.7;
    }
    if (phrase.length >= 8 && hayText.includes(phrase)) score += 8;
    return { ...chunk, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score);

  const selected = [];
  let chars = 0;
  const perFile = new Map();
  for (const item of scored) {
    if (selected.length >= maxChunks) break;
    const seen = perFile.get(item.file) || 0;
    if (seen >= 2) continue;
    const cost = item.text.length + item.file.length + 80;
    if (selected.length && chars + cost > maxChars) continue;
    selected.push(item);
    perFile.set(item.file, seen + 1);
    chars += cost;
  }

  const compiled = selected.map(item =>
    `===== SOURCE: ${item.file} | CHUNK ${item.chunk} | retrieval_score=${item.score.toFixed(3)} =====\n${item.text}`
  ).join('\n\n');
  return {
    query,
    compiled,
    selected: selected.map(({ file, title, chunk, score, text }) => ({ file, title, chunk, score, chars: text.length }))
  };
}
