#!/usr/bin/env node
/** 2026-10-28 音频独立复核：真实控件/布局，设备声音用可观察的内存替身，不宣称真机发声。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {startStaticServer, launchChrome, connect, Page, RESULTS_DIR, REPO_ROOT, sleep} from './cdp.mjs';
const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],shots:[],errors:[],limits:['Chrome headless与375/1440视口仿真不等于真机/读屏','speechSynthesis为可观察替身，只验证真实应用调用及状态，不证明设备发声/离线语音']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const FAKE=`(() => {
 const events=new Map(), state={calls:[],cancels:0,voices:[{name:'Review English',lang:'en-US',voiceURI:'review-en'}]};
 const api={getVoices:()=>state.voices.slice(),speak(u){state.calls.push(u);setTimeout(()=>u.onstart?.(),0);},cancel(){state.cancels++;},addEventListener(t,f){if(!events.has(t))events.set(t,[]);events.get(t).push(f);}};
 state.changed=()=>{for(const f of events.get('voiceschanged')||[])f();};window.__reviewSpeech=state;
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:api});
 Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
})();`;
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);let p;
async function click(selector){await p.scrollIntoView(selector);await sleep(60);if(!await p.isClickable(selector))throw Error('不能真实点击 '+selector);await p.clickSelector(selector);await sleep(70);}
async function seed(width){
 await p.setViewport(width,width===375?812:1000,{mobile:width===375});
 const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
 await p.eval(`(() => {const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS())),words=v.getW();
  const target=Object.keys(window.WORD_SENSES.books.kaoyan).find(w=>words.some(x=>x.w===w));
  s.progress={};s.days={};s.stars={};s.timeSec=0;s.proficient=Object.fromEntries(words.filter(x=>x.w!==target).map(x=>[x.w,1]));s.reviewDay={};s.extraDay={};
  Object.assign(s.settings,{dailyNew:1,groupSize:1,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,autoSpk:false,theme:${JSON.stringify(width===375?'dark':'light')},fontSize:${JSON.stringify(width===375?'large':'standard')},singleCharKeys:true});
  localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1',JSON.stringify(s.proficient));localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));
 })()`);
 try{await p.reload();await p.waitFor('window.__vocab&&window.__vocab.cur!==null');}finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
}
try{
 p=await Page.open(conn,{url:server.url()});await p.send('Page.addScriptToEvaluateOnNewDocument',{source:FAKE});await p.reload();await p.waitFor('window.__vocab&&window.__reviewSpeech');
 for(const width of [375,1440]){
  await seed(width);
  await click('#spk');await p.waitFor('window.__vocab.getSpeechPlayback().status==="playing"');
  const cancels=await p.eval('window.__reviewSpeech.cancels');
  await p.eval(`window.__reviewSpeech.voices=[{name:'Chinese',lang:'zh-CN',voiceURI:'zh'}];window.__reviewSpeech.changed();`);
  await click('#spkSlow');
  const fail=await p.eval('({status:window.__vocab.getSpeechPlayback().status,cancels:window.__reviewSpeech.cancels,stop:document.querySelector("#spkStop").disabled})');
  check(width+' 新朗读失败仍取消旧声音',fail.status==='error'&&fail.cancels===cancels+1&&fail.stop,fail);
  await p.eval(`window.__reviewSpeech.voices=[{name:'Review English',lang:'en-US',voiceURI:'review-en'}];window.__reviewSpeech.changed();`);
  await click('[data-v="set"]');await click('#btnVoiceTest');await p.waitFor('window.__vocab.getSpeechPlayback().status==="playing"');
  await p.eval('window.__reviewSpeech.calls.at(-1).onend()');await click('[data-v="study"]');
  check(width+' 设置试听状态不串回学习卡',await p.eval('document.querySelector("#wordAudioStatus").textContent===""'));
  check(width+' 回忆态无语境朗读泄题',await p.eval('!document.querySelector("#card [data-audio-play]")'));
  await p.eval('document.querySelector("#card").focus({preventScroll:true})');await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');
  await click('#card .sense-evidence > summary');
  const normal='#card .sense-example [data-audio-play="normal"]', slow='#card .sense-example [data-audio-play="slow"]', stop='#card .sense-example [data-audio-stop]';
  await click(normal);await p.waitFor('window.__vocab.getSpeechPlayback().status==="playing"');
  const spoken=await p.eval(`(()=>{const g=document.querySelector('#card .sense-example [data-audio-text]');return {text:window.__reviewSpeech.calls.at(-1).text,expected:g.dataset.audioText,pressed:g.querySelector('[data-audio-play="normal"]').getAttribute('aria-pressed'),label:g.querySelector('.audio-status').textContent};})()`);
  check(width+' 已核义项原句可真实点击朗读且只读英文',spoken.text===spoken.expected&&spoken.pressed==='true'&&spoken.label==='朗读中',spoken);
  await click(slow);check(width+' 已核原句慢速复用控制器',await p.eval('window.__vocab.getSpeechPlayback().slow&&window.__reviewSpeech.calls.at(-1).rate<window.__vocab.getS().settings.speechRate'));
  await click(stop);check(width+' 已核原句停止状态明确',await p.eval('window.__vocab.getSpeechPlayback().status==="stopped"&&document.querySelector("#card .sense-example .audio-status").textContent==="已停止"'));
  const sizes=await p.eval(`['${normal}','${slow}','${stop}'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {w:r.width,h:r.height};})`);
  check(width+' 例句按钮触控高度至少44px',width!==375||sizes.every(x=>x.h>=44),sizes);
  await click('[data-v="list"]');await click('#q');await p.insertText(await p.eval('window.__vocab.getW()[window.__vocab.cur].w'));await sleep(120);await click('#listInner .row-word');
  await p.waitFor('!document.querySelector("#wordSheet").hidden');await click('#wordDetail .sense-evidence > summary');await click('#wordDetail .sense-example [data-audio-play="normal"]');
  check(width+' 词表详情义项原句也可真实朗读',await p.eval('window.__vocab.getSpeechPlayback().status==="playing"&&window.__reviewSpeech.calls.at(-1).text===document.querySelector("#wordDetail .sense-example [data-audio-text]").dataset.audioText'));
  await click('#wordClose');check(width+' 关闭详情停止旧音频',await p.eval('window.__vocab.getSpeechPlayback().status==="stopped"'));
  await click('[data-v="study"]');await p.scrollIntoView(normal);await p.nextFrame();
  check(width+' 音频控件不引起横向溢出',await p.eval('document.documentElement.scrollWidth<=innerWidth+1'));
  report.shots.push(await p.screenshot('audio-review-'+width+'.png'));
 }
}catch(error){check('旅程完整执行',false,String(error.stack||error));}
finally{
 if(p)report.errors=p.errors();check('无未解释console错误',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('运行时字节稳定',JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter));
 report.passed=report.checks.filter(c=>c.ok).length;report.failed=report.checks.length-report.passed;
 fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(RESULTS_DIR,'audio-review.json'),JSON.stringify(report,null,2));
 await p?.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.passed,failed:report.failed}));process.exitCode=report.failed?1:0;
