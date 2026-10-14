import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  OnDeviceKokoro, SEED_PROFILES, BROWSER_KOKORO_LANGUAGES,
  blendStyleRow, normalizeStyles, encodePcm16Wav, normalizeItalianIPA,
} from '../public/dual-lab/voice/browser-kokoro.js';

test('original public Giulia and Mei Kokoro seed blends remain separate and correctly weighted', () => {
  const giulia = SEED_PROFILES['giulia-blend'], mei = SEED_PROFILES['mei-blend'];
  assert.equal(giulia.agent, 'giulia');
  assert.deepEqual(giulia.styles.map(x => x.name), ['if_sara', 'af_heart']);
  assert.deepEqual(giulia.styles.map(x => x.weight), [.65, .35]);
  assert.equal(mei.agent, 'mei');
  assert.deepEqual(mei.styles.map(x => x.name), ['jf_alpha', 'jf_nezumi']);
  assert.deepEqual(mei.styles.map(x => x.weight), [.60, .40]);
  assert.deepEqual(BROWSER_KOKORO_LANGUAGES, ['en-us', 'en-gb', 'it', 'ja']);
});
test('styles are blended per phoneme length as 256D vectors, not waveform mixing', () => {
  const n = 510 * 256;
  const first = new Float32Array(n).fill(4);
  const second = new Float32Array(n).fill(12);
  // Make row 18 differ from other rows.
  first.fill(8, 18 * 256, 19 * 256);
  const sources = new Map([['jf_alpha', first], ['jf_nezumi', second]]);
  const style = blendStyleRow(SEED_PROFILES['mei-blend'].styles, sources, 18);
  assert.equal(style.length, 256);
  assert.ok(Math.abs(style[0] - (8 * .6 + 12 * .4)) < 1e-5);
  assert.ok(Math.abs(blendStyleRow(SEED_PROFILES['mei-blend'].styles, sources, 1)[0] - (4 * .6 + 12 * .4)) < 1e-5);
});
test('reject malformed style definitions instead of silently changing voice identity', () => {
  for (const sample of [
    [{ name: '../../private', weight: 1 }],
    [{ name: 'af_heart', weight: 0 }],
    [{ name: 'af_heart', weight: Infinity }],
    [],
  ]) assert.throws(() => normalizeStyles(sample));
  assert.throws(() => blendStyleRow([{name:'if_sara',weight:1}],new Map(),10),/missing/);
});
test('raw WAV encoder uses proper PCM header and clips samples safely', async () => {
  const blob = encodePcm16Wav(new Float32Array([0, .5, -1, 2]), 24000);
  assert.equal(blob.type, 'audio/wav');
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.getUint32(4,true), 44);
  assert.equal(view.getUint32(24,true), 24000);
  assert.equal(view.getInt16(44+2*3,true), 32767);
  assert.equal(view.getInt16(44+2*2,true), -32768);
  assert.throws(() => encodePcm16Wav([Infinity]));
});
test('browser Kokoro status advertises no backend compute or private Seed-VC parity', async () => {
  const runtime = new OnDeviceKokoro({ loader: () => { throw Error('Model must load lazily'); } });
  const status = await runtime.status();
  assert.equal(status.tts.backend,'kokoro-on-device');
  assert.equal(status.tts.referenceConversion,false);
  assert.equal(status.privacy.textUploadedForTTS,false);
  assert.equal(status.voices.length,2);
});
test('browser Kokoro runs both seed blends through same local model, saving download time', async () => {
  const byId = {'if_sara':1,'af_heart':3,'jf_alpha':8,'jf_nezumi':10};
  const calls = [], progress = [];
  let loaded = 0, fetched = 0;
  class MockTensor {
    constructor(type, data, dims) { this.type=type;this.data=data;this.dims=dims; }
  }
  const model = {
    tokenizer: () => ({}),
    model: async ({ style, speed }) => {
      calls.push({style: style.data[0],speed:speed.data[0]});
      return {waveform:{data:new Float32Array([0,0.5,1,-0.5,0])}};
    },
    generate_from_ids: async () => { throw Error('Not overridden'); },
    async generate(text, options) {
      assert.ok(text);
      return this.generate_from_ids(new MockTensor('int64',new BigInt64Array(9),[1,9]),options);
    },
  };
  const client = new OnDeviceKokoro({
    onStatus: s => progress.push(s),
    loader: async () => ({KokoroTTS:{from_pretrained:async (...args) => {loaded++;assert.equal(args[1].dtype,'q8');assert.equal(args[1].device,'wasm');return model;}}}),
    fetchImpl: async url => {
      fetched++;
      const name = url.match(/\/voices\/([^/]+)\.bin$/)?.[1];
      assert.ok(name in byId);
      return new Response(new Float32Array(510 * 256).fill(byId[name]).buffer);
    },
  });
  const a = await client.synthesize({text:'Hello from Italy',voice:'giulia-blend',speech:{pace:1}});
  const b = await client.synthesize({text:'Hello from Japan',voice:'mei-blend',speech:{pace:1.1}});
  assert.equal(loaded,1);
  assert.equal(fetched,4);
  assert.equal(a.backend,'kokoro-on-device');
  assert.equal(a.blob.type,'audio/wav');
  assert.ok(Math.abs(calls[0].style - (1*.65+3*.35)) < 1e-5);
  assert.ok(Math.abs(calls[1].style - (8*.60+10*.40)) < 1e-5);
  assert.ok(Math.abs(calls[1].speed - 1.1) < 1e-5);
  assert.ok(progress.some(x=>x.includes('browser Kokoro')));
});
test('multilingual Kokoro forwards Italian IPA and Japanese Open JTalk phonemes without changing blends',async()=>{
  let modelLoads=0,italianLoads=0,japaneseLoads=0,warmJapanese=0;
  const sampleStyles={'if_sara':1,'af_heart':3,'jf_alpha':8,'jf_nezumi':10};
  const calls=[];
  class Tensor { constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;} }
  const model={
    tokenizer: (ps)=>{ calls.push({stage:'tokens',ps});return{input_ids:new Tensor('int64',new BigInt64Array(8),[1,8])}; },
    model:async ({style,speed})=>{calls.push({stage:'infer',style:style.data[0],speed:speed.data[0]});return{waveform:{data:new Float32Array([0,.1,.2])}};},
    generate_from_ids:async()=>{throw Error('Must be patched during rendering.');},
    generate:async()=>{throw Error('Native G2P must bypass the English generator.');},
  };
  const loader=async()=>({KokoroTTS:{from_pretrained:async()=>{modelLoads++;return model;}}});
  const japaneseLoader=async()=>({KokoroJP: class {
    constructor(tts){this.model=tts;japaneseLoads++;}
    async loadJapaneseG2POnce(){warmJapanese++;}
    async speak(text,voice,speed){
      assert.equal(voice,'jf_alpha');
      await this.loadJapaneseG2POnce();
      const {input_ids}=this.model.tokenizer('tɕiɴɴa', {truncation:true});
      return this.model.generate_from_ids(input_ids,{speed});
    }
  }});
  const italianLoader=async()=>({
    roa:{},
    default:async()=>{italianLoads++;return{setVoice:name=>{assert.equal(name,'it');},textToIpa:()=> 'bwonˈdʒorno'};}
  });
  const runtime=new OnDeviceKokoro({
    loader,italianLoader,japaneseLoader,
    fetchImpl: async url=>{
      const name=url.match(/\/voices\/([^/]+)\.bin$/)?.[1];
      assert.ok(name in sampleStyles);
      return new Response(new Float32Array(510*256).fill(sampleStyles[name]).buffer);
    }
  });
  const warm=await runtime.preload();
  assert.equal(warm.modelReady,true);
  assert.equal(warm.languagesReady,2);
  assert.equal(modelLoads,1);
  assert.equal(italianLoads,1);
  assert.equal(japaneseLoads,1);
  assert.ok(warmJapanese>=1);
  const ita=await runtime.synthesize({text:'Buongiorno',voice:'giulia-blend',language:'it'});
  const ja=await runtime.synthesize({text:'こんにちは',voice:'mei-blend',language:'ja'});
  assert.equal(ita.backend,'kokoro-on-device');
  assert.equal(ja.blob.type,'audio/wav');
  assert.ok(calls.some(c=>c.stage==='tokens'&&/bwon/.test(c.ps)));
  assert.ok(calls.some(c=>c.stage==='tokens'&&/tɕiɴ/.test(c.ps)));
  const [giulia,mei]=calls.filter(c=>c.stage==='infer');
  assert.ok(Math.abs(giulia.style-(1*.65+3*.35))<1e-5);
  assert.ok(Math.abs(mei.style-(8*.6+10*.4))<1e-5);
  assert.equal(modelLoads,1);
});
test('Italian IPA follows Misaki equivalents and invalid results fail closed',()=>{
  assert.equal(normalizeItalianIPA('d^ʒ e^ɪ'), 'ʤ eɪ');
  assert.throws(()=>normalizeItalianIPA(''),/no IPA/);
});
test('unsupported speech language still rejects rather than defaulting to English',async()=>{
  const client=new OnDeviceKokoro({loader:async()=>{throw Error('Model should not be touched');}});
  await assert.rejects(client.synthesize({text:'हैलो',voice:'mei-blend',language:'hi'}),/Unsupported Kokoro speech language/);
});
test('failed model fetch is retryable and cancelled generation rejects', async () => {
  const client = new OnDeviceKokoro({loader: async () => {throw Error('No model network');}});
  await assert.rejects(client.synthesize({text:'A test',voice:'giulia-blend'}),/No model network/);
  await assert.rejects(client.synthesize({text:'A test',voice:'giulia-blend'}),/No model network/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(client.synthesize({text:'A test',voice:'giulia-blend'},{signal:controller.signal}),x=>x.name==='AbortError');
});
test('frontend defaults to Kokoro on-device and Modal billing code is absent', () => {
  const v=fs.readFileSync(new URL('../public/dual-lab/voice/index.html',import.meta.url),'utf8');
  const d=fs.readFileSync(new URL('../public/dual-lab/index.html',import.meta.url),'utf8');
  assert.match(v,/<option value="ondevice">/);
  assert.match(d,/<option value="ondevice">/);
  assert.ok(!fs.existsSync(new URL('../cloud_voice/modal_app.py',import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../lib/voice-cloud-proxy.mjs',import.meta.url)));
});
