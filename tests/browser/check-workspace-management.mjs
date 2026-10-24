#!/usr/bin/env node
/** 个人方案管理与四种主题/宽度组合；真实 UI，独立于完整工作台旅程。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],samples:[],shots:[],errors:[],
  matrix:['375 light large','375 dark large','1440 light standard','1440 dark standard'],
  limits:['Chrome headless representative widths; no physical phone, native keyboard/IME, screen reader or native zoom verification',
    'Fixtures initialize an empty learning record; profile mutations, text input, copy, rename, update, delete and undo use actual controls',
    'Read-only hooks inspect authoritative learning/settings/profile state; no business mutation hook']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const learning=`(() => {const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,Q:v.Q,answered:v.answered,total:v.getGroupTotal(),plan:v.getPlan(),progress:s.progress,days:s.days,stars:s.stars,proficient:s.proficient,reviewDay:s.reviewDay,extraDay:s.extraDay,pause:localStorage.getItem('vocab_autoresume_pause_v1')};})()`;
const library='window.__vocabSettingsProfiles.readSettingsProfiles().profiles';
let p;
async function click(selector){await p.scrollIntoView(selector);if(!await p.isClickable(selector))throw Error('控件不能真实命中：'+selector);await p.clickSelector(selector);}
async function fill(selector,value){await click(selector);await p.eval(`document.querySelector(${JSON.stringify(selector)}).select()`);await p.insertText(value);await p.key('Tab');}
async function shot(name){await sleep(120);report.shots.push(await p.screenshot('workspace-management-'+name+'.png'));}
async function geometry(label){
  const actual=await p.eval(`(() => {const e=document.querySelector('#settingsWorkspaceSheet .sheet-panel'),r=e.getBoundingClientRect();return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth,focusInside:e.contains(document.activeElement),theme:document.documentElement.dataset.theme};})()`);
  check(label+' 浮层边界与焦点',actual.doc<=actual.width+1&&actual.scroll<=actual.client+1&&actual.left>=-1&&actual.right<=actual.width+1&&actual.top>=-1&&actual.bottom<=actual.height+1&&actual.focusInside,actual);
}
async function seed(theme,fontSize,{autoEnabled=false,groupSize=4}={}){
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.eval(`(() => {const s=JSON.parse(JSON.stringify(window.__vocab.getS())),d=new Date(),day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    s.progress={};s.days={};s.stars={};s.proficient={};s.spelling={};s.timeSec=0;s.reviewDay={d:day,used:0};s.extraDay={d:day,extra:3};
    Object.assign(s.settings,{theme:${JSON.stringify(theme)},fontSize:${JSON.stringify(fontSize)},dailyNew:${groupSize},groupSize:${groupSize},dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,autoSpk:false,singleCharKeys:true,autoResume:{enabled:${autoEnabled},threshold:5,idleMs:120000,countdownMs:15000}});
    localStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_active_book_v1','kaoyan');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));localStorage.setItem('vocab_autoresume_pause_v1',JSON.stringify({kaoyan:day,cet4:day}));})()`);
  try{await p.reload();await p.waitFor('window.__vocabSettingsProfiles&&window.__vocabWorkspace&&document.querySelector("#no")');}
  finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
}
const card=id=>'#settingsProfilesList [data-profile-id="'+id+'"]';
async function manage(id){await click(card(id)+' [data-profile-edit]');await p.waitFor(`!document.querySelector(${JSON.stringify(card(id)+' .profile-edit')}).hidden`);}
try{
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#btnQuickSettings")');
  for(const width of [375,1440])for(const theme of ['light','dark']){
    const fontSize=width===375?'large':'standard',label=width+' '+theme,base='通勤复习 '+width+' '+theme;
    await p.setViewport(width,width===375?812:1000,{mobile:width===375});await seed(theme,fontSize);
    const before=await p.eval(learning);
    await click('#btnQuickSettings');await p.waitFor('!document.querySelector("#settingsWorkspaceSheet").hidden');
    await geometry(label+' 快速调整');await shot(label.replaceAll(' ','-')+'-quick');
    await click('#workspaceProfilesTab');await click('#profileSaveBox > summary');await fill('#profileName',base);await click('#saveSettingsProfile');
    await p.waitFor(`(${library}).some(x=>x.name===${JSON.stringify(base)})`);
    const source=await p.eval(`(${library}).find(x=>x.name===${JSON.stringify(base)})`),id=source.id;
    check(label+' 真实保存个人方案且学习现场保留',source.name===base&&same(before,await p.eval(learning)),source);
    await manage(id);
    check(label+' 管理展开聚焦名称输入',await p.eval(`document.querySelector(${JSON.stringify(card(id)+' .profile-edit input')})===document.activeElement`));
    await click(card(id)+' .profile-edit input');await p.key('keyJ');
    check(label+' 管理输入不穿透学习判定',same(before,await p.eval(learning)));
    await fill(card(id)+' .profile-edit input',base);
    await click(card(id)+' [data-profile-copy]');await p.waitFor(`(${library}).length===2`);
    const firstCopy=await p.eval(`(${library}).find(x=>x.name===${JSON.stringify(base+' 副本')})`);
    check(label+' 未改名另存自动生成副本',!!firstCopy&&firstCopy.id!==id&&same(firstCopy.settings,source.settings)&&same(firstCopy.categories,source.categories),firstCopy);
    await manage(id);await click(card(id)+' [data-profile-copy]');await p.waitFor(`(${library}).length===3`);
    const secondCopy=await p.eval(`(${library}).find(x=>x.name===${JSON.stringify(base+' 副本 2')})`);
    check(label+' 再次复制自动避开已有副本名',!!secondCopy&&secondCopy.id!==id&&secondCopy.id!==firstCopy?.id,secondCopy);
    await manage(id);const renamed=base+' 修订';await fill(card(id)+' .profile-edit input',renamed);await click(card(id)+' [data-profile-rename]');
    await p.waitFor(`(${library}).find(x=>x.id===${JSON.stringify(id)})?.name===${JSON.stringify(renamed)}`);
    const renamedProfile=await p.eval(`(${library}).find(x=>x.id===${JSON.stringify(id)})`);
    check(label+' 改名保留原配置与身份',same(renamedProfile.settings,source.settings)&&same(renamedProfile.categories,source.categories)&&renamedProfile.createdAt===source.createdAt,renamedProfile);
    await click('#workspaceQuickTab');await fill('[data-quick-key="groupSize"]','7');await p.waitFor('window.__vocab.getS().settings.groupSize===7');
    await click('#workspaceProfilesTab');await manage(id);await click(card(id)+' [data-profile-update]');
    await p.waitFor(`(${library}).find(x=>x.id===${JSON.stringify(id)})?.settings.groupSize===7`);
    const updated=await p.eval(`(${library}).find(x=>x.id===${JSON.stringify(id)})`);
    check(label+' 用当前配置更新保持类别与身份',updated.id===id&&updated.name===renamed&&updated.createdAt===source.createdAt&&same(updated.categories,source.categories)&&same(before,await p.eval(learning)),updated);
    await manage(id);await geometry(label+' 管理展开');await shot(label.replaceAll(' ','-')+'-manage');
    const beforeDelete=await p.eval(library);await click(card(id)+' [data-profile-delete]');
    await p.waitFor(`!(${library}).some(x=>x.id===${JSON.stringify(id)})`);
    const undo=await p.eval(`(() => {const e=document.querySelector('#workspaceStatus button'),r=e?.getBoundingClientRect();return {text:e?.textContent,focus:e===document.activeElement,top:r?.top,bottom:r?.bottom,height:innerHeight};})()`);
    check(label+' 删除后撤销可见且焦点可达',undo.text==='撤销删除'&&undo.focus&&undo.top>=0&&undo.bottom<=undo.height&&await p.isClickable('#workspaceStatus button'),undo);await shot(label.replaceAll(' ','-')+'-deleted');
    await click('#workspaceStatus button');await p.waitFor(`(${library}).some(x=>x.id===${JSON.stringify(id)})`);
    const restored=await p.eval(`(${library}).find(x=>x.id===${JSON.stringify(id)})`),restoredLibrary=await p.eval(library);
    check(label+' 撤销删除完整恢复方案且焦点回应用入口',same(restored,updated)&&restoredLibrary.length===beforeDelete.length&&await p.eval(`document.activeElement===document.querySelector(${JSON.stringify(card(id)+' [data-profile-apply]')})`),restored);
    check(label+' 全管理链不改变学习队列进度与今日状态',same(before,await p.eval(learning)));
    await geometry(label+' 撤销后');await shot(label.replaceAll(' ','-')+'-restored');
    await p.key('Escape');await p.waitFor('document.querySelector("#settingsWorkspaceSheet").hidden');
    check(label+' Esc退出后学习卡焦点恢复',await p.eval('document.activeElement.id==="card"'));
    report.samples.push({width,theme,fontSize,originalProfile:source,updatedProfile:updated,copies:[firstCopy?.name,secondCopy?.name],undo});
  }
  await p.setViewport(375,812,{mobile:true});await seed('dark','large',{autoEnabled:true,groupSize:7});
  const beforeConflict=await p.eval(learning);
  await click('#btnQuickSettings');await p.waitFor('!document.querySelector("#settingsWorkspaceSheet").hidden');
  check('375 续背配置初始无冲突',await p.eval('!document.querySelector("#quickPendingDiff .workspace-warning")'));
  await fill('[data-quick-key="groupSize"]','1');await p.waitFor('document.querySelector("#quickPendingDiff .workspace-warning")');
  const warning=await p.eval('document.querySelector("#quickPendingDiff .workspace-warning").textContent');
  const quickFix='#quickPendingDiff .workspace-warning button:last-child';await p.scrollIntoView(quickFix);
  check('375 快速改组长后冲突提示与便捷修正可见可点',warning.includes('自动续背')&&warning.includes('5')&&await p.isClickable(quickFix)&&same(beforeConflict,await p.eval(learning)),warning);
  await shot('375-dark-conflict');await click(quickFix);
  await p.waitFor('window.__vocab.getS().settings.autoResume.threshold===1');
  const fixed=await p.eval('JSON.parse(JSON.stringify(window.__vocab.getS().settings.autoResume))');
  check('375 明确便捷动作修改参数且保留当前组和今日暂停',same(fixed,{enabled:true,threshold:1,idleMs:30000,countdownMs:3000})&&same(beforeConflict,await p.eval(learning))&&!await p.eval('!!document.querySelector("#quickPendingDiff .workspace-warning")'),fixed);
  await geometry('375 便捷修正后');await shot('375-dark-conflict-fixed');
}catch(error){check('管理链执行完整',false,String(error.stack||error));}
finally{
  if(p)report.errors=p.errors();check('浏览器无新增console错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/workspace-management.json',JSON.stringify(report,null,2));
  if(p)await p.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/workspace-management.json',screenshots:report.shots.length}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
