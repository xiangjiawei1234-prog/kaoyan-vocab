#!/usr/bin/env node
/** R03审查回归：真实UI休息/特训守卫与词表熟练操作后的快照状态；隔离Chrome。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const files=['index.html','js/app.js','css/app.css','sw.js'];
const fingerprint=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['真实Chrome CDP键盘/点击；375为视口仿真，不代表真机或读屏','仅localStorage准备夹具与注入快照键写失败，不用学习业务写hook']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
let p;
const scene=`(()=>{const v=window.__vocab;return {Q:v.Q,cur:v.cur,phase:v.phase,verdict:v.verdict,answered:v.answered,drill:v.drillMode,resting:v.isResting(),snapshotSaved:v.getRestState().restState?.snapshotSaved,snapshotPresent:v.getSessionSnapshotState().present};})()`;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function dismissNotices(){for(const selector of ['#toastDismiss','#profFeedbackDismiss']){if(await p.isClickable(selector))await click(selector);}}
async function click(selector){await p.send('Page.bringToFront');await p.scrollIntoView(selector);await sleep(90);if(!await p.isClickable(selector))throw Error('无法真实命中 '+selector);await p.clickSelector(selector);await sleep(100);await p.nextFrame();}
async function seed(width,groupSize=5){
  await p.setViewport(width,width===375?812:1000,{mobile:width===375});
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.eval(`(()=>{const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS())),now=Date.now();s.progress={5:[1,now-1000,1,2,now-86400000],6:[1,now-1000,1,2,now-86400000]};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};s.timeSec=0;s.spelling={};Object.assign(s.settings,{dailyNew:5,groupSize:${groupSize},dailyReviewCap:100,fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,order:'freq',autoSpk:false,singleCharKeys:true,autoResume:{enabled:${groupSize===1},threshold:1,idleMs:30000,countdownMs:3000}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  try{await p.reload();await p.waitFor('window.__vocab&&window.__vocab.cur!==null');}
  finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  await p.send('Page.bringToFront');
}
try{
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#card")');
  for(const width of [375,1440]){
    await seed(width);await p.key('keyJ');await p.waitFor('window.__vocab.verdict===false');
    const original=await p.eval(scene);await click('#btnSaveRest');
    const rest=await p.eval(scene);
    check(width+' 真实保存并休息保持当前组/卡/判定',rest.resting&&same(rest.Q,original.Q)&&rest.cur===original.cur&&rest.verdict===original.verdict,rest);
    check(width+' 休息页错词特训入口隐藏并禁用',await p.eval(`(()=>{const e=document.querySelector('#btnDrill');return e.hidden&&e.disabled;})()`));
    await dismissNotices();
    const restWord=await p.eval('window.__vocab.getW()[window.__vocab.cur].w');
    await click('[data-v="list"]');await click('#q');await p.insertText(restWord);
    await p.waitFor(`document.querySelector('#listInner [data-proficient="${rest.cur}"]')`);
    await click(`#listInner [data-proficient="${rest.cur}"]`);
    await click('[data-v="study"]');
    await dismissNotices();
    const managed=await p.eval(scene);
    check(width+' 词表标熟练后仍保留休息选择并跳过熟练词',managed.resting&&managed.cur!==rest.cur&&!managed.snapshotPresent,managed);
    const text=await p.eval('document.querySelector("#card").textContent');
    check(width+' 清除快照后不再承诺刷新恢复当前现场',managed.snapshotSaved===false&&text.includes('本页现场未能写入浏览器')&&!text.includes('现场也已写入'),text);
    await click('#restResume');
    check(width+' 明确继续后恢复原阶段并重新开放错词特训',await p.eval(`(()=>{const v=window.__vocab,e=document.querySelector('#btnDrill');return !v.isResting()&&!e.hidden&&!e.disabled;})()`));
    await click('#btnDrill');check(width+' 继续后可真正进入错词特训',await p.eval('window.__vocab.drillMode&&!window.__vocab.isResting()'));
    await click('#btnDrill');check(width+' 退出特训回到原主组',await p.eval('!window.__vocab.drillMode&&!window.__vocab.isResting()'));
    await seed(width,1);await p.key('keyF');await p.waitFor('window.__vocab.verdict===true');
    const last=await p.eval(`({cur:window.__vocab.cur,word:window.__vocab.getW()[window.__vocab.cur].w,day:JSON.stringify(window.__vocab.getS().days),review:JSON.stringify(window.__vocab.getReviewLedger())})`);
    await click('#btnSaveRest');await dismissNotices();
    await click('[data-v="list"]');await click('#q');await p.insertText(last.word);
    await p.waitFor(`document.querySelector('#listInner [data-proficient="${last.cur}"]')`);
    await click(`#listInner [data-proficient="${last.cur}"]`);await click('[data-v="study"]');await dismissNotices();
    const ended=await p.eval(`({cur:window.__vocab.cur,resting:window.__vocab.isResting(),eligible:window.__vocab.getAutoResumeState().eligible,resume:!!document.querySelector('#restResume'),again:!!document.querySelector('#again'),day:JSON.stringify(window.__vocab.getS().days),review:JSON.stringify(window.__vocab.getReviewLedger())})`);
    check(width+' 休息组最后一词标熟练后安全收尾且不自动续开',ended.cur===null&&!ended.resting&&!ended.eligible&&!ended.resume&&ended.again&&ended.day===last.day&&ended.review===last.review,ended);
    await click('#again');
    check(width+' 队尾收尾后仍能通过真实按钮手动继续下一组',await p.eval('window.__vocab.cur!==null&&!window.__vocab.isResting()&&window.__vocab.answered===0'));
    await seed(width);await p.key('keyF');await p.waitFor('window.__vocab.verdict===true');
    await p.eval(`(()=>{window.__restOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('vocab_session_snapshot_'))throw new DOMException('snapshot quota fixture','QuotaExceededError');return window.__restOriginalSet.call(this,k,v);};})()`);
    await click('#btnSaveRest');
    const failedSnapshot=await p.eval(`({resting:window.__vocab.isResting(),snapshotSaved:window.__vocab.getRestState().restState?.snapshotSaved,text:document.querySelector('#card').textContent})`);
    check(width+' 实际快照写失败仍只承诺主学习记录已保存',failedSnapshot.resting&&failedSnapshot.snapshotSaved===false&&failedSnapshot.text.includes('本页现场未能写入浏览器')&&!failedSnapshot.text.includes('现场也已写入'),failedSnapshot);
    await p.eval('Storage.prototype.setItem=window.__restOriginalSet;true');
    await dismissNotices();
    await p.scrollIntoView('#restResume');const hit=await p.isClickable('#restResume');
    check(width+' 失败说明后继续入口仍可真实命中且无横向溢出',hit&&await p.eval('document.documentElement.scrollWidth<=innerWidth+1'));
    report.shots.push(await p.screenshot('rest-review-'+width+'.png'));
  }
}catch(error){if(p)report.shots.push(await p.screenshot('rest-review-failure.png'));check('旅程完整执行',false,String(error.stack||error));}
finally{
  if(p)report.errors=p.errors();check('无未解释console错误',report.errors.length===0,report.errors);
  report.sourcesAfter=fingerprint();check('运行时字节稳定',same(report.sources,report.sourcesAfter),report.sourcesAfter);
  report.passed=report.checks.filter(c=>c.ok).length;report.failed=report.checks.length-report.passed;
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(RESULTS_DIR,'rest-review.json'),JSON.stringify(report,null,2));
  await p?.close();conn.close();await chrome.close();await server.close();
}
console.log(`保存休息复核浏览器：${report.passed} 通过 / ${report.failed} 失败`);process.exitCode=report.failed?1:0;
