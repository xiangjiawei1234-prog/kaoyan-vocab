#!/usr/bin/env node
/** 局部键盘契约：输入确认不触发保存，列表唯一Tab入口，组合键不被局部导航截获。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],limits:['Chrome隔离profile；375手机仿真不等于真机','输入法候选/229/AltGraph使用合成事件，仅证明实际DOM监听守卫，不冒充真实系统IME','组合键验证未被页面preventDefault或改变局部选择，不宣称穷尽系统快捷键']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl),p=await Page.open(conn,{url:server.url()});
const scene=`JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,days:s.days,review:s.reviewDay,extra:s.extraDay}})())`;
async function click(s){await p.send('Page.bringToFront');await p.scrollIntoView(s);await sleep(90);await p.clickSelector(s);}
async function fill(s,value){await click(s);await p.eval(`document.querySelector(${JSON.stringify(s)}).select()`);await p.insertText(value);}
async function ignored(s,key,kind){return await p.eval(`(()=>{const input=document.querySelector(${JSON.stringify(s)});input.focus();const opts=${JSON.stringify({key,code:key,bubbles:true,cancelable:true,...(kind==='composition'?{isComposing:true}:kind==='229'?{keyCode:229}:kind==='repeat'?{repeat:true}:kind==='ctrl'?{ctrlKey:true}:kind==='meta'?{metaKey:true}:kind==='alt'?{altKey:true}:{})})};const e=new KeyboardEvent('keydown',opts);${kind==='altGraph'?"Object.defineProperty(e,'getModifierState',{value:k=>k==='AltGraph'});":""}input.dispatchEvent(e);return {prevented:e.defaultPrevented,sameFocus:document.activeElement===input,focusId:document.activeElement.id};})()`);}
try{
 await p.waitFor('window.__vocab');
 for(const [width,theme] of [[1440,'light'],[375,'dark']]){
  const label=width+' '+theme;
  await p.setViewport(width,width<500?812:1000,{mobile:width<500});
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.proficient={};s.stars={};s.reviewDay={};s.extraDay={};Object.assign(s.settings,{theme:${JSON.stringify(theme)},dailyNew:20,groupSize:30,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');const before=await p.eval(scene);
  await click('[data-v="set"]');await fill('#settingsSearch','字号');await p.waitFor('document.querySelector("#settingsSearchResults button")');
  for(const kind of ['composition','229','altGraph','repeat','ctrl','meta','alt']){const a=await ignored('#settingsSearch','Enter',kind);check(label+' 设置搜索 '+kind+' 不提前跳结果',!a.prevented&&a.sameFocus,a);}
  await p.key('Enter');check(label+' 普通Enter仍聚焦搜索结果',await p.eval('!!document.activeElement.dataset.settingTarget'));
  await p.key('Enter');check(label+' 再次Enter仍定位真实设置控件',await p.eval('!!document.activeElement.closest("#fontSizeSeg")'));
  await click('[data-v="list"]');await click('#listViewsMenu summary');await fill('#listViewName','尚未确认');
  for(const kind of ['composition','229','altGraph','repeat','ctrl','meta','alt']){const a=await ignored('#listViewName','Enter',kind);const raw=await p.eval("localStorage.getItem('vocab_list_views_v1')");check(label+' 保存名称 '+kind+' 不提前落盘',!a.prevented&&a.sameFocus&&raw===null,{...a,raw});}
  await p.key('Enter');check(label+' 普通Enter保存视图一次',await p.eval(`JSON.parse(localStorage.getItem('vocab_list_views_v1')).views.length===1&&JSON.parse(localStorage.getItem('vocab_list_views_v1')).views[0].name==='尚未确认'`));
  await fill('[data-view-rename-input]','正常更名');const stored=await p.eval("localStorage.getItem('vocab_list_views_v1')");
  for(const kind of ['composition','229','altGraph','repeat','ctrl','meta','alt']){const a=await ignored('[data-view-rename-input]','Enter',kind);check(label+' 重命名 '+kind+' 不提前落盘',!a.prevented&&a.sameFocus&&stored===await p.eval("localStorage.getItem('vocab_list_views_v1')"),a);}
  await p.key('Enter');check(label+' 普通Enter仍完成重命名',await p.eval(`JSON.parse(localStorage.getItem('vocab_list_views_v1')).views[0].name==='正常更名'`));
  if(await p.eval("document.querySelector('#listViewsMenu').open"))await click('#listViewsMenu summary');
  await click('#btnToggleOrganize');await p.eval("document.querySelector('#listInner [data-open-word]').focus()");
  for(const [key,attr] of [['ArrowRight','rowCheck'],['ArrowRight','proficient'],['ArrowLeft','rowCheck'],['ArrowLeft','openWord'],['ArrowDown','openWord']]){
   await p.key(key);const a=await p.eval(`({action:document.activeElement.dataset.${attr},stops:[...document.querySelectorAll('#listInner button')].filter(x=>x.tabIndex===0).length,current:document.activeElement.tabIndex})`);check(label+' '+key+' 至 '+attr+' 保留唯一Tab入口',a.action!==undefined&&a.stops===1&&a.current===0,a);
  }
  for(const kind of ['ctrl','meta','alt','composition','229','altGraph']){const a=await ignored('#listInner [data-open-word][tabindex="0"]','ArrowRight',kind);check(label+' 词表 '+kind+' 方向不切换操作',!a.prevented&&a.sameFocus,a);}
  await click('[data-v="stats"]');await p.scrollIntoView('#forecast');await p.eval("document.querySelector('#forecast [data-fc-label]').focus()");
  for(const kind of ['ctrl','meta','alt','composition','229','altGraph']){const a=await ignored('#forecast [data-fc-label][tabindex="0"]','ArrowRight',kind);check(label+' 图表 '+kind+' 方向不切选择',!a.prevented&&a.sameFocus,a);}
  const fc=await p.eval('document.activeElement.dataset.fcLabel');await p.key('ArrowRight');check(label+' 裸方向仍选择相邻日期',fc!==await p.eval('document.activeElement.dataset.fcLabel'));
  await click('[data-v="study"]');await click('#btnQuickSettings');await p.eval("document.querySelector('#workspaceQuickTab').focus()");
  for(const kind of ['ctrl','meta','alt','composition','229','altGraph']){const a=await ignored('#workspaceQuickTab','ArrowRight',kind);check(label+' 工作台 '+kind+' 方向不切标签',!a.prevented&&a.sameFocus&&await p.eval('!document.querySelector("#workspaceQuick").hidden'),a);}
  await p.key('ArrowRight');check(label+' 裸方向仍切换工作台标签',await p.eval('document.activeElement.id==="workspaceProfilesTab"&&!document.querySelector("#workspaceProfiles").hidden'));
  await p.key('Escape');
  await p.scrollIntoView('#card .ex');await p.eval("document.querySelector('#card .ex-word').focus()");
  for(const kind of ['ctrl','meta','alt','composition','229','altGraph']){const a=await ignored('#card .ex-word.ex-active','ArrowRight',kind);check(label+' 例句 '+kind+' 方向不切词',!a.prevented&&a.sameFocus,a);}
  await p.key('ArrowRight');check(label+' 裸方向仍选择例句下一词',await p.eval("[...document.querySelectorAll('#card .ex-word')].indexOf(document.activeElement)===1"));
  check(label+' 所有局部操作保留学习现场',before===await p.eval(scene));
 }
 report.errors=p.errors();check('局部键盘旅程无浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('取证期间运行时源未变化',JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter));
}catch(e){check('局部键盘旅程执行完整',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/local-keyboard.json',JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(c=>c.ok).length,failed:report.checks.filter(c=>!c.ok).length,report:RESULTS_DIR+'/local-keyboard.json'}));process.exitCode=report.checks.some(c=>!c.ok)?1:0;
