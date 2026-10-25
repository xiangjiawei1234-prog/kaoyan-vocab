#!/usr/bin/env node
/** P07短横屏词表：真实几何、控件命中和词表现场；只读业务钩子。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={checks:[],errors:[],shots:[],sources:fingerprint(),limits:['Chrome隔离profile，屏幕与触摸仿真不代替真机','只在初始化通过存储设置夹具，操作走真实控件/输入；不伪造cur/Q/answered']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl),p=await Page.open(conn,{url:server.url()});
const scene='JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,review:s.reviewDay,extra:s.extraDay}})())';
const controls=['#q','#fst','#fsc','#btnToggleOrganize','#listViewsMenu > summary','#listExportMenu > summary'];
async function click(sel){await p.send('Page.bringToFront');await p.scrollIntoView(sel);await sleep(180);if(!await p.isClickable(sel))throw Error('不可命中：'+sel);await p.clickSelector(sel);await sleep(70);}
async function fill(sel,text){await click(sel);await p.eval('document.querySelector('+JSON.stringify(sel)+').select()');await p.insertText(text);await sleep(120);}
async function choose(sel,value){await p.eval('(()=>{const el=document.querySelector('+JSON.stringify(sel)+');el.value='+JSON.stringify(value)+';el.dispatchEvent(new Event("change",{bubbles:true}));})()');await sleep(120);}
async function geometry(){return p.eval('(()=>{const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,main:rect(document.querySelector("#main")),first:rect(document.querySelector("#listInner .row")),header:rect(document.querySelector("#listHead")),toolbar:rect(document.querySelector(".list-toolbar")),controls:'+JSON.stringify(controls)+'.map(s=>{const e=document.querySelector(s),r=rect(e),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,hit=document.elementFromPoint(x,y);return {s,...r,clickable:!!hit&&(hit===e||e.contains(hit))}}),wordFont:getComputedStyle(document.querySelector("#listInner .row-word")).fontSize};})()');}
let stateTemplate,preferenceTemplate;
async function seed(w,h,theme,fontSize='standard'){
 await p.setViewport(w,h,{mobile:w<1100});
 await p.eval('(()=>{const s='+JSON.stringify(stateTemplate)+',d='+JSON.stringify(preferenceTemplate)+';s.progress={};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};s.timeSec=0;Object.assign(s.settings,{theme:'+JSON.stringify(theme)+',fontSize:'+JSON.stringify(fontSize)+',dailyNew:20,groupSize:30,order:"freq",fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,autoSpk:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});d.shared.theme='+JSON.stringify(theme)+';d.shared.fontSize='+JSON.stringify(fontSize)+';for(const id of Object.keys(d.overrides))d.overrides[id]=[];localStorage.clear();sessionStorage.clear();localStorage.setItem("kaoyan_vocab_v1",JSON.stringify(s));localStorage.setItem("kaoyan_vocab_proficient_v1","{}");localStorage.setItem("vocab_device_preferences_v1",JSON.stringify(d));localStorage.setItem("vocab_guide_v1",JSON.stringify({version:1,dismissedAt:Date.now()}));})()');
 await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');
 await click('[data-v="list"]');await p.eval('document.querySelector("#main").scrollTop=0');await sleep(180);
}
try{
 await p.waitFor('window.__vocab');
 stateTemplate=await p.eval('JSON.parse(JSON.stringify(window.__vocab.getS()))');
 const own=await p.eval('window.__vocab.getPreferenceOwnership()');
 preferenceTemplate={kind:'vocab-device-preferences',version:1,shared:own.shared,overrides:{kaoyan:[],cet4:[],cet6:[],combined:[]}};
 for(const [w,h,theme,size] of [[844,390,'light','standard'],[844,390,'dark','large'],[932,430,'light','large'],[932,430,'dark','standard'],[721,390,'light','standard'],[1000,390,'dark','large'],[844,500,'dark','standard'],[844,501,'light','standard'],[320,568,'light','standard'],[375,812,'dark','large'],[720,812,'light','large'],[721,812,'dark','standard'],[1000,812,'light','standard'],[1001,812,'dark','large'],[1440,900,'light','standard']]){
  await seed(w,h,theme,size);const label=w+'×'+h+' '+theme+' '+size,g=await geometry();
  check(label+' 首次列表至少完整显示一行',g.first.top>=Math.max(g.main.top,g.header.bottom)-1&&g.first.bottom<=Math.min(g.height,g.main.bottom)+1,g);
  check(label+' 搜索/筛选/三个管理入口44px且真实可命中',g.controls.every(c=>c.height>=43.5&&c.clickable),g.controls);
  check(label+' 无页面横向溢出，词行字号未压小',g.doc<=w+1&&g.first.left>=-1&&g.first.right<=w+1&&parseFloat(g.wordFont)>=14,g);
  report.shots.push(await p.screenshot('short-list-'+w+'x'+h+'-'+theme+'-'+size+'.png'));
 }
 await seed(844,390,'dark','large');const before=await p.eval(scene);
 await fill('#q','can');await choose('#fst','new');await choose('#fsc','all');
 check('短横屏查询/两个筛选实际生效且不改学习现场',await p.eval('document.querySelector("#q").value==="can"&&document.querySelector("#fst").value==="new"&&document.querySelector("#fsc").value==="all"&&window.__vocab.getFilterIndices().length>0')&&before===await p.eval(scene));
 await fill('#q','zz-no-matching-word');await p.waitFor('!document.querySelector("#listEmpty").hidden');await click('#clearListFilters');
 check('空结果可真实清除，恢复全部单词列表',await p.eval('document.querySelector("#q").value===""&&document.querySelector("#fst").value==="all"&&document.querySelector("#fsc").value==="all"&&window.__vocab.getFilterIndices().length>0'));
 await click('#btnToggleOrganize');await p.scrollIntoView('#listInner [data-open-word]');await p.eval('document.querySelector("#listInner [data-open-word]").focus()');await p.key('ArrowRight');await p.key('Space');
 const selected=await p.eval('window.__vocab.getListSelection()');
 check('短横屏整理可由键盘选择且唯一Tab入口保持',selected.length===1&&await p.eval('[...document.querySelectorAll("#listInner button")].filter(x=>x.tabIndex===0).length===1'),selected);
 const rotateExpr='({q:document.querySelector("#q").value,fst:document.querySelector("#fst").value,fsc:document.querySelector("#fsc").value,selected:window.__vocab.getListSelection(),focus:{word:document.activeElement.dataset.rowCheck,tab:document.activeElement.tabIndex}})';
 const rotateBefore=await p.eval(rotateExpr);
 await p.setViewport(375,812,{mobile:true});await sleep(150);await p.setViewport(844,390,{mobile:true});await sleep(150);
 const rotated=await p.eval(rotateExpr);
 check('横竖变化保留筛选、整理选择、活动操作与学习现场',JSON.stringify(rotateBefore)===JSON.stringify(rotated)&&before===await p.eval(scene),{rotateBefore,rotated});
 await click('#btnExitOrganize');
 await p.scrollIntoView('#listScroll');await p.eval('document.querySelector("#listScroll").focus()');await p.key('End');await sleep(180);
 const scrollExpr='({top:document.querySelector("#listScroll").scrollTop,word:document.activeElement.dataset.openWord,total:window.__vocab.getFilterIndices().length,stops:[...document.querySelectorAll("#listInner button")].filter(x=>x.tabIndex===0).length})';
 const scrolled=await p.eval(scrollExpr);
 await p.setViewport(375,812,{mobile:true});await sleep(150);await p.setViewport(844,390,{mobile:true});await sleep(150);
 const afterScroll=await p.eval(scrollExpr);
 check('已滚动到末行后缩放不回首行且活动词/唯一Tab保留',scrolled.top>0&&afterScroll.top===scrolled.top&&afterScroll.word===scrolled.word&&afterScroll.total===scrolled.total&&afterScroll.stops===1,{scrolled,afterScroll});
 for(const book of ['cet4','cet6','combined','kaoyan']){
  await click('#btnBooks');await click('#bookList [data-book="'+book+'"]');await p.waitFor('window.__vocab.getBook()==='+JSON.stringify(book));
  check('短横屏实际切至'+book+'且词表行合法无越界',await p.eval('document.querySelector("#v-list").classList.contains("on")&&window.__vocab.getFilterIndices().length>0&&[...document.querySelectorAll("#listInner [data-open-word]")].every(x=>Number(x.dataset.openWord)<window.__vocab.getBooks().find(b=>b.id===window.__vocab.getBook()).words)'));
 }
 await seed(844,390,'light','standard');const drillBefore=await p.eval(scene);
 await click('[data-v="stats"]');await p.scrollIntoView('#statsFreqPanel');await click('#freqMastery .fm-drill:not([disabled])');await p.waitFor('!!window.__vocab.getStatsDrill()');
 const drill=await p.eval('({kind:window.__vocab.getStatsDrill().kind,count:window.__vocab.getStatsDrillIndices().length,chip:document.querySelector("#listDrillSource").textContent})');
 await p.setViewport(375,812,{mobile:true});await sleep(150);await p.setViewport(844,390,{mobile:true});await sleep(150);
 check('统计下钻经横竖变化仍显示来源和同一词集，不改当前学习组',await p.eval('window.__vocab.getStatsDrill().kind==="freq"&&!document.querySelector("#listDrillChip").hidden&&window.__vocab.getStatsDrillIndices().length==='+drill.count)&&drillBefore===await p.eval(scene),drill);
 await click('#btnBackToStats');check('短横屏下钻仍可返回原统计面板',await p.eval('document.querySelector("#v-stats").classList.contains("on")&&document.querySelector("#statsFreqPanel").open'));
 report.errors=p.errors();check('短词表旅程无浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('取证期间源字节保持一致',JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter));
}catch(e){check('P07旅程执行完整',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(RESULTS_DIR,'short-list.json'),JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:path.join(RESULTS_DIR,'short-list.json'),screenshots:report.shots.length}));process.exitCode=report.checks.some(x=>!x.ok)?1:0;
