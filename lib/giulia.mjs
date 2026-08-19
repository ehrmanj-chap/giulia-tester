import { loadPrompts, loadKnowledge } from './loaders.mjs';
import { retrieveKnowledge } from './retrieval.mjs';
import { createTrace, recordCall, writeTrace } from './trace.mjs';
import { safeJsonParse, latestUserMessage } from './utils.mjs';

const VALID_ROUTES = new Set(['cultural', 'business', 'both', 'out_of_scope']);

function activeModels(config) {
  return config.provider === 'ollama'
    ? { model: config.ollama.model, routerModel: config.ollama.routerModel }
    : { model: config.qwen.model, routerModel: config.qwen.routerModel };
}

function composeSpecialistSystem({ core, specialist, marker, knowledge }) {
  return `${marker}\n\n${core}\n\n${specialist}\n\nRETRIEVED APPROVED KNOWLEDGE:\n${knowledge || '(No directly relevant knowledge-base passage was retrieved for this turn.)'}`;
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

function retrievalQuery(messages) {
  return messages.filter(m => m.role === 'user').slice(-3).map(m => m.content).join('\n');
}

function routeFallback(messages) {
  const userTurns = messages.filter(m => m.role === 'user').slice(-3).map(m => m.content);
  const current = (userTurns.at(-1) || '').toLowerCase();
  if (/\b(?:weather|forecast|visa|hotel availability|train schedule|flight schedule)\b/.test(current)) return 'out_of_scope';
  const context = userTurns.join(' ').toLowerCase();
  const italy = /(italy|italian|italia|milan|milano|rome|roma|bologna|naples|napoli|turin|torino|florence|firenze|venice|venezia|sicily|sicilia|sardinia|sardegna|tuscany|toscana|lombardy|lombardia|piedmont|piemonte|veneto|emilia|calabria|puglia|liguria)/.test(context);
  if (!italy) return 'out_of_scope';

  const business = /\b(?:business|work|workplace|manager|meeting|company|contract|gdp|economy|economic|tax|client|professional|market|labor|labour|trade|intern|office|employment|investment|supplier|legal|law|compliance|salary|hiring|negotiation|negotiations|corporate|srl|spa|vat|iva|governance|succession|companies|ownership)\b|regulat/.test(context);
  const cultural = /(culture|etiquette|family|social|language|dialect|gesture|tradition|religion|regional|food|custom|dating|conversation|greeting|church|catholic|campanilismo|bella figura|dining|dress|foreigners|festival|biennale|relationship|relationship-building)/.test(context);

  const explicitMixed = /(culture|social|regional|family|campanilismo|bella figura|etiquette|relationship|relationship-building).*(business|company|companies|supplier|market|negotiat|workplace|manager|governance|succession|ownership)|(?:business|company|companies|supplier|market|negotiat|workplace|manager|governance|succession|ownership).*(culture|social|regional|family|campanilismo|bella figura|etiquette|relationship|relationship-building)/.test(current);
  if (business && cultural && explicitMixed) return 'both';
  if (business) return 'business';
  if (cultural) return 'cultural';
  return 'cultural';
}

function unavailableReply(route) {
  if (route === 'business') {
    return 'This internal test build routed your question to the business side, but the Business knowledge corpus is not loaded yet. The router is working; the business evidence layer is intentionally unavailable until that corpus is added.';
  }
  if (route === 'cultural') {
    return 'This internal test build routed your question to the cultural side, but the Cultural knowledge corpus is not loaded.';
  }
  return 'The knowledge corpus required for this routed answer is not loaded in this internal test build yet.';
}

export function createGiulia({ config, provider }) {
  function loadState() {
    const culturalKb = loadKnowledge(config, 'cultural');
    const businessKb = loadKnowledge(config, 'business');
    return {
      culturalKb,
      businessKb,
      available: {
        cultural: culturalKb.documents.length > 0,
        business: businessKb.documents.length > 0
      }
    };
  }

  return {
    status() {
      const { culturalKb, businessKb, available } = loadState();
      return {
        available,
        cultural: { documents: culturalKb.documents.length, chunks: culturalKb.index.count, chars: culturalKb.chars, sha256: culturalKb.sha256 },
        business: { documents: businessKb.documents.length, chunks: businessKb.index.count, chars: businessKb.chars, sha256: businessKb.sha256 }
      };
    },

    async chat(rawMessages) {
      const messages = sanitizeMessages(rawMessages);
      if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('A conversation ending with a user message is required.');

      const models = activeModels(config);
      const { prompts, meta: promptMeta } = loadPrompts(config);
      const { culturalKb, businessKb, available } = loadState();
      const knowledgeMeta = {
        cultural: { sha256: culturalKb.sha256, chars: culturalKb.chars, files: culturalKb.documents.map(d => d.file), chunks: culturalKb.index.count, available: available.cultural },
        business: { sha256: businessKb.sha256, chars: businessKb.chars, files: businessKb.documents.map(d => d.file), chunks: businessKb.index.count, available: available.business }
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
        const route = VALID_ROUTES.has(parsed.route) ? parsed.route : routeFallback(messages);
        trace.route = {
          choice: route,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
          reason: typeof parsed.reason === 'string' ? parsed.reason : 'Router output required fallback parsing.',
          availability: { ...available }
        };

        if (route === 'out_of_scope') {
          const reply = "I’m designed specifically for Italian cultural and business intelligence. If you connect the question meaningfully to Italy, I can help within that scope.";
          trace.final = { reply, route };
          writeTrace(config, trace);
          return { reply, route, trace };
        }

        const query = retrievalQuery(messages);

        const callCultural = async () => {
          if (!available.cultural) return null;
          const retrieved = retrieveKnowledge(culturalKb, query);
          const result = await provider.complete({
            model: models.model,
            temperature: 0.25,
            messages: [
              { role: 'system', content: composeSpecialistSystem({ core: prompts.core, specialist: prompts.cultural, marker: 'CULTURAL_GIULIA', knowledge: retrieved.compiled }) },
              ...messages
            ]
          });
          recordCall(trace, 'cultural', result, { knowledgeSha256: culturalKb.sha256, retrieval: retrieved.selected });
          return result.content;
        };

        const callBusiness = async () => {
          if (!available.business) return null;
          const retrieved = retrieveKnowledge(businessKb, query);
          const result = await provider.complete({
            model: models.model,
            temperature: 0.25,
            messages: [
              { role: 'system', content: composeSpecialistSystem({ core: prompts.core, specialist: prompts.business, marker: 'BUSINESS_GIULIA', knowledge: retrieved.compiled }) },
              ...messages
            ]
          });
          recordCall(trace, 'business', result, { knowledgeSha256: businessKb.sha256, retrieval: retrieved.selected });
          return result.content;
        };

        let reply;
        if (route === 'cultural') {
          reply = available.cultural ? await callCultural() : unavailableReply('cultural');
        } else if (route === 'business') {
          reply = available.business ? await callBusiness() : unavailableReply('business');
        } else if (available.cultural && available.business) {
          const [culturalDraft, businessDraft] = await Promise.all([callCultural(), callBusiness()]);
          const synthesisResult = await provider.complete({
            model: models.model,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: `SYNTHESIS_GIULIA\n\n${prompts.core}\n\n${prompts.synthesis}\n\nMerge the two internal drafts into one seamless answer. Never mention routing, specialists, drafts, or internal architecture.`
              },
              { role: 'user', content: `Original user message:\n${latestUserMessage(messages)}\n\nCULTURAL DRAFT:\n${culturalDraft}\n\nBUSINESS DRAFT:\n${businessDraft}` }
            ]
          });
          recordCall(trace, 'synthesis', synthesisResult);
          reply = synthesisResult.content;
        } else if (available.cultural) {
          const culturalDraft = await callCultural();
          reply = `${culturalDraft}\n\n[Internal test note: this request also needs Business Giulia, but the Business corpus is not loaded yet. The answer above contains only the cultural portion.]`;
        } else if (available.business) {
          const businessDraft = await callBusiness();
          reply = `${businessDraft}\n\n[Internal test note: this request also needs Cultural Giulia, but the Cultural corpus is not loaded.]`;
        } else {
          reply = unavailableReply('both');
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
