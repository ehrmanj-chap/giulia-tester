import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './utils.mjs';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.html']);

export function readTextFile(file, fallback = '') {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback;
}

export function loadPrompts(config) {
  const names = ['core', 'router', 'cultural', 'business', 'synthesis'];
  const prompts = {};
  const meta = {};
  for (const name of names) {
    const file = path.join(config.promptsDir, `${name}.md`);
    const text = readTextFile(file, '');
    prompts[name] = text;
    meta[name] = { file: path.relative(config.rootDir, file), sha256: sha256(text), chars: text.length };
  }
  return { prompts, meta };
}

function walkTextFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTextFiles(full));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out.sort();
}

export function loadKnowledge(config, division) {
  const dir = path.join(config.knowledgeDir, division);
  const files = walkTextFiles(dir);
  const documents = files.map(file => ({ file: path.relative(config.rootDir, file), text: fs.readFileSync(file, 'utf8') }));
  const compiled = documents.map(doc => `\n\n===== SOURCE: ${doc.file} =====\n${doc.text}`).join('');
  return { division, documents, compiled, sha256: sha256(compiled), chars: compiled.length };
}
