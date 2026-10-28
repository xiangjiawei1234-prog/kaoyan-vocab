#!/usr/bin/env node
/** 同卡一次快捷改判：隔离 profile、真实 CDP 键盘/按钮，结果写 ignored 报告目录。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={checks:[],shots:[],errors:[],limits:['Chrome headless CDP; narrow viewport is emulation, not physical-device or screen-reader verification']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const scene=`(() => {const v=window.__vocab,s=v.getS();return {cur:v.cur,phase:v.phase,verdict:v.verdict,changes:v.answerChanges,qi:v.qi,answered:v.answered,progress:s.progress,days:s.days,reviewDay:s.reviewDay};})()`;
let p;
async function click(selector){await p.scrollIntoView(selector);if(!await p.isClickable(selector))throw Error('控件无法真实命中：'+selector);await p.clickSelector(selector);}
async function seed(large){
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.eval(`(() => {const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};s.timeSec=0;
    Object.assign(s.settings,{dailyNew:4,groupSize:4,dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,backlogGuard:false,autoSpk:false,fontSize:${JSON.stringify(large?'large':'standard')},singleCharKeys:true,
      keys:{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},gestures:{enabled:true,recall:{left:'dont',right:'know'},revealed:{left:'dont',right:'know'}}});
    localStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  try{await p.reload();await p.waitFor('window.__vocab&&window.__vocab.cur!==null');}
  finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  await p.eval('document.querySelector("#card").focus({preventScroll:true})');
}
try{
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#card")');
  for(const width of [375,1440]){
    await p.setViewport(width,width===375?812:1000,{mobile:width===375});
    for(const [first,second,expected] of [['keyF','keyJ',false],['keyJ','keyF',true]]){
      await seed(width===375);const name=width+' '+first+'→'+second;
      await p.key(first);await p.key(second);const corrected=await p.eval(scene);
      check(name+' 首次改判生效且只计一次作答',corrected.verdict===expected&&corrected.changes===1&&corrected.answered===1,corrected);
      await p.key(first);const blocked=await p.eval(scene);
      check(name+' 第三次判定键不再翻转或记账',JSON.stringify(blocked)===JSON.stringify(corrected),blocked);
      check(name+' 提示次数并移除失效快捷键',await p.eval('document.querySelector("#hint").textContent.includes("已改判 1 次")&&!document.querySelector("#fix kbd")'));
      await p.reload();await p.waitFor('window.__vocab&&window.__vocab.verdict!==null');await p.key(first);
      const restored=await p.eval(scene);
      check(name+' 真实刷新保留改判保护',JSON.stringify(restored)===JSON.stringify(corrected),restored);
      await click('#fix');await click('#fix');const explicit=await p.eval(scene);
      check(name+' 明确点击仍可二次三次改判',explicit.verdict===expected&&explicit.changes===3&&explicit.answered===1,explicit);
      await p.key(first);check(name+' 点击不重开普通快捷键',JSON.stringify(await p.eval(scene))===JSON.stringify(explicit));
      await p.scrollIntoView('#acts');await p.nextFrame();
      const geometry=await p.eval(`(() => {const a=document.querySelector('#acts').getBoundingClientRect(),h=document.querySelector('#hint').getBoundingClientRect(),f=document.querySelector('#fix'),r=f.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {acts:a.height,hint:h.height,overflow:document.documentElement.scrollWidth>innerWidth,hit:!!hit&&(hit===f||f.contains(hit))};})()`);
      check(name+' 动作槽位保持且按钮真实可达',Math.abs(geometry.acts-(width===375?151:156))<=1&&(width!==375||Math.abs(geometry.hint-40)<=1)&&!geometry.overflow&&geometry.hit,geometry);
      report.shots.push(await p.screenshot('answer-guard-'+width+'-'+first+'.png'));
    }
  }
}catch(error){check('旅程完整执行',false,String(error.stack||error));}
finally{
  if(p)report.errors=p.errors();check('浏览器无新增console错误',report.errors.length===0,report.errors);
  report.passed=report.checks.filter(c=>c.ok).length;report.failed=report.checks.length-report.passed;
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/answer-guard.json',JSON.stringify(report,null,2));
  await p?.close();conn.close();await chrome.close();await server.close();
}
console.log(`改判保护浏览器：${report.passed} 通过 / ${report.failed} 失败`);
process.exitCode=report.failed?1:0;
