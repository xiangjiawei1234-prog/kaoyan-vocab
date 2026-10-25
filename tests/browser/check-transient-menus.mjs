#!/usr/bin/env node
/** 瞬时操作菜单：互斥、外点、Escape、焦点离开与模态返回；不改学习数据。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const files=['index.html','js/app.js','css/app.css','sw.js'];
const fingerprint=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['Chrome隔离profile；媒体和屏幕仿真不代表真机或真实输入法']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome(),conn=await connect(chrome.wsUrl),p=await Page.open(conn,{url:server.url()});
const scene='JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,review:s.reviewDay,extra:s.extraDay}})())';
async function click(selector){await p.scrollIntoView(selector);await sleep(150);await p.clickSelector(selector);await sleep(50);}
async function resetMenus(){await p.eval('document.querySelectorAll("#listViewsMenu,#listExportMenu,#actsMore").forEach(x=>x.open=false)');}
try{
 await p.waitFor('window.__vocab');
 for(const [width,height,dark,reduce] of [[375,812,true,false],[1440,1000,false,true]]){
  const label=width+' '+(dark?'深色':'浅色')+(reduce?' 减少动态':'');
  await p.setViewport(width,height,{mobile:width<500});
  await p.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduce?'reduce':'no-preference'}]});
  await p.eval('(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.reviewDay={};s.extraDay={};s.stars={};s.proficient={};s.settings.theme='+JSON.stringify(dark?'dark':'light')+';s.settings.secondaryActions=["speak","star"];s.settings.autoSpk=false;localStorage.clear();sessionStorage.clear();localStorage.setItem("kaoyan_vocab_v1",JSON.stringify(s));localStorage.setItem("vocab_guide_v1",JSON.stringify({version:1,dismissedAt:Date.now()}));})()');
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');
  await click('[data-v="list"]');const before=await p.eval(scene);
  await click('#listViewsMenu > summary');await click('#listExportMenu > summary');
  check(label+' 打开导出自动收起视图',await p.eval('!document.querySelector("#listViewsMenu").open&&document.querySelector("#listExportMenu").open'));
  await click('#v-list .view-heading h2');
  check(label+' 外点收起，不改变学习现场',await p.eval('!document.querySelector("#listViewsMenu").open&&!document.querySelector("#listExportMenu").open')&&before===await p.eval(scene));
  await resetMenus();await p.eval('document.querySelector("#listViewsMenu > summary").focus()');await p.key('Enter');await sleep(70);await p.key('Tab');await p.insertText('保留草稿');
  check(label+' 原生键盘展开且首个输入可达',await p.eval('document.querySelector("#listViewsMenu").open&&document.activeElement.id==="listViewName"'));
  await p.key('Escape');
  check(label+' 输入内Escape收起并归还summary焦点，草稿保留',await p.eval('!document.querySelector("#listViewsMenu").open&&document.activeElement===document.querySelector("#listViewsMenu > summary")&&document.querySelector("#listViewName").value==="保留草稿"'));
  await resetMenus();await click('#listViewsMenu > summary');await click('#listViewName');
  check(label+' 菜单内点击不收起',await p.eval('document.querySelector("#listViewsMenu").open'));
  await p.key('Tab');await p.key('Tab');
  check(label+' Tab离开收起，继续落到导出入口',await p.eval('!document.querySelector("#listViewsMenu").open&&document.activeElement===document.querySelector("#listExportMenu > summary")'));
  await resetMenus();await click('#listViewsMenu > summary');await click('#btnSaveListView');
  const viewId=await p.eval('window.__vocab.getListViewState().views[0].id');
  const renameInput='[data-view-rename-input="'+viewId+'"]',renameButton='[data-view-rename="'+viewId+'"]';
  await click(renameInput);await p.eval('document.querySelector('+JSON.stringify(renameInput)+').select()');await p.insertText('重命名后的视图');await click(renameButton);
  check(label+' 菜单内重绘不被误判成外点',await p.eval('document.querySelector("#listViewsMenu").open&&window.__vocab.getListViewState().views[0].name==="重命名后的视图"'));
  check(label+' 重绘后键盘焦点留在同一操作',await p.eval('document.activeElement.dataset.viewRename==='+JSON.stringify(viewId)));
  await p.key('Escape');check(label+' 重命名后Escape仍回到菜单入口',await p.eval('!document.querySelector("#listViewsMenu").open&&document.activeElement===document.querySelector("#listViewsMenu > summary")'));
  await resetMenus();await click('#listExportMenu > summary');await click('#btnPrintBookList');
  await p.waitFor('!document.querySelector("#printSheet").hidden');
  check(label+' 打开真正弹窗前收起操作菜单',await p.eval('!document.querySelector("#listExportMenu").open&&document.querySelector("#main").inert'));
  await p.key('Escape');
  check(label+' 弹窗关闭回到可见菜单入口',await p.eval('document.querySelector("#printSheet").hidden&&document.activeElement===document.querySelector("#listExportMenu > summary")&&!document.querySelector("#main").inert'));
  await resetMenus();await click('#listViewsMenu > summary');await click('[data-v="study"]');await click('[data-v="list"]');
  check(label+' 切页后不残留上次操作菜单',await p.eval('!document.querySelector("#listViewsMenu").open'));
  await resetMenus();await click('[data-v="study"]');await p.key('keyF');await click('#actsMore > summary');
  check(label+' 次级操作菜单可展开',await p.eval('document.querySelector("#actsMore").open'));
  const revealed=await p.eval(scene);await p.key('Escape');
  check(label+' 次级操作Escape关闭并回入口，不改判',await p.eval('!document.querySelector("#actsMore").open&&document.activeElement===document.querySelector("#actsMore > summary")')&&revealed===await p.eval(scene));
  await resetMenus();await click('#actsMore > summary');await click('#card .word');
  check(label+' 次级操作外点收起',await p.eval('!document.querySelector("#actsMore").open'));
  await resetMenus();await click('#actsMore > summary');await click('#btnBooks');
  check(label+' 打开词书弹窗前收起次级操作',await p.eval('!document.querySelector("#actsMore").open&&!document.querySelector("#bookSheet").hidden'));
  await p.key('Escape');await click('[data-v="list"]');await click('#listExportMenu > summary');
  const geometry=await p.eval('(()=>{const e=document.querySelector("#listExportMenu .list-export-pop"),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,motion:getComputedStyle(e).animationName}})()');
  check(label+' 菜单在视口内且尊重减少动态',geometry.left>=-1&&geometry.right<=width+1&&(!reduce||geometry.motion==='none'),geometry);
  report.shots.push(await p.screenshot('transient-menus-'+width+'.png'));await resetMenus();
 }
 report.errors=p.errors();check('全程无浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('取证期间运行时字节一致',JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter));
}catch(e){check('完整菜单旅程',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/transient-menus.json',JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/transient-menus.json'}));process.exitCode=report.checks.some(x=>!x.ok)?1:0;
