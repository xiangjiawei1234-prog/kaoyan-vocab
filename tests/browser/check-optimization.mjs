#!/usr/bin/env node
/** 独立浏览器验收：Node内置CDP，无npm依赖；不加入默认Node汇总。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const pages=[],report={browser:await conn.send('Browser.getVersion'),checks:[],shots:[],errors:[]};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const open=async()=>{const p=await Page.open(conn,{url:server.url()});pages.push(p);await p.waitFor('window.__vocab && document.querySelector("#card")');return p;};
const shot=async(p,name)=>report.shots.push(await p.screenshot('optimization-'+name+'.png'));
const group=`(() => {const v=window.__vocab;return {cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,answered:v.answered,Q:v.Q,total:v.getGroupTotal(),plan:v.getPlan()};})()`;
// 不计实际阅读时长；检查恢复/设置操作不能隐式判定、消费额度或重写学习记录。
const learningLedger=`(() => {const s=window.__vocab.getS();return {progress:s.progress,days:s.days,reviewDay:s.reviewDay,extraDay:s.extraDay};})()`;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// 统计页纵向分区（真实 DOM class 字符串，index.html #v-stats 的直接 .panel 子节点）：
// 今日计划 → 学习总览 → 6 个原生 details 深入分析 → 备份与导出。
const STATS_ORDER=['panel review-action-panel','panel overview-panel',
  'panel stats-details','panel stats-details','panel stats-details',
  'panel stats-details','panel stats-details','panel stats-details',
  'panel stats-storage-panel'];
async function seed(p,settings,{makeOnly=false}={}){
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.eval(`(() => {const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS()));s.progress={};s.days={};s.proficient={};s.stars={};s.timeSec=0;s.spelling={};s.reviewDay={};s.extraDay={};
    Object.assign(s.settings,{theme:'light',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,order:'freq',dailyNew:2,groupSize:1,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}},${JSON.stringify(settings)});
    ${makeOnly?`const x=v.getW().find(x=>x.w==='make');s.settings.fmin=x.f;s.settings.fmax=x.f;`:''}
    localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.removeItem('vocab_autoresume_pause_v1');localStorage.removeItem('vocab_autoresume_lease_v1');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab && document.querySelector("#no")');
}
try{
  const a=await open();await a.setViewport(1440,1000);
  await a.eval(`localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));`);await a.reload();await a.waitFor('document.querySelector("#no")');
  const b=await open();await b.setViewport(1440,1000);
  await a.send('Page.bringToFront');await a.key('keyF');await sleep(150);const before=await a.eval(group);
  await b.send('Page.bringToFront');await b.clickSelector('#btnTheme');await sleep(250);
  check('另一标签切主题保留已揭示组',same(before,await a.eval(group)),await a.eval(group));
  await a.send('Page.bringToFront');await a.clickSelector('#btnHelp');await sleep(100);
  await b.send('Page.bringToFront');await b.clickSelector('[data-v="set"]');await b.scrollIntoView('#groupSize');await b.clickSelector('#groupSize');await b.eval(`document.querySelector('#groupSize').select()`);await b.insertText('3');await b.key('Tab');await sleep(250);
  check('远端组长保存不关帮助/不重开冻结组',same(before,await a.eval(group))&&await a.eval(`!document.querySelector('#helpSheet').hidden`),await a.eval(group));
  await a.send('Page.bringToFront');await a.key('Escape');await a.clickSelector('[data-v="set"]');await a.scrollIntoView('.combo-cards [data-combo="core"]');await a.clickSelector('.combo-cards [data-combo="core"]');await a.clickSelector('[data-v="study"]');
  const scope=await a.eval(`({head:document.querySelector('#scopeLabel').textContent,title:document.querySelector('#scopeLabel').title,study:document.querySelector('#studyScope').textContent,n:window.__vocab.getPlan().scopeCount,cur:window.__vocab.cur})`);
  check('页头和学习条同为冻结范围且提示下组',scope.head.includes(scope.n.toLocaleString())&&scope.study.includes(scope.n.toLocaleString())&&scope.title.includes('下一组'),scope);
  await shot(a,'scope-pending');
  await a.eval(`(() => {const v=window.__vocab,s=v.getS(),d=s.reviewDay.d;s.timeSec=200;s.reviewDay={d,used:9};s.extraDay={d,extra:40};s.spelling={sessions:2,attempts:2,correct:1,skipped:0,lastDay:null,lastSession:null};v.setGroupSize(s.settings.groupSize);})()`);
  await sleep(150);await b.send('Page.bringToFront');await b.clickSelector('[data-v="stats"]');await b.scrollIntoView('.stats-danger-area > summary');await b.clickSelector('.stats-danger-area > summary');await b.scrollIntoView('#rst');await b.clickSelector('#rst');
  await a.waitFor(`window.__vocab.getS().extraDay.extra===0 && window.__vocab.getS().spelling.sessions===0`);
  const replaced=await a.eval(`({token:JSON.parse(localStorage.getItem('kaoyan_vocab_v1'))._replace,progress:Object.keys(window.__vocab.getS().progress).length,used:window.__vocab.getS().reviewDay.used,extra:window.__vocab.getS().extraDay.extra,spell:window.__vocab.getS().spelling.sessions,time:window.__vocab.getS().timeSec})`);
  check('真实另一标签重置采用新代且不复活旧辅助记录',typeof replaced.token==='string'&&replaced.progress===0&&replaced.used===0&&replaced.extra===0&&replaced.spell===0&&replaced.time<10,replaced);
  await a.send('Page.bringToFront');await a.clickSelector('#btnTheme');
  const saved=await a.eval(`JSON.parse(localStorage.getItem('kaoyan_vocab_v1'))`);
  check('重置后普通设置保存保留代际且旧辅助记录不回写',saved._replace===replaced.token&&saved.reviewDay.used===0&&saved.extraDay.extra===0&&saved.spelling.sessions===0,{token:saved._replace,used:saved.reviewDay.used,extra:saved.extraDay.extra,spell:saved.spelling.sessions});
  await b.close();pages.splice(pages.indexOf(b),1);
  await seed(a,{dailyNew:2,groupSize:1});await a.setViewport(1280,900);
  const r=await a.rect('#card');await a.click(r.right-80,r.bottom-20);await a.key('keyF');await a.key('Space');await sleep(220);
  const focus=await a.eval(`({active:document.activeElement.id,visible:document.querySelector('#card').matches(':focus-visible'),outline:getComputedStyle(document.querySelector('#card')).outlineStyle,shadow:getComputedStyle(document.querySelector('#card')).boxShadow})`);
  check('点卡片后快捷键换词没有UA系统蓝框',focus.outline==='none',focus);await shot(a,'focus');
  await a.key('Tab');const tab=await a.eval(`({id:document.activeElement.id,tag:document.activeElement.tagName,outline:getComputedStyle(document.activeElement).outlineStyle})`);
  check('Tab仍到达可见焦点控件',tab.tag==='BUTTON'&&tab.outline!=='none',tab);
  for(const theme of ['light','dark']){
    await a.eval(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await a.clickSelector('[data-v="stats"]');
    for(const width of [320,375,424,720,721,768,1000,1001,1280,1440]){
      await a.setViewport(width,width<500?900:1000,{mobile:width<500});await a.eval(`document.querySelector('#main').scrollTop=0`);await sleep(100);
      const geo=await a.eval(`(() => {const v=document.querySelector('#v-stats'),rr=[...v.querySelectorAll(':scope > .panel')].map(x=>{const r=x.getBoundingClientRect();return {id:x.id||x.className,x:r.x,w:r.width,right:r.right,top:r.top,bottom:r.bottom};});return {w:innerWidth,doc:document.documentElement.scrollWidth,panels:rr,order:[...v.children].filter(x=>x.matches('.panel')).map(x=>x.className)};})()`);
      check('统计通栏边线/无水平溢出 '+theme+' '+width,geo.doc<=geo.w+1&&geo.panels.every(x=>Math.abs(x.x-geo.panels[0].x)<=1&&Math.abs(x.right-geo.panels[0].right)<=1),geo);
      check('统计分区顺序 '+theme+' '+width,same(geo.order,STATS_ORDER),geo.order);
      const tops=geo.panels.map(x=>x.top),first=geo.panels[0],last=geo.panels[geo.panels.length-1];
      check('统计分区纵向单调/首尾边线一致 '+theme+' '+width,
        geo.panels.length===STATS_ORDER.length&&tops.every((t,i)=>i===0||t>=tops[i-1]-0.5)
        &&Math.abs(first.x-last.x)<=1&&Math.abs(first.right-last.right)<=1,
        {tops,first,last,count:geo.panels.length});
      if([375,768,1440].includes(width))await shot(a,'stats-'+theme+'-'+width);
    }
  }
  await a.setViewport(375,900,{mobile:true});await a.eval(`document.querySelectorAll('#v-stats details.stats-details').forEach(x=>x.open=true)`);await sleep(150);await shot(a,'stats-expanded-375');
  check('统计展开不产生页面级横向溢出',await a.eval('document.documentElement.scrollWidth<=innerWidth+1'));
  await a.eval(`document.documentElement.dataset.fontSize='large'`);await a.setViewport(320,800,{mobile:true});await sleep(100);
  check('大字320统计无横向溢出',await a.eval('document.documentElement.scrollWidth<=innerWidth+1'));
  await a.setViewport(640,450);await a.eval(`document.documentElement.style.zoom='2'`);await sleep(100);
  check('200% CSS缩放主区可滚动',await a.eval(`getComputedStyle(document.querySelector('#main')).overflowY==='auto'`));await shot(a,'stats-zoom200');await a.eval(`document.documentElement.style.zoom='';document.documentElement.dataset.fontSize='standard'`);
  await seed(a,{dailyNew:1,groupSize:1},{makeOnly:true});await a.setViewport(1280,900);
  await a.key('keyF');await a.key('Enter');await sleep(100);await a.clickSelector('#startSpellingBtn');
  const spelling=await a.eval(`({word:window.__vocab.getSpellingState().current.w,text:document.querySelector('#spellPrompt').innerText,input:document.querySelector('#spellInput').value,main:window.__vocab.getW().find(x=>x.w==='make').m})`);
  check('真实make拼写题面不泄漏英文而主释义保留',spelling.word==='make'&&!/make|headway/i.test(spelling.text)&&spelling.main.includes('make headway')&&spelling.input==='',spelling);await shot(a,'spelling-make');
  await a.insertText('make');await a.key('Enter');await sleep(100);
  check('拼写提交后反馈可显示正确答案',await a.eval(`/make/i.test(document.querySelector('#spellFeedback').innerText)`));await a.key('Escape');
  await seed(a,{dailyNew:2,groupSize:1});await a.setViewport(424,900,{mobile:true});await a.key('keyF');await a.key('Enter');await sleep(100);
  const done=await a.eval(`({text:document.querySelector('#again').textContent,disabled:document.querySelector('#again').disabled,duplicates:!!document.querySelector('#autoResumeNow, #nextGroupBtn'),quick:!document.querySelector('#autoResumeQuick').hidden})`);
  check('完成页唯一继续入口和可发现便捷入口',done.text.startsWith('继续下一组')&&!done.disabled&&!done.duplicates&&done.quick,done);await shot(a,'completion');
  await a.clickSelector('#autoResumeQuick');const started=Date.now();
  await a.waitFor(`window.__vocab.getAutoResumeState().phase==='countdown'`,{timeout:40000,interval:400});
  check('真实30秒闲置进入倒计时',Date.now()-started>=29000,{elapsed:Date.now()-started,state:await a.eval('window.__vocab.getAutoResumeState()')});await shot(a,'countdown');
  await a.waitFor('window.__vocab.cur!==null',{timeout:7000,interval:200});
  const next=await a.eval(`({answered:window.__vocab.answered,phase:window.__vocab.phase,ret:window.__vocab.getAutoResumeState().returnAvailable,n:Object.values(window.__vocab.getS().days).reduce((s,d)=>s+d.n,0)})`);
  check('真实3秒后自动开组不判定/消费新词且可返回',next.answered===0&&next.phase==='recall'&&next.ret&&next.n===1,next);await shot(a,'auto-started');
  await a.clickSelector('#returnPrevResult');await a.clickSelector('#autoResumePause');const pause=await a.eval(`localStorage.getItem('vocab_autoresume_pause_v1')`);await a.clickSelector('#again');
  check('今日暂停后手动继续可用且不解除暂停',await a.eval(`window.__vocab.cur!==null&&localStorage.getItem('vocab_autoresume_pause_v1')===${JSON.stringify(pause)}`));

  // M01/M02 维护回归：追加在原有检查之后，保留既有全部验收路径。
  // 自定义续背用真实点击恢复；曲线只改预设，再分别通过学习页/设置页显式重开。
  const presets=await a.eval('window.__vocab.getStagePresets()');
  for(const width of [375,1440]){
    const mobile=width===375;
    await a.setViewport(width,mobile?812:1000,{mobile});
    const customResume={enabled:true,threshold:1,idleMs:90000,countdownMs:7000};
    await seed(a,{dailyNew:2,groupSize:1,autoResume:customResume});
    await a.key('keyF');await a.key('Enter');await a.waitFor('document.querySelector("#again")');
    // 其他书同日暂停是夹具；被测操作仍必须保留它，只解除当前书。
    await a.eval(`localStorage.setItem('vocab_autoresume_pause_v1',JSON.stringify({cet4:window.__vocab.getAutoResumePause().today}))`);
    await a.scrollIntoView('#autoResumePause');await a.clickSelector('#autoResumePause');
    const pausedResume=await a.eval(`({config:window.__vocab.getAutoResume(),pause:window.__vocab.getAutoResumePause(),store:JSON.parse(localStorage.getItem('vocab_autoresume_pause_v1')||'{}')})`);
    await a.scrollIntoView('#autoResumeRestore');
    check('M01 今日暂停保留自定义且恢复入口可点击 '+width,
      same(pausedResume.config,customResume)&&pausedResume.pause.pausedToday
      &&pausedResume.store.cet4===pausedResume.pause.today&&await a.isClickable('#autoResumeRestore'),pausedResume);
    await shot(a,'m01-paused-'+width);
    const resumeGroup=await a.eval(group),resumeLedger=await a.eval(learningLedger);
    await a.clickSelector('#autoResumeRestore');
    const restoredResume=await a.eval(`({config:window.__vocab.getAutoResume(),pause:window.__vocab.getAutoResumePause(),store:JSON.parse(localStorage.getItem('vocab_autoresume_pause_v1')||'{}'),runtime:window.__vocab.getAutoResumeState()})`);
    check('M01 恢复原90秒7秒方案且仅清本书暂停 '+width,
      same(restoredResume.config,customResume)&&!restoredResume.pause.pausedToday
      &&!Object.hasOwn(restoredResume.store,'kaoyan')&&restoredResume.store.cet4===restoredResume.pause.today,restoredResume);
    const resumedGroup=await a.eval(group),resumedLedger=await a.eval(learningLedger);
    check('M01 恢复不重开组不判定不消费额度 '+width,
      same(resumeGroup,resumedGroup)&&same(resumeLedger,resumedLedger),{before:resumeGroup,after:resumedGroup,ledger:resumedLedger});
    check('M01 恢复重新等待而非立即倒计时 '+width,
      restoredResume.runtime.phase!=='countdown'&&restoredResume.runtime.countdownDeadline===0
      &&(restoredResume.runtime.idleSince===null||restoredResume.runtime.idleRemainingMs>=88000),restoredResume.runtime);
    check('M01 恢复后375或桌面无页面横向溢出 '+width,await a.eval('document.documentElement.scrollWidth<=innerWidth+1'));
    await shot(a,'m01-restored-'+width);

    await seed(a,{dailyNew:5,groupSize:3,stages:presets.balanced.stages,relearn:presets.balanced.relearn,stagePreset:'balanced'});
    await a.key('keyF');await a.waitFor('window.__vocab.phase!=="recall"');
    const rhythmGroup=await a.eval(group),rhythmLedger=await a.eval(learningLedger);
    await a.clickSelector('[data-v="set"]');
    await a.scrollIntoView('#rhythmPresets [data-preset="light"]');await a.clickSelector('#rhythmPresets [data-preset="light"]');
    const changedRhythm=await a.eval(`({group:${group},ledger:${learningLedger},stages:window.__vocab.getStages(),relearn:window.__vocab.getRelearn(),pending:window.__vocab.hasPendingScopeSettings(),current:document.querySelector('#settingsCurrentGroup').textContent,restartHidden:document.querySelector('#applySettingsRestart').hidden})`);
    check('M02 仅改曲线保存轻负荷但本组和已写到期时间冻结 '+width,
      same(changedRhythm.stages,presets.light.stages)&&changedRhythm.relearn===presets.light.relearn
      &&same(rhythmGroup,changedRhythm.group)&&same(rhythmLedger,changedRhythm.ledger),changedRhythm);
    check('M02 曲线差异显示待生效及设置页显式重开 '+width,
      changedRhythm.pending&&!changedRhythm.restartHidden&&changedRhythm.current.includes('下一组')
      &&!changedRhythm.current.includes('与当前设置一致'),changedRhythm);
    await a.scrollIntoView('#settingsLifecycle');await shot(a,'m02-settings-pending-'+width);
    await a.clickSelector('[data-v="study"]');
    const rhythmNotice=await a.eval(`({hidden:document.querySelector('#planPendingNotice').hidden,text:document.querySelector('#planPendingText').textContent,group:${group}})`);
    check('M02 学习页提示下组生效且旧范围签名保持兼容 '+width,
      !rhythmNotice.hidden&&rhythmNotice.text.includes('下一组')&&same(rhythmNotice.group,rhythmGroup)
      &&rhythmNotice.group.plan.scopeSig===rhythmGroup.plan.scopeSig,rhythmNotice);
    await a.scrollIntoView('#planPendingNotice');await shot(a,'m02-study-pending-'+width);
    const restartSelector=mobile?'#planPendingApply':'#applySettingsRestart';
    if(!mobile)await a.clickSelector('[data-v="set"]');
    await a.scrollIntoView(restartSelector);
    check('M02 '+(mobile?'学习页':'设置页')+'重开入口真实可命中 '+width,await a.isClickable(restartSelector));
    await a.clickSelector(restartSelector);
    const restartedRhythm=await a.eval(`({group:${group},ledger:${learningLedger},pending:window.__vocab.hasPendingScopeSettings(),noticeHidden:document.querySelector('#planPendingNotice').hidden})`);
    check('M02 显式重开采用新曲线并清除待生效不追溯进度 '+width,
      !restartedRhythm.pending&&restartedRhythm.noticeHidden&&restartedRhythm.group.phase==='recall'
      &&restartedRhythm.group.answered===0&&restartedRhythm.group.plan.startedAt>rhythmGroup.plan.startedAt
      &&same(restartedRhythm.group.plan.stagesMs,presets.light.stages.map(n=>n*60000))
      &&restartedRhythm.group.plan.relearnMs===presets.light.relearn*60000
      &&same(restartedRhythm.ledger.progress,rhythmLedger.progress),restartedRhythm);
    await a.clickSelector('[data-v="study"]');await shot(a,'m02-restarted-'+width);
  }
}catch(e){check('浏览器脚本执行完整',false,String(e.stack||e));}
finally{
  for(const p of pages)report.errors.push(...p.errors());check('控制台无新增错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/optimization.json',JSON.stringify(report,null,2));
  for(const p of pages)await p.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/optimization.json'}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
