import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OnDeviceKokoro, minimumReasonableSpeechMs } from '../public/dual-lab/voice/browser-kokoro.js';
import { groupSpeechSegments, playKokoroSpeech, naturalPauseMs } from '../public/dual-lab/voice/speech-buffer.js';

const multilingual=[
  {text:'Hello, everyone!',language:'en-us'},
  {text:'Buongiorno a tutti!',language:'it'},
  {text:'こんにちは、みなさん。',language:'ja'},
];
const clip={blob:new Blob([new Uint8Array(48)],{type:'audio/wav'}),generationMs:2100,inferenceMs:2000,phonemizationMs:100,durationMs:950};

test('short mixed-language utterances become one Kokoro inference batch',()=>{
  const groups=groupSpeechSegments(multilingual);
  assert.equal(groups.length,1);
  assert.equal(groups[0].segments.length,3);
  assert.deepEqual(groups[0].languages,['en-us','it','ja']);
  assert.equal(groups[0].text,multilingual.map(x=>x.text).join(''));
});
test('long text is bounded and never silently discarded',()=>{
  const chunks=Array.from({length:12},(_,i)=>({text:'Normal speech segment '+i+' that has many words and punctuation. ',language:'en-us'}));
  const groups=groupSpeechSegments(chunks,{maxCharacters:190});
  assert.ok(groups.length>=4);
  assert.equal(groups.flatMap(g=>g.segments).map(x=>x.text).join(''),chunks.map(x=>x.text).join(''));
});
test('fused browser Kokoro uses one ONNX run and retains original Giulia blend across languages',async()=>{
  const values={if_sara:1,af_heart:3,jf_alpha:6,jf_nezumi:8};
  const recorded={models:0,inferences:0,phonemes:[],tensor:null,style:null};
  class Tensor {
    constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}
  }
  const model={
    tokenizer(text){
      recorded.phonemes.push(text);
      const data=text==='…'?[0n,99n,0n]:[0n,1n,2n,0n];
      return{input_ids:new Tensor('int64',new BigInt64Array(data),[1,data.length])};
    },
    async generate(text){
      recorded.phonemes.push(text);
      return this.generate_from_ids(this.tokenizer(text).input_ids);
    },
    async generate_from_ids(){throw Error('Unpatched Kokoro generation should never run');},
    async model({input_ids,style}){
      recorded.inferences++;
      recorded.tensor=input_ids;recorded.style=style;
      return{waveform:{data:new Float32Array(24000*6)}};
    },
  };
  const kokoro=new OnDeviceKokoro({
    loader:async()=>({KokoroTTS:{from_pretrained:async()=>{recorded.models++;return model;}}}),
    italianLoader:async()=>({roa:{},default:async()=>({setVoice(){},textToIpa:()=> 'bwɔnˈdʒorno'})}),
    japaneseLoader:async()=>({KokoroJP:class {
      constructor(tts){this.tts=tts;}
      async speak(){return this.tts.generate_from_ids(this.tts.tokenizer('koɴnitɕiwa').input_ids);}
    }}),
    fetchImpl:async url=>{
      const key=url.match(/voices\/([^/]+)\.bin/)?.[1];
      assert.ok(key in values);
      return new Response(new Float32Array(510*256).fill(values[key]).buffer);
    },
  });
  const originalGenerate=model.generate_from_ids;
  const result=await kokoro.synthesizeMixed({segments:multilingual,voice:'giulia-blend'});
  assert.equal(recorded.models,1);
  assert.equal(recorded.inferences,1,'one inference, rather than three per language change');
  assert.equal(result.segmentCount,3);
  assert.deepEqual(result.fusedLanguages,['en-us','it','ja']);
  assert.equal(result.blob.type,'audio/wav');
  assert.equal(recorded.tensor.data.length,10);
  assert.deepEqual([...recorded.tensor.data],[0n,1n,2n,99n,1n,2n,99n,1n,2n,0n]);
  assert.equal(result.insertedPauseTokens,1);
  assert.ok(Math.abs(recorded.style.data[0]-(1*.65+3*.35))<1e-5);
  assert.equal(model.generate_from_ids,originalGenerate,'runtime must be restored after token capture');
  assert.ok(Number.isFinite(result.inferenceMs));
  assert.ok(Number.isFinite(result.phonemizationMs));
});
test('fused browser Kokoro restores model methods even if the phonemizer fails',async()=>{
  class Tensor{constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}}
  const model={
    tokenizer:()=>({input_ids:new Tensor('int64',new BigInt64Array([0n,1n,0n]),[1,3])}),
    async generate(){return this.generate_from_ids(this.tokenizer().input_ids);},
    generate_from_ids:async()=>{throw Error('Unpatched');},
    model:async()=>({waveform:{data:new Float32Array([0])}}),
  };
  const original=model.generate_from_ids;
  const runtime=new OnDeviceKokoro({
    loader:async()=>({KokoroTTS:{from_pretrained:async()=>model}}),
    italianLoader:async()=>({roa:{},default:async()=>({setVoice(){},textToIpa:()=>{throw Error('phoneme error');}})}),
    fetchImpl:async()=>new Response(new Float32Array(510*256).fill(2).buffer),
  });
  await assert.rejects(runtime.synthesizeMixed({segments:multilingual.slice(0,2),voice:'giulia-blend'}),/phoneme error/);
  assert.equal(model.generate_from_ids,original);
});
test('playback combines all short mixed-language spans into a single playable WAV',async()=>{
  let mixed=0,played=0,individual=0;
  const provider={
    kind:'ondevice',
    synthesizeMixed:async()=>{mixed++;return clip;},
    synthesize:async()=>{individual++;return clip;},
  };
  const metrics=await playKokoroSpeech({
    segments:multilingual,provider,voice:'mei-blend',
    play:async(blob,{onPlaying})=>{played++;assert.equal(blob.type,'audio/wav');onPlaying?.();},
  });
  assert.equal(mixed,1);
  assert.equal(individual,0);
  assert.equal(played,1);
  assert.equal(metrics.clips,1);
  assert.equal(metrics.phonemizationMs,100);
  assert.equal(metrics.inferenceMs,2000);
});
test('on fusion incompatibility, playback keeps Kokoro clips and does not substitute device voices',async()=>{
  let individual=0;
  const provider={
    synthesizeMixed:async()=>{throw Error('Unavailable fusion');},
    synthesize:async()=>{individual++;return clip;},
  };
  const played=[];
  const result=await playKokoroSpeech({
    segments:multilingual,provider,voice:'mei-blend',
    play:async(blob,{onPlaying})=>{played.push(blob);onPlaying?.();},
  });
  assert.equal(result.fusionFallbacks,1);
  assert.equal(individual,3);
  assert.equal(played.length,3);
});
test('short multi-batch audio is fully buffered before first playback',async()=>{
  let generated=0,firstPlayGenerated=null;
  const segments=[
    {text:'A'.repeat(120),language:'en-us'},
    {text:'B'.repeat(120),language:'it'},
    {text:'C'.repeat(120),language:'en-us'},
  ];
  await playKokoroSpeech({
    segments,provider:{synthesize:async()=>{generated++;return clip;}},
    voice:'giulia-blend',smooth:true,
    play:async(_blob,{onPlaying})=>{if(firstPlayGenerated===null)firstPlayGenerated=generated;onPlaying?.();},
  });
  assert.equal(generated,3);
  assert.equal(firstPlayGenerated,3,'no 20-second dead air once short playback begins');
});
test('aborted speech never starts another expensive inference',async()=>{
  const controller=new AbortController();controller.abort();
  let calls=0;
  await assert.rejects(playKokoroSpeech({
    segments:multilingual,provider:{synthesize:async()=>{calls++;return clip;}},
    voice:'mei-blend',signal:controller.signal,play:async()=>{},
  }),x=>x.name==='AbortError');
  assert.equal(calls,0);
});

