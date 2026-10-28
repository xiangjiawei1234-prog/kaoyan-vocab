#!/usr/bin/env node
/** D1 输入定制：真实控件、CDP键盘/触摸与稳定动作槽位，不进入Node默认汇总。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],samples:[],shots:[],errors:[],
  limits:['Chrome headless CDP; touch emulation is not a physical phone','Native select choices use DOM value + native change because CDP native popup keyboard selection is unreliable; business setters are not called',
    'Synthetic composition/selection guards prove DOM guard behavior only, not real IME or assistive technology','No native screen reader, OS speech playback, Safari/Firefox or OS sleep audit'],
  fixture:'Independent temporary profile; fixtures initialize stored book records only. Main groups, verdicts, undo, completion, drill and continue are reached through normal boot and real controls/input; Q/cur/counters are not directly mutated.'};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const learning=`(() => {const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,Q:v.Q,answered:v.answered,total:v.getGroupTotal(),plan:v.getPlan(),progress:s.progress,days:s.days,reviewDay:s.reviewDay,extraDay:s.extraDay,stars:s.stars,proficient:s.proficient,drill:v.drillMode,extra:v.isExtraSubgroup(),newOnly:v.isNewOnlySubgroup()};})()`;
const prefs=`(() => {const s=window.__vocab.getS().settings;return {keys:s.keys,actionKeys:s.actionKeys,gestures:s.gestures,actionLayout:s.actionLayout,singleCharKeys:s.singleCharKeys};})()`;
let p;
async function run(name,fn){try{await fn();}catch(e){check(name+' 旅程执行完整',false,String(e.stack||e));}}
async function shot(name){await sleep(120);report.shots.push(await p.screenshot('input-preferences-'+name+'.png'));}
async function openAncestors(selector){
  const indices=await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('控件缺失：'+${JSON.stringify(selector)});const all=[...document.querySelectorAll('details')],out=[];for(let q=e.tagName==='SUMMARY'?e.parentElement?.parentElement:e.parentElement;q;q=q.parentElement)if(q.tagName==='DETAILS'&&!q.open)out.unshift(all.indexOf(q));return out;})()`);
  for(const i of indices){const point=await p.eval(`(() => {const s=document.querySelectorAll('details')[${i}].querySelector(':scope > summary');s.scrollIntoView({block:'center'});const r=s.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await p.click(point.x,point.y);}
}
async function click(selector){
  await openAncestors(selector);await p.scrollIntoView(selector);
  if(await p.isClickable(selector)){await p.clickSelector(selector);return;}
  const proxy=await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)}),p=e?.type==='checkbox'?e.closest('.sw'):null;if(!p)return null;const r=p.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,ok:!!hit&&(hit===p||p.contains(hit)),w:r.width,h:r.height};})()`);
  if(proxy?.ok&&proxy.w>0&&proxy.h>0){await p.click(proxy.x,proxy.y);return;}
  throw Error('控件不能真实命中：'+selector);
}
async function select(selector,value){await openAncestors(selector);await p.scrollIntoView(selector);await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(![...e.options].some(o=>o.value===${JSON.stringify(value)}))throw Error('没有选项 '+${JSON.stringify(value)}+' in '+${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await sleep(35);}
async function seed({theme='light',fontSize='standard',dailyNew=8,groupSize=4,dayN=0,autoEnabled=false,wrong=false,keys,actionKeys,gestures,actionLayout='standard',targetWord=null}={}){
  const {identifier}=await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));`});
  const k=keys||{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},a=actionKeys||{continue:null,wait:null,return:null,listSearch:null},g=gestures||{enabled:true,recall:{left:'dont',right:'know'},revealed:{left:'none',right:'none'}};
  await p.eval(`(() => {const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS())),now=Date.now(),d=new Date(),day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    s.progress={};s.days={};s.stars={};s.proficient={};s.spelling={};s.timeSec=0;s.reviewDay={d:day,used:0};s.extraDay={d:day,extra:0};
    Object.assign(s.settings,{theme:${JSON.stringify(theme)},fontSize:${JSON.stringify(fontSize)},dailyNew:${dailyNew},groupSize:${groupSize},dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,showPh:true,showEx:true,showFm:true,autoSpk:false,singleCharKeys:true,keys:${JSON.stringify(k)},actionKeys:${JSON.stringify(a)},gestures:${JSON.stringify(g)},actionLayout:${JSON.stringify(actionLayout)},autoResume:{enabled:${autoEnabled},threshold:1,idleMs:30000,countdownMs:3000}});
    if(${dayN}>0){s.days[day]={n:${dayN},r:${dayN},ok:${dayN},no:0};s.progress[0]=[1,now+86400000,1,0,now-86400000];}
    if(${wrong}){const i=v.getW().findIndex(x=>x.f>0);s.progress[i]=[0,0,0,1,0];}
    if(${JSON.stringify(targetWord)}!==null)s.proficient=Object.fromEntries(v.getW().filter(x=>x.w!==${JSON.stringify(targetWord)}).map(x=>[x.w,1]));
    localStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1',JSON.stringify(s.proficient));localStorage.setItem('vocab_active_book_v1','kaoyan');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  try{await p.reload();await p.waitFor('window.__vocab&&window.__vocab.getInputPreferences&&document.querySelector("#card")');}
  finally{await p.send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  await sleep(110);
}
async function openKeys(){await click('[data-v="set"]');await p.waitFor('document.querySelector("#v-set").classList.contains("on")');await openAncestors('#gestureSettings');await p.scrollIntoView('#settings-keys',{block:'start'});}
async function study(){await click('[data-v="study"]');await p.waitFor('document.querySelector("#v-study").classList.contains("on")');await p.eval('document.querySelector("#card").focus({preventScroll:true})');}
async function bind(action,key,{shift=false,ctrl=false}={}){await click('[data-k="'+action+'"]');await p.key('custom',{key:shift?key.toUpperCase():key,code:/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():key===' '?'Space':'',vk:key===' '?32:key.toUpperCase().charCodeAt(0),text:key,modifiers:(shift?8:0)|(ctrl?2:0)});await sleep(50);}
async function swipe(direction,{dx=130,dy=0}={}){const r=await p.rect('#card'),distance=direction==='left'?-dx:dx;const x=distance<0?r.right-35:r.left+35,y=Math.max(r.top+28,Math.min(r.bottom-28,r.top+r.h*.25));await p.touchSwipe(x,y,distance,dy);await sleep(100);return {x,y,dx:distance,dy};}
async function undo(){await p.key('keyZ',{modifiers:2});await p.waitFor('window.__vocab.phase==="recall"');}
async function geometry(label,layout,phase){
  // U3：长答案由学习主区统一滚动；先把动作区真实滚到可见位置，再检查所有按钮命中。
  // 这里只发生在双击完成之后/下一次双击之前，不在同一次两下点击中间调整位置。
  await p.scrollIntoView('#acts');
  // nextFrame等待两次rAF：先让原生scroll事件完成提示定位，再采样真正已绘制的UI。
  // 不在双击两下之间插入等待，也不放宽任何命中、尺寸或连击断言。
  await p.nextFrame();
  const x=await p.eval(`(() => {const a=document.querySelector('#acts'),c=document.querySelector('#card'),h=document.querySelector('#hint'),r=a.getBoundingClientRect(),cr=c.getBoundingClientRect(),hr=h.getBoundingClientRect(),status=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {id:e.id,tag:e.tagName,hidden:e.hidden,className:String(e.className),placement:e.dataset.placement,top:r.top,bottom:r.bottom,left:r.left,right:r.right};},buttons=[...a.querySelectorAll('button')].map(e=>{const q=e.getBoundingClientRect(),x=q.x+q.width/2,y=q.y+q.height/2,hit=document.elementFromPoint(x,y);return {id:e.id,x:q.x,y:q.y,w:q.width,h:q.height,cx:x,cy:y,inView:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,hit:!!hit&&(hit===e||e.contains(hit)),hitElement:status(hit)};});return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,layout:a.dataset.layout,phase:window.__vocab.phase,acts:{top:r.top,bottom:r.bottom,h:r.height,min:getComputedStyle(a).minHeight},card:{top:cr.top,bottom:cr.bottom,h:cr.height},hint:{h:hr.height,min:getComputedStyle(h).minHeight},toast:status(document.querySelector('#toast')),profFeedback:status(document.querySelector('#profFeedback')),buttons,dom:buttons.map(e=>e.id)};})()`);
  const expected=x.width<=720?151:156;
  check(label+' 动作高度/提示行/卡片边界保持',Math.abs(x.acts.h-expected)<=1&&parseFloat(x.acts.min)===expected&&x.card.bottom<=x.acts.top+1&&(x.width>720||Math.abs(x.hint.h-40)<=1)&&x.doc<=x.width+1,x);
  check(label+' 可见按钮真实命中与布局标记',x.layout===layout&&x.phase===phase&&x.buttons.filter(e=>e.inView).every(e=>e.hit)&&x.buttons.filter(e=>e.inView).length>=2,x);
  const expectedOrder=phase==='recall'?(layout==='right'?['no','ok']:['ok','no']):(layout==='left'?['nx','fix','markProficient','undoBtn']:['fix','nx','undoBtn','markProficient']);
  const relevant=x.dom.filter(id=>expectedOrder.includes(id));
  check(label+' DOM/视觉顺序一致',same(relevant,expectedOrder)&&relevant.every((id,i)=>{if(i===0)return true;const a=x.buttons.find(e=>e.id===relevant[i-1]),b=x.buttons.find(e=>e.id===id);return a.y<b.y-1||Math.abs(a.y-b.y)<=1&&a.x<b.x;}),{expected:expectedOrder,actual:relevant,buttons:x.buttons});
  report.samples.push({label,actual:x});return x;
}

try{
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#card")');
  await run('触摸定制',async()=>{
    await p.setViewport(375,812,{mobile:true});await seed({theme:'dark',fontSize:'large'});
    const initial=await p.eval(learning);const right=await swipe('right');
    check('默认右滑判会且只记一次',await p.eval('window.__vocab.verdict===true&&window.__vocab.answered===1'),right);await undo();
    check('手势判定可真实撤销',same(initial,await p.eval(learning)));
    const left=await swipe('left');check('默认左滑判不会且只记一次',await p.eval('window.__vocab.verdict===false&&window.__vocab.answered===1'),left);await undo();
    await openKeys();const beforeDisable=await p.eval(learning);await click('#gesturesEnabled');await study();
    check('关闭手势保存且不改学习现场',await p.eval('!window.__vocab.getS().settings.gestures.enabled')&&same(beforeDisable,await p.eval(learning)));
    await swipe('right');await swipe('left');check('关闭后左右滑动不判定',same(beforeDisable,await p.eval(learning)));
    await openKeys();await click('#gesturesEnabled');await click('[data-gesture-preset="reverse"]');const reverse=await p.eval(prefs);await study();
    await swipe('left');check('反转后左滑判会/真实参数对应',reverse.gestures.recall.left==='know'&&reverse.gestures.recall.right==='dont'&&await p.eval('window.__vocab.verdict===true&&window.__vocab.answered===1'),reverse);await undo();
    await openKeys();await select('#gestureRecallLeft','none');await select('#gestureRecallRight','star');await select('#gestureRevealedRight','next');await p.scrollIntoView('#gestureSettings',{block:'start'});await shot('settings-gestures-dark-375');await study();
    const beforeCustom=await p.eval(learning);await swipe('left');check('自定义左滑不操作',same(beforeCustom,await p.eval(learning)));
    await swipe('right');const starred=await p.eval(learning);check('自定义右滑收藏不判定',starred.answered===beforeCustom.answered&&starred.phase==='recall'&&starred.cur===beforeCustom.cur&&Object.keys(starred.stars).length===1&&same(starred.progress,beforeCustom.progress),starred);
    await p.key('keyF');const revealed=await p.eval(learning);await swipe('right');const next=await p.eval(learning);
    check('判定后自定义右滑下一词/不自动判定',next.cur!==revealed.cur&&next.phase==='recall'&&next.answered===revealed.answered&&same(next.progress,revealed.progress),{before:revealed,after:next});await shot('touch-custom-dark-375');
    const beforeShort=await p.eval(learning);await swipe('right',{dx:30});await swipe('right',{dx:10,dy:90});
    check('短距离与纵向触摸不触发映射',same(beforeShort,await p.eval(learning)));
    await openKeys();await click('[data-gesture-preset="standard"]');await study();
    const beforeSelection=await p.eval(learning);
    await p.eval(`(() => {const e=document.querySelector('#card .word'),r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`);
    await p.key('keyF');await swipe('right');check('已有文本选择不穿透按键/触摸判定',same(beforeSelection,await p.eval(learning)));
    await p.eval('getSelection().removeAllRanges()');
    const beforeIme=await p.eval(learning);
    await p.eval(`document.querySelector('#card').dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',bubbles:true,isComposing:true}));document.querySelector('#card').dispatchEvent(new KeyboardEvent('keydown',{key:'f',code:'KeyF',bubbles:true,repeat:true}));`);
    check('合成输入法/重复键守卫不判定（DOM边界）',same(beforeIme,await p.eval(learning)));
  });
  await run('键位与上下文',async()=>{
    await p.setViewport(1440,1000);await seed();await openKeys();const before=await p.eval(learning);
    await bind('dont','f',{shift:true});let k=await p.eval(prefs);
    check('捕获Shift加字母保留原bare键',k.keys.dont==='shift+f'&&k.keys.know==='f'&&same(before,await p.eval(learning)),k);
    await bind('star','f');const conflict=await p.eval(`({prefs:${prefs},status:(document.querySelector('#inputPreferencesStatus')?.textContent||'')+' '+document.querySelector('#keyBindingStatus').textContent+' '+document.querySelector('#toast').textContent})`);
    check('相同上下文键冲突拒绝并明确占用动作',conflict.prefs.keys.star==='b'&&/会|占用|冲突/.test(conflict.status),conflict);await p.key('Escape');
    await click('[data-input-reset="dont"]');check('单项恢复只还原目标绑定',await p.eval('window.__vocab.getS().settings.keys.dont==="j"&&window.__vocab.getS().settings.keys.know==="f"'));
    await bind('dont','f',{shift:true});await bind('continue','f');await bind('listSearch','q');const bound=await p.eval(prefs);
    check('上下文无交集可复用/词表搜索自定义保存',bound.actionKeys.continue==='f'&&bound.actionKeys.listSearch==='q'&&bound.keys.know==='f',bound);await p.scrollIntoView('#actionKeysSettings',{block:'start'});await shot('settings-bindings-shift-1440');
    await study();await p.key('Space');check('回忆态下一词仍被门控',same(before,await p.eval(learning)));
    await p.key('keyF');check('原bare F判会',await p.eval('window.__vocab.verdict===true&&window.__vocab.answered===1'));await undo();
    await p.key('keyF',{key:'F',text:'F',modifiers:8});check('显式Shift+F优先判不会',await p.eval('window.__vocab.verdict===false&&window.__vocab.answered===1'));await undo();
    await p.key('keyF',{key:'F',text:'F'});check('无Shift大写/CapsLock语义保持原F',await p.eval('window.__vocab.verdict===true&&window.__vocab.answered===1'));await undo();
    await click('#btnHelp');await p.waitFor('!document.querySelector("#helpSheet").hidden');check('帮助显示真实Shift绑定',await p.eval('/Shift.*F/i.test(document.querySelector("#keyList").textContent)'));await p.key('Escape');
    const beforeSearch=await p.eval(learning);await p.key('q',{key:'q',code:'KeyQ',vk:81,text:'q'});await p.waitFor('document.querySelector("#v-list").classList.contains("on")');
    check('新增词表搜索键保留学习现场并聚焦输入',await p.eval('document.activeElement.id==="q"')&&same(beforeSearch,await p.eval(learning)));
    await p.key('keyF');check('搜索框输入不穿透判定',same(beforeSearch,await p.eval(learning)));await study();
    await openKeys();await click('#singleCharKeys');await study();const beforeOff=await p.eval(learning);
    await p.key('keyF');await p.key('keyF',{key:'F',text:'F',modifiers:8});await p.key('q',{key:'q',code:'KeyQ',vk:81,text:'q'});
    check('关闭单字符同时关闭Shift与新增字符键',same(beforeOff,await p.eval(learning))&&await p.eval('document.querySelector("#v-study").classList.contains("on")'));
    await click('#ok');const revealed=await p.eval(learning);await p.key('Enter');check('关闭字符后固定Enter仍继续',await p.eval('window.__vocab.phase==="recall"')&&await p.eval('window.__vocab.cur')!==revealed.cur);
    await openKeys();await click('#keyReset');const reset=await p.eval(prefs);
    check('整套恢复默认不重新启用字符/清新增映射',!reset.singleCharKeys&&same(reset.keys,{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'})&&Object.values(reset.actionKeys).every(x=>x===null),reset);await study();await shot('keys-standard-1440');
    await seed({actionKeys:{continue:'f',wait:null,return:null,listSearch:null}});
    for(let i=0;i<4;i++){await p.key('keyF');await p.key('Enter');}
    await p.waitFor('window.__vocab.cur===null&&document.querySelector("#again")');const completed=await p.eval(learning);await p.key('keyF');
    check('同一个F在完成页继续新组且不自动判定',await p.eval('window.__vocab.cur!==null&&window.__vocab.answered===0&&window.__vocab.phase==="recall"')&&same(completed.progress,await p.eval('window.__vocab.getS().progress'))&&same(completed.days,await p.eval('window.__vocab.getS().days')));
    await seed({dailyNew:1,groupSize:1,dayN:1,autoEnabled:true,actionKeys:{continue:null,wait:'w',return:null,listSearch:null}});
    await p.key('w',{key:'w',code:'KeyW',vk:87,text:'w'});check('等待键明确开始本页空等待',await p.eval('window.__vocab.getAutoResumeState().waitingForDue&&window.__vocab.cur===null'));
    await p.key('w',{key:'w',code:'KeyW',vk:87,text:'w'});check('同等待键退出本页等待',await p.eval('!window.__vocab.getAutoResumeState().waitingForDue&&window.__vocab.cur===null'));
    await seed({wrong:true,actionKeys:{continue:null,wait:null,return:'r',listSearch:null}});const main=await p.eval(learning);await click('#btnDrill');await p.waitFor('window.__vocab.drillMode');await p.key('r',{key:'r',code:'KeyR',vk:82,text:'r'});
    check('返回键退出特训保留原主组',!await p.eval('window.__vocab.drillMode')&&same(main,await p.eval(learning)));
  });
  await run('布局保留阅读现场',async()=>{
    await p.setViewport(375,900,{mobile:true});
    const target=await p.eval(`window.__vocab.getW().filter(x=>x.fm&&x.ex&&x.ex.length>180).sort((a,b)=>b.ex.length-a.ex.length)[0]?.w`);
    if(!target)throw Error('缺少带词形与长例句的阅读夹具');
    await seed({theme:'dark',fontSize:'large',targetWord:target});check('长阅读目标由主队列自然配入',await p.eval('window.__vocab.getW()[window.__vocab.cur]?.w')===target&&await p.eval('window.__vocab.getGroupTotal()')===1,{target,actual:await p.eval('window.__vocab.getW()[window.__vocab.cur]?.w')});await p.key('keyF');
    await p.waitFor('document.querySelector("#card .answer-extra")');
    await click('#card .answer-extra > summary');
    const point=await p.eval(`(() => {const m=document.querySelector('#main'),r=m.getBoundingClientRect();return {x:r.x+r.width/2,y:Math.min(innerHeight-30,r.y+Math.min(r.height/2,220))};})()`);
    await p.mouseMove(point.x,point.y);
    await p.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:point.x,y:point.y,deltaX:0,deltaY:240});await sleep(100);
    const before=await p.eval(`({learning:${learning},open:document.querySelector('#card .answer-extra').open,scroll:document.querySelector('#main').scrollTop,cardScroll:document.querySelector('#card').scrollTop,html:document.querySelector('#card').innerHTML})`);
    check('阅读夹具真实展开词形且在学习主区滚动、卡内无独立滚动',before.open&&before.scroll>0&&before.cardScroll===0,{word:target,scroll:before.scroll,cardScroll:before.cardScroll,open:before.open});
    await openKeys();await click('[data-action-layout="left"]');await study();
    const after=await p.eval(`({learning:${learning},open:document.querySelector('#card .answer-extra').open,scroll:document.querySelector('#main').scrollTop,cardScroll:document.querySelector('#card').scrollTop,html:document.querySelector('#card').innerHTML})`);
    check('左右手设置保留词形展开/学习主区阅读滚动与当前卡DOM',same(before.learning,after.learning)&&before.open===after.open&&Math.abs(before.scroll-after.scroll)<=1&&after.cardScroll===0&&before.html===after.html,{word:target,before:{open:before.open,scroll:before.scroll},after:{open:after.open,scroll:after.scroll}});
    await shot('layout-reading-preserved-375');
  });
  for(const width of [320,375,720,721,1440])for(const layout of ['standard','left','right'])await run('布局 '+width+' '+layout,async()=>{
    const theme=width===375?'dark':'light',fontSize=width<=375?'large':'standard',label=width+' '+layout;
    await p.setViewport(width,width<=720?900:1000,{mobile:width<=720});await seed({theme,fontSize});const original=await p.eval(learning);
    await openKeys();await click('[data-action-layout="'+layout+'"]');await study();
    check(label+' 即时布局只变呈现不重建学习',same(original,await p.eval(learning))&&await p.eval('window.__vocab.getS().settings.actionLayout')===layout);
    await geometry(label+' recall',layout,'recall');
    for(const id of ['ok','no']){
      if(id==='no')await undo();
      await p.scrollIntoView('#'+id);
      const beforeClick=await p.eval(learning),r=await p.rect('#'+id);if(!await p.isClickable('#'+id))throw Error('判定按钮未可点：'+id);
      await p.doubleClickAt(r.cx,r.cy,{gap:50});await sleep(120);const after=await p.eval(learning);
      check(label+' '+id+' 同坐标双击只判定一次',after.cur===beforeClick.cur&&after.qi===beforeClick.qi&&after.phase==='revealed'&&after.answered===1&&after.verdict===(id==='ok')&&Object.keys(after.progress).length===1,{point:{x:r.cx,y:r.cy},before:beforeClick,after});
      await geometry(label+' '+id+' revealed',layout,'revealed');
    }
    if([320,375,721,1440].includes(width))await shot('layout-'+label.replaceAll(' ','-'));
  });
}catch(error){check('D1检查启动完整',false,String(error.stack||error));}
finally{
  if(p)report.errors=p.errors();check('浏览器无新增console错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/input-preferences.json',JSON.stringify(report,null,2));
  if(p)await p.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/input-preferences.json',screenshots:report.shots.length}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
