#!/usr/bin/env node
/** 三种背诵显示模式：真实UI与键盘、设备偏好、休息/额度/错误保留；无依赖CDP。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const files=['index.html','js/app.js','css/app.css','sw.js'];
const fingerprint=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['Chrome隔离profile；320/375视口与触摸仿真不代表真机/读屏','语音为可观察替身，只验证调用与同词连续性，不证明实际发声','仅以存储准备学习夹具，业务操作均经真实按钮与键盘']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function channel(v){v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}
function luminance(hex){const v=hex.replace('#','');return [0,2,4].map(i=>channel(parseInt(v.slice(i,i+2),16))).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+.05)/(lo+.05);}
const MODES=['standard','simple','immersive'];
const SCENE=`JSON.stringify((()=>{const v=window.__vocab,s=v.getS(),settings={...s.settings};delete settings.studyMode;return {book:v.getBook(),Q:v.Q,qi:v.qi,cur:v.cur,phase:v.phase,verdict:v.verdict,answered:v.answered,changes:v.answerChanges,plan:v.getPlan(),progress:s.progress,days:s.days,review:s.reviewDay,extra:s.extraDay,stars:s.stars,proficient:s.proficient,settings};})())`;
const VISIBLE=`s=>{const e=document.querySelector(s);return !!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';}`;
// 测量主区内容盒和正常文档流里的整组内容；不把跨行侧栏或浮动反馈算成正文留白。
// gate-toast 收起时 translateY(-4px) 只改变视觉位置，须扣除位移以取得网格实际保留的布局盒。
const COMPOSITION=`(()=>{const main=document.querySelector('#main'),view=document.querySelector('#v-study'),r=main.getBoundingClientRect(),s=getComputedStyle(main),px=n=>parseFloat(n)||0,items=[...view.children].filter(e=>{const c=getComputedStyle(e);return e.id!=='studyModeBar'&&!e.hidden&&e.getClientRects().length&&c.display!=='none'&&!['fixed','absolute'].includes(c.position);}).map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),translateY=s.transform==='none'?0:new DOMMatrixReadOnly(s.transform).m42;return {id:e.id,top:r.top-translateY-px(s.marginTop),bottom:r.bottom-translateY+px(s.marginBottom)};}),top=r.top+px(s.borderTopWidth)+px(s.paddingTop),bottom=r.bottom-px(s.borderBottomWidth)-px(s.paddingBottom),first=Math.min(...items.map(e=>e.top)),last=Math.max(...items.map(e=>e.bottom));return {top,bottom,first,last,leading:first-top,trailing:bottom-last,scrollTop:main.scrollTop,client:main.clientHeight,scroll:main.scrollHeight,items};})()`;
const CARD_SIZE=`(()=>{const c=document.querySelector('#card'),w=c.querySelector('.word'),m=c.querySelector('.mean'),r=c.getBoundingClientRect();return {height:r.height,width:r.width,word:parseFloat(getComputedStyle(w).fontSize),meaning:m?parseFloat(getComputedStyle(m).fontSize):null,sameCard:c===window.__responsiveCard,sameWord:w===window.__responsiveWord,doc:document.documentElement.scrollWidth,viewport:innerWidth};})()`;
const FAKE_SPEECH=`(()=>{const state={calls:[],cancels:0};window.__modeSpeech=state;Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'en-US',voiceURI:'mode-en',name:'Mode English'}],addEventListener(){},cancel(){state.cancels++;},speak(u){state.calls.push(u);setTimeout(()=>u.onstart?.(),0);}}});Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});})();`;
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);let p;
async function click(selector){await p.send('Page.bringToFront');await p.scrollIntoView(selector);await sleep(70);if(!await p.isClickable(selector))throw Error('无法真实点击 '+selector);await p.clickSelector(selector);await sleep(65);}
async function dismiss(){for(const s of ['#toastDismiss','#profFeedbackDismiss'])if(await p.isClickable(s))await click(s);}
async function seed({width=375,height=812,dark=false,large=false,groupSize=4,due=0,cap=100,order='freq',targetWord=null}={}){
 await p.setViewport(width,height,{mobile:width<500});
 const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
 await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS())),now=Date.now();s.progress={};s.days={};s.stars={};s.proficient={};s.reviewDay={};s.extraDay={};s.timeSec=0;s.spelling={};for(let i=0;i<${due};i++)s.progress[i]=[1,now-1000,1,0,now-86400000];Object.assign(s.settings,{studyMode:'standard',theme:${JSON.stringify(dark?'dark':'light')},fontSize:${JSON.stringify(large?'large':'standard')},dailyNew:4,groupSize:${groupSize},dailyReviewCap:${cap},fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,order:${JSON.stringify(order)},backlogGuard:false,autoSpk:false,singleCharKeys:true,autoResume:{enabled:false,threshold:1,idleMs:30000,countdownMs:3000}});if(${JSON.stringify(targetWord)}!==null)s.proficient=Object.fromEntries(window.__vocab.getW().filter(x=>x.w!==${JSON.stringify(targetWord)}).map(x=>[x.w,1]));localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1',JSON.stringify(s.proficient));localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
 try{await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#card .word")');}
 finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
 await p.send('Page.bringToFront');
}
async function mode(value){await click('#studyModeBar [data-study-mode="'+value+'"]');await p.nextFrame();}
async function tool(kind,value){await click('#studyTools > summary');await click('#studyTools [data-study-'+kind+'="'+value+'"]');}
async function shot(name){report.shots.push(await p.screenshot('study-modes-'+name+'.png'));}
try{
 p=await Page.open(conn,{url:server.url()});await p.send('Page.addScriptToEvaluateOnNewDocument',{source:FAKE_SPEECH});await p.reload();await p.waitFor('window.__vocab');
 for(const spec of [{width:320,height:568},{width:375,height:812},{width:1280,height:720},{width:1440,height:900},{width:1920,height:1080}])for(const dark of [false,true]){
  await seed({...spec,dark,large:dark});const label=spec.width+(dark?' 深色大字':' 浅色标准');
  const palette=await p.eval(`(()=>{const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--'+n).trim();return Object.fromEntries(['paper','card','ink','ink-2','ink-3','accent','accent-strong','accent-soft','on-accent','ok','ok-soft','no','no-soft'].map(n=>[n,v(n)]));})()`);
  const ratios=Object.fromEntries([['正文',['ink','card']],['辅助',['ink-2','card']],['弱化',['ink-3','card']],['强调',['accent','card']],['选中',['accent-strong','accent-soft']],['主按钮',['on-accent','accent']],['会',['ok','ok-soft']],['不会',['no','no-soft']]].map(([name,pair])=>[name,contrast(palette[pair[0]],palette[pair[1]])]));
  check(label+' 纸感令牌正文/辅助/强调/语义按钮对比度均≥4.5',Object.values(ratios).every(n=>n>=4.5),{palette,ratios});
  for(const value of MODES){
   const before=await p.eval(SCENE);await mode(value);
   const g=await p.eval(`(()=>{const visible=${VISIBLE},rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};return {mode:document.documentElement.dataset.studyMode,view:document.documentElement.dataset.studyView,header:visible('.top'),rail:visible('.progress-rail'),stats:visible('#statLine'),tools:visible('.drill-bar'),hint:visible('#hint'),progress:visible('#studyModeProgress'),progressText:document.querySelector('#studyModeProgress').textContent,meta:visible('#card .tagrow'),stage:visible('#card .dots'),word:rect('#card .word'),card:rect('#card'),main:rect('#main'),acts:rect('#acts'),buttons:[...document.querySelectorAll('#studyModeBar [data-study-mode]')].map(e=>({h:e.getBoundingClientRect().height,pressed:e.getAttribute('aria-pressed')})),height:innerHeight,doc:document.documentElement.scrollWidth,width:innerWidth};})()`);
   check(label+' '+value+' 切换即时且不改变学习现场',g.mode===value&&g.view==='study'&&await p.eval(SCENE)===before,g);
   check(label+' '+value+' 信息按模式递增，卡片与切换入口保留',g.header===(value!=='immersive')&&g.stats===(value==='standard')&&g.tools===(value==='standard')&&(value==='standard'||!g.meta&&!g.stage)&&(value!=='simple'||g.progress&&g.progressText.includes('本组')),g);
   check(label+' '+value+' 首词完整可见、桌面词卡居中、44px切换键与固定动作区，无横向溢出',g.word.top>=g.main.top-1&&g.word.bottom<=Math.min(g.height,g.main.bottom)+1&&(spec.width<=720||Math.abs(g.card.left+g.card.width/2-g.width/2)<=2)&&g.buttons.every(b=>b.h>=44)&&g.buttons.filter(b=>b.pressed==='true').length===1&&Math.abs(g.acts.height-(spec.width<=720?151:156))<1&&g.doc<=g.width+1,g);
   check(label+' '+value+' 回忆态不暴露释义或例句音频',await p.eval('!document.querySelector("#card .mean")&&!document.querySelector("#card [data-audio-play]")'));
   const fullscreen=await p.eval(`(()=>{const e=document.querySelector('#studyFullscreen'),r=e.getBoundingClientRect();return {hidden:e.hidden,width:r.width,height:r.height,left:r.left,right:r.right,viewport:innerWidth,pressed:e.getAttribute('aria-pressed'),label:e.getAttribute('aria-label')};})()`);
   check(label+' '+value+' 保留44px全屏直达入口且不横向溢出',!fullscreen.hidden&&fullscreen.width>=44&&fullscreen.height>=44&&fullscreen.left>=0&&fullscreen.right<=fullscreen.viewport+1&&fullscreen.pressed==='false'&&fullscreen.label==='进入全屏显示',fullscreen);
   if(spec.width>=721&&value==='standard'){
    const compact=await p.eval(`(()=>{const stat=document.querySelector('#statLine').getBoundingClientRect(),bar=document.querySelector('#studyModeBar').getBoundingClientRect(),card=document.querySelector('#card').getBoundingClientRect();return {statHeight:stat.height,barHeight:bar.height,cardCenter:card.left+card.width/2,width:innerWidth};})()`);
    check(label+' 标准统计行不被侧栏撑高且词卡保持居中',compact.statHeight<=125&&compact.statHeight<compact.barHeight&&Math.abs(compact.cardCenter-compact.width/2)<=2,compact);
    if(spec.width===1280){
     const controls=await p.eval(`(()=>{const main=document.querySelector('#main').getBoundingClientRect();return ['#ok','#no'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {selector:s,top:r.top,bottom:r.bottom,mainTop:main.top,mainBottom:main.bottom,height:innerHeight};});})()`);
     check(label+' 720高电脑回忆态会与不会首屏可真实点击',controls.every(r=>r.top>=r.mainTop&&r.bottom<=Math.min(r.height,r.mainBottom)+1)&&await p.isClickable('#ok')&&await p.isClickable('#no'),controls);
    }
   }
   await shot(spec.width+'-'+(dark?'dark':'light')+'-'+value+'-recall');
  }
  await p.key('keyF');await sleep(80);const keyboard=await p.eval('window.__vocab.verdict===true');
  check(label+' 点击模式后F可直接判定',keyboard);if(!keyboard)await click('#ok');
  const revealed=await p.eval(SCENE),meaning=await p.eval('document.querySelector("#card .mean")?.textContent');
  check(label+' 同文同源证据只指向主例句且不重复渲染',await p.eval(`document.querySelector('#card .word')?.textContent==='can'&&!document.querySelector('#card .sense-quote')&&document.querySelector('#card .sense-shared')?.textContent.includes('同一出处')&&document.querySelectorAll('#card [data-audio-text]').length===1`));
  await p.eval('window.__modeOriginalWord=document.querySelector("#card .word")');
  for(const value of MODES){
   await mode(value);await p.eval('document.querySelector("#main").scrollTop=0');await p.nextFrame();
   check(label+' '+value+' 揭示态保留原句释义、判定、卡DOM与改判按钮',await p.eval(SCENE)===revealed&&await p.eval(`document.querySelector('#card .mean')?.textContent===${JSON.stringify(meaning)}&&document.querySelector('#card .word')===window.__modeOriginalWord&&!!document.querySelector('#fix')&&!!document.querySelector('#nx')`));
   const reading=await p.eval(`(()=>{const c=document.querySelector('#card'),w=c.querySelector('.word-face'),a=c.querySelector('.answer'),m=c.querySelector('.mean'),wr=w.getBoundingClientRect(),ar=a.getBoundingClientRect();return {display:getComputedStyle(c).display,topDelta:Math.abs(wr.top-ar.top),centerDelta:Math.abs((wr.top+wr.bottom-ar.top-ar.bottom)/2),wordOverflow:getComputedStyle(w).overflow,answerOverflow:getComputedStyle(a).overflow,fontSize:parseFloat(getComputedStyle(m).fontSize),width:innerWidth,doc:document.documentElement.scrollWidth};})()`);
   check(label+' '+value+' 揭示态阅读对齐、正文字号与主区单滚动',reading.fontSize===(dark?19:17)&&reading.doc<=reading.width+1&&(spec.width<1000||reading.display==='grid'&&(value==='standard'?reading.topDelta<=2:reading.centerDelta<=2)&&reading.wordOverflow==='visible'&&reading.answerOverflow==='visible'),reading);
   await shot(spec.width+'-'+(dark?'dark':'light')+'-'+value+'-revealed');
  }
 }
 // 高窗口的短内容居中于主区内容盒；正文和操作是一套构图，不靠移动词卡制造假居中。
 for(const dark of [false,true])for(const value of MODES){
  await seed({width:1920,height:1080,dark,large:dark});await mode(value);
  await p.eval('document.querySelector("#main").scrollTop=0');await p.nextFrame();
  const g=await p.eval(COMPOSITION),label=(dark?'深色大字':'浅色标准')+' '+value;
  check(label+' 短内容在可用主区上下留白对称且无负向溢出',g.leading>4&&g.trailing>4&&Math.abs(g.leading-g.trailing)<=2&&g.first>=g.top-1&&g.last<=g.bottom+1&&g.scroll<=g.client+2,g);
 }
 // 同一张卡实时适配窗口；回忆与揭示都检查，避免只让未揭示的大词变大。
 for(const dark of [false,true])for(const value of MODES){
  await seed({width:1280,height:720,dark,large:dark});await mode(value);
  for(const phase of ['recall','revealed']){
   await p.setViewport(1280,720);await p.nextFrame();
   if(phase==='revealed'){await p.eval('document.querySelector("#card").focus({preventScroll:true})');await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');}
   await p.eval('window.__responsiveCard=document.querySelector("#card");window.__responsiveWord=document.querySelector("#card .word")');
   const before=await p.eval(SCENE),small=await p.eval(CARD_SIZE);
   await p.setViewport(1920,1080);await p.nextFrame();await p.nextFrame();
   const large=await p.eval(CARD_SIZE),label=(dark?'深色大字':'浅色标准')+' '+value+' '+phase;
   check(label+' 放大窗口使卡片与词头适度增长且保留同卡DOM和学习现场',large.height>small.height+1&&large.height<=small.height*2.5&&large.word>small.word+.5&&large.word<=small.word*1.5&&large.sameCard&&large.sameWord&&large.doc<=large.viewport+1&&await p.eval(SCENE)===before,{small,large});
   if(phase==='revealed')check(label+' 流式适配保留标准17px/大字19px释义',small.meaning===(dark?19:17)&&large.meaning===(dark?19:17),{small:small.meaning,large:large.meaning});
  }
 }
 // 用真实长例句与词形构造长卡，验证安全居中在内容超高时回到自然滚动。
 const longTarget=await p.eval(`window.__vocab.getW().filter(x=>x.fm&&x.ex&&x.ex.length>180).sort((a,b)=>b.ex.length-a.ex.length)[0]?.w`);
 if(!longTarget)throw Error('缺少带词形与长例句的阅读夹具');
 for(const spec of [{width:1280,height:500},{width:320,height:568}])for(const value of MODES){
  await seed({...spec,dark:true,large:true,groupSize:1,targetWord:longTarget});await mode(value);
  await p.eval('document.querySelector("#card").focus({preventScroll:true})');await p.key('keyF');await p.waitFor('document.querySelector("#card .answer-extra")');
  await click('#card .answer-extra > summary');await p.eval('document.querySelector("#main").scrollTop=0');await p.nextFrame();
  const before=await p.eval(SCENE),g=await p.eval(COMPOSITION),layout=await p.eval(`(()=>{const main=document.querySelector('#main'),card=document.querySelector('#card');return {mainOverflow:getComputedStyle(main).overflowY,word:card.querySelector('.word').textContent,parts:['#card','#card .word-face','#card .answer'].map(s=>{const e=document.querySelector(s);return {selector:s,overflow:getComputedStyle(e).overflowY,scroll:e.scrollHeight,client:e.clientHeight,scrollTop:e.scrollTop};})};})()`),label=spec.width+'×'+spec.height+' '+value;
  check(label+' 长卡从顶部自然可达且只有主区滚动',layout.word===longTarget&&g.first>=g.top-1&&g.scroll>g.client+2&&layout.mainOverflow==='auto'&&layout.parts.every(e=>!['auto','scroll','hidden'].includes(e.overflow)&&e.scroll<=e.client+2&&e.scrollTop===0),{composition:g,layout});
  await p.scrollIntoView('#nx');await p.nextFrame();
  check(label+' 长卡下一词可经主区滚动命中且不改阅读现场',await p.eval('document.querySelector("#main").scrollTop>0')&&await p.isClickable('#nx')&&await p.eval(SCENE)===before);
  if(spec.width===320&&value==='immersive')await shot('320-dark-immersive-long-natural-scroll');
  await click('#nx');
  check(label+' 长卡可真实点击下一词完成本组',await p.eval('window.__vocab.cur===null&&window.__vocab.answered===1'));
 }
 // 桌面默认乱序含首次自评，侧栏不能把统计区撑成一整块空白。
 for(const spec of [{width:1280,height:720},{width:1440,height:900},{width:1920,height:1080}]){
  await seed({...spec,order:'shuffle'});
  const compact=await p.eval(`(()=>{const stat=document.querySelector('#statLine'),r=stat.getBoundingClientRect(),card=document.querySelector('#card').getBoundingClientRect();return {height:r.height,survey:document.querySelector('#surveyChip').getClientRects().length>0,open:document.querySelector('#surveyDetail').open,cardCenter:card.left+card.width/2,width:innerWidth};})()`);
  check(spec.width+' 默认乱序含首次自评时统计仍紧凑且词卡居中',compact.survey&&!compact.open&&compact.height<=125&&Math.abs(compact.cardCenter-compact.width/2)<=2,compact);
 }
 // 低矮电脑的短揭示卡可自然滚到下一词，通过实际点击完成翻页。
 await seed({width:1280,height:720});await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');
 const shortBefore=await p.eval('({cur:window.__vocab.cur,answered:window.__vocab.answered})');
 await click('#nx');
 check('1280×720 短揭示卡下一词可自然滚到并真实点击',await p.eval(`window.__vocab.cur!==${shortBefore.cur}&&window.__vocab.answered===${shortBefore.answered}&&window.__vocab.phase==='recall'`));
 // 工具面板由触发点以下的实际空间限高，末项通过面板滚动可达。
 await seed({width:1280,height:640});await mode('simple');const toolsBefore=await p.eval(SCENE);
 await click('#studyTools > summary');
 const menuGeometry=await p.eval(`(()=>{const e=document.querySelector('#studyTools .study-tools-menu'),r=e.getBoundingClientRect(),main=document.querySelector('#main');return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight,client:e.clientHeight,scroll:e.scrollHeight,mainScroll:main.scrollTop};})()`);
 check('1280×640 工具菜单完整留在窗口内并提供自身滚动',menuGeometry.top>=0&&menuGeometry.bottom<=menuGeometry.height+1&&menuGeometry.left>=0&&menuGeometry.right<=menuGeometry.width+1&&menuGeometry.scroll>menuGeometry.client,menuGeometry);
 await p.scrollIntoView('#studyTools [data-study-proxy="btnHelp"]');await p.nextFrame();
 check('低矮电脑工具最后帮助项可经菜单滚动真实命中',await p.isClickable('#studyTools [data-study-proxy="btnHelp"]')&&await p.eval(`Math.abs(document.querySelector('#main').scrollTop-${menuGeometry.mainScroll})<=1`));
 await click('#studyTools [data-study-proxy="btnHelp"]');await p.waitFor('!document.querySelector("#helpSheet").hidden');await p.key('Escape');
 // 学习页模态沿既有协议回到卡片，确保下一次空格翻页不会再次激活入口。
 check('工具帮助关闭后焦点回学习卡且学习现场保持',await p.eval(`document.querySelector('#helpSheet').hidden&&document.activeElement===document.querySelector('#card')`)
   &&await p.eval(SCENE)===toolsBefore);
 await click('#studyTools > summary');await p.key('Escape');
 check('Esc直接收起工具后焦点回summary',await p.eval(`!document.querySelector('#studyTools').open&&document.activeElement===document.querySelector('#studyTools > summary')`));
 // 全屏直达入口始终随模式栏显示，先沉浸与先全屏两条真实路径均可逆。
 for(const spec of [{width:1440,height:900},{width:375,height:812}]){
  await seed(spec);await mode('immersive');const directBefore=await p.eval(SCENE);
  await click('#studyFullscreen');await p.waitFor('!!document.fullscreenElement');
  check(spec.width+' 先沉浸后从直达入口进入全屏并同步全部状态',await p.eval(`['#btnFullscreen','#studyFullscreen'].every(s=>{const e=document.querySelector(s);return !e.hidden&&e.getAttribute('aria-pressed')==='true'&&e.getAttribute('aria-label')==='退出全屏显示';})&&document.querySelector('#studyFullscreen [data-fullscreen-label]').textContent==='退出'&&document.querySelector('#studyTools [data-study-proxy="btnFullscreen"]').textContent==='退出全屏显示'&&window.__vocab.getStudyMode()==='immersive'&&!document.querySelector('#studyTools').open`)
    &&await p.eval(SCENE)===directBefore);
  await click('#studyFullscreen');await p.waitFor('!document.fullscreenElement');
  check(spec.width+' 沉浸直达入口可退出全屏且保留原卡原组',await p.eval(`['#btnFullscreen','#studyFullscreen'].every(s=>document.querySelector(s).getAttribute('aria-pressed')==='false'&&document.querySelector(s).getAttribute('aria-label')==='进入全屏显示')&&document.querySelector('#studyFullscreen [data-fullscreen-label]').textContent==='全屏'&&window.__vocab.getStudyMode()==='immersive'`)
    &&await p.eval(SCENE)===directBefore);
 }
 await seed({width:1440,height:900});const reverseBefore=await p.eval(SCENE);
 await click('#btnFullscreen');await p.waitFor('!!document.fullscreenElement');await mode('immersive');
 check('先顶部全屏再进入沉浸时直达出口保持可见与状态同步',await p.isClickable('#studyFullscreen')&&await p.eval(`document.querySelector('#studyFullscreen').getAttribute('aria-pressed')==='true'&&document.querySelector('#studyFullscreen').getAttribute('aria-label')==='退出全屏显示'&&window.__vocab.getStudyMode()==='immersive'`)
   &&await p.eval(SCENE)===reverseBefore);
 await click('#studyFullscreen');await p.waitFor('!document.fullscreenElement');
 check('先全屏后沉浸也可直接退出而不丢失现场',await p.eval(`document.querySelector('#studyFullscreen').getAttribute('aria-pressed')==='false'&&window.__vocab.getStudyMode()==='immersive'`)&&await p.eval(SCENE)===reverseBefore);
 // 工具代理路径仍保留，入口名称随真实fullscreenchange更新。
 await seed({width:1440,height:900});await mode('immersive');const fullBefore=await p.eval(SCENE);
 await tool('proxy','btnFullscreen');await p.waitFor('!!document.fullscreenElement');
 check('沉浸工具可真实进入全屏并同步名称和状态',await p.eval(`document.querySelector('#btnFullscreen').getAttribute('aria-pressed')==='true'&&document.querySelector('#btnFullscreen').getAttribute('aria-label')==='退出全屏显示'&&document.querySelector('#studyTools [data-study-proxy="btnFullscreen"]').textContent==='退出全屏显示'`)
   &&await p.eval(SCENE)===fullBefore);
 await tool('proxy','btnFullscreen');await p.waitFor('!document.fullscreenElement');
 check('沉浸工具可真实退出全屏且保留现场与焦点',await p.eval(`document.querySelector('#btnFullscreen').getAttribute('aria-pressed')==='false'&&document.querySelector('#btnFullscreen').getAttribute('aria-label')==='进入全屏显示'&&document.querySelector('#studyTools [data-study-proxy="btnFullscreen"]').textContent==='进入全屏显示'&&document.activeElement===document.querySelector('#studyTools > summary')`)
   &&await p.eval(SCENE)===fullBefore);
 // 同词朗读在切换时继续，停止入口仍可真实命中。
 await seed();await click('#spk');await p.waitFor('window.__vocab.getSpeechPlayback().status==="playing"');
 const speech=await p.eval('({id:window.__vocab.getSpeechPlayback().id,cancels:window.__modeSpeech.cancels,word:window.__vocab.cur})');
 for(const value of MODES){await mode(value);check('朗读中切换'+value+'不取消同词音频',await p.eval(`window.__vocab.getSpeechPlayback().status==='playing'&&window.__vocab.getSpeechPlayback().id===${speech.id}&&window.__modeSpeech.cancels===${speech.cancels}&&window.__vocab.cur===${speech.word}`));}
 check('沉浸模式朗读中仍保留停止入口',await p.isClickable('#spkStop'));if(await p.isClickable('#spkStop'))await click('#spkStop');
 // 工具菜单本身不能穿透学习，Esc后恢复。
 await mode('immersive');await click('#studyTools > summary');const menuScene=await p.eval(SCENE);
 for(const key of ['keyF','keyJ','Space'])await p.key(key);
 check('工具菜单展开时F/J/空格不穿透',await p.eval(SCENE)===menuScene);
 await p.key('Escape');check('Esc收起工具并保持当前组',await p.eval('!document.querySelector("#studyTools").open')&&await p.eval(SCENE)===menuScene);
 // 导航与设置只在学习页隐藏全局抬头，模式设置可从两处继续切换。
 await tool('view','set');check('沉浸可从工具进入设置且主导航恢复',await p.eval(`document.documentElement.dataset.studyView==='set'&&(${VISIBLE})('.top')&&window.__vocab.getStudyMode()==='immersive'`));
 await click('#studyModeSettings [data-study-mode="simple"]');await click('[data-v="study"]');
 check('设置页模式与首页同步，切页不丢现场',await p.eval('window.__vocab.getStudyMode()==="simple"&&document.documentElement.dataset.studyView==="study"')&&await p.eval(SCENE)===menuScene);
 await mode('immersive');await tool('view','list');check('沉浸可从工具进入词表',await p.eval('document.documentElement.dataset.studyView==="list"'));
 await click('[data-v="study"]');await tool('proxy','btnQuickSettings');
 check('工具打开模态后模式条也受inert保护',await p.eval('document.querySelector("#main").inert')&&!await p.isClickable('#studyModeBar [data-study-mode="simple"]'));
 await p.key('Escape');check('关闭模态后回到工具入口且不误改模式',await p.eval('!document.querySelector("#main").inert&&window.__vocab.getStudyMode()==="immersive"'));
 // 刷新：保留模式及当前已揭示卡，不重复记账。
 await p.key('keyF');const freshBefore=await p.eval(SCENE);await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#card .word")');
 check('刷新保留沉浸与合法当前卡，不重复判定额度',await p.eval('window.__vocab.getStudyMode()==="immersive"')&&await p.eval(SCENE)===freshBefore);
 await dismiss();const restBefore=await p.eval(SCENE);await tool('proxy','btnSaveRest');
 check('沉浸工具可保存并休息且保持现场',await p.eval('window.__vocab.isResting()&&!!document.querySelector("#restResume")')&&await p.eval(SCENE)===restBefore);
 await click('#restResume');check('休息后真实继续回同卡同模式',await p.eval('!window.__vocab.isResting()&&window.__vocab.getStudyMode()==="immersive"')&&await p.eval(SCENE)===restBefore);
 // 额度与保存失败属于必要信息，任何模式都不能遮住。
 await seed({due:2,cap:1,groupSize:2});await p.key('keyF');await p.key('Space');await p.waitFor('window.__vocab.isCapPaused()');const capBefore=await p.eval(SCENE);
 for(const value of MODES){await mode(value);check(value+'保留额度暂停说明、按钮与原组',await p.eval(`window.__vocab.isCapPaused()&&(${VISIBLE})('#capPause')&&!!document.querySelector('#capPauseActs button')`)&&await p.eval(SCENE)===capBefore);}
 await seed();await mode('immersive');const failBefore=await p.eval(SCENE);
 await p.eval(`window.__modeOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='kaoyan_vocab_v1')throw new DOMException('mode quota fixture','QuotaExceededError');return window.__modeOriginalSet.call(this,k,v);}`);
 await tool('proxy','btnSaveRest');
 check('沉浸保存失败的持续错误清晰可见且不假装休息',await p.eval(`(${VISIBLE})('#appAlert')&&!window.__vocab.isResting()&&document.querySelector('#appAlert').textContent.includes('重试保存并休息')`)&&await p.eval(SCENE)===failBefore);
 await p.eval('Storage.prototype.setItem=window.__modeOriginalSet');
 const retry=await p.eval(`[...document.querySelectorAll('#appAlertActions button')].findIndex(e=>e.textContent.includes('重试保存并休息'))+1`);
 await click('#appAlertActions button:nth-of-type('+retry+')');check('沉浸失败恢复后可真实重试并继续',await p.eval('window.__vocab.isResting()&&!!document.querySelector("#restResume")'));
 await click('#restResume');
 await seed({groupSize:1});await mode('immersive');await p.key('keyF');await p.key('Space');await p.waitFor('window.__vocab.cur===null');
 check('沉浸完成页保留明确继续入口与模式切换',await p.isClickable('#again')&&await p.isClickable('#studyModeBar [data-study-mode="simple"]'));
 await click('#again');check('沉浸完成页真实继续能开始下一组',await p.eval('window.__vocab.cur!==null&&window.__vocab.answered===0&&window.__vocab.getStudyMode()==="immersive"'));
 // 用户反馈的同词场景在完整旅程末尾独立执行，避免熟练夹具影响后续状态。
 for(const dark of [false,true])for(const [book,word,modeId] of [['cet4','bygone','immersive'],['cet4','bygone','simple'],['kaoyan','assistance','simple']]){
  await seed({width:1440,height:1000,dark,large:dark});
  await p.eval(`(async()=>{const v=window.__vocab,book=${JSON.stringify(book)},word=${JSON.stringify(word)};await v.switchBook(book);const s=v.getS(),w=v.getW(),target=w.find(x=>x.w===word);if(!target)throw Error(word+' fixture missing');Object.assign(s.settings,{theme:${JSON.stringify(dark?'dark':'light')},fontSize:${JSON.stringify(dark?'large':'standard')},fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,dailyNew:4,groupSize:4,backlogGuard:false,order:'freq'});s.proficient=Object.fromEntries(w.filter(x=>x.w!==word).map(x=>[x.w,1]));localStorage.setItem(book+'_vocab_v1',JSON.stringify(s));localStorage.setItem(book+'_vocab_proficient_v1',JSON.stringify(s.proficient));})()`);
  await p.reload();await p.waitFor('window.__vocab');await p.eval(`window.__vocab.getBook()===${JSON.stringify(book)}||window.__vocab.switchBook(${JSON.stringify(book)})`);await p.waitFor(`document.querySelector("#card .word")?.textContent===${JSON.stringify(word)}`);
  if(dark){if(await p.eval('document.documentElement.dataset.theme!=="dark"'))await click('#btnTheme');await p.eval('window.__vocab.setFontSize("large")');}
  await p.key('keyF');await mode(modeId);await p.nextFrame();
  const geo=await p.eval(`(()=>{const w=document.querySelector('#card .word-face').getBoundingClientRect(),a=document.querySelector('#card .answer').getBoundingClientRect(),m=document.querySelector('#main');return {theme:document.documentElement.dataset.theme,centerDelta:Math.abs((w.top+w.bottom-a.top-a.bottom)/2),doc:document.documentElement.scrollWidth,width:innerWidth,mainScrollable:m.scrollHeight>m.clientHeight+1,word:document.querySelector('#card .word').textContent,mode:document.documentElement.dataset.studyMode};})()`);
  check((dark?'深色':'浅色')+' '+word+' '+modeId+' 词头与释义视觉中心对齐且无横向溢出',geo.word===word&&geo.mode===modeId&&geo.theme===(dark?'dark':'light')&&geo.centerDelta<=2&&geo.doc<=geo.width+1,geo);
  await shot('1440-'+(dark?'dark':'light')+'-'+modeId+'-'+word);
 }
 // 能力不支持时只隐藏全屏入口，学习与模式切换保持可用。
 const unsupported=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:undefined});`});
 try{
  await seed({width:1280,height:720});
  check('不支持全屏时顶栏与工具代理同时隐藏',await p.eval(`typeof document.documentElement.requestFullscreen==='undefined'&&document.querySelector('#btnFullscreen').hidden&&document.querySelector('#studyTools [data-study-proxy="btnFullscreen"]').hidden`));
  check('不支持全屏时模式栏直达入口也隐藏且无Tab目标',await p.eval(`document.querySelector('#studyFullscreen').hidden&&document.querySelector('#studyFullscreen').getClientRects().length===0`));
  await mode('immersive');await p.key('keyF');
  check('不支持全屏不影响沉浸切换和正常判定',await p.eval(`window.__vocab.getStudyMode()==='immersive'&&window.__vocab.phase==='revealed'&&window.__vocab.verdict===true`));
 }finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:unsupported.identifier});}
}catch(error){if(p)report.shots.push(await p.screenshot('study-modes-failure.png'));check('模式完整旅程执行',false,String(error.stack||error));}
finally{
 if(p)report.errors=p.errors();check('无未解释浏览器异常',report.errors.length===0,report.errors);
 report.sourcesAfter=fingerprint();check('运行时源文件稳定',same(report.sources,report.sourcesAfter),report.sourcesAfter);
 report.passed=report.checks.filter(x=>x.ok).length;report.failed=report.checks.length-report.passed;
 fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(path.join(RESULTS_DIR,'study-modes.json'),JSON.stringify(report,null,2));
 await p?.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:path.join(RESULTS_DIR,'study-modes.json'),screenshots:report.shots.length}));process.exitCode=report.failed?1:0;
