#!/usr/bin/env node
/** 收尾：固定Enter保持连续键盘学习；使用隔离profile和真实CDP输入，不改业务现场。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['Chrome headless隔离profile；手机视口仿真不代表真机或读屏','仅存储夹具初始化；操作使用真实方向键、Enter、repeat/keyup和原生按钮激活']};
const check=(name,ok,actual={})=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl),p=await Page.open(conn,{url:server.url()});
const group=`(()=>{const v=window.__vocab;return {cur:v.cur,phase:v.phase,verdict:v.verdict,answered:v.answered,qi:v.qi,Q:v.Q,startedAt:v.getPlan()?.startedAt};})()`;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function key(name,options={}){await p.send('Page.bringToFront');await p.key(name,options);}
async function click(selector){await p.send('Page.bringToFront');await p.scrollIntoView(selector);await sleep(80);await p.clickSelector(selector);await sleep(100);}
async function seed(singleCharKeys,width){
 await p.setViewport(width,width<500?812:1000,{mobile:width<500});
 const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));"});
 try{
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.stars={};s.proficient={};s.timeSec=0;s.reviewDay={};s.extraDay={};s.spelling={};Object.assign(s.settings,{singleCharKeys:${singleCharKeys},dailyNew:2,groupSize:1,dailyReviewCap:100,order:'freq',pmin:0,fmin:1,fmax:0,pos:[],kyOnly:false,theme:${width<500?"'dark'":"'light'"},autoSpk:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000},keys:{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},actionKeys:{continue:null,wait:null,return:null,listSearch:null}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');await sleep(120);
 }finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
}
try{
 await p.waitFor('window.__vocab');
 for(const [width,single] of [[1440,true],[375,false]]){
  await seed(single,width);const initial=await p.eval(group);
  await key('ArrowRight');await p.waitFor('window.__vocab.phase==="revealed"');
  await p.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await p.waitFor('window.__vocab.cur==null');const done=await p.eval(group);
  const hint=await p.eval("({text:document.querySelector('#hint').textContent,button:document.querySelector('#again').textContent,single:window.__vocab.getS().settings.singleCharKeys})");
  check(width+' Enter完成当前组且显示真实Enter续组提示',done.answered===1&&hint.text.includes('Enter')&&hint.button.includes('Enter')&&hint.single===single,hint);
  await p.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,autoRepeat:true});await sleep(100);
  check(width+' 按住Enter产生repeat不越过完成页',same(done,await p.eval(group)));
  await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});await key('Enter');await p.waitFor('window.__vocab.cur!=null&&window.__vocab.phase==="recall"');
  const next=await p.eval(group);
  check(width+' 松开再按Enter直接下一组，首卡未判定',next.cur!==initial.cur&&next.answered===0&&next.verdict===null,{initial,next});
  if(!single){
   await key('keyF');await key('Space');check('单字符关闭保持关闭，F与空格不借Enter功能重新启用',await p.eval('window.__vocab.getS().settings.singleCharKeys===false&&window.__vocab.phase==="recall"&&window.__vocab.answered===0'));
  }
  await key('ArrowRight');await key('Enter');await p.waitFor('window.__vocab.cur==null');const exhausted=await p.eval(group);
  await key('Enter');await sleep(120);
  check(width+' 今日无候选时Enter不空开组、不授予额外额度或隐式等待',same(exhausted,await p.eval(group))&&await p.eval('window.__vocab.getS().extraDay.extra===0&&!window.__vocab.getAutoResumeState().waitingForDue'));
  await p.scrollIntoView('#goStats');await p.eval("document.querySelector('#goStats').focus()");await key('Enter');await p.waitFor('document.querySelector("#v-stats").classList.contains("on")');
  check(width+' 聚焦统计按钮时Enter只执行原生统计操作，保留完成现场',same(exhausted,await p.eval(group)));
  await click('[data-v="study"]');await click('#btnHelp');await p.waitFor('!document.querySelector("#helpSheet").hidden');await key('Enter');await sleep(100);
  check(width+' 帮助浮层中的Enter不穿透背景续组',same(exhausted,await p.eval(group)));
  if(await p.eval('!document.querySelector("#helpSheet").hidden'))await key('Escape');
  report.shots.push(await p.screenshot('completion-keyboard-'+width+'.png'));
 }
 await click('[data-v="set"]');await click('#actionKeysSettings > summary');
 const label=await p.eval(`(()=>{const b=document.querySelector('.keybtn[data-k="continue"]');return {visible:b.textContent,aria:b.getAttribute('aria-label')};})()`);
 check('继续键沿用的可见标签和辅助名称一致',label.visible.includes('沿用 空格')&&label.aria.includes('当前 沿用 空格')&&!label.aria.includes('未绑定'),label);
 report.errors=p.errors();check('旅程无浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('取证期间运行时字节保持一致',same(report.sources,report.sourcesAfter));
}catch(error){check('旅程完整执行',false,{error:String(error.stack||error)});report.errors=p.errors();}
finally{
 await p.close();await conn.close();await chrome.close();await server.close();
 const file=path.join(RESULTS_DIR,'completion-keyboard.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
 const passed=report.checks.filter(c=>c.ok).length,failed=report.checks.length-passed;console.log(JSON.stringify({passed,failed,report:file,screenshots:report.shots.length}));if(failed)process.exitCode=1;
}
