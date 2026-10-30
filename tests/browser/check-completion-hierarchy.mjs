#!/usr/bin/env node
/** P09 完成页层级：夹具只初始化存储，以真实按键/指针自然完成，不伪造cur/Q/answered。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['Chrome headless隔离profile；手机视口/触摸仿真不代表真机或读屏','只在reload前初始化存储；以真实按键/点击/触摸自然完成组，调试钩子只读取证']};
const check=(name,ok,actual={})=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
let p=await Page.open(conn,{url:server.url()});
const desktopOnly=process.argv.includes('--only=desktop'),fileErrors=[];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const scene=`(()=>{const v=window.__vocab;return {book:v.getBook(),cur:v.cur,phase:v.phase,verdict:v.verdict,answered:v.answered,qi:v.qi,Q:v.Q,plan:v.getPlan(),total:v.getGroupTotal(),days:v.getS().days,review:v.getS().reviewDay,extra:v.getS().extraDay,progress:v.getS().progress};})()`;
async function key(name,options={}){await p.send('Page.bringToFront');await p.key(name,options);}
async function click(sel,{touch=false}={}){await p.send('Page.bringToFront');await p.scrollIntoView(sel);await sleep(100);if(!await p.isClickable(sel))throw Error('控件不可真实命中：'+sel);if(touch){const r=await p.rect(sel);await p.touchTap(r.cx,r.cy);}else await p.clickSelector(sel);await sleep(100);}
async function shot(name){report.shots.push(await p.screenshot('completion-hierarchy-'+name+'.png'));}
async function seed({book='kaoyan',width=1440,height=1000,theme='light',large=false,dailyNew=3,groupSize=1,cap=100,due=0,wrong=false,future=0,enabled=false}={}){
 await p.setViewport(width,height,{mobile:width<500});
 const meta={kaoyan:['kaoyan_vocab_v1','kaoyan_vocab_proficient_v1',3],cet4:['cet4_vocab_v1','cet4_vocab_proficient_v1',5],cet6:['cet6_vocab_v1','cet6_vocab_proficient_v1',4],combined:['combined_vocab_v1','combined_vocab_proficient_v1',3]}[book];
 const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));"});
 try{
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS())),now=Date.now(),d=new Date(),day=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');s.dv=${meta[2]};s.progress={};s.days={};s.stars={};s.proficient={};s.timeSec=0;s.reviewDay={d:day,used:0};s.extraDay={d:day,extra:0};s.spelling={};
   for(let i=0;i<${due};i++)s.progress[i]=[1,now-1000,1,0,now-86400000];
   ${wrong?"s.progress[0]=[0,0,0,1,0];":""}
   ${future?`s.progress[0]=[1,now+${future},1,0,now-86400000];s.days[day]={n:${dailyNew},r:${dailyNew},ok:${dailyNew},no:0};`:''}
   Object.assign(s.settings,{studyMode:'standard',dailyNew:${dailyNew},groupSize:${groupSize},dailyReviewCap:${cap},order:'freq',pmin:0,fmin:1,fmax:0,pos:[],posMode:'primary',kyOnly:false,theme:${JSON.stringify(theme)},fontSize:${large?"'large'":"'standard'"},autoSpk:false,singleCharKeys:true,keys:{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},actionKeys:{continue:null,wait:null,return:null,listSearch:null},autoResume:{enabled:${enabled},threshold:1,idleMs:30000,countdownMs:3000}});
   localStorage.clear();sessionStorage.clear();localStorage.setItem(${JSON.stringify(meta[0])},JSON.stringify(s));localStorage.setItem(${JSON.stringify(meta[1])},'{}');localStorage.setItem('vocab_active_book_v1',${JSON.stringify(book)});localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#card")');await p.send('Page.bringToFront');await sleep(140);
 }finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
}
async function finishOne(){await key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');await key('Space');await p.waitFor('window.__vocab.cur==null');}
async function finishGroup(){for(let n=0;n<100&&await p.eval('window.__vocab.cur!=null');n++){await key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');await key('Space');}await p.waitFor('window.__vocab.cur==null');}
const presentation=`(()=>{const c=document.querySelector('#card'),m=window.__vocab.deriveStudyPresentation(),a=document.querySelector('#again'),d=c.querySelector('.done-details');return {title:c.querySelector('h2')?.textContent,summary:c.querySelector('.done-summary')?.textContent,next:c.querySelector('.done-next')?.textContent,context:c.querySelector('.done-context')?.textContent,details:d?.textContent,detailsOpen:d?.open,big:!!c.querySelector('.big'),primary:[...document.querySelectorAll('#acts > .btn.primary')].filter(b=>!b.disabled&&!b.hidden).map(b=>b.id),again:a?{disabled:a.disabled,primary:a.classList.contains('primary'),text:a.textContent}:null,model:{state:m.state,mode:m.mode,primary:m.primaryAction,reason:m.reason,candidates:m.candidates},doc:document.documentElement.scrollWidth,width:innerWidth};})()`;
async function desktopLayout(label,controls=[]){
 await p.eval(`document.querySelector('#main').scrollTop=0`);await p.nextFrame();
 const actual=await p.eval(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};},view=document.querySelector('#v-study'),card=document.querySelector('#card'),main=document.querySelector('#main');return {display:getComputedStyle(view).display,card:rect(card),main:rect(main),bar:rect(document.querySelector('#studyModeBar')),stats:rect(document.querySelector('#statLine')),cardOverflow:getComputedStyle(card).overflowY,cardClient:card.clientHeight,cardScroll:card.scrollHeight,mainOverflow:getComputedStyle(main).overflowY,doc:document.documentElement.scrollWidth,width:innerWidth,done:!!card.querySelector('.done'),status:[...document.querySelector('#groupStatus').children].filter(e=>!e.hidden&&e.getClientRects().length>0).map(e=>e.id)};})()`);
 check(label+' 完成类状态仍为桌面网格且词卡居中限宽',actual.done&&actual.display==='grid'&&actual.card.width<=1041&&Math.abs(actual.card.left+actual.card.width/2-actual.width/2)<=2,actual);
 check(label+' 侧栏在卡片右侧且不推高统计首行',actual.bar.left>=actual.card.right+2&&actual.bar.right<=actual.main.right+1&&actual.bar.top<=actual.stats.top+2&&actual.stats.height<=125,actual);
 check(label+' 自然高度只由主区滚动且无横向溢出',actual.cardScroll<=actual.cardClient+2&&!['auto','scroll'].includes(actual.cardOverflow)&&actual.mainOverflow==='auto'&&actual.card.height>=240&&actual.doc<=actual.width+1,actual);
 for(const control of controls){await p.scrollIntoView(control);await sleep(80);check(label+' '+control+' 可自然滚到并真实命中',await p.isClickable(control));}
}
async function completionModes(label){
 const before=await p.eval(scene);
 for(const mode of ['standard','simple','immersive']){
  await click('#studyModeBar [data-study-mode="'+mode+'"]');await p.eval(`document.querySelector('#main').scrollTop=0`);await p.nextFrame();
  const actual=await p.eval(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,width:r.width};},view=document.querySelector('#v-study'),card=document.querySelector('#card'),bar=document.querySelector('#studyModeBar'),first=[...view.children].find(e=>e!==bar&&!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).display!=='none');return {mode:document.documentElement.dataset.studyMode,display:getComputedStyle(view).display,card:rect(card),bar:rect(bar),first:first?{id:first.id,...rect(first)}:null,statsVisible:document.querySelector('#statLine').getClientRects().length>0,width:innerWidth};})()`);
  check(label+' '+mode+' 完成类三模式仍居中网格且侧栏与首个可见内容同行',actual.mode===mode&&actual.display==='grid'&&actual.card.width<=(mode==='immersive'?861:1041)&&Math.abs(actual.card.left+actual.card.width/2-actual.width/2)<=2&&actual.bar.left>=actual.card.right+2&&actual.first&&Math.abs(actual.bar.top-actual.first.top)<=2&&actual.statsVisible===(mode==='standard'),actual);
  check(label+' '+mode+' 切换不改学习现场',same(before,await p.eval(scene)));
 }
 await click('#studyModeBar [data-study-mode="standard"]');
}
async function desktopStateJourneys(){
 for(const cfg of [{book:'kaoyan',width:1440,height:900,theme:'light'},{book:'combined',width:1280,height:720,theme:'dark'}]){
  const label=cfg.width+' '+cfg.book+' '+cfg.theme;
  await seed({...cfg,enabled:true});await finishOne();await desktopLayout(label+' 自然完成',['#again','#autoResumePause']);await completionModes(label+' 自然完成');
  await seed({...cfg,dailyNew:1});await finishOne();await desktopLayout(label+' 额度耗尽完成',['#extraNew10']);
  await seed({...cfg,future:120000,dailyNew:1,enabled:true});
  check(label+' 普通空页真实无当前词并显示独立状态区',await p.eval(`window.__vocab.cur===null&&window.__vocab.deriveStudyPresentation().state==='empty'&&[...document.querySelector('#groupStatus').children].some(e=>!e.hidden&&e.getClientRects().length>0)`));
  await desktopLayout(label+' 普通空页',['#startEmptyWait']);
  await click('#startEmptyWait');await desktopLayout(label+' 显式等待',['#stopEmptyWait']);
  await click('#autoResumePause');await desktopLayout(label+' 今日暂停',['#autoResumeRestore','#stopEmptyWait']);
  await seed(cfg);await click('#btnSaveRest');
  check(label+' 保存并休息仍保留未完成现场',await p.eval(`window.__vocab.isResting()&&window.__vocab.cur!==null&&window.__vocab.answered===0`));
  await desktopLayout(label+' 保存并休息',['#restResume']);await shot('desktop-states-'+cfg.width+'-'+cfg.book);
 }
 // 直接打开真实交付文件；先在隔离 profile 准备合法记录，再关闭该页并冷启动新页。
 const httpPage=p,fileURL=pathToFileURL(path.join(REPO_ROOT,'index.html')).href;
 const recordFileErrors=page=>{const errors=page.errors(),expected=errors.filter(e=>/manifest\.webmanifest/.test(e.text)&&/CORS|ERR_FAILED/.test(e.text));report.fileExpectedBrowserWarnings=(report.fileExpectedBrowserWarnings||[]).concat(expected);fileErrors.push(...errors.filter(e=>!expected.includes(e)));};
 try{
  p=await Page.open(conn,{url:fileURL});await p.waitFor('window.__vocab');
  await seed({book:'combined',width:1440,height:900,theme:'dark',future:120000,dailyNew:1,enabled:true});recordFileErrors(p);await p.close();
  p=await Page.open(conn,{url:fileURL});await p.setViewport(1440,900);await p.waitFor('window.__vocab&&document.querySelector("#card .done")');await p.send('Page.bringToFront');
  const file=await p.eval(`({protocol:location.protocol,book:window.__vocab.getBook(),theme:document.documentElement.dataset.theme,offline:window.__vocab.getOfflineStatus().status,state:window.__vocab.deriveStudyPresentation().state,cur:window.__vocab.cur})`);
  check('file协议冷启动保留深色综合词书普通空页',file.protocol==='file:'&&file.book==='combined'&&file.theme==='dark'&&file.offline==='file'&&file.state==='empty'&&file.cur===null,file);
  await desktopLayout('file协议1440深色综合空页',['#startEmptyWait']);await completionModes('file协议1440深色综合空页');
  await p.eval(`document.querySelector('#main').scrollTop=0`);await p.nextFrame();await shot('file-combined-dark-empty');
  await click('#startEmptyWait');await desktopLayout('file协议1440深色综合等待',['#stopEmptyWait']);
  await click('#autoResumePause');await desktopLayout('file协议1440深色综合今日暂停',['#autoResumeRestore']);await shot('file-combined-dark-paused');
 }finally{if(p!==httpPage){recordFileErrors(p);await p.close();}p=httpPage;}
}
try{
 await p.waitFor('window.__vocab');
 await desktopStateJourneys();
 if(!desktopOnly){
 for(const cfg of [{book:'kaoyan',width:1440,height:1000},{book:'cet4',width:375,height:812,theme:'dark',large:true},{book:'cet6',width:320,height:568,large:true},{book:'combined',width:844,height:390,theme:'dark'}]){
  await seed(cfg);const first=await p.eval(scene);await finishOne();const done=await p.eval(presentation);
  check(cfg.book+' 完成数量先呈现，判定细节默认收进说明',done.title==='本组完成'&&done.summary?.includes('完成 1/1 词')&&!done.summary?.includes('判定')&&done.details?.includes('本次判定 1 次')&&!done.detailsOpen,done);
  check(cfg.book+' 当前范围掌握量为次级摘要，无大号全局成绩',!done.big&&done.context?.includes('当前范围')&&done.context?.includes('掌握'),done);
  check(cfg.book+' 下一步摘要与只读模型一致，唯一主继续',done.next?.includes(String(done.model.candidates.available))&&done.model.primary==='continue'&&same(done.primary,['again'])&&!done.again.disabled,done);
  check(cfg.book+' 完成卡自然高度无内滚动与横向溢出',await p.eval(`(()=>{const c=document.querySelector('#card'),r=c.getBoundingClientRect(),s=getComputedStyle(c);return c.scrollHeight<=c.clientHeight+2&&!['auto','scroll'].includes(s.overflowY)&&r.height>=240&&document.documentElement.scrollWidth<=innerWidth+1;})()`));
  const before=await p.eval(scene);
  if(await p.eval('!!document.querySelector(".done-details > summary")')){await click('.done-details > summary');await click('.done-details > summary');}
  check(cfg.book+' 展开说明仅改变呈现，组现场/进度/配额保持',same(before,await p.eval(scene)));
  for(const sel of ['#again','#startSpellingBtn','#goStats','#undoBtn']){
   if(await p.eval(`!!document.querySelector(${JSON.stringify(sel)})`)){await p.scrollIntoView(sel);await sleep(100);check(cfg.book+' '+sel+' 可直接真实命中',await p.isClickable(sel));}
  }
  await p.eval("document.querySelector('#main').scrollTop=0");await shot(cfg.book+'-'+cfg.width);
  await p.eval("document.querySelector('#card').focus()");await key('Enter');await p.waitFor('window.__vocab.cur!=null&&window.__vocab.phase==="recall"');
  check(cfg.book+' 固定Enter继续且新组未判定',await p.eval('window.__vocab.answered===0&&window.__vocab.verdict===null')&&await p.eval('window.__vocab.cur')!==first.cur);
 }
 await seed();await finishOne();await p.scrollIntoView('#again');await click('#btnHelp');await sleep(1200);
 const modalGuard=await p.eval('window.__vocab.deriveStudyPresentation().blockedBy');await key('Escape');const closedAt=Date.now();
 const immediate=await p.eval('!document.querySelector("#again").disabled');await p.clickSelector('#again');await p.waitFor('window.__vocab.cur!=null');
 check('帮助关闭后立即点击继续，无等下一次tick的禁用延迟',modalGuard==='sheet'&&immediate&&Date.now()-closedAt<800&&await p.eval('window.__vocab.answered===0'));
 await seed({groupSize:1});await key('keyJ');await key('Space');await p.waitFor('window.__vocab.cur!=null&&window.__vocab.phase==="recall"');await finishGroup();const retried=await p.eval(presentation);
 check('重考后的判定次数与固定分母分开，不编造本组正确率',retried.summary?.includes('完成 1/1 词')&&retried.details?.includes('本次判定 2 次')&&retried.details?.includes('记为会 1 次')&&!retried.summary?.includes('%'),retried);
 await seed({width:320,height:568,large:true,dailyNew:1});await finishOne();const exhausted=await p.eval(presentation),exScene=await p.eval(scene);
 check('零候选解释新词目标，禁用继续不装成主按钮',exhausted.again.disabled&&!exhausted.again.primary&&exhausted.primary.length===0&&exhausted.model.primary===null&&exhausted.next?.includes('新词'),exhausted);
 await key('Enter');check('零候选Enter不空开组/加量/取得等待资格',same(exScene,await p.eval(scene))&&await p.eval('!window.__vocab.getAutoResumeState().waitingForDue'));
 await shot('exhausted-320');
 await seed({width:375,height:812,future:2000,dailyNew:1,enabled:true});const empty=await p.eval(presentation);
 check('普通空页与真正完成分开，未默认开始等待',empty.title==='暂无待背单词'&&empty.model.state==='empty'&&await p.eval('!window.__vocab.getAutoResumeState().waitingForDue'),empty);
 check('普通空页只突出模型的开始等待主动作',empty.model.primary==='wait'&&await p.eval('document.querySelector("#startEmptyWait").classList.contains("primary")&&!document.querySelector("#again").classList.contains("primary")'));
 await click('#startEmptyWait');const wait=await p.eval(presentation),stable=await p.eval(scene);
 check('显式等待状态与退出主语保持真实',wait.title==='本页等待到期'&&wait.model.state==='wait'&&await p.eval('!document.querySelector("#stopEmptyWait").hidden'),wait);
 check('等待页突出真实退出动作，仍可直接手动继续',wait.model.primary==='stopWait'&&await p.eval('document.querySelector("#stopEmptyWait").classList.contains("primary")&&!document.querySelector("#again").classList.contains("primary")'));
 await p.eval("document.querySelector('#stopEmptyWait').focus();window.__p09CardNode=document.querySelector('.done-summary');");
 await p.waitFor('window.__vocab.countDue()>0',{timeout:10000});await sleep(1200);const updated=await p.eval(presentation);
 check('候选到期只刷新下一步摘要，卡片节点与焦点保持',updated.model.candidates.available>0&&updated.next?.includes(String(updated.model.candidates.available))&&await p.eval('window.__p09CardNode===document.querySelector(".done-summary")&&document.activeElement.id==="stopEmptyWait"'),updated);
 check('等待候选更新不判定、不消费额度',same(stable,await p.eval(scene)));
 await click('#autoResumePause');check('今天暂停保持可见恢复/退出入口',await p.eval('window.__vocab.getAutoResumeState().pausedToday&&!document.querySelector("#autoResumeRestore").hidden&&!document.querySelector("#stopEmptyWait").hidden'));
 await shot('waiting-paused-375');await click('#stopEmptyWait');await click('#again');
 check('手动继续不解除今日自动暂停',await p.eval('window.__vocab.cur!=null&&window.__vocab.answered===0&&window.__vocab.getAutoResumeState().pausedToday'));
 await seed({wrong:true,dailyNew:2});await finishOne();const main=await p.eval(scene);await click('#startDrillBtn');await p.waitFor('window.__vocab.drillMode&&window.__vocab.cur!=null');await finishOne();const drill=await p.eval(presentation);
 check('特训完成返回优先，再练仍直接可达',drill.title==='错词特训完成'&&same(drill.primary,['exitDrillBtn'])&&await p.eval('!!document.querySelector("#again")&&!document.querySelector("#again").disabled'),drill);
 await shot('drill-done');await key('Enter');await p.waitFor('!window.__vocab.drillMode');
 const afterDrill=await p.eval(scene);check('特训完成Enter返回原主组完成现场',afterDrill.cur===main.cur&&afterDrill.answered===main.answered&&same(afterDrill.Q,main.Q)&&same(afterDrill.plan,main.plan));
 await seed({width:375,height:812,due:2,groupSize:2,cap:1});await key('keyF');await key('Space');await p.waitFor('window.__vocab.isCapPaused()');const paused=await p.eval(scene);
 check('额度暂停仍保留原卡与固定分母，不伪装完成',paused.cur!=null&&paused.total===2&&await p.eval('!document.querySelector("#capPause").hidden'));
 await click('#extraNewCustomPaused');await click('#extraNewCustomInputPaused');await p.eval("document.querySelector('#extraNewCustomInputPaused').select()");await p.insertText('1');await click('#extraNewCustomGoPaused');await p.waitFor('window.__vocab.isExtraSubgroup()&&window.__vocab.cur!=null');await finishGroup();const subgroup=await p.eval(presentation);
 check('临时子组完成唯一主返回，不混入主组继续',subgroup.title==='临时加量完成'&&same(subgroup.primary,['extraBack'])&&subgroup.model.mode==='extra'&&!subgroup.again,subgroup);
 await shot('subgroup-done-375');await key('Enter');await p.waitFor('!window.__vocab.isExtraSubgroup()');const returned=await p.eval(scene);
 check('子组Enter恢复额度暂停原卡、队列与冻结计划',returned.cur===paused.cur&&returned.answered===paused.answered&&same(returned.Q,paused.Q)&&same(returned.plan,paused.plan)&&await p.eval('window.__vocab.isCapPaused()'));
 await click('#capPauseEnd');const capDone=await p.eval(presentation);
 check('主动结束额度暂停明确保留原因，不写完成',capDone.title==='本组已暂停'&&capDone.model.reason==='cap-ended'&&capDone.next?.includes('额度')&&!capDone.again.primary,capDone);
 await shot('cap-ended-375');
 const endedScene=await p.eval(scene);await click('[data-v="set"]');await click('#reviewCapPresets [data-cap="30"]');await click('[data-v="study"]');const restoredCap=await p.eval(presentation);
 check('主动结束后提高上限仍显示暂停结果，明确额度恢复与重新开组',restoredCap.title==='本组已暂停'&&restoredCap.model.reason==='cap-ended'&&restoredCap.next?.includes('额度已恢复')&&!restoredCap.again.disabled&&restoredCap.again.primary,restoredCap);
 const afterCap=await p.eval(scene);check('提高上限不重建已结束组、不追溯进度或消费额度',afterCap.cur===endedScene.cur&&afterCap.answered===endedScene.answered&&same(afterCap.Q,endedScene.Q)&&same(afterCap.plan,endedScene.plan)&&same(afterCap.progress,endedScene.progress)&&same(afterCap.days,endedScene.days)&&same(afterCap.review,endedScene.review));
 await click('#again');check('额度恢复后正式继续只开待自评的新组',await p.eval('window.__vocab.cur!=null&&window.__vocab.answered===0&&window.__vocab.phase==="recall"'));
 await seed({width:375,height:812,future:120000,dailyNew:1,enabled:false});
 check('未开启自动策略的空页主动作明确启用并等待',await p.eval('window.__vocab.deriveStudyPresentation().primaryAction==="enableWait"&&document.querySelector("#autoResumeQuick").classList.contains("primary")&&document.querySelector("#autoResumeQuick").textContent==="启用便捷并在本页等待"'));
 await seed({width:375,height:812,future:120000,dailyNew:1,enabled:true});await click('#autoResumePause');
 check('暂停且零候选的普通空页突出恢复今天，原方案不变',await p.eval('window.__vocab.deriveStudyPresentation().primaryAction==="restoreAuto"&&document.querySelector("#autoResumeRestore").classList.contains("primary")&&window.__vocab.getAutoResume().threshold===1'));
 await seed({width:375,height:812});await p.eval("window.__p09SetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='kaoyan_vocab_v1')throw new DOMException('P09 forced save failure','QuotaExceededError');return window.__p09SetItem.call(this,k,v);}");
 await finishOne();const failedSave=await p.eval(presentation),failedScene=await p.eval(scene);
 check('持续保存失败结果页明确未保存，不把可背候选包装为可用继续',failedSave.next?.includes('尚未保存')&&failedSave.model.candidates.available>0&&failedSave.again.disabled&&!failedSave.again.primary&&await p.eval('!document.querySelector("#appAlert").hidden'),failedSave);
 await key('Enter');await sleep(1200);check('保存失败阻止开组且摘要保持，不被普通提示计时收起',same(failedScene,await p.eval(scene))&&await p.eval('document.querySelector("#doneNext").textContent.includes("尚未保存")&&!document.querySelector("#appAlert").hidden'));
 await p.eval("Storage.prototype.setItem=window.__p09SetItem");await shot('save-error-375');
 }
 report.errors=p.errors().concat(fileErrors);check('旅程无浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('取证期间运行时字节保持一致',same(report.sources,report.sourcesAfter));
}catch(error){check('旅程完整执行',false,{error:String(error.stack||error)});report.errors=p.errors();}
finally{
 await p.close();await conn.close();await chrome.close();await server.close();
 const file=path.join(RESULTS_DIR,desktopOnly?'completion-hierarchy-desktop.json':'completion-hierarchy.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
 const passed=report.checks.filter(c=>c.ok).length,failed=report.checks.length-passed;console.log(JSON.stringify({passed,failed,report:file,screenshots:report.shots.length}));if(failed)process.exitCode=1;
}
