import { MEI_TOPICS } from './mei-topics.js';
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

const MEI_EDGE_CASES = [
 ['both','How can polite Japanese language affect a negotiation without implying agreement?'],
 ['both','What does meishi exchange communicate culturally during a business meeting?'],
 ['both','How do nemawashi and indirect communication change the sequence of a business decision?'],
 ['both','How can I decline workplace nomikai without damaging relationships?'],
 ['both','How should a foreign intern handle keigo when disagreeing with a manager?'],
 ['both','How can regional communication differences affect a business meeting in Osaka?'],
 ['both','How do gift-giving customs apply to a professional client relationship?'],
 ['both','How do hierarchy and social expectations affect Japanese workplace decisions?'],
 ['both','What should a manager understand about LGBTQ inclusion and daily social interactions at work?'],
 ['business','What work-permission conditions should a student verify before accepting a part-time job in Japan?'],
 ['business','Is nemawashi mandatory in every Japanese company? Explain the limits of that premise.'],
 ['business','Do digital contact tools universally replace paper meishi at formal business meetings?'],
 ['business','How would you verify current yen exchange rates before making a business budget?'],
 ['business','Can you guarantee that my proposed internship meets Japanese visa requirements?'],
 ['cultural','Must Japanese people identify exclusively as either Shinto or Buddhist?'],
 ['cultural','Do shrine clapping customs also apply at Buddhist temples?'],
 ['cultural','Are all Japanese people indirect? Explain without stereotyping individuals.'],
 ['cultural','Can I assume every Japanese person speaks the same regional dialect?'],
 ['cultural','What information is missing before recommending accessible transportation for a wheelchair user?'],
 ['cultural','What should a newcomer do if posted shrine rules differ from general etiquette advice?'],
 ['out_of_scope','Write a Python script to scrape restaurant reviews.'],
 ['out_of_scope','Give me the weather forecast in Seoul tomorrow.'],
 ['out_of_scope','Debug my JavaScript code.']
];
function meiCases(){
 const topicCases=MEI_TOPICS.flatMap((topic,i)=>[
   `Explain ${topic.topic} in Japan${topic.domain==='business'?' in a business or professional context':' in everyday life'}, using the research available to you. Include practical limits and avoid stereotypes.`,
   `For someone new to Japan, what are the most important details about ${topic.topic}${topic.domain==='business'?' in a business or professional context':' in everyday life'}? Flag information that needs current verification.`
 ].map((question,j)=>({id:`mei-topic-${String(i+1).padStart(2,'0')}-${j+1}`,agent:'mei',question,expectedRoute:topic.domain,acceptableRoutes:[topic.domain,'both'],expectedSources:topic.sourceIds,tags:['verity-v2','rag',topic.domain,`topic-${i+1}`],reviewLens:['factuality','grounding','retrieval','persona','prosody']})));
 const edges=MEI_EDGE_CASES.flatMap(([route,question],i)=>[question,`${question} Please explain your reasoning briefly and be candid about uncertainty.`].map((question,j)=>({id:`mei-edge-${String(i+1).padStart(2,'0')}-${j+1}`,agent:'mei',question,expectedRoute:route,expectedSources:[],tags:['verity-v2','boundary',route],reviewLens:['factuality','grounding','retrieval','persona','prosody']})));
 return [...topicCases,...edges];
}

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
  const cases = [...expand('giulia', G), ...meiCases()];
  const ids = new Set(cases.map(x => x.id));
  if (cases.length !== 400 || ids.size !== 400) throw new Error(`Verity invariant failed: ${cases.length}/${ids.size}`);
  return cases;
}

export const VERITY_META = Object.freeze({
  version: 'dual-verity-v2', requiredMeiCorpus: 'mei-drive-2026-09-29', total: 400, perAgent: 200,
  description: '400 isolated RAG and voice probes: 200 Giulia, 200 Mei across 77 research topics plus boundary cases.'
});
