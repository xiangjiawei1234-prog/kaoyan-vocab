#!/usr/bin/env node
/** 个人方案的真实 UI 本书隔离与同值冻结；不使用业务写 hook 保存/应用/切书。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';

const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const sourceStart=fingerprint(),server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],errors:[],shots:[],sourceStart,
  limits:['独立临时Chrome profile；1440浅色和375深色','初始夹具只写隔离存储；保存/应用/切书/改设置走真实UI','手机尺寸仿真不代表真机、读屏或原生软键盘','存储写失败/回滚由既有Node真实app专项验证，本文件不穷举失败组合']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const p=await Page.open(conn,{url:server.url()});
const SCENE=`(()=>{const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,total:v.getGroupTotal(),plan:v.getPlan(),progress:s.progress,days:s.days,stars:s.stars,prof:s.proficient,review:s.reviewDay,extra:s.extraDay,pause:localStorage.getItem('vocab_autoresume_pause_v1'),snapshot:localStorage.getItem('vocab_session_snapshot_'+v.getBook()+'_v1')};})()`;
const PREFS=`(()=>{const d=JSON.parse(localStorage.getItem('vocab_device_preferences_v1')),v=window.__vocab;return {book:v.getBook(),settings:JSON.parse(JSON.stringify(v.getS().settings)),shared:d.shared,overrides:d.overrides,raw:localStorage.getItem('vocab_device_preferences_v1'),main:localStorage.getItem(v.getBook()+'_vocab_v1')};})()`;
let template,deviceTemplate;
async function ready(){await p.waitFor('window.__vocab&&window.__vocabSettingsProfiles&&document.querySelector("#card")');await p.send('Page.bringToFront');}
async function click(selector){await p.send('Page.bringToFront');await p.scrollIntoView(selector);await sleep(160);if(!await p.isClickable(selector))throw Error('控件不能真实命中：'+selector);await p.clickSelector(selector);await sleep(100);}
async function fill(selector,value){await click(selector);await p.eval(`document.querySelector(${JSON.stringify(selector)}).select()`);if(String(value))await p.insertText(String(value));else await p.key('Backspace');await p.key('Tab');await sleep(80);}
async function categories(container,attribute,wanted){
  const choices=await p.eval(`[...document.querySelectorAll(${JSON.stringify(container+' ['+attribute+']')})].map(x=>({key:x.getAttribute(${JSON.stringify(attribute)}),checked:x.checked}))`);
  if(!choices.length)throw Error('类别控件不存在：'+container);
  for(const choice of choices)if(choice.checked!==wanted.includes(choice.key))await click(container+' ['+attribute+'="'+choice.key+'"]');
}
async function seed(width,theme){
  await p.setViewport(width,width<500?812:1000,{mobile:width<500});
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  try{
    await p.eval(`(()=>{const s=${JSON.stringify(template)},d=${JSON.stringify(deviceTemplate)},now=new Date(),today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');s.progress={};s.days={};s.stars={};s.proficient={};s.spelling={};s.timeSec=0;s.reviewDay={d:today,used:0};s.extraDay={d:today,extra:3};Object.assign(s.settings,{theme:${JSON.stringify(theme)},fontSize:'standard',dailyNew:4,groupSize:2,dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,autoSpk:false,singleCharKeys:true,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});d.shared.theme=${JSON.stringify(theme)};d.shared.fontSize='standard';for(const id of Object.keys(d.overrides))d.overrides[id]=[];localStorage.clear();sessionStorage.clear();localStorage.setItem('vocab_device_preferences_v1',JSON.stringify(d));localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_default_book_v1','kaoyan');sessionStorage.setItem('vocab_page_book_v1','kaoyan');sessionStorage.setItem('vocab_page_book_mode_v1','local');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));localStorage.setItem('vocab_autoresume_pause_v1',JSON.stringify({kaoyan:today,cet4:today}));})()`);
    await p.reload();await ready();
  }finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');await click('[data-v="set"]');
}
async function openProfiles(){await click('#btnSettingsProfiles');await p.waitFor('!document.querySelector("#settingsWorkspaceSheet").hidden&&!document.querySelector("#workspaceProfiles").hidden');}
async function closeProfiles(){await click('#settingsWorkspaceSheet .sheet-head [data-close]');await p.waitFor('document.querySelector("#settingsWorkspaceSheet").hidden');}
async function saveProfile(name,cats){
  await openProfiles();await click('#profileSaveBox > summary');await fill('#profileName',name);
  await categories('#profileSaveCategories','data-profile-save-category',cats);await click('#saveSettingsProfile');
  const profile=await p.eval(`window.__vocabSettingsProfiles.readSettingsProfiles().profiles.find(x=>x.name===${JSON.stringify(name)})`);
  if(!profile)throw Error('真实保存未产生方案：'+name);
  return profile;
}
async function applyProfile(profile,cats){await categories('#profileApplyCategories','data-profile-apply-category',cats);await click('[data-profile-apply="'+profile.id+'"]');}
async function switchBook(id){await click('#btnBooks');await p.waitFor('!document.querySelector("#bookSheet").hidden');await click('#bookList [data-book="'+id+'"]');await p.waitFor(`window.__vocab.getBook()===${JSON.stringify(id)}&&document.querySelector('#bookSheet').hidden`);}
async function shot(name){await p.waitFor(`!document.querySelector('#toast').classList.contains('on')`);await sleep(260);report.shots.push(await p.screenshot('profile-scope-'+name+'.png'));}

try{
  await ready();template=await p.eval('JSON.parse(JSON.stringify(window.__vocab.getS()))');
  const ownership=await p.eval('window.__vocab.getPreferenceOwnership()');
  deviceTemplate={kind:'vocab-device-preferences',version:1,shared:ownership.shared,overrides:{kaoyan:[],cet4:[],cet6:[],combined:[]}};
  const appearance=await p.eval(`window.__vocabSettingsProfiles.getCatalog().filter(x=>x.category==='appearance').map(x=>x.key)`);
  for(const {width,theme} of [{width:1440,theme:'light'},{width:375,theme:'dark'}]){
    const label=width+'-'+theme;
    await seed(width,theme);await click('[data-font-size="large"]');await fill('#dailyNew',5);
    const profile=await saveProfile('本书大字方案-'+width,['plan','appearance']);
    check(label+' 真实保存方案包含选择的类别/有效值，排除学习记录',same(profile.categories,['plan','appearance'])&&profile.settings.fontSize==='large'&&profile.settings.dailyNew===5&&!('progress' in profile.settings)&&!('extraDay' in profile.settings),profile);
    await closeProfiles();await click('[data-font-size="standard"]');await fill('#dailyNew',7);
    const before=await p.eval(PREFS),learning=await p.eval(SCENE);
    check(label+' 应用前确为继承设备标准字号，无本书覆盖',before.settings.fontSize==='standard'&&before.shared.fontSize==='standard'&&before.overrides.kaoyan.length===0,before.overrides);
    await openProfiles();await categories('#profileApplyCategories','data-profile-apply-category',[]);
    const emptyCategories=await p.eval(`({checked:document.querySelectorAll('[data-profile-apply-category]:checked').length,cards:[...document.querySelectorAll('.profile-card')].map(x=>({note:x.querySelector('.sheet-note')?.textContent,error:!!x.querySelector('.workspace-error'),disabled:x.querySelector('[data-profile-apply]').disabled}))})`);
    check(label+' 未选类别时中性提示且全部禁用，不自动代选或改现场',emptyCategories.checked===0&&emptyCategories.cards.length>0&&emptyCategories.cards.every(x=>x.disabled&&!x.error&&/请选择要应用的类别/.test(x.note))&&same(learning,await p.eval(SCENE)),emptyCategories);
    await categories('#profileApplyCategories','data-profile-apply-category',['appearance']);
    const inapplicable=await p.eval(`[...document.querySelectorAll('.profile-card[data-profile-id^="builtin_"]')].map(x=>({note:x.querySelector('.sheet-note')?.textContent,error:!!x.querySelector('.workspace-error'),disabled:x.querySelector('[data-profile-apply]').disabled}))`);
    check(label+' 方案不含所选外观类别时用中性说明，不显示红色错误',inapplicable.length===2&&inapplicable.every(x=>x.disabled&&!x.error&&/此方案不包含所选类别/.test(x.note)),inapplicable);
    const preview=await p.eval(`document.querySelector('[data-profile-id="${profile.id}"]').textContent`);
    check(label+' 预览清楚说明只应用当前书并建立覆盖',/仅应用本书/.test(preview)&&/本书单独/.test(preview),preview);
    await click('[data-profile-apply="'+profile.id+'"]');const applied=await p.eval(PREFS);
    check(label+' 仅本书获得方案字号，设备通用值逐字段保持',applied.settings.fontSize==='large'&&same(applied.shared,before.shared),{font:applied.settings.fontSize,shared:applied.shared.fontSize});
    check(label+' 所选外观全字段建立本书覆盖，其他书覆盖不动',same(applied.overrides.kaoyan.slice().sort(),appearance.slice().sort())&&['cet4','cet6','combined'].every(id=>same(applied.overrides[id],before.overrides[id])),applied.overrides);
    const unselected=Object.keys(before.settings).filter(key=>!appearance.includes(key));
    check(label+' 未选择的计划/曲线/范围/操作类别保持原值',unselected.every(key=>same(applied.settings[key],before.settings[key]))&&applied.settings.dailyNew===7,{keys:unselected,dailyNew:applied.settings.dailyNew});
    check(label+' 应用不改变已揭示组、判定、配额、暂停或会话快照',same(learning,await p.eval(SCENE)));
    await shot('applied-'+label);await closeProfiles();await click('[data-v="study"]');await p.key('keyZ',{modifiers:2});
    check(label+' 回学习页真实撤销仍可用，偏好保留',await p.eval(`window.__vocab.answered===0&&window.__vocab.phase==='recall'&&window.__vocab.getS().settings.fontSize==='large'`));
    await click('[data-v="set"]');await switchBook('cet4');const other=await p.eval(PREFS);
    check(label+' 真实切到四级仍继承设备标准字号，方案没有广播',other.book==='cet4'&&other.settings.fontSize==='standard'&&other.shared.fontSize==='standard'&&!other.overrides.cet4.includes('fontSize'),other.overrides);
    await switchBook('kaoyan');check(label+' 返回考研仍保留本书大字方案',await p.eval(`window.__vocab.getS().settings.fontSize==='large'`));

    // 同值方案不是“什么都不做”：仍须把本书有效值冻结为本书覆盖。
    await seed(width,theme);const sameProfile=await saveProfile('本书标准冻结-'+width,['appearance']);
    const sameBefore=await p.eval(PREFS),sameScene=await p.eval(SCENE);
    await applyProfile(sameProfile,['appearance']);const frozen=await p.eval(PREFS),status=await p.eval(`document.querySelector('#workspaceStatus').textContent`);
    check(label+' 同值应用不改配置值和设备值，仍建立外观覆盖',same(sameBefore.settings,frozen.settings)&&same(sameBefore.shared,frozen.shared)&&same(frozen.overrides.kaoyan.slice().sort(),appearance.slice().sort()),frozen.overrides);
    check(label+' 同值应用状态如实说明归属变化，并保留学习现场',/本书单独/.test(status)&&same(sameScene,await p.eval(SCENE)),status);
    const noOpBefore=await p.eval(PREFS);await click('[data-profile-apply="'+sameProfile.id+'"]');const noOpAfter=await p.eval(PREFS);
    check(label+' 已冻结后重复应用是只读无变化，不重复保存或记账',noOpBefore.raw===noOpAfter.raw&&noOpBefore.main===noOpAfter.main&&same(sameScene,await p.eval(SCENE)));
    await closeProfiles();await switchBook('cet4');await click('[data-font-size="large"]');const deviceChanged=await p.eval(PREFS);
    check(label+' 其他书普通设置仍可编辑设备通用值',deviceChanged.settings.fontSize==='large'&&deviceChanged.shared.fontSize==='large'&&!deviceChanged.overrides.cet4.includes('fontSize'),deviceChanged.overrides);
    await switchBook('kaoyan');const restored=await p.eval(PREFS);
    check(label+' 设备后来改大字，已应用同值方案的考研保持标准',restored.settings.fontSize==='standard'&&restored.shared.fontSize==='large'&&restored.overrides.kaoyan.includes('fontSize'),{font:restored.settings.fontSize,shared:restored.shared.fontSize});
    await p.reload();await ready();check(label+' 实际刷新后本书方案归属与有效值继续保留',await p.eval(`window.__vocab.getBook()==='kaoyan'&&window.__vocab.getS().settings.fontSize==='standard'&&window.__vocab.getPreferenceOwnership().currentOverrides.includes('fontSize')`));
    await click('[data-v="set"]');await shot('frozen-after-reload-'+label);

    // 真正不合法的跨书范围仍显示错误并禁止应用，不能被“中性不适用”分支吞掉。
    await switchBook('cet4');await fill('#pmin',80);const rangeProfile=await saveProfile('四级范围上限-'+width,['scope']);
    check(label+' 真UI保存当前四级合法的80套卷范围方案',rangeProfile.bookId==='cet4'&&rangeProfile.settings.pmin===80,rangeProfile.settings);
    await closeProfiles();await switchBook('kaoyan');const beforeInvalid=await p.eval(SCENE);await openProfiles();await categories('#profileApplyCategories','data-profile-apply-category',['scope']);
    const invalid=await p.eval(`(()=>{const e=document.querySelector('[data-profile-id="${rangeProfile.id}"]');return {error:e.querySelector('.workspace-error')?.textContent,disabled:e.querySelector('[data-profile-apply]').disabled,book:window.__vocab.getBook()};})()`);
    check(label+' 真跨书范围非法仍显示错误并禁止应用',invalid.book==='kaoyan'&&invalid.disabled&&!!invalid.error,invalid);
    check(label+' 无效范围仅预览不改变当前学习现场',same(beforeInvalid,await p.eval(SCENE)));
    await closeProfiles();
    report.errors.push(...p.errors());p.clearLogs();
  }
  check('个人方案本书隔离旅程无console错误/未捕获异常',report.errors.length===0,report.errors);
  report.sourceEnd=fingerprint();check('取证期间运行时源字节稳定',same(sourceStart,report.sourceEnd),report.sourceEnd);
}catch(e){check('个人方案隔离旅程执行完整',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(RESULTS_DIR,'profile-scope.json'),JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:path.join(RESULTS_DIR,'profile-scope.json'),screenshots:report.shots.length}));process.exitCode=report.checks.some(x=>!x.ok)?1:0;
