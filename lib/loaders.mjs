import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sha256 } from './utils.mjs';
import { buildKnowledgeIndex } from './retrieval.mjs';

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv', '.html']);
const IGNORED_BASENAMES = new Set(['README.md']);

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
    else if (entry.isFile() && (entry.name.toLowerCase().endsWith('.json.gz') || TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) && !IGNORED_BASENAMES.has(entry.name)) out.push(full);
  }
  return out.sort();
}

function titleFromText(text, fallback) {
  const m = String(text || '').match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

function expandFile(config, file) {
  const rel = path.relative(config.rootDir, file);
  const lower = file.toLowerCase();
  const text = lower.endsWith('.json.gz')
    ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')
    : fs.readFileSync(file, 'utf8');
  if (lower.endsWith('.json') || lower.endsWith('.json.gz')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.giulia_batch === true && Array.isArray(parsed.documents)) {
        return parsed.documents.map((doc, index) => ({
          file: `${rel}#${doc.id || index + 1}`,
          containerFile: rel,
          sourcePdf: doc.source_pdf || null,
          sourceSha256: doc.sha256 || null,
          title: doc.title || doc.id || `${path.basename(file)} item ${index + 1}`,
          text: String(doc.text || '')
        }));
      }
    } catch {}
  }
  return [{ file: rel, containerFile: rel, sourcePdf: null, sourceSha256: null, title: titleFromText(text, path.basename(file)), text }];
}

export function loadKnowledge(config, division) {
  const dir = path.join(config.knowledgeDir, division);
  const files = walkTextFiles(dir);
  const documents = files.flatMap(file => expandFile(config, file));
  const corpusFingerprint = documents.map(doc => `===== ${doc.file} =====\n${doc.text}`).join('\n\n');
  const index = buildKnowledgeIndex(documents);
  return { division, documents, index, sha256: sha256(corpusFingerprint), chars: corpusFingerprint.length };
}
