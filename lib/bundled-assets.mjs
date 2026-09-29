import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Literal file URLs let Vercel's dependency tracer include the runtime assets.
// Keep these entries aligned with the approved corpus and persona files.
export const bundledPrompts = {
  core: () => fs.readFileSync(new URL('../prompts/core.md', import.meta.url), 'utf8'),
  router: () => fs.readFileSync(new URL('../prompts/router.md', import.meta.url), 'utf8'),
  cultural: () => fs.readFileSync(new URL('../prompts/cultural.md', import.meta.url), 'utf8'),
  business: () => fs.readFileSync(new URL('../prompts/business.md', import.meta.url), 'utf8'),
  synthesis: () => fs.readFileSync(new URL('../prompts/synthesis.md', import.meta.url), 'utf8')
};
export const bundledCorpora = {
  cultural: {file:'knowledge/cultural/culture-corpus.json', read:() => fs.readFileSync(new URL('../knowledge/cultural/culture-corpus.json', import.meta.url), 'utf8')},
  business: {file:'knowledge/business/business-corpus.json.gz', read:() => gunzipSync(fs.readFileSync(new URL('../knowledge/business/business-corpus.json.gz', import.meta.url))).toString('utf8')}
};
