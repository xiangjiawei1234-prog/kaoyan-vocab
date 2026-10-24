#!/usr/bin/env node
/** 空页等待真实时间路径；不伪造完成组，不替用户判定。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1280,900'}),conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],shots:[],errors:[]};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const p=await Page.open(conn,{url:server.url()});
const shot=async name=>report.shots.push(await p.screenshot('empty-wait-'+name+'.png'));
const state=()=>p.eval('window.__vocab.getAutoResumeState()');
async function click(selector){await p.scrollIntoView(selector);await p.clickSelector(selector);}
async function seed(futureMs=10000,enabled=true){
  await p.eval(`(() => {const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS())),now=Date.now(),d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    Object.assign(s.settings,{theme:'light',fontSize:'standard',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,order:'freq',dailyNew:1,groupSize:1,dailyReviewCap:100,autoResume:{enabled:${enabled},threshold:1,idleMs:30000,countdownMs:3000}});
    s.progress={0:[1,now+${futureMs},1,0,now-86400000]};s.days={[day]:{n:1,r:1,ok:1,no:0}};s.proficient={};s.stars={};s.timeSec=0;s.spelling={};s.reviewDay={d:day,used:0};s.extraDay={d:day,extra:0};
    localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.removeItem('vocab_autoresume_pause_v1');localStorage.removeItem('vocab_autoresume_lease_v1');
    Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab && window.__vocab.cur===null');
}
try{
  await p.waitFor('window.__vocab');
  // pagehide可能写旧卡快照，启动前只清临时快照以建立与真实全新空页相同的前置。
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.setViewport(375,900,{mobile:true});await seed(1000);
  check('首次空页0张且未获得自动资格',await p.eval(`window.__vocab.getGroupTotal()===0&&window.__vocab.answered===0&&!window.__vocab.getAutoResumeState().eligible`),await state());
  await sleep(36000);
  check('未选择等待，词已到期超过30秒仍不自动开组',await p.eval(`window.__vocab.cur===null&&window.__vocab.countDue()>0&&!window.__vocab.getAutoResumeState().waitingForDue`),await state());

  await seed(120000,false);
  check('关闭态先提供明确启用入口',await p.eval(`document.querySelector('#startEmptyWait').disabled&&!document.querySelector('#autoResumeQuick').hidden`));
  check('关闭态复合动作明确说明启用并等待',await p.eval(`document.querySelector('#autoResumeQuick').textContent==='启用便捷并在本页等待'`));
  await click('#autoResumeQuick');
  check('一次明确启用并选择等待，仍为0张',await p.eval(`window.__vocab.getAutoResumeState().waitingForDue&&window.__vocab.getGroupTotal()===0&&window.__vocab.answered===0`),await state());
  await p.reload();await p.waitFor('window.__vocab');
  check('真实刷新清除本页等待资格',await p.eval(`window.__vocab.cur===null&&!window.__vocab.getAutoResumeState().waitingForDue&&!window.__vocab.getAutoResumeState().eligible`),await state());

  await seed(10000);
  const rawBefore=await p.eval(`localStorage.getItem('kaoyan_vocab_v1')`),daysBefore=await p.eval(`JSON.stringify(window.__vocab.getS().days)`);
  await click('#startEmptyWait');const begin=Date.now();
  check('显式等待仅内存，不改变主记录或完成指标',await p.eval(`localStorage.getItem('kaoyan_vocab_v1')===${JSON.stringify(rawBefore)}&&window.__vocab.getGroupTotal()===0&&window.__vocab.answered===0&&!window.__vocab.getAutoResumeState().completedPage`),await state());
  await shot('waiting-375');
  const geo=await p.eval(`(() => {const card=document.querySelector('#card').getBoundingClientRect(),acts=document.querySelector('#acts').getBoundingClientRect(),box=document.querySelector('#autoResume').getBoundingClientRect();return {w:innerWidth,doc:document.documentElement.scrollWidth,cardH:card.height,cardBottom:card.bottom,actsTop:acts.top,actsBottom:acts.bottom,panelTop:box.top};})()`);
  check('375等待页自然高度/动作/状态不重叠且无横向溢出',geo.cardH>=240&&geo.cardBottom<=geo.actsTop+1&&geo.actsBottom<=geo.panelTop+1&&geo.doc<=geo.w+1,geo);
  await p.waitFor(`window.__vocab.getAutoResumeState().phase==='countdown'`,{timeout:40000,interval:250});
  check('未来到期后，真实30秒闲置才进入倒计时',Date.now()-begin>=29000&&await p.eval('window.__vocab.countDue()>0'),{elapsed:Date.now()-begin,state:await state()});
  await shot('countdown-375');
  await p.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:200,y:400,deltaX:0,deltaY:120});await sleep(150);
  check('真实用户滚轮取消倒计时，布局滚动不吞用户输入',await p.eval(`window.__vocab.getAutoResumeState().phase!=='countdown'&&window.__vocab.getAutoResumeState().waitingForDue`),await state());
  await p.waitFor(`window.__vocab.getAutoResumeState().phase==='countdown'`,{timeout:40000,interval:250});
  await p.waitFor('window.__vocab.cur!==null',{timeout:7000,interval:150});
  check('真实3秒启动不自动判定/计时/消耗预算',await p.eval(`window.__vocab.answered===0&&window.__vocab.phase==='recall'&&window.__vocab.getS().reviewDay.used===0&&window.__vocab.getS().timeSec===0&&JSON.stringify(window.__vocab.getS().days)===${JSON.stringify(daysBefore)}`),await state());
  check('首判前真实按钮准确叫返回等待页',await p.eval(`document.querySelector('#returnPrevResult').textContent==='返回等待页'&&window.__vocab.getAutoResumeState().returnKind==='waiting'`));
  await shot('started-375');await click('#returnPrevResult');
  check('返回恢复空等待而不冒充完成组',await p.eval(`window.__vocab.cur===null&&window.__vocab.getGroupTotal()===0&&window.__vocab.answered===0&&window.__vocab.getAutoResumeState().waitingForDue&&!window.__vocab.getAutoResumeState().completedPage`),await state());
  await click('#autoResumePause');const pause=await p.eval(`localStorage.getItem('vocab_autoresume_pause_v1')`);
  check('等待中今天暂停与退出按钮同时可用',await p.eval(`window.__vocab.getAutoResumeState().pausedToday&&!document.querySelector('#stopEmptyWait').hidden`),await state());
  await click('#stopEmptyWait');
  check('退出等待不解除今天暂停',await p.eval(`!window.__vocab.getAutoResumeState().waitingForDue&&localStorage.getItem('vocab_autoresume_pause_v1')===${JSON.stringify(pause)}`));
  await click('#again');await p.key('keyF');
  check('已有卡的揭示流程不提供空等待入口',await p.eval(`window.__vocab.phase==='revealed'&&document.querySelector('#autoResume').hidden&&!window.__vocab.getAutoResumeState().waitingForDue`),await state());
  await shot('revealed-375');
}catch(e){check('空页等待脚本完整执行',false,{error:String(e.stack||e),state:await state(),detail:await p.eval(`({visible:document.visibilityState,view:document.querySelector('.view.on').id,ar:window.__vocab.getAutoResume(),progress:window.__vocab.getS().progress,now:Date.now(),hint:document.querySelector('#autoResumeText').textContent,alert:document.querySelector('#appAlert').hidden,waiting:document.querySelector('#stopEmptyWait').hidden})`)});}
finally{
  report.errors.push(...p.errors());check('控制台无新增错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/empty-wait.json',JSON.stringify(report,null,2));
  await p.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
