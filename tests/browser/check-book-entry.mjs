#!/usr/bin/env node
/** 词库范围第二入口与词书模式样式；只读采样，切书/关闭/模式切换走真实控件。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const fingerprint=()=>Object.fromEntries(['index.html','js/app.js','css/app.css','sw.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const sourceStart=fingerprint(),server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],errors:[],shots:[],sourceStart,limits:['Chrome隔离profile；320/375/1440×深浅主题','手机/触摸仿真不是真机或读屏','fixture只在初始化写存储；切书、模式与关闭经真实UI']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const p=await Page.open(conn,{url:server.url()});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const learning=`(()=>{const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,days:s.days,prof:s.proficient,review:s.reviewDay,extra:s.extraDay}})()`;
async function ready(){await p.waitFor('window.__vocab&&document.querySelector("#card")');await p.send('Page.bringToFront');}
async function click(selector){await p.send('Page.bringToFront');await p.scrollIntoView(selector);await sleep(160);if(!await p.isClickable(selector))throw Error('控件不可命中：'+selector);await p.clickSelector(selector);await sleep(100);}
async function shot(name){await p.waitFor(`!document.querySelector('#toast').classList.contains('on')`);report.shots.push(await p.screenshot('book-entry-'+name+'.png'));}
let template,deviceTemplate;
async function seed(width,theme){
  await p.setViewport(width,width<500?812:1000,{mobile:width<500});
  await p.eval(`(()=>{const s=${JSON.stringify(template)},d=${JSON.stringify(deviceTemplate)};s.progress={};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};s.timeSec=0;Object.assign(s.settings,{dailyNew:5,groupSize:2,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,theme:${JSON.stringify(theme)},autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});d.shared.theme=${JSON.stringify(theme)};for(const id of Object.keys(d.overrides))d.overrides[id]=[];localStorage.clear();sessionStorage.clear();localStorage.setItem('vocab_device_preferences_v1',JSON.stringify(d));localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_default_book_v1','kaoyan');localStorage.setItem('vocab_active_book_v1','kaoyan');sessionStorage.setItem('vocab_page_book_v1','kaoyan');sessionStorage.setItem('vocab_page_book_mode_v1','local');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await ready();await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');
}
try{
  await ready();
  template=await p.eval('JSON.parse(JSON.stringify(window.__vocab.getS()))');
  const own=await p.eval('window.__vocab.getPreferenceOwnership()');
  deviceTemplate={kind:'vocab-device-preferences',version:1,shared:own.shared,overrides:{kaoyan:[],cet4:[],cet6:[],combined:[]}};
  for(const width of [320,375,1440])for(const theme of ['light','dark']){
    const label=width+'-'+theme;await seed(width,theme);await click('[data-v="set"]');
    await p.waitFor('document.querySelector("#btnScopeBooks")');await p.scrollIntoView('#btnScopeBooks');
    const initial=await p.eval(`({name:document.querySelector('#scopeBookName')?.textContent,meta:document.querySelector('#scopeBookMeta')?.textContent,inScope:!!document.querySelector('#settings-scope')?.contains(document.querySelector('#btnScopeBooks')),expanded:document.querySelector('#btnScopeBooks')?.getAttribute('aria-expanded')})`);
    check(label+' 词库范围显示当前书及可用切换入口',initial.inScope&&/考研/.test(initial.name||'')&&/7997/.test((initial.meta||'').replace(/,/g,''))&&initial.expanded==='false',initial);
    const before=await p.eval(learning);await click('#btnScopeBooks');await p.waitFor('!document.querySelector("#bookSheet").hidden');
    const layout=await p.eval(`(()=>{const panel=document.querySelector('#bookSheet .sheet-panel'),seg=document.querySelector('#bookPageModeSeg'),list=document.querySelector('#bookList'),r=seg.getBoundingClientRect(),pr=panel.getBoundingClientRect(),lr=list.getBoundingClientRect();return {doc:document.documentElement.scrollWidth,width:innerWidth,panel:{left:pr.left,right:pr.right,scroll:panel.scrollWidth,client:panel.clientWidth},seg:{left:r.left,right:r.right,width:r.width,gap:r.top-lr.bottom},buttons:[...seg.querySelectorAll('button')].map(x=>{const b=x.getBoundingClientRect();return {width:b.width,height:b.height,scroll:x.scrollWidth,client:x.clientWidth,pressed:x.getAttribute('aria-pressed')};}),count:document.querySelectorAll('#bookList [data-book]').length,expanded:document.querySelector('#btnScopeBooks').getAttribute('aria-expanded')};})()`);
    check(label+' 模式控件等宽且44px可点、列表与模式分隔协调',layout.buttons.length===2&&layout.buttons.every(x=>x.height>=43&&x.scroll<=x.client+1)&&Math.abs(layout.buttons[0].width-layout.buttons[1].width)<=2&&layout.seg.gap>=10,layout);
    check(label+' 弹窗与模式无横向溢出，沿用四词书同一弹窗',layout.doc<=layout.width+1&&layout.panel.left>=-1&&layout.panel.right<=layout.width+1&&layout.panel.scroll<=layout.panel.client+1&&layout.count===4&&layout.expanded==='true',layout);
    await click('#bookPageModeFollow');
    const follow=await p.eval(`({mode:sessionStorage.getItem('vocab_page_book_mode_v1'),local:document.querySelector('#bookPageModeLocal').getAttribute('aria-pressed'),follow:document.querySelector('#bookPageModeFollow').getAttribute('aria-pressed')})`);
    check(label+' 模式按钮选择态与真实follow状态一致',follow.mode==='follow'&&follow.local==='false'&&follow.follow==='true',follow);
    await click('#bookPageModeLocal');check(label+' 模式切换不改学习现场',same(before,await p.eval(learning)));
    await shot('dialog-'+label);
    await click('#bookClose');
    const closed=await p.eval(`({hidden:document.querySelector('#bookSheet').hidden,inert:document.querySelector('#main').inert,focus:document.activeElement.id,expanded:document.querySelector('#btnScopeBooks').getAttribute('aria-expanded')})`);
    check(label+' 叉号关闭后返回设置触发按钮并解除背景',closed.hidden&&!closed.inert&&closed.focus==='btnScopeBooks'&&closed.expanded==='false',closed);
    check(label+' 只开关词书弹窗不改变当前判定或队列',same(before,await p.eval(learning)));
    await p.eval(`document.querySelector('#btnScopeBooks').focus()`);await p.key('Enter');await p.waitFor('!document.querySelector("#bookSheet").hidden');await p.key('Escape');
    check(label+' 设置入口键盘打开/Esc回焦点',await p.eval(`document.querySelector('#bookSheet').hidden&&document.activeElement.id==='btnScopeBooks'`));
    await click('#btnScopeBooks');await click('#bookList [data-book="cet4"]');await p.waitFor('window.__vocab.getBook()==="cet4"&&document.querySelector("#bookSheet").hidden');
    const switched=await p.eval(`({view:document.querySelector('#v-set').classList.contains('on'),book:window.__vocab.getBook(),name:document.querySelector('#scopeBookName').textContent,meta:document.querySelector('#scopeBookMeta').textContent,range:document.querySelector('#scopeCount').textContent,pmin:document.querySelector('#pmin').max,focus:document.activeElement.id,page:sessionStorage.getItem('vocab_page_book_v1'),active:localStorage.getItem('vocab_active_book_v1'),defaultBook:localStorage.getItem('vocab_default_book_v1'),oldProgress:Object.keys(JSON.parse(localStorage.getItem('kaoyan_vocab_v1')).progress||{}).length,newProgress:Object.keys(window.__vocab.getS().progress||{}).length})`);
    check(label+' 从范围切书留在设置并同步词书/词数/筛选文案',switched.view&&switched.book==='cet4'&&/四级/.test(switched.name)&&/7167/.test(switched.meta.replace(/,/g,''))&&switched.range.length>0&&switched.pmin==='80'&&switched.focus==='btnScopeBooks',switched);
    check(label+' 仅本页切书不改默认或广播信号，原书进度保留',switched.page==='cet4'&&switched.active==='kaoyan'&&switched.defaultBook==='kaoyan'&&switched.oldProgress>0&&switched.newProgress===0,switched);
    await shot('settings-'+label);
    await p.eval(`document.querySelector('#btnBooks').focus()`);await p.key('Enter');await p.waitFor('!document.querySelector("#bookSheet").hidden');
    check(label+' 原页头词书入口仍打开同一当前词书弹窗',await p.eval(`document.querySelector('#bookList [data-book="cet4"]').getAttribute('aria-pressed')==='true'`));
    await p.key('Escape');check(label+' 页头键盘入口关闭回原触发按钮',await p.eval(`document.querySelector('#bookSheet').hidden&&document.activeElement.id==='btnBooks'`));
    report.errors.push(...p.errors());p.clearLogs();
  }
  check('六组词书入口旅程无console错误',report.errors.length===0,report.errors);
  report.sourceEnd=fingerprint();check('取证期间运行时源字节稳定',same(sourceStart,report.sourceEnd),report.sourceEnd);
}catch(e){check('词书入口旅程执行完整',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(RESULTS_DIR,'book-entry.json'),JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:path.join(RESULTS_DIR,'book-entry.json'),screenshots:report.shots.length}));process.exitCode=report.checks.some(x=>!x.ok)?1:0;
