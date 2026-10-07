import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const app=fs.readFileSync(root+'/public/dual-lab/app.js','utf8');
const css=fs.readFileSync(root+'/public/dual-lab/styles.css','utf8');

test('dual lab exposes real route progress in its thinking indicator',()=>{
  assert.ok(app.includes("'Accept':'application/x-ndjson'"));
  assert.ok(app.includes("Thinking about ${country} culture"));
  assert.ok(app.includes("Thinking about ${country} business"));
  assert.ok(app.includes("className='thinking-dots'"));
  assert.ok(css.includes('@keyframes thinkingPulse'));
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
});
