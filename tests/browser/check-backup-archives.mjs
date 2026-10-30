#!/usr/bin/env node
/** 网页内多存档：隔离 Chrome profile，经真实键盘、点击、文件下载/选择与恢复确认验收。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vocab-backup-browser-')),downloads=path.join(temporary,'downloads');fs.mkdirSync(downloads);
const report={checks:[],shots:[],samples:[],errors:[],limits:['Chrome headless CDP; 375 viewport and large font are emulation, not physical mobile or screen-reader verification','Fixture initializes stored records; archive save/restore/delete/download and learning use real controls; native dialogs use CDP accept/cancel']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const records=`(() => {const s=window.__vocab.getS();return {progress:s.progress,days:s.days,stars:s.stars,proficient:s.proficient,review:s.reviewDay,extra:s.extraDay};})()`;
const store='window.__vocab.readBackupArchives()';
let p,acceptDialog=false;
async function click(selector){await p.scrollIntoView(selector);if(!await p.isClickable(selector))throw Error('控件无法真实命中：'+selector);await p.clickSelector(selector);}
async function keyboardClick(selector){await p.scrollIntoView(selector);await p.eval(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);await p.key('Enter');}
async function fill(selector,value){await click(selector);await p.eval(`document.querySelector(${JSON.stringify(selector)}).select()`);await p.insertText(value);await p.key('Tab');}
async function settings(){
  await click('[data-v="set"]');
  if(await p.eval('document.querySelector("#settingsCategory").getClientRects().length>0')){
    await p.scrollIntoView('#settingsCategory');
    // macOS CDP 原生 select 无法靠方向键可靠提交；只设置表单值并触发真实 change 路径。
    await p.eval(`{const picker=document.querySelector('#settingsCategory');picker.value='settings-backup';picker.dispatchEvent(new Event('change',{bubbles:true}));}`);
    await p.waitFor(`document.activeElement.id==='settings-backup'&&document.querySelector('#settingsCategory').value==='settings-backup'`);
    check('手机分类选择到备份区并同步原锚点与焦点',await p.eval(`document.querySelector('.settings-nav a[aria-current="location"]')?.getAttribute('href')==='#settings-backup'&&document.activeElement.id==='settings-backup'`));
  }else await click('a[href="#settings-backup"]');
}
async function study(){await click('[data-v="study"]');await p.eval('document.querySelector("#card").focus({preventScroll:true})');}
async function save(name){await fill('#archiveName',name);await click('#saveArchive');await p.waitFor(`window.__vocab.readBackupArchives().archives.some(a=>a.name===${JSON.stringify(name)})`);return (await p.eval(store)).archives.find(a=>a.name===name);}
const action=(id,name)=>`[data-archive-id="${id}"][data-archive-action="${name}"]`;
async function waitDownload(suffix){const deadline=Date.now()+6000;while(Date.now()<deadline){const file=fs.readdirSync(downloads).find(x=>x.endsWith(suffix));if(file){const target=path.join(downloads,file);try{const contents=fs.readFileSync(target,'utf8');if(contents){if(suffix==='.json')JSON.parse(contents);return target;}}catch{ /* 文件名先出现时继续等实际内容写完。 */ }}await sleep(60);}throw Error('未生成完整下载文件 '+suffix);}
async function upload(file){const {root}=await p.send('DOM.getDocument',{depth:1}),{nodeId}=await p.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#file'});await p.send('DOM.setFileInputFiles',{nodeId,files:[file]});}
async function seed(width){
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.eval(`(() => {const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};s.timeSec=0;
    Object.assign(s.settings,{dailyNew:5,groupSize:5,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,backlogGuard:false,autoSpk:false,fontSize:${JSON.stringify(width===375?'large':'standard')},theme:${JSON.stringify(width===375?'dark':'light')},singleCharKeys:true,keys:{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'}});
    localStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  try{await p.reload();await p.waitFor('window.__vocab&&window.__vocab.cur!==null');}finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  fs.readdirSync(downloads).forEach(f=>fs.rmSync(path.join(downloads,f)));
}
async function modalGeometry(label){
  const actual=await p.eval(`(() => {const e=document.querySelector('#importSheet .sheet-panel'),r=e.getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,scroll:e.scrollWidth,client:e.clientWidth,focus:e.contains(document.activeElement)};})()`);
  check(label+' 恢复确认无溢出且焦点在浮层',actual.left>=-1&&actual.right<=actual.width+1&&actual.scroll<=actual.client+1&&actual.focus,actual);
}
try{
  await conn.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#card")');
  const original=p._onEvent.bind(p);p._onEvent=(method,params)=>{if(method==='Page.javascriptDialogOpening'){p.dialogs.push({type:params.type,message:params.message,accepted:acceptDialog});p.send('Page.handleJavaScriptDialog',{accept:acceptDialog}).catch(()=>{});return;}original(method,params);};
  for(const width of [375,1440])try{
    await p.setViewport(width,width===375?812:1000,{mobile:width===375});await seed(width);await p.key('keyF');const first=await p.eval(records);
    check(width+' 真实F先生成一词可恢复记录',Object.keys(first.progress).length===1&&Object.values(first.days).some(d=>d.r===1),first);
    await click('[data-v="stats"]');check(width+' 统计页已移除备份区',await p.eval('!document.querySelector("#v-stats #exp")&&!document.querySelector("#v-stats #settings-backup")&&!/备份与导出/.test(document.querySelector("#v-stats").textContent)'));
    await settings();const beforeSave=await p.eval(records),one=await save('第一轮 '+width);
    check(width+' 保存新存档不改学习记录且自动清空名称',same(beforeSave,await p.eval(records))&&await p.eval('document.querySelector("#archiveName").value===""'));
    await study();await p.key('Enter');await p.key('keyB');await p.key('keyF');const second=await p.eval(records);await settings();const two=await save('第二轮 '+width);
    check(width+' 两份命名存档分别保留一词/两词和收藏',one.id!==two.id&&Object.keys(one.data.books.kaoyan.progress).length===1&&Object.keys(two.data.books.kaoyan.progress).length===2&&Object.keys(two.data.books.kaoyan.stars).length===1,(await p.eval(store)).archives.map(a=>({name:a.name,id:a.id})));
    const archiveRaw=await p.eval('localStorage.getItem(window.__vocab.backupArchivesKey)');await p.reload();await p.waitFor('window.__vocab&&window.__vocab.readBackupArchives');await settings();
    check(width+' 刷新保留两份独立存档',await p.eval('localStorage.getItem(window.__vocab.backupArchivesKey)')===archiveRaw&&(await p.eval(store)).archives.length===2);
    await study();await p.key('Enter');await p.key('keyB');await p.key('keyF');const changed=await p.eval(records);await settings();
    check(width+' 恢复前确已通过学习/收藏改变记录',Object.keys(changed.progress).length===3&&Object.keys(changed.stars).length===2,changed);
    const rawBefore=await p.eval('localStorage.getItem("kaoyan_vocab_v1")');await keyboardClick(action(one.id,'restore'));await p.waitFor('!document.querySelector("#importSheet").hidden');
    const preview=await p.eval('({title:document.querySelector("#importTitle").textContent,summary:document.querySelector("#importSummary").textContent,books:document.querySelector("#importBookList").textContent,scope:document.querySelector("#importScopeNote").textContent})');
    check(width+' 恢复预览说明名称/时间/记录量/替换范围且确认前不写',preview.title.includes(one.name)&&/导出于/.test(preview.summary)&&/已学 1 词/.test(preview.books)&&/替换/.test(preview.scope)&&await p.eval('localStorage.getItem("kaoyan_vocab_v1")')===rawBefore,preview);await modalGeometry(width);
    await click('#importSheet .acts [data-import-close]');check(width+' 取消恢复不写且焦点回原存档按钮',same(changed,await p.eval(records))&&await p.eval('localStorage.getItem("kaoyan_vocab_v1")')===rawBefore&&await p.eval(`document.activeElement.dataset.archiveId===${JSON.stringify(one.id)}`));
    await keyboardClick(action(one.id,'restore'));await click('#importConfirm');await p.waitFor('document.querySelector("#importSheet").hidden');
    check(width+' 确认恢复准确回到第一份进度与收藏',same(first,await p.eval(records)),await p.eval(records));
    check(width+' 恢复不修改或覆盖两份存档',await p.eval('localStorage.getItem(window.__vocab.backupArchivesKey)')===archiveRaw);
    await keyboardClick(action(two.id,'export'));const archiveFile=await waitDownload('.json'),fileData=JSON.parse(fs.readFileSync(archiveFile,'utf8'));
    check(width+' 单份下载得到选中第二份v3备份',fileData.version===3&&same(fileData.books.kaoyan.progress,two.data.books.kaoyan.progress)&&same(fileData.books.kaoyan.stars,two.data.books.kaoyan.stars),{file:path.basename(archiveFile)});
    await keyboardClick('#imp');await upload(archiveFile);await p.waitFor('!document.querySelector("#importSheet").hidden');
    check(width+' 从文件恢复入口可用且确认前不写',same(first,await p.eval(records))&&await p.eval('document.querySelector("#importTitle").textContent==="确认导入进度"'));
    await click('#importConfirm');check(width+' 文件确认恢复到第二份数据',same(second,await p.eval(records)),await p.eval(records));fs.rmSync(archiveFile);
    const current=await p.eval(records);await keyboardClick('#exp');const currentFile=await waitDownload('.json'),currentData=JSON.parse(fs.readFileSync(currentFile,'utf8'));check(width+' 导出进度文件下载当前有效记录',currentData.version===3&&same(currentData.books.kaoyan.progress,current.progress)&&same(current,await p.eval(records)));fs.rmSync(currentFile);
    acceptDialog=false;await keyboardClick(action(two.id,'delete'));await sleep(80);check(width+' 删除取消保留两份和当前记录',(await p.eval(store)).archives.length===2&&same(current,await p.eval(records))&&p.dialogs.at(-1)?.accepted===false,p.dialogs.at(-1));
    acceptDialog=true;await keyboardClick(action(two.id,'delete'));await p.waitFor('window.__vocab.readBackupArchives().archives.length===1');check(width+' 确认只删选中存档且焦点有归处',(await p.eval(store)).archives[0].id===one.id&&same(current,await p.eval(records))&&await p.eval('document.activeElement.id==="saveArchive"'),p.dialogs.at(-1));
    const geometry=await p.eval(`(() => {const root=document.querySelector('#settings-backup'),controls=[...root.querySelectorAll('button:not([hidden]),input:not([hidden])')].filter(e=>e.offsetWidth&&e.offsetHeight).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.dataset.archiveAction,w:r.width,h:r.height};});return {width:innerWidth,doc:document.documentElement.scrollWidth,section:root.scrollWidth,client:root.clientWidth,controls};})()`);
    check(width+' 备份区无横向溢出且主要控件至少44px',geometry.doc<=width+1&&geometry.section<=geometry.client+1&&geometry.controls.every(c=>c.h>=44),geometry);
    if(width===1440){
      // 重现上一节仅露短尾部、备份标题已进入阅读区的真实滚动位置；只驱动DOM滚动，不调用导航业务函数。
      await p.eval(`{const main=document.querySelector('#main'),section=document.querySelector('#settings-backup');main.scrollBy({top:section.getBoundingClientRect().top-main.getBoundingClientRect().top-80,behavior:'auto'});}`);await p.nextFrame();
      const nav=await p.eval(`(() => {const main=document.querySelector('#main'),section=document.querySelector('#settings-backup'),active=document.querySelector('.settings-nav a[aria-current="location"]');return {mainTop:main.getBoundingClientRect().top,sectionTop:section.getBoundingClientRect().top,active:active?.getAttribute('href'),label:active?.textContent};})()`);
      check('1440 备份标题进入上方阅读区时导航高亮06',Math.abs(nav.sectionTop-nav.mainTop-80)<=2&&nav.active==='#settings-backup'&&/06/.test(nav.label),nav);
    }else await p.scrollIntoView('#archiveList');
    report.shots.push(await p.screenshot('backup-archives-'+width+'.png'));
    await keyboardClick('#backupExportTxt');const txtFile=await waitDownload('.txt'),lines=fs.readFileSync(txtFile,'utf8').trim().split(/\r?\n/);check(width+' 范围TXT入口真实下载完整词表',lines.length>1000&&lines.every(l=>l&&!l.includes('\t')),{lines:lines.length,file:path.basename(txtFile)});fs.rmSync(txtFile);
    await keyboardClick('#backupSplitTxt');await p.waitFor('!document.querySelector("#txtSplitSheet").hidden');check(width+' 分批TXT入口真实打开且焦点在浮层',await p.eval('document.querySelector("#txtSplitSheet").contains(document.activeElement)'));await p.key('Escape');check(width+' 分批TXT关闭回入口',await p.eval('document.querySelector("#txtSplitSheet").hidden&&document.activeElement.id==="backupSplitTxt"'));
    report.samples.push({width,preview,geometry});
  }catch(error){check(width+' 旅程完整执行',false,String(error.stack||error));}
}catch(error){check('浏览器启动完整',false,String(error.stack||error));}
finally{
  if(p)report.errors=p.errors();check('浏览器无新增console错误',report.errors.length===0,report.errors);
  report.passed=report.checks.filter(c=>c.ok).length;report.failed=report.checks.length-report.passed;
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/backup-archives.json',JSON.stringify(report,null,2));
  await p?.close();conn.close();await chrome.close();await server.close();fs.rmSync(temporary,{recursive:true,force:true});
}
console.log(`网页存档浏览器：${report.passed} 通过 / ${report.failed} 失败`);process.exitCode=report.failed?1:0;
