#!/usr/bin/env node
/** Representative real-browser surface/geometry audit. Uses only the shipped CDP driver. */
import fs from 'node:fs';
import {startStaticServer, launchChrome, connect, Page, sleep, RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(), chrome=await launchChrome({windowSize:'1440,1000'}), conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],surfaces:[],shots:[],errors:[],limits:['Chrome headless only','375/768/1440 representative widths; one 600px-high desktop','Mobile/touch emulation is not a real device','No Safari/Firefox, native screen reader, soft keyboard, speech playback or installed PWA audit','No browser-native zoom or OS sleep audit']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const p=await Page.open(conn,{url:server.url()});
await p.waitFor('window.__vocab && document.querySelector("#no")');
await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
async function seed({theme='light',fontSize='standard',kind='normal'}={}){
  await p.eval(`(() => {const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS())),d=new Date(),today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    s.progress={};s.days={};s.proficient={};s.stars={};s.timeSec=0;s.spelling={};s.reviewDay={d:today,used:0};s.extraDay={d:today,extra:0};
    Object.assign(s.settings,{theme:${JSON.stringify(theme)},fontSize:${JSON.stringify(fontSize)},fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,order:'freq',dailyNew:1,groupSize:1,dailyReviewCap:100,showEx:true,showPh:true,showFm:true,autoSpeak:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});
    ${kind==='cap'?`s.settings.dailyReviewCap=1;s.reviewDay.used=1;const first=v.getW().findIndex(x=>x.f>0);s.progress[first]=[1,Date.now()-60000,1,0,Date.now()-86400000];`:''}
    localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_active_book_v1','kaoyan');localStorage.removeItem('vocab_autoresume_pause_v1');localStorage.removeItem('vocab_autoresume_lease_v1');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab && document.querySelector("#card")');await sleep(180);
}
async function viewport(width,height=width<500?900:1000){await p.setViewport(width,height,{mobile:width<500});await sleep(90);}
async function shot(name){const file=await p.screenshot('surfaces-'+name+'.png');report.shots.push(file);return file;}
async function geometry(name,{state,expectedActs,completeMin}={}){
  const actual=await p.eval(`(() => {const r=s=>{const e=document.querySelector(s);if(!e||e.hidden)return null;const x=e.getBoundingClientRect(),c=getComputedStyle(e);if(c.display==='none')return null;return {x:x.x,y:x.y,w:x.width,h:x.height,right:x.right,bottom:x.bottom,minHeight:c.minHeight,overflow:c.overflowY,text:e.innerText?.slice(0,120)};};const hit=s=>{const e=document.querySelector(s);if(!e||e.hidden)return null;const r=e.getBoundingClientRect();if(r.width<2||r.height<2)return null;const x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {selector:s,inView:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:h?.id||h?.className||h?.tagName,ok:!!h&&(h===e||e.contains(h))};};return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,main:document.querySelector('#main').scrollWidth,mainClient:document.querySelector('#main').clientWidth,card:r('#card'),acts:r('#acts'),hint:r('#hint'),group:r('#groupStatus'),cap:r('#capPause'),current:window.__vocab.cur,phase:window.__vocab.phase,buttons:['#ok','#no','#fix','#nx','#again','#capPauseEnd','#extraNew10Paused'].map(hit).filter(Boolean)};})()`);
  report.surfaces.push({name,state,actual});
  check(name+' 页面无横向溢出',actual.doc<=actual.width+1&&actual.main<=actual.mainClient+1,actual);
  if(expectedActs)check(name+' 动作区约定高度',actual.acts&&Math.abs(actual.acts.h-expectedActs)<=1&&parseFloat(actual.acts.minHeight)===expectedActs,{acts:actual.acts,expectedActs});
  if(actual.width<=720)check(name+' 窄屏hint固定40',Math.abs(actual.hint.h-40)<=1&&parseFloat(actual.hint.minHeight)===40,actual.hint);
  check(name+' 卡片/操作区不重叠',actual.card.bottom<=(actual.acts||actual.cap).y+1,{card:actual.card,acts:actual.acts,cap:actual.cap});
  if(completeMin)check(name+' 完成卡保底自然高度',actual.card.h>=completeMin-1,actual.card);
  const relevant=actual.buttons.filter(b=>b.inView);check(name+' 可见动作中心指针命中',relevant.length>0&&relevant.every(b=>b.ok),relevant);
  return actual;
}
async function sheet(name,selector,close){
  await p.waitFor(`!document.querySelector(${JSON.stringify(selector)}).hidden`);await sleep(200);
  const x=await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)}+' .sheet-panel'),r=e.getBoundingClientRect(),close=document.querySelector(${JSON.stringify(close)}),cr=close?.getBoundingClientRect(),hit=cr&&document.elementFromPoint(cr.x+cr.width/2,cr.y+cr.height/2);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,closeHit:hit&&(hit===close||close.contains(hit)),focusInside:e.contains(document.activeElement)};})()`);
  report.surfaces.push({name,actual:x});check(name+' 浮层边界/关闭命中/焦点',x.left>=-1&&x.right<=x.width+1&&x.top>=-1&&x.bottom<=x.height+1&&x.scrollWidth<=x.clientWidth+1&&x.closeHit&&x.focusInside,x);await shot(name);
}
/** 关闭浮层后的真实焦点位置（closeSheet 实现：背诵页归 #card，否则归触发元素/词表行）。 */
async function activeInfo(){
  return p.eval(`(() => {const a=document.activeElement;if(!a)return null;const cls=String((a.className&&a.className.baseVal!==undefined)?a.className.baseVal:(a.className||''));return {tag:a.tagName,id:a.id||'',cls,exw:(a.dataset&&a.dataset.exw)||'',inCard:!!document.querySelector('#card')?.contains(a),inList:!!document.querySelector('#v-list')?.contains(a),body:a===document.body};})()`);
}
async function focusBack(label,name,pred){const info=await activeInfo();check(label+'-'+name,pred(info),info);return info;}
/** 卡片例句里挑一个能查到词条的可点词（未收录词没有「详情」入口）。 */
async function clickResolvedExWord(){
  const target=await p.eval(`(() => {const v=window.__vocab;const el=[...document.querySelectorAll('#card .ex .ex-word')].find(e=>v.lookupExWord(e.dataset.exw)>=0);if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,exw:el.dataset.exw};})()`);
  if(!target)throw new Error('卡片例句里没有可查义的英文词');
  await p.click(target.x,target.y);return target;
}
try {
  for(const theme of ['light','dark'])for(const width of [375,768,1440]){
    const name=theme+'-'+width;await viewport(width);await seed({theme});
    await geometry('recall-'+name,{state:'recall',expectedActs:width<=720?151:156});await shot('recall-'+name);
    const no=await p.rect('#no');await p.doubleClickAt(no.cx,no.cy,{gap:50});await sleep(200);
    check('真实连击保护-'+name,await p.eval(`window.__vocab.phase==='revealed'&&window.__vocab.verdict===false&&window.__vocab.answered===1`));
    await geometry('revealed-'+name,{state:'revealed',expectedActs:width<=720?151:156});await shot('revealed-'+name);
    await seed({theme});await p.key('keyF');await p.key('Space');await p.waitFor('document.querySelector("#card .done")');await sleep(180);
    await geometry('done-'+name,{state:'done',completeMin:width<=720?240:320});await shot('done-'+name);
    await seed({theme,kind:'cap'});await p.waitFor('!document.querySelector("#capPause").hidden');await sleep(100);
    await geometry('cap-'+name,{state:'cap'});await shot('cap-'+name);
  }
  await viewport(1440,600);await seed();await geometry('low-desktop-recall',{state:'recall',expectedActs:146});await p.key('keyF');await geometry('low-desktop-revealed',{state:'revealed',expectedActs:146});await shot('low-desktop-revealed');
  for(const {theme,width,fontSize} of [{theme:'light',width:375,fontSize:'large'},{theme:'dark',width:768,fontSize:'large'},{theme:'dark',width:1440,fontSize:'standard'}]){
    const name=theme+'-'+width+'-'+fontSize;await viewport(width);await seed({theme,fontSize});await p.key('keyF');await sleep(180);
    await geometry('reading-'+name,{state:'revealed',expectedActs:width<=720?151:156});await shot('reading-'+name);
    const firstEx='#card .ex .ex-word';await p.scrollIntoView(firstEx);await p.clickSelector(firstEx);await p.waitFor('!document.querySelector("#exPop").hidden');await sleep(150);
    const pop=await p.rect('#exPop');check('例句浮层边界-'+name,pop.left>=-1&&pop.right<=width+1&&pop.top>=-1&&pop.bottom<=((width<500)?900:1000)+1,pop);await shot('example-pop-'+name);await p.key('Escape');await sleep(180);
    await focusBack('例句浮层关闭后焦点归还触发词',name,i=>!i.body&&i.cls.includes('ex-word')&&i.exw&&i.inCard);
    await clickResolvedExWord();await p.waitFor('!document.querySelector("#exPop").hidden');await sleep(150);
    await p.clickSelector('#exPopDetail');await p.waitFor('!document.querySelector("#wordSheet").hidden');await sleep(180);await p.key('Escape');await sleep(180);
    await focusBack('例句浮层进详情关闭后焦点回卡片',name,i=>i.id==='card');
    await p.clickSelector('[data-v="list"]');await p.clickSelector('#q');await p.insertText('make');await p.waitFor(`document.querySelector('#listCount').textContent.includes('共')&&document.querySelector('.row-word')`);await sleep(250);
    const list=await p.eval(`({doc:document.documentElement.scrollWidth,width:innerWidth,count:document.querySelector('#listCount').innerText,query:document.querySelector('#q').value,rows:document.querySelectorAll('.row').length})`);check('词表搜索无溢出-'+name,list.doc<=list.width+1&&list.query==='make'&&list.rows>0,list);await shot('list-'+name);
    await p.clickSelector('.row-word');await sheet('word-detail-'+name,'#wordSheet','#wordClose');await p.key('Escape');await sleep(180);
    await focusBack('词条详情关闭后焦点归还触发行',name,i=>!i.body&&i.cls.includes('row-word')&&i.inList);
    await p.clickSelector('[data-v="set"]');await p.eval(`document.querySelector('#main').scrollTop=0`);await sleep(100);
    const settings=await p.eval(`({doc:document.documentElement.scrollWidth,width:innerWidth,main:document.querySelector('#main').scrollWidth,client:document.querySelector('#main').clientWidth,sections:[...document.querySelectorAll('.settings-section')].map(x=>({id:x.id,w:x.getBoundingClientRect().width,scroll:x.scrollWidth,client:x.clientWidth}))})`);check('设置无页面/分区溢出-'+name,settings.doc<=settings.width+1&&settings.main<=settings.client+1&&settings.sections.every(x=>x.scroll<=x.client+1),settings);await shot('settings-'+name);
    // 键盘路径先聚焦触发按钮再 Enter：macOS 鼠标点击不聚焦 button，只有触发元素本来持有焦点时 closeSheet 才能归还。
    await p.eval(`document.querySelector('#btnHelp').focus()`);await p.key('Enter');await sheet('help-'+name,'#helpSheet','#helpSheet [data-close].icon-btn');await p.key('Escape');await sleep(180);
    await focusBack('帮助浮层关闭后焦点归还触发按钮',name,i=>i.id==='btnHelp');
    await p.eval(`document.querySelector('#btnBooks').focus()`);await p.key('Enter');await sheet('books-'+name,'#bookSheet','#bookSheet .icon-btn');await p.key('Escape');await sleep(180);
    await focusBack('词书浮层关闭后焦点归还触发按钮',name,i=>i.id==='btnBooks');
    await p.clickSelector('[data-v="stats"]');await p.eval(`document.querySelector('#main').scrollTop=0;document.querySelectorAll('#v-stats .stats-details').forEach(e=>e.open=true)`);await sleep(200);
    const stats=await p.eval(`({doc:document.documentElement.scrollWidth,width:innerWidth,panels:[...document.querySelectorAll('#v-stats .panel')].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})})`);check('统计展开无溢出/自然排列-'+name,stats.doc<=stats.width+1&&stats.panels.every((r,i)=>r.left===stats.panels[0].left&&r.right===stats.panels[0].right&&(i===0||r.top>=stats.panels[i-1].bottom)),stats);const emptySurvey=await p.eval(`(() => {const panel=document.querySelector('#surveyPanel'),kpi=document.querySelector('#surveyKpis'),hint=document.querySelector('#surveyHint');return {empty:panel.dataset.empty,kpiVisible:kpi.getClientRects().length>0&&getComputedStyle(kpi).display!=='none',hintVisible:hint.getClientRects().length>0&&getComputedStyle(hint).display!=='none',hint:hint.innerText};})()`);check('统计空样本只留说明-'+name,emptySurvey.empty==='1'&&!emptySurvey.kpiVisible&&emptySurvey.hintVisible&&emptySurvey.hint.length>0,emptySurvey);await shot('stats-expanded-'+name);await p.scrollIntoView('#statsForecastPanel',{block:'start'});await sleep(100);await shot('stats-analysis-'+name);await p.scrollIntoView('.stats-storage-panel',{block:'start'});await sleep(100);await shot('stats-backup-'+name);
  }
}catch(error){check('四页检查脚本执行完整',false,String(error.stack||error));}
finally{
  report.errors=p.errors();check('浏览器无新增console错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/surfaces.json',JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/surfaces.json',screenshots:report.shots.length}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