test('both production lab entrypoints use one Kokoro prebuffer/fusion scheduler, not blocking serial loops',()=>{
  const dual=fs.readFileSync(new URL('../public/dual-lab/app.js',import.meta.url),'utf8');
  const audio=fs.readFileSync(new URL('../public/dual-lab/voice/app.js',import.meta.url),'utf8');
  assert.match(dual,/import \{ playKokoroSpeech \} from '\.\/voice\/speech-buffer\.js'/);
  assert.match(audio,/import \{ playKokoroSpeech \} from '\.\/speech-buffer\.js'/);
  assert.match(dual,/onDeviceReadout.*\n[\s\S]*playKokoroSpeech/);
  assert.match(audio,/playKokoroSpeech\(\{/);
  assert.match(dual,/phonemizationMs/);
  assert.match(dual,/inferenceMs/);
  assert.match(audio,/betweenClipsGapMs/);
});
test('fused synthesis rejects a waveform that only speaks its first word', async()=>{
  const text=multilingual.map(x=>x.text).join(' ');
  assert.ok(minimumReasonableSpeechMs(multilingual,1)>1000);
  assert.ok(minimumReasonableSpeechMs(multilingual,1.5)<minimumReasonableSpeechMs(multilingual,1));
  class Tensor{constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}}
  const model={
    tokenizer:t=>({input_ids:new Tensor('int64',new BigInt64Array(t==='…'?[0n,9n,0n]:[0n,1n,2n,0n]),[1,t==='…'?3:4])}),
    async generate(text){return this.generate_from_ids(this.tokenizer(text).input_ids);},
    generate_from_ids:async()=>{throw Error('Unpatched');},
    model:async()=>({waveform:{data:new Float32Array(24000)}}),
  };
  const runtime=new OnDeviceKokoro({
    loader:async()=>({KokoroTTS:{from_pretrained:async()=>model}}),
    italianLoader:async()=>({roa:{},default:async()=>({setVoice(){},textToIpa:()=> 'bwɔnˈdʒorno'})}),
    japaneseLoader:async()=>({KokoroJP:class{
      constructor(tts){this.tts=tts;}
      async speak(){return this.tts.generate_from_ids(this.tts.tokenizer('kon'nichiwa').input_ids);}
    }}),
    fetchImpl:async()=>new Response(new Float32Array(510*256).fill(2).buffer),
  });
  await assert.rejects(runtime.synthesizeMixed({segments:multilingual,voice:'giulia-blend'}),
    /Incomplete Kokoro fusion/);
  assert.equal(model.generate_from_ids.name,'generate_from_ids');
});
test('natural pauses separate speech clips by language without 20-second processing gaps',async()=>{
  assert.equal(naturalPauseMs([multilingual[0]],[multilingual[1]]),180);
  assert.equal(naturalPauseMs([multilingual[1]],[multilingual[2]]),180);
  assert.equal(naturalPauseMs([{text:'Hello!',language:'en-us'}],[{text:'World',language:'en-us'}]),125);
  assert.equal(naturalPauseMs([{text:'hello',language:'en-us'}],[{text:'world',language:'en-us'}]),65);
  assert.equal(naturalPauseMs(null,[multilingual[0]]),0);
});
test('separate Kokoro clips receive an intentional short breath with no paid device fallback', async()=>{
  const gaps=[], played=[];
  await playKokoroSpeech({
    segments:multilingual,provider:{
      synthesizeMixed:async()=>{throw Error('Short waveform');},
      synthesize:async({text})=>({...clip, text}),
    },
    voice:'mei-blend',
    pause:async(ms)=>gaps.push(ms),
    play:async(blob,{onPlaying})=>{played.push(blob);onPlaying?.();},
  });
  assert.deepEqual(gaps,[180,180]);
  assert.equal(played.length,3);
});
