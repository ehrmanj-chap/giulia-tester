import { loadPrompts, loadKnowledge } from './loaders.mjs';
import { createTrace, recordCall, writeTrace } from './trace.mjs';
import { safeJsonParse, latestUserMessage } from './utils.mjs';

const VALID_ROUTES = new Set(['cultural', 'business', 'both', 'out_of_scope']);

function activeModels(config) {
  return config.provider === 'ollama'
    ? { model: config.ollama.model, routerModel: config.ollama.routerModel }
    : { model: config.qwen.model, routerModel: config.qwen.routerModel };
}

function composeSpecialistSystem({ core, specialist, marker, knowledge }) {
  return `${marker}\n\n${core}\n\n${specialist}\n\nAPPROVED KNOWLEDGE BASE:\n${knowledge || '(Knowledge base placeholder is currently empty.)'}`;
}

function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content }))
    .slice(-40);
}

function buildRouterMessages(prompt, conversation) {
  return [{ role: 'system', content: `ROUTER_GIULIA\n\n${prompt}` }, ...conversation];
}

function routeFallback(text) {
  const t = text.toLowerCase();
  const italy = /(italy|italian|italia|milan|milano|rome|roma|bologna|naples|napoli|turin|torino|florence|firenze|sicily|sicilia|sardinia|sardegna)/.test(t);
  if (!italy) return 'out_of_scope';
  const biz = /(business|work|manager|meeting|company|contract|gdp|econom|tax|client|professional|market|labor|labour|trade|intern|office|employment)/.test(t);
  const cul = /(culture|etiquette|family|social|language|dialect|gesture|tradition|religion|regional|food|custom|dating|conversation)/.test(t);
  if (biz && cul) return 'both';
  if (biz) return 'business';
  if (cul) return 'cultural';
  return 'cultural';
}

export function createGiulia({ config, provider }) {
  return {
    async chat(rawMessages) {
      const messages = sanitizeMessages(rawMessages);
      if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('A conversation ending with a user message is required.');

      const models = activeModels(config);
      const { prompts, meta: promptMeta } = loadPrompts(config);
      const culturalKb = loadKnowledge(config, 'cultural');
      const businessKb = loadKnowledge(config, 'business');
      const knowledgeMeta = {
        cultural: { sha256: culturalKb.sha256, chars: culturalKb.chars, files: culturalKb.documents.map(d => d.file) },
        business: { sha256: businessKb.sha256, chars: businessKb.chars, files: businessKb.documents.map(d => d.file) }
      };
      const trace = createTrace({ provider: provider.name, messages, promptMeta, knowledgeMeta });

      try {
        const routerResult = await provider.complete({
          model: models.routerModel,
          temperature: 0,
          json: true,
          messages: buildRouterMessages(prompts.router, messages)
        });
        recordCall(trace, 'router', routerResult);
        const parsed = safeJsonParse(routerResult.content) || {};
        const route = VALID_ROUTES.has(parsed.route) ? parsed.route : routeFallback(latestUserMessage(messages));
        trace.route = {
          choice: route,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          reason: typeof parsed.reason === 'string' ? parsed.reason : 'Router output required fallback parsing.'
        };

        if (route === 'out_of_scope') {
          const reply = "I’m designed specifically for Italian cultural and business contexts. If you connect the question to Italy, I can help within that scope.";
          trace.final = { reply, route };
          writeTrace(config, trace);
          return { reply, route, trace };
        }

        const callCultural = async () => {
          const result = await provider.complete({
            model: models.model,
            temperature: 0.25,
            messages: [
              { role: 'system', content: composeSpecialistSystem({ core: prompts.core, specialist: prompts.cultural, marker: 'CULTURAL_GIULIA', knowledge: culturalKb.compiled }) },
              ...messages
            ]
          });
          recordCall(trace, 'cultural', result, { knowledgeSha256: culturalKb.sha256 });
          return result.content;
        };

        const callBusiness = async () => {
          const result = await provider.complete({
            model: models.model,
            temperature: 0.25,
            messages: [
              { role: 'system', content: composeSpecialistSystem({ core: prompts.core, specialist: prompts.business, marker: 'BUSINESS_GIULIA', knowledge: businessKb.compiled }) },
              ...messages
            ]
          });
          recordCall(trace, 'business', result, { knowledgeSha256: businessKb.sha256 });
          return result.content;
        };

        let reply;
        if (route === 'cultural') reply = await callCultural();
        else if (route === 'business') reply = await callBusiness();
        else {
          const [culturalDraft, businessDraft] = await Promise.all([callCultural(), callBusiness()]);
          const synthesisResult = await provider.complete({
            model: models.model,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: `SYNTHESIS_GIULIA\n\n${prompts.core}\n\n${prompts.synthesis}\n\nYou are merging two internal specialist drafts into one seamless Giulia response. Never mention routing, specialists, drafts, or internal architecture.`
              },
              { role: 'user', content: `Original user message:\n${latestUserMessage(messages)}\n\nCULTURAL DRAFT:\n${culturalDraft}\n\nBUSINESS DRAFT:\n${businessDraft}` }
            ]
          });
          recordCall(trace, 'synthesis', synthesisResult);
          reply = synthesisResult.content;
        }

        trace.final = { reply, route };
        writeTrace(config, trace);
        return { reply, route, trace };
      } catch (error) {
        trace.errors.push({ message: error.message, name: error.name });
        writeTrace(config, trace);
        throw error;
      }
    }
  };
}
