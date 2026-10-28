#!/usr/bin/env node
/** P08：真实页面提示任务；UI触发消息，真实鼠标/Tab/Enter/触摸；计时边界另由test-toast受控时钟验证。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const files=['index.html','js/app.js','css/app.css','sw.js'];
const fingerprint=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['Chrome隔离profile；手机/触摸仿真不等于真机','IME候选事件为合成事件，仅证明DOM守卫；真实输入法、读屏和系统后台休眠未验','具体计时余量、上限与旧回调由受控时钟执行真实app.js验证；浏览器使用真实时间任务抽测','临时应用副本只额外暴露真实toast入口，用于已聚焦替换和1000码点布局；不暴露或写入学习状态。其余业务提示均由真实UI触发']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
// 源文件不变：副本只加一个普通提示入口，避免用背词快捷键伪造异步提示来源。
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'vocab-toast-'));
for(const file of ['index.html','css','assets','manifest.webmanifest','sw.js'])fs.symlinkSync(path.join(REPO_ROOT,file),path.join(fixture,file));
fs.mkdirSync(path.join(fixture,'js'));
for(const file of fs.readdirSync(path.join(REPO_ROOT,'js')))if(file!=='app.js')fs.symlinkSync(path.join(REPO_ROOT,'js',file),path.join(fixture,'js',file));
fs.writeFileSync(path.join(fixture,'js/app.js'),fs.readFileSync(path.join(REPO_ROOT,'js/app.js'),'utf8').replace('window.__vocab = {','window.__vocab = { toastForBrowserTest: toast,'));
report.fixtureApp=crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture,'js/app.js'))).digest('hex');
const server=await startStaticServer({root:fixture}),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl),p=await Page.open(conn,{url:server.url()});
const scene=`JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,review:s.reviewDay,extra:s.extraDay}})())`;
const visible='!document.querySelector("#toast").hidden&&document.querySelector("#toast").classList.contains("on")';
const geometry=`(()=>{const t=document.querySelector('#toast'),a=document.querySelector('#acts'),c=document.querySelector('#card'),b=document.querySelector('#toastDismiss'),r=e=>{const x=e.getBoundingClientRect();return {top:x.top,bottom:x.bottom,left:x.left,right:x.right,width:x.width,height:x.height};};return {toast:r(t),acts:r(a),card:r(c),close:r(b),placement:t.dataset.placement,focus:document.activeElement.id,text:t.textContent,scroll:t.scrollHeight,client:t.clientHeight,hidden:b.hidden}})()`;
async function click(s){await p.scrollIntoView(s);await sleep(100);await p.clickSelector(s);await sleep(100);}
async function showLong(){await p.send('Page.bringToFront');await p.eval('document.querySelector("#card").focus({preventScroll:true})');await p.key('keyS');await p.waitFor(visible);}
async function dismiss(){if(await p.eval(visible)){await click('#toastDismiss');await sleep(60);}}
async function box(){return p.eval(geometry);}
async function hit(s){return p.eval(`(()=>{const e=document.querySelector(${JSON.stringify(s)}),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return y>=0&&y<innerHeight&&e.contains(document.elementFromPoint(x,y));})()`);}
try{
 await p.waitFor('window.__vocab');
 // 能力夹具仅模拟设备没有语音API；提示始终由真实发音按钮/生产speak()触发。
 await p.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(window,"speechSynthesis",{configurable:true,value:undefined});'});
 await p.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));"});
 for(const [width,height,dark,large,reduced] of [[320,568,true,true,false],[375,812,false,false,false],[1440,1000,false,false,true]]){
  const label=width+'×'+height+(dark?' 深色':' 浅色')+(large?' 大字':' 标准');
  await p.setViewport(width,height,{mobile:width<500});await p.setMedia({reducedMotion:reduced?'reduce':'no-preference'});
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.proficient={};s.stars={};s.reviewDay={};s.extraDay={};Object.assign(s.settings,{theme:${JSON.stringify(dark?'dark':'light')},fontSize:${JSON.stringify(large?'large':'standard')},autoSpk:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');
  const before=await p.eval(scene);await click('#btnTheme');await click('#btnTheme');
  check(label+' 短确认无额外Tab目标',await p.eval(visible+'&&document.querySelector("#toastDismiss").hidden'));
  await p.mouseMove(1,1);await sleep(2400);check(label+' 短确认仍轻快自动结束',!await p.eval(visible));
  const withoutToast=await box();await showLong();const first=await box();
  check(label+' 长说明完整可读且不自动聚焦提示',first.text==='当前浏览器不支持语音朗读，请使用系统浏览器或开启系统语音'&&!first.hidden&&first.focus!=='toastDismiss',first);
  check(label+' 显示提示前后词卡/动作区几何完全一致',JSON.stringify(withoutToast.card)===JSON.stringify(first.card)&&JSON.stringify(withoutToast.acts)===JSON.stringify(first.acts),{before:withoutToast,after:first});
  await p.scrollIntoView('#acts');await sleep(120);const placed=await box();
  const dimensions=r=>JSON.stringify([r.width,r.height]);
  const cardBefore=dimensions(placed.card),actsBefore=dimensions(placed.acts);
  check(label+' 提示在视口内且不覆盖判定区',placed.toast.left>=0&&placed.toast.right<=width+1&&placed.toast.top>=0&&placed.toast.bottom<=height+1&&(placed.toast.bottom<=placed.acts.top||placed.toast.top>=placed.acts.bottom),placed);
  check(label+' 会/不会仍真实命中、收起目标至少44px',await hit('#ok')&&await hit('#no')&&placed.close.width>=44&&placed.close.height>=44,placed.close);
  await p.mouseMove(placed.toast.left+8,placed.toast.top+8);await sleep(5000);
  check(label+' 悬停后越过原2.2秒仍可读',await p.eval(visible));
  await p.eval('document.querySelector("#card").focus()');await p.key('Escape');
  check(label+' 提示外Escape不收起或翻页',await p.eval(visible)&&before===await p.eval(scene));
  // 从页面最后一个Tab目标进入提示；使用真正的Tab导航而非直接聚焦关闭按钮。
  await p.eval('document.querySelector("#autoResumePause").focus()');
  for(let n=0;n<80&&await p.eval('document.activeElement.id!=="toastDismiss"');n++)await p.key('Tab');
  check(label+' 收起按钮可以通过Tab到达',await p.eval('document.activeElement.id==="toastDismiss"'));
  await p.mouseMove(1,1);await sleep(3100);
  check(label+' 移走鼠标后键盘焦点仍保持暂停',await p.eval(visible));
  const candidate=await p.eval(`(()=>{const b=document.querySelector('#toastDismiss'),e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,isComposing:true,keyCode:229});b.dispatchEvent(e);return {prevented:e.defaultPrevented,shown:!document.querySelector('#toast').hidden};})()`);
  check(label+' 候选Escape不会提前收起',!candidate.prevented&&candidate.shown,candidate);
  await p.eval('window.__vocab.toastForBrowserTest("已确认")');
  check(label+' 已聚焦长提示替换为短确认仍保留可见收起按钮和焦点',await p.eval('document.querySelector("#toast").textContent==="已确认"&&!document.querySelector("#toastDismiss").hidden&&document.activeElement.id==="toastDismiss"'));
  await sleep(2400);check(label+' 替换后的短确认保持用户焦点暂停',await p.eval(visible));
  await p.key('Enter');check(label+' Enter主动收起并回学习卡、不改变学习现场',!await p.eval(visible)&&await p.eval('document.activeElement.id==="card"')&&before===await p.eval(scene));
  const after=await box();check(label+' 主动收起不压缩词卡或改变固定动作区',dimensions(after.card)===cardBefore&&dimensions(after.acts)===actsBefore,{before:placed,after});
  await showLong();await click('#btnBooks');check(label+' 打开模态清理旧提示',!await p.eval(visible));
  await click('#bookSetDefault');await p.waitFor(visible);const modal=await p.eval(`(()=>{const t=document.querySelector('#toast'),p=document.querySelector('#bookSheet .sheet-panel'),x=p.querySelector('[data-close]'),r=e=>{const a=e.getBoundingClientRect();return {top:a.top,bottom:a.bottom,left:a.left,right:a.right,height:a.height};};return {one:document.querySelectorAll('#toast').length===1&&document.querySelectorAll('#toastDismiss').length===1,inside:p.contains(t),closeInside:p.contains(document.querySelector('#toastDismiss')),text:t.textContent,live:t.getAttribute('aria-live'),atomic:t.getAttribute('aria-atomic'),toast:r(t),x:r(x),focus:document.activeElement.id,business:document.querySelector('#bookDefaultStatus').textContent}})()`);
  check(label+' 模态提示单节点portal、polite完整文本与业务区分离',modal.one&&modal.inside&&modal.closeInside&&modal.text.includes('已设为下次新开页面')&&modal.business.startsWith('下次新开页面默认：')&&modal.live==='polite'&&modal.atomic==='true',modal);
  check(label+' 模态关闭叉号没有被提示遮挡',await hit('#bookSheet .sheet-head [data-close]')&&(modal.toast.top>=modal.x.bottom||modal.toast.bottom<=modal.x.top),modal);
  await p.scrollIntoView('#bookSetDefault');await sleep(100);check(label+' 模态主要确认操作仍真实命中',await hit('#bookSetDefault'));
  await p.eval('document.querySelector("#bookSheet .sheet-panel").focus()');await p.key('Tab');
  check(label+' 模态首个Tab仍在面板内',await p.eval('document.querySelector("#bookSheet .sheet-panel").contains(document.activeElement)'));
  for(let n=0;n<12&&await p.eval('document.activeElement.id!=="toastDismiss"');n++)await p.key('Tab');
  check(label+' 模态的提示收起位于原Tab圈内',await p.eval('document.activeElement.id==="toastDismiss"'));
  await p.key('Escape');check(label+' 提示内Escape只收起提示，模态保留且焦点安全',!await p.eval(visible)&&await p.eval('!document.querySelector("#bookSheet").hidden&&document.activeElement===document.querySelector("#bookSheet .sheet-panel")'));
  await p.key('Tab');check(label+' 收起后模态面板可继续Tab到关闭入口',await p.eval('document.activeElement===document.querySelector("#bookSheet .sheet-head [data-close]")'));
  await click('#bookSetDefault');await p.waitFor(visible);await click('#bookSheet .sheet-head [data-close]');
  check(label+' 真正点击叉号清理portal并归还学习卡',await p.eval('document.querySelector("#bookSheet").hidden&&document.querySelector("#toast").parentNode===document.body&&document.querySelector("#toastDismiss").hidden&&document.activeElement.id==="card"'));
  await showLong();const touch=await p.rect('#toastDismiss');
  if(width<500){await p.touchTap(touch.cx,touch.cy);check(label+' 触摸直接收起，不依赖悬停',!await p.eval(visible));}
  else {await p.clickSelector('#toastDismiss');check(label+' 指针直接收起',!await p.eval(visible));}
  check(label+' 全部普通提示操作没有误判/误翻/配额变化',before===await p.eval(scene));
  await p.scrollIntoView('#acts');await p.eval('window.__vocab.toastForBrowserTest("长".repeat(1000))');const huge=await box();
  check(label+' 1000码点仅在提示内滚动，未遮判定或压缩卡片',huge.toast.top>=0&&huge.toast.bottom<=height+1&&huge.scroll>huge.client&&(huge.toast.bottom<=huge.acts.top||huge.toast.top>=huge.acts.bottom)&&await hit('#ok')&&await hit('#no'),huge);
  await p.eval('document.querySelector("#toast").scrollTop=99999');await sleep(80);check(label+' 超长提示滚到底后仍可直接收起',await hit('#toastDismiss'));await dismiss();
  if(reduced){await showLong();check(label+' 提示遵从减少动态',await p.eval('getComputedStyle(document.querySelector("#toast")).transitionDuration.split(",").every(x=>parseFloat(x)===0)'));}
  report.shots.push(await p.screenshot('toast-'+width+'.png'));await dismiss();
 }
 // R-P08-02：同坐标真实双击的保护提示，在滚动与绘制后不得截住撤销/熟练。
 for(const width of [375,721]){
  await dismiss();await p.setViewport(width,width===375?900:1000,{mobile:width===375});
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};Object.assign(s.settings,{dailyNew:8,groupSize:4,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,showPh:true,showEx:true,showFm:true,actionLayout:'standard',theme:${width===375?"'dark'":"'light'"},fontSize:${width===375?"'large'":"'standard'"},autoSpk:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');await p.scrollIntoView('#ok');await p.nextFrame();const original=await p.eval(scene),point=await p.rect('#ok');
  // 两下之间只有真实双击原来的50ms间隔，不插入滚动或布局等待。
  await p.doubleClickAt(point.cx,point.cy,{gap:50});await sleep(120);
  check('R-P08-02 '+width+' 真实双击仅判定一次并产生保护长提示',await p.eval('window.__vocab.phase==="revealed"&&window.__vocab.answered===1&&document.querySelector("#toast").textContent.includes("已记录判定，先看释义")'),await box());
  await p.scrollIntoView('#acts');await p.nextFrame();
  const painted=await p.eval(`(()=>{const R=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right};};return{toast:R(document.querySelector('#toast')),acts:R(document.querySelector('#acts')),buttons:['undoBtn','markProficient'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{id,hit:hit===e||e.contains(hit),hitId:hit?.id,hitTag:hit?.tagName,rect:R(e)};})};})()`);
  check('R-P08-02 '+width+' 绘制后底部撤销/熟练真实命中且动作高度不变',painted.buttons.every(x=>x.hit)&&Math.abs(painted.acts.height-(width<=720?151:156))<=1&&(painted.toast.bottom<=painted.acts.top||painted.toast.top>=painted.acts.bottom),painted);
  await p.clickSelector('#undoBtn');await p.waitFor('window.__vocab.phase==="recall"');
  check('R-P08-02 '+width+' 真正点击可见撤销按钮恢复判定前现场',original===await p.eval(scene),await p.eval(scene));
  report.shots.push(await p.screenshot('toast-doubleclick-'+width+'.png'));
 }
 // 专项真实完成入口：主学习自然结束一张组，空提交/发音说明不覆盖专项业务结果。
 await p.setViewport(375,812,{mobile:true});await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.stars={};s.proficient={};s.settings.dailyNew=1;s.settings.groupSize=1;s.settings.autoResume.enabled=false;localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
 await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.key('keyF');await p.key('Space');await p.waitFor('document.querySelector("#startSpellingBtn")');await click('#startSpellingBtn');await p.waitFor('!document.querySelector("#spellingSheet").hidden');const spelling=await p.eval(scene);const feedback=await p.eval('document.querySelector("#spellFeedback").textContent');await click('#spellSubmit');
 check('专项空提交的短提示完整呈现在模态内且无多余Tab目标',await p.eval('document.querySelector("#spellingSheet .sheet-panel").contains(document.querySelector("#toast"))&&document.querySelector("#toast").textContent==="请输入拼写后再提交"&&document.querySelector("#toastDismiss").hidden&&document.querySelector("#spellFeedback").textContent==='+JSON.stringify(feedback)));
 await click('#spellingSheet .sheet-head [data-spell-close]');
 check('专项退出确认显示在返回页，未留在已关闭模态',await p.eval('document.querySelector("#spellingSheet").hidden&&document.querySelector("#toast").parentNode===document.body&&!document.querySelector("#toast").hidden&&document.querySelector("#toast").textContent.includes("已退出拼写专项")')&&spelling===await p.eval(scene));
 // R-P08-01：持续保存错误+横向短窗+动作区可见，不能把min-height撑进仅39px的空隙。
 for(const height of [390,320]){
  await dismiss();await p.setViewport(844,height);
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.stars={};s.proficient={};Object.assign(s.settings,{dailyNew:20,groupSize:30,theme:'light',fontSize:'standard',autoSpk:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');
  await p.eval(`(()=>{const set=Storage.prototype.setItem;window.__restoreToastStorage=()=>{Storage.prototype.setItem=set;};Storage.prototype.setItem=function(k,v){if(k==='kaoyan_vocab_v1')throw new Error('P08 simulated storage full');return set.call(this,k,v);};document.querySelector('#card').focus();})()`);
  await p.key('ArrowRight');await p.waitFor('!document.querySelector("#appAlert").hidden');const failing=await p.eval(scene),beforeError=await box();
  const error=await p.eval('document.querySelector("#appAlertTitle").textContent+document.querySelector("#appAlertBody").textContent');
  await p.key('keyS');await p.waitFor(visible);await p.scrollIntoView('#acts');await sleep(180);const cramped=await box();
  check('R-P08-01 844×'+height+' 无安全空隙转为主区专用自然流状态',cramped.placement==='context'&&await p.eval('document.querySelector("#toast").parentNode===document.querySelector("#main")&&!document.querySelector("#v-study").contains(document.querySelector("#toast"))'),cramped);
  check('R-P08-01 844×'+height+' 不覆盖动作，卡片/动作尺寸与错误说明保持',!(cramped.toast.top<cramped.acts.bottom&&cramped.toast.bottom>cramped.acts.top)&&cramped.card.width===beforeError.card.width&&cramped.card.height===beforeError.card.height&&cramped.acts.height===beforeError.acts.height&&error===await p.eval('document.querySelector("#appAlertTitle").textContent+document.querySelector("#appAlertBody").textContent')&&failing===await p.eval(scene),{before:beforeError,after:cramped});
  await sleep(5000);check('R-P08-01 844×'+height+' 离屏状态没有用掉阅读余量',await p.eval(visible));
  await p.scrollIntoView('#toast');await sleep(100);check('R-P08-01 844×'+height+' 主区滚动后全文与44px收起真实可达',await hit('#toastDismiss')&&await p.eval('document.querySelector("#toast").textContent==="当前浏览器不支持语音朗读，请使用系统浏览器或开启系统语音"'),await box());
  report.shots.push(await p.screenshot('toast-storage-'+height+'.png'));await click('#toastDismiss');
  check('R-P08-01 844×'+height+' 收起普通状态仍保留持续保存错误',!await p.eval(visible)&&await p.eval('!document.querySelector("#appAlert").hidden')&&failing===await p.eval(scene));
  await p.eval('window.__restoreToastStorage()');
 }
 report.errors=p.errors();check('提示旅程无浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('取证期间运行时源未变化',JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter));
}catch(e){check('提示旅程完整执行',false,String(e.stack||e));report.errors=p.errors();report.diagnostic=await p.eval(`({visibility:document.visibilityState,focus:document.activeElement.id,inert:document.querySelector('#main').inert,pop:document.querySelector('#exPop').hidden,sheets:[...document.querySelectorAll('.sheet')].filter(x=>!x.hidden).map(x=>x.id),phase:window.__vocab.phase,cur:window.__vocab.cur,keys:window.__vocab.getS().settings.keys,selection:window.getSelection().toString(),toast:document.querySelector('#toast').outerHTML})`).catch(()=>null);report.shots.push(await p.screenshot('toast-failure.png').catch(()=>''));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/toast.json',JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();fs.rmSync(fixture,{recursive:true,force:true});}
console.log(JSON.stringify({passed:report.checks.filter(c=>c.ok).length,failed:report.checks.filter(c=>!c.ok).length,report:RESULTS_DIR+'/toast.json'}));process.exitCode=report.checks.some(c=>!c.ok)?1:0;
