import { latestUserMessage } from './utils.mjs';

function routeFor(text) {
  const t = text.toLowerCase();
  const italy = /(italy|italian|milan|rome|naples|bologna|florence|venice|sicily|sardinia|turin|tuscany)/.test(t);
  if (!italy) return 'out_of_scope';
  const business = /(work|manager|meeting|office|intern|company|business|contract|gdp|econom|tax|client|professional|market|salary|labor|labour|trade|fdi)/.test(t);
  const cultural = /(culture|etiquette|family|friend|dating|gesture|religion|language|dialect|social|restaurant|dinner|greeting|tradition|regional|naples|milan|bologna|rome|italian)/.test(t);
  if (business && cultural) return 'both';
  if (business) return 'business';
  if (cultural) return 'cultural';
  return 'out_of_scope';
}

export class MockProvider {
  constructor(config) { this.config = config; this.name = 'mock'; }
  async complete({ messages, model = 'mock-model' }) {
    const system = String(messages?.[0]?.content || '');
    const user = latestUserMessage(messages);
    const conversationText = messages.filter(m => m?.role !== 'system').map(m => String(m.content || '')).join('\n');
    let content;
    if (system.includes('ROUTER_GIULIA')) {
      const route = routeFor(conversationText);
      content = JSON.stringify({ route, confidence: route === 'out_of_scope' ? 0.78 : 0.91, reason: 'mock deterministic keyword routing' });
    } else if (system.includes('SYNTHESIS_GIULIA')) content = `Mock unified Giulia synthesis for: ${user}`;
    else if (system.includes('CULTURAL_GIULIA')) content = `Mock Cultural Giulia answer for: ${user}`;
    else if (system.includes('BUSINESS_GIULIA')) content = `Mock Business Giulia answer for: ${user}`;
    else content = `Mock Giulia answer for: ${user}`;
    return { content, model, usage: { mock: true }, latencyMs: 1, rawId: null };
  }
}
