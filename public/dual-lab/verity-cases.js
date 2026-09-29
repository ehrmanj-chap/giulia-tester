const V = [
  s => `Explain ${s} in practical terms for a newcomer.`,
  s => `Give a concise factual account of ${s}, including the nuance people often miss.`,
  s => `What should I know about ${s} if I want to avoid stereotypes?`,
  s => `What is a common misunderstanding about ${s}, and how would you correct it?`,
  s => `Walk me through ${s}, including important limits or exceptions.`,
  s => `How would you explain ${s} to an American professional who wants accuracy rather than a travel-guide cliché?`,
  s => `What could someone get wrong in practice if they misunderstand ${s}?`,
  s => `Summarize the key points about ${s}; flag gaps in your knowledge instead of inventing specifics.`
];

const G = [
  ['cultural','campanilismo and strong local or city identity in Italy',['culture-003']],
  ['cultural','Italian regional languages and dialects, and why they are not simply accents of standard Italian',['culture-002']],
  ['cultural','the social meaning of Lei versus tu in Italian relationships',['culture-023']],
  ['cultural','a shift from buongiorno to ciao between Italian coworkers',['culture-023']],
  ['cultural','Italian dining etiquette and the difference between useful conventions and rigid rules',['culture-012','culture-019']],
  ['cultural','Italian family traditions and the continuing social importance of family ties',['culture-016','culture-017']],
  ['cultural','the Catholic Church’s cultural influence in Italy without assuming every Italian is observant',['culture-007']],
  ['cultural','Italian public-behaviour norms and expressive interaction in shared spaces',['culture-001']],
  ['cultural','Italian regional identity without reducing north and south to personality stereotypes',['culture-003']],
  ['cultural','Italian email etiquette, including formality and sign-offs',['culture-018']],
  ['business','the practical differences between an Italian SRL and SPA',[]],
  ['business','IRES and IRAP when budgeting for an Italian company',[]],
  ['business','Italian IVA or VAT obligations for a foreign company',[]],
  ['business','why a CCNL can matter in Italian employment relationships',[]],
  ['business','employee termination constraints and process in Italy',[]],
  ['business','market entry into Italy through Milan during the first 90 days',[]],
  ['business','the importance of SMEs to the structure of the Italian economy',[]],
  ['business','supplier due diligence before relying on an Italian supplier',[]],
  ['business','regional-government differences that can affect doing business in Italy',[]],
  ['business','governance and succession risks in Italian family-owned companies',[]],
  ['both','how campanilismo can affect supplier selection and regional market expansion',[]],
  ['both','how Italian family culture can interact with governance and succession in family-owned companies',[]],
  ['both','how Italian relationship-building norms can change a concrete supplier negotiation strategy',[]],
  ['out_of_scope','the weather forecast in Rome tomorrow',[]],
  ['out_of_scope','writing a Python script that scrapes restaurant reviews',[]]
];

const M = [
  ['cultural','the five-category keigo framework: sonkeigo, kenjōgo I, kenjōgo II or teichōgo, teineigo, and bikago',['workplace-japanese-keigo.md']],
  ['cultural','why contemporary keigo is relationship- and context-sensitive rather than a simple status ladder',['workplace-japanese-keigo.md']],
  ['cultural','common keigo overcorrection errors such as misusing humble forms or stacking honorifics',['workplace-japanese-keigo.md']],
  ['cultural','why highly polite Japanese wording can still communicate a firm refusal or constraint',['workplace-japanese-keigo.md']],
  ['cultural','layered participation in Shinto and Buddhism without assuming exclusive religious affiliation',['shinto-buddhism-spirituality.md']],
  ['cultural','the coexistence of shrine observance and Buddhist funeral customs in Japanese life',['shinto-buddhism-spirituality.md']],
  ['cultural','common Shinto shrine etiquette, including purification and the two-bows two-claps sequence',['shinto-buddhism-spirituality.md']],
  ['cultural','common Buddhist temple etiquette and why the Shinto clapping sequence should not be generalized to temples',['shinto-buddhism-spirituality.md']],
  ['cultural','why posted local rules at Japanese shrines and temples take precedence over generalized etiquette',['shinto-buddhism-spirituality.md']],
  ['cultural','the false premise that Japanese people must be exclusively Shinto or Buddhist',['shinto-buddhism-spirituality.md']],
  ['business','the continuing role of physical meishi in Japanese professional settings',['meishi-exchange.md']],
  ['business','respectful handling of a received meishi during a formal first meeting',['meishi-exchange.md']],
  ['business','why a dedicated cardholder is a safer default for meishi than a pocket or casual handling',['meishi-exchange.md']],
  ['business','the common Japanese meishi size of about 91 mm by 55 mm and why it is a printing detail rather than an etiquette law',['meishi-exchange.md']],
  ['business','how digital contact sharing supplements rather than universally replaces paper meishi',['meishi-exchange.md']],
  ['business','nemawashi as advance consultation and a no-surprises process before formal decisions',['nemawashi-ringi.md']],
  ['business','jizen-jumbi, jizen-tsūchi, and jizen-rikai in advance organizational preparation',['nemawashi-ringi.md']],
  ['business','ringi and the circulation or approval process around a ringisho proposal',['nemawashi-ringi.md']],
  ['business','the trade-off between slower pre-decision alignment and smoother implementation in nemawashi and ringi',['nemawashi-ringi.md']],
  ['business','why nemawashi and ringi should not be presented as universal across Japanese firms',['nemawashi-ringi.md']],
  ['both','how polite Japanese language can affect negotiation without implying that politeness means agreement',['workplace-japanese-keigo.md']],
  ['both','how meishi etiquette carrries cultural meaning and practical business consequences in a first meeting',['meishi-exchange.md']],
  ['both','how nemawashi connects Japanese communication norms with the sequencing of a business decision',['nemawashi-ringi.md']],
  ['out_of_scope','the weather forecast in Seoul tomorrow',[]],
  ['out_of_scope','writing a Python script that scrapes restaurant reviews',[]]
];

function expand(agent, rows) {
  return rows.flatMap(([route, subject, expectedSources], topic) => V.map((render, variant) => ({
    id: `${agent}-${String(topic + 1).padStart(2,'0')}-${variant + 1}`,
    agent,
    question: render(subject),
    expectedRoute: route,
    expectedSources,
    tags: ['verity-v1','rag',route,`variant-${variant + 1}`],
    reviewLens: ['factuality','grounding','retrieval','persona','prosody']
  })));
}

export function buildVerityCases() {
  const cases = [...expand('giulia', G), ...expand('mei', M)];
  const ids = new Set(cases.map(x => x.id));
  if (cases.length !== 400 || ids.size !== 400) throw new Error(`Verity invariant failed: ${cases.length}/${ids.size}`);
  return cases;
}

export const VERITY_META = Object.freeze({
  version: 'dual-verity-v1', total: 400, perAgent: 200,
  description: '400 isolated RAG and voice probes: 200 Giulia, 200 Mei.'
});
