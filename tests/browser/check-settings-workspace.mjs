#!/usr/bin/env node
/** 设置工作台用户旅程；沿用无依赖 CDP，默认 Node 汇总不启动本文件。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const MATRIX=[
  '默认手机首屏可达主要计划控件，生命周期匹配态收起',
  '已揭示卡快速调整计划与即时偏好，保留当前组并可真实撤销',
  '常用项自选持久化，真实刷新恢复原学习现场',
  '检索高级设置并展开/聚焦，不写配置或学习记录',
  '保存个人方案并仅应用所选类别，保留其他配置及今天状态',
  '真实导出方案，非法多方案文件整份拒绝且不半写',
  '有效配置导入先预览后确认，只增加方案库',
  '375/1440、暗色/大字、输入守卫及浮层焦点/命中',
  '自然完成一词组，加量并学习与仅增加额度语义分开，指针连击不误判新卡',
  '词表真实搜索/收藏后打印默认当前筛选并保留学习现场'
];
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vocab-workspace-'));
const downloads=path.join(temporary,'downloads');fs.mkdirSync(downloads);
const report={browser:await conn.send('Browser.getVersion'),matrix:MATRIX,checks:[],samples:[],shots:[],errors:[],extraErrors:[],
  limits:['Chrome headless; 375×812/1440×1000 representative widths','Dark/large at 375 and light/standard at 1440; not a full Cartesian matrix','Temporary profile and generated configuration files only','Native select keyboard routing does not change even an isolated blank select in this macOS CDP environment; select values use the DOM control plus native change event, never a business write hook','No true mobile keyboard, IME, screen reader, speech or native zoom verification']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const learning=`(() => {const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,Q:v.Q,answered:v.answered,total:v.getGroupTotal(),plan:v.getPlan(),progress:s.progress,days:s.days,stars:s.stars,proficient:s.proficient,reviewDay:s.reviewDay,extraDay:s.extraDay,pause:localStorage.getItem('vocab_autoresume_pause_v1'),drill:v.drillMode,extra:v.isExtraSubgroup(),newOnly:v.isNewOnlySubgroup()};})()`;
const settings='JSON.parse(JSON.stringify(window.__vocab.getS().settings))';
const profiles='window.__vocabSettingsProfiles.readSettingsProfiles()';
let p;
async function shot(name){await sleep(280);report.shots.push(await p.screenshot('settings-workspace-'+name+'.png'));}
async function click(selector){await p.scrollIntoView(selector);if(!await p.isClickable(selector))throw new Error('控件不能真实命中：'+selector);await p.clickSelector(selector);}
async function fill(selector,value){await click(selector);await p.eval(`document.querySelector(${JSON.stringify(selector)}).select()`);if(String(value))await p.insertText(String(value));else await p.key('Backspace');await p.key('Tab');}
async function setControl(selector,value){
  const info=await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)});return e?{tag:e.tagName,type:e.type,value:e.value,checked:e.checked}:null;})()`);
  if(!info)throw new Error('缺少控件：'+selector);
  if(info.type==='checkbox'){if(info.checked!==value)await click(selector);return;}
  if(info.tag==='SELECT'){
    await p.scrollIntoView(selector);await p.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const index=await p.eval(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(String(value))})`);
    if(index<0)throw new Error('缺少选项：'+selector+' = '+value);
    // 本机CDP原生select按键在独立空白页面也不提交；沿真实表单change路径，不调用业务写hook。
    await p.eval(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));}`);await p.key('Tab');return;
  }
  await fill(selector,value);
}
async function openQuick(){await click('#btnQuickSettings');await p.waitFor('!document.querySelector("#settingsWorkspaceSheet").hidden');await p.waitFor('document.querySelector("[data-quick-key=groupSize]")');}
async function openProfiles(){
  if(await p.eval('document.querySelector("#settingsWorkspaceSheet").hidden'))await openQuick();
  await click('#workspaceProfilesTab');await p.waitFor('!document.querySelector("#workspaceProfiles").hidden');
}
async function chooseCategories(container,attribute,wanted){
  const choices=await p.eval(`Array.from(document.querySelectorAll(${JSON.stringify(container+' ['+attribute+']')})).map(e=>({key:e.getAttribute(${JSON.stringify(attribute)}),checked:e.checked}))`);
  if(!choices.length)throw new Error('类别控件为空：'+container);
  for(const c of choices)if(c.checked!==wanted.includes(c.key))await click(container+' ['+attribute+'="'+c.key+'"]');
}
async function upload(file){
  const {root}=await p.send('DOM.getDocument',{depth:1});
  const {nodeId}=await p.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#profilesFile'});
  if(!nodeId)throw new Error('缺少方案文件输入');
  await p.send('DOM.setFileInputFiles',{nodeId,files:[file]});
}
async function panelGeometry(label){
  const actual=await p.eval(`(() => {const e=document.querySelector('#settingsWorkspaceSheet .sheet-panel'),r=e.getBoundingClientRect(),close=e.querySelector('[data-close]'),cr=close.getBoundingClientRect(),hit=document.elementFromPoint(cr.x+cr.width/2,cr.y+cr.height/2);return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth,focusInside:e.contains(document.activeElement),closeHit:hit===close||close.contains(hit)};})()`);
  check(label+' 浮层边界/焦点/关闭命中',actual.doc<=actual.width+1&&actual.scroll<=actual.client+1&&actual.left>=-1&&actual.right<=actual.width+1&&actual.top>=-1&&actual.bottom<=actual.height+1&&actual.focusInside&&actual.closeHit,actual);
}
async function seed(theme,fontSize,{one=false}={}){
  // pagehide会在旧页重新写快照；仅在本次fixture装载前清理，移除后真实刷新仍应正常恢复。
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  await p.eval(`(() => {const s=JSON.parse(JSON.stringify(window.__vocab.getS())),d=new Date(),today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    s.progress={};s.days={};s.stars={};s.proficient={};s.spelling={};s.timeSec=0;s.reviewDay={d:today,used:0};s.extraDay={d:today,extra:${one?0:3}};
    Object.assign(s.settings,{theme:${JSON.stringify(theme)},fontSize:${JSON.stringify(fontSize)},dailyNew:${one?1:4},groupSize:${one?1:4},dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,autoSpk:false,singleCharKeys:true,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});
    localStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_active_book_v1','kaoyan');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));localStorage.setItem('vocab_autoresume_pause_v1',JSON.stringify({kaoyan:today,cet4:today}));})()`);
  try{await p.reload();await p.waitFor('window.__vocab&&window.__vocabSettingsProfiles&&window.__vocabWorkspace&&document.querySelector("#no")');}
  finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
}
try{
  await conn.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#card")');
  for(const config of [{width:1440,theme:'light',fontSize:'standard'},{width:375,theme:'dark',fontSize:'large'}]){
    const {width,theme,fontSize}=config,label=width+' '+theme+' '+fontSize;
    await p.setViewport(width,width===375?812:1000,{mobile:width===375});await seed(theme,fontSize);
    const targets=await p.eval(`window.__vocabSettingsProfiles.getCatalog().map(x=>({key:x.key,target:x.target,exists:!!document.querySelector(x.target)}))`);
    check(label+' 所有设置目录目标都存在',targets.every(x=>x.exists),targets);
    await click('[data-v="set"]');await sleep(200);
    const first=await p.eval(`(() => {const e=document.querySelector('#dailyNew'),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,closed:!document.querySelector('#settingsLifecycleDetails').open,doc:document.documentElement.scrollWidth,width:innerWidth};})()`);
    check(label+' 默认主要计划输入完整可见/匹配摘要收起',first.top>=0&&first.bottom<=first.height&&first.closed&&first.doc<=first.width+1,first);await shot('default-settings-'+width);
    await click('[data-v="study"]');await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');
    const original=await p.eval(learning);await openQuick();await panelGeometry(label+' 快速调整');
    const quickCount=await p.eval('document.querySelectorAll("#quickSettingsFields [data-quick-key]").length');
    check(label+' 默认常用设置不超过六项',quickCount>=4&&quickCount<=6,quickCount);
    await setControl('[data-quick-key="groupSize"]',7);await setControl('[data-quick-key="dailyNew"]',6);await setControl('[data-quick-key="dailyReviewCap"]',60);
    const nextFont=fontSize==='large'?'standard':'large';await setControl('[data-quick-key="fontSize"]',nextFont);
    const quick=await p.eval(`({state:window.__vocabWorkspace.getState(),diff:window.__vocabWorkspace.getPendingDiff(),settings:${settings},learning:${learning},font:document.documentElement.dataset.fontSize,text:document.querySelector('#quickPendingDiff').textContent})`);
    check(label+' 快速计划下组生效/字号与上限即时保存且现场不变',quick.settings.groupSize===7&&quick.settings.dailyNew===6&&quick.settings.dailyReviewCap===60&&quick.font===nextFont&&quick.text.includes('下一组')&&same(original,quick.learning),quick);await shot('quick-pending-'+width);
    await p.eval('document.querySelector("#workspaceQuickTab").focus()');await p.key('ArrowRight');
    check(label+' Tab页方向键选择方案并转移焦点',await p.eval('document.activeElement.id==="workspaceProfilesTab"&&!document.querySelector("#workspaceProfiles").hidden'));
    await p.key('ArrowLeft');
    await p.key('Escape');await p.waitFor('document.querySelector("#settingsWorkspaceSheet").hidden');
    check(label+' 关闭快速调整焦点回学习卡',await p.eval('document.activeElement.id==="card"'));
    await click('#undoBtn');check(label+' 快速调整后仍能真实撤销',await p.eval('window.__vocab.answered===0&&window.__vocab.phase==="recall"&&Object.keys(window.__vocab.getS().progress).length===0'));
    await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');

    await openQuick();
    const beforeRemote=await p.eval(learning),remote=await Page.open(conn,{url:server.url()});
    try{
      await remote.waitFor('window.__vocab&&document.querySelector("#btnQuickSettings")');await remote.clickSelector('#btnQuickSettings');await remote.waitFor('!document.querySelector("#settingsWorkspaceSheet").hidden');
      const field='[data-quick-key="groupSize"]';await remote.scrollIntoView(field);await remote.clickSelector(field);await remote.eval(`document.querySelector(${JSON.stringify(field)}).select()`);await remote.insertText('11');await remote.key('Tab');
      await p.waitFor('window.__vocab.getS().settings.groupSize===11');
      const live=await p.eval(`({field:document.querySelector('[data-quick-key="groupSize"]').value,hidden:document.querySelector('#settingsWorkspaceSheet').hidden,learning:${learning}})`);
      check(label+' 跨标签配置更新同步可见字段且不关闭/丢现场',live.field==='11'&&!live.hidden&&same(beforeRemote,live.learning),live);
      await remote.scrollIntoView('#quickPins > summary');await remote.clickSelector('#quickPins > summary');
      const remotePin='[data-quick-pin="showEx"]';if(!await remote.eval(`document.querySelector(${JSON.stringify(remotePin)}).checked`)){await remote.scrollIntoView(remotePin);await remote.clickSelector(remotePin);}
      await p.waitFor('window.__vocabWorkspace.getState().prefs.pins.includes("showEx")');
      check(label+' 跨标签常用项同步到已打开面板',await p.eval('!!document.querySelector("[data-quick-key=showEx]")')&&same(beforeRemote,await p.eval(learning)));
    }finally{report.extraErrors.push(...remote.errors());await remote.close();await p.send('Page.bringToFront');}
    await setControl('[data-quick-key="groupSize"]',7);await click('#quickPins > summary');
    const pin='[data-quick-pin="showPh"]';if(!await p.eval(`document.querySelector(${JSON.stringify(pin)}).checked`))await click(pin);
    await p.waitFor('document.querySelector("[data-quick-key=showPh]")');
    check(label+' 常用项重绘后键盘焦点保持在原选择项',await p.eval('document.activeElement.dataset.quickPin==="showPh"'));
    const beforeReload=await p.eval(learning);
    await p.key('Escape');await p.reload();await p.waitFor('window.__vocab&&window.__vocab.phase==="revealed"');await openQuick();
    check(label+' 常用项刷新保留且旧组恢复',await p.eval('!!document.querySelector("[data-quick-key=showPh]")')&&same(beforeReload,await p.eval(learning)));
    await click('#workspaceAllSettings');await p.waitFor('document.querySelector("#v-set").classList.contains("on")&&document.querySelector("#settingsWorkspaceSheet").hidden');
    const beforeSearch={learning:await p.eval(learning),settings:await p.eval(settings)};
    await click('#settingsSearch');await p.key('keyJ');
    check(label+' 完整设置搜索输入不穿透学习改判',same(beforeSearch.learning,await p.eval(learning)));
    await fill('#settingsSearch','十档');await p.waitFor('document.querySelector("#settingsSearchResults [data-setting-target]")');
    const result=await p.eval(`(() => {const e=[...document.querySelectorAll('#settingsSearchResults [data-setting-target]')].find(x=>x.textContent.includes('十档'));if(!e)throw new Error('十档搜索结果不存在');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,target:e.dataset.settingTarget};})()`);
    await p.click(result.x,result.y);await sleep(180);
    const located=await p.eval(`(() => {const a=document.activeElement,parents=[];for(let e=a;e;e=e.parentElement)if(e.tagName==='DETAILS')parents.push(e.open);const r=a.getBoundingClientRect();return {id:a.id,tag:a.tagName,stage:a.dataset.stageIndex,insideRhythm:!!a.closest('#settings-rhythm'),parents,top:r.top,bottom:r.bottom,height:innerHeight};})()`);
    check(label+' 搜索展开高级并聚焦真实档位输入',located.insideRhythm&&['INPUT','SELECT'].includes(located.tag)&&located.parents.every(Boolean)&&located.top>=0&&located.bottom<=located.height,located);
    check(label+' 搜索定位不修改设置/现场',same(beforeSearch.settings,await p.eval(settings))&&same(beforeSearch.learning,await p.eval(learning)));await shot('search-rhythm-'+width);
    await fill('#settingsSearch','语速');await p.waitFor('document.querySelector("#settingsSearchResults [data-setting-target]")');
    const speechResult=await p.eval(`(() => {const e=[...document.querySelectorAll('#settingsSearchResults [data-setting-target]')].find(x=>x.textContent.includes('语速'));e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await p.click(speechResult.x,speechResult.y);await sleep(120);
    check(label+' 发音检索定位真实语速控件且配置不变',await p.eval('document.activeElement.id==="speechRate"')&&same(beforeSearch.settings,await p.eval(settings))&&same(beforeSearch.learning,await p.eval(learning)));await shot('search-speech-'+width);
    await fill('#settingsSearch','不存在的设置XYZ');await sleep(120);
    check(label+' 无搜索结果有明确反馈',await p.eval('document.querySelector("#settingsSearchResults").textContent.trim().length>0&&!document.querySelector("#settingsSearchResults [data-setting-target]")'));
    await fill('#settingsSearch','');await click('[data-v="study"]');await openProfiles();

    await click('#profileSaveBox > summary');const profileName='浏览器个人方案 '+width;
    await fill('#profileName',profileName);const beforeTyping=await p.eval(learning);await click('#profileName');await p.key('keyJ');
    check(label+' 浮层文字输入不穿透学习改判',same(beforeTyping,await p.eval(learning)));await fill('#profileName',profileName);
    await chooseCategories('#profileSaveCategories','data-profile-save-category',['plan','appearance']);await click('#saveSettingsProfile');
    await p.waitFor(`window.__vocabSettingsProfiles.readSettingsProfiles().profiles.some(x=>x.name===${JSON.stringify(profileName)})`);
    const saved=await p.eval(`window.__vocabSettingsProfiles.readSettingsProfiles().profiles.find(x=>x.name===${JSON.stringify(profileName)})`);
    check(label+' 方案只存选定配置类别',same(saved.categories,['plan','appearance'])&&!('progress' in saved.settings)&&!('extraDay' in saved.settings)&&!('spelling' in saved.settings),saved);
    await click('#workspaceQuickTab');await setControl('[data-quick-key="groupSize"]',9);await setControl('[data-quick-key="fontSize"]',fontSize);
    await click('#workspaceProfilesTab');await chooseCategories('#profileApplyCategories','data-profile-apply-category',['plan']);
    const beforeApply={learning:await p.eval(learning),settings:await p.eval(settings)};
    const applySelector='[data-profile-id="'+saved.id+'"] [data-profile-apply]';await p.scrollIntoView(applySelector);await p.eval(`document.querySelector(${JSON.stringify(applySelector)}).focus()`);await p.key('Enter');await p.waitFor('window.__vocab.getS().settings.groupSize===7');
    const applied=await p.eval(settings),catalog=await p.eval('window.__vocabSettingsProfiles.getCatalog()');
    const selected=catalog.filter(x=>x.category==='plan').map(x=>x.key),unselected=catalog.filter(x=>x.category!=='plan').map(x=>x.key);
    check(label+' 仅应用学习计划/未选类别保持原值',selected.every(k=>same(applied[k],saved.settings[k]))&&unselected.every(k=>same(applied[k],beforeApply.settings[k])),{before:beforeApply.settings,after:applied,categories:selected});
    check(label+' 应用方案保留已揭示组/今日暂停/临时量',same(beforeApply.learning,await p.eval(learning)));await panelGeometry(label+' 方案列表');await shot('profiles-applied-'+width);
    check(label+' 方案应用重绘后焦点仍在该方案可操作按钮',await p.eval(`document.activeElement.dataset.profileApply===${JSON.stringify(saved.id)}`));

    await click('#exportProfiles');const deadline=Date.now()+6000;let file;
    while(Date.now()<deadline){file=fs.readdirSync(downloads).find(x=>x.endsWith('.json'));if(file)break;await sleep(100);}
    if(!file)throw new Error('实际方案导出未生成JSON');
    const exported=JSON.parse(fs.readFileSync(path.join(downloads,file),'utf8'));fs.rmSync(path.join(downloads,file));
    check(label+' 实际下载配置文件与进度备份区分',exported.kind==='vocab-settings-profiles'&&exported.version===1&&exported.profiles.some(x=>x.id===saved.id)&&!('books' in exported),exported);
    const imported=JSON.parse(JSON.stringify(saved));imported.id='imported_'+width;imported.name='导入独立方案 '+width;
    const broken=JSON.parse(JSON.stringify(imported));broken.id+='bad';broken.name+='非法';broken.settings.groupSize=0;
    const invalid={kind:exported.kind,version:exported.version,profiles:[imported,broken]},valid={kind:exported.kind,version:exported.version,profiles:[imported]};
    const badFile=path.join(temporary,'invalid-'+width+'.json'),goodFile=path.join(temporary,'valid-'+width+'.json');fs.writeFileSync(badFile,JSON.stringify(invalid));fs.writeFileSync(goodFile,JSON.stringify(valid));
    const beforeImport={learning:await p.eval(learning),settings:await p.eval(settings),library:await p.eval(profiles)};
    await upload(badFile);await p.waitFor('document.querySelector("#workspaceStatus").textContent.includes("每组词数")');
    check(label+' 非法混合文件整份拒绝不半写',same(beforeImport.library,await p.eval(profiles))&&same(beforeImport.settings,await p.eval(settings))&&same(beforeImport.learning,await p.eval(learning))&&await p.eval('document.querySelector("#profilesImportPreview").hidden'),await p.eval('document.querySelector("#workspaceStatus").textContent'));
    await upload(goodFile);await p.waitFor('!document.querySelector("#profilesImportPreview").hidden');
    check(label+' 有效导入先预览不应用不落库',same(beforeImport.library,await p.eval(profiles))&&same(beforeImport.settings,await p.eval(settings))&&same(beforeImport.learning,await p.eval(learning)),await p.eval('document.querySelector("#profilesImportSummary").textContent'));await shot('import-preview-'+width);
    await click('#confirmProfilesImport');await p.waitFor(`window.__vocabSettingsProfiles.readSettingsProfiles().profiles.some(x=>x.id===${JSON.stringify(imported.id)})`);
    check(label+' 确认只增加方案不替换学习设置或现场',await p.eval('window.__vocabSettingsProfiles.readSettingsProfiles().profiles.length')===beforeImport.library.profiles.length+1&&same(beforeImport.settings,await p.eval(settings))&&same(beforeImport.learning,await p.eval(learning)));
    await panelGeometry(label+' 导入完成');await shot('import-complete-'+width);await p.key('Escape');
    report.samples.push({config,first,quickCount,located,profile:saved.id,workspace:await p.eval('window.__vocabWorkspace.getState()')});
  }
  for(const {width,theme,fontSize} of [{width:375,theme:'dark',fontSize:'large'},{width:1440,theme:'light',fontSize:'standard'}]){
    const label='学习动作 '+width;
    await p.setViewport(width,width===375?812:1000,{mobile:width===375});await seed(theme,fontSize,{one:true});
    await p.key('keyF');await p.key('Enter');await p.waitFor('document.querySelector("#again")&&!document.querySelector("#extraNewRow").hidden');
    const beforeExtra=await p.eval(learning);await p.scrollIntoView('#extraNew10');
    const extraRect=await p.rect('#extraNew10');check(label+' 加10词并继续入口真实命中',await p.isClickable('#extraNew10')&&extraRect.text.includes('继续'),extraRect);
    await p.eval(`window.__workspaceExtraClicks=[];document.addEventListener('click',e=>{if(window.__workspaceExtraClicks.length<4)window.__workspaceExtraClicks.push({id:e.target.closest('button')?.id||e.target.id,x:e.clientX,y:e.clientY,detail:e.detail});},{capture:true});`);
    await p.doubleClickAt(extraRect.cx,extraRect.cy,{gap:50});await sleep(160);
    const started=await p.eval(`({learning:${learning},settings:${settings},clicks:window.__workspaceExtraClicks})`);
    check(label+' 一次加量启动且连击不判定新卡',started.learning.cur!==null&&started.learning.phase==='recall'&&started.learning.answered===0&&started.learning.total===1
      &&started.settings.dailyNew===1&&started.learning.extraDay.extra===10&&same(started.learning.progress,beforeExtra.progress)&&same(started.learning.days,beforeExtra.days)
      &&same(started.learning.reviewDay,beforeExtra.reviewDay)&&!started.learning.extra&&!started.learning.newOnly,started);await shot('extra-started-'+width);

    await seed(theme,fontSize,{one:true});await p.key('keyF');await p.key('Enter');await p.waitFor('document.querySelector("#again")&&!document.querySelector("#extraNewRow").hidden');
    await click('#extraNewCustom');await fill('#extraNewCustomInput',5);const beforeOnly=await p.eval(learning);await click('#extraNewGrantOnly');
    const only=await p.eval(learning);
    check(label+' 仅增加额度不启动不判定',only.cur===null&&only.answered===1&&only.extraDay.extra===5&&same(only.Q,beforeOnly.Q)
      &&same(only.progress,beforeOnly.progress)&&same(only.days,beforeOnly.days)&&same(only.reviewDay,beforeOnly.reviewDay),only);await shot('extra-grant-only-'+width);
    await click('[data-v="list"]');await fill('#q','make');
    const make=await p.eval('window.__vocab.getW().findIndex(x=>x.w==="make")'),row='[data-open-word="'+make+'"]';await p.waitFor(`document.querySelector(${JSON.stringify(row)})`);await click(row);await p.waitFor('!document.querySelector("#wordSheet").hidden');
    await click('#detailStar');await p.key('Escape');await p.waitFor('document.querySelector("#wordSheet").hidden');
    const beforePrint=await p.eval(learning),listCount=await p.eval('document.querySelector("#listCount").textContent'),count=Number(listCount.match(/共\s*(\d+)\s*词/)?.[1]);
    await click('#listExportMenu > summary');await click('#btnPrintBookList');await p.waitFor('!document.querySelector("#printSheet").hidden');
    const print=await p.eval(`({source:document.querySelector('#printSource').value,words:[...document.querySelectorAll('#printBody .print-word')].map(x=>x.textContent),count:document.querySelector('#printCount').textContent,query:document.querySelector('#q').value,doc:document.documentElement.scrollWidth,width:innerWidth})`);
    check(label+' 已有收藏时词表打印仍沿用当前搜索筛选',print.source==='filter'&&print.query==='make'&&print.words.length===count&&print.words.includes('make')&&print.count.includes('筛选结果')&&print.doc<=print.width+1,print);
    check(label+' 打印预览不改变已完成组/进度/额度',same(beforePrint,await p.eval(learning)));await shot('print-current-filter-'+width);await p.key('Escape');
  }
}catch(error){check('设置工作台旅程执行完整',false,String(error.stack||error));}
finally{
  if(p)report.errors=[...report.extraErrors,...p.errors()];check('浏览器无新增console错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/settings-workspace.json',JSON.stringify(report,null,2));
  if(p)await p.close();conn.close();await chrome.close();await server.close();fs.rmSync(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/settings-workspace.json',screenshots:report.shots.length}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
