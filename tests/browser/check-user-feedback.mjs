#!/usr/bin/env node
/**
 * 六项用户反馈的真实浏览器回归。无 npm 依赖；隔离 Chrome profile / 同源临时服务。
 * 运行：node --max-old-space-size=512 tests/browser/check-user-feedback.mjs [--only=study,card,settings,stats]
 * 夹具只写 localStorage/sessionStorage 初始化状态；学习、设置和排序均走真实按键/指针/触摸。
 * 只读 __vocab 用于取证，不通过业务写 hook 伪造当前卡/完成组或排序结果。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { startStaticServer, launchChrome, connect, Page, sleep, createRecorder, REPO_ROOT, RESULTS_DIR } from "./cdp.mjs";

const only = process.argv.find(x => x.startsWith("--only="))?.slice(7).split(",");
const wants = s => !only || only.includes(s);
const fingerprint = () => Object.fromEntries(["index.html", "js/app.js", "css/app.css", "sw.js"].map(f => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO_ROOT, f))).digest("hex")]));
const sources = fingerprint();
const server = await startStaticServer();
const chrome = await launchChrome({windowSize:"1440,1000"});
const conn = await connect(chrome.wsUrl);
const rec = createRecorder("user-feedback", {
  title:"六项用户反馈浏览器验收", sources, browser:await conn.send("Browser.getVersion"),
  limits:["Chrome headless 隔离 profile；320/375 为视口与触摸仿真，不代表真机、软键盘或读屏", "夹具只初始化独立存储，业务操作使用真实键盘/鼠标/触摸", "长按拖拽为真实持续按压 520ms 后逐步移动，不直接调用排序入口"],
});
let counter = 0;
const shots = [];
const check = (ok,title,actual={}) => {
  const entry={id:"UF-"+String(++counter).padStart(3,"0"),title,actual};
  rec[ok?"pass":"fail"](entry);console.log((ok?"PASS ":"FAIL ")+entry.id+" "+title);
};
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
async function shot(p,name){const file=await p.screenshot("user-feedback-"+name+".png");shots.push(file);rec.addEvidence(file);}
async function open(){const p=await Page.open(conn,{url:server.url()});await p.waitFor("window.__vocab&&document.querySelector('#card')",{timeout:60000});return p;}
async function press(p,name,options={}){await p.send("Page.bringToFront");return p.key(name,options);}
async function click(p,sel){await p.send("Page.bringToFront");await p.scrollIntoView(sel);await sleep(110);if(!await p.isClickable(sel)){await sleep(200);await p.scrollIntoView(sel);}if(!await p.isClickable(sel))throw Error("控件不能真实命中："+sel);await p.clickSelector(sel);await sleep(60);}
async function seed(p,{settings={},target=null,statsRaw=null}={}){
  const {identifier}=await p.send("Page.addScriptToEvaluateOnNewDocument",{source:"try{Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));}catch(e){}"});
  try{
    await p.eval(`(()=>{const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS()));s.progress={};s.days={};s.stars={};s.proficient={};s.spelling={};s.timeSec=0;s.reviewDay={};s.extraDay={};
      Object.assign(s.settings,{theme:'dark',fontSize:'standard',dailyNew:4,groupSize:1,dailyReviewCap:100,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,autoSpk:false,singleCharKeys:true,
        keys:{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},actionKeys:{continue:null,wait:null,return:null,listSearch:null},
        autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000},cardDensity:'comfortable',readingOrder:['meaning','example','forms'],showCardMeta:true,showCardStage:true,showCardPos:true,secondaryActions:['undo','proficient']},${JSON.stringify(settings)});
      ${target?`if(!v.getW().some(w=>w.w===${JSON.stringify(target)}))throw Error('夹具词缺失');for(const x of v.getW())if(x.w!==${JSON.stringify(target)})s.proficient[x.w]=Date.now();`:""}
      localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1',JSON.stringify(s.proficient));localStorage.setItem('vocab_active_book_v1','kaoyan');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));
      ${statsRaw!==null?`localStorage.setItem('vocab_stats_panels_v1',${JSON.stringify(statsRaw)});`:""}
    })()`);
    await p.reload();await p.waitFor("window.__vocab&&document.querySelector('#card')",{timeout:60000});await p.send("Page.bringToFront");await sleep(120);
  }finally{await p.send("Page.removeScriptToEvaluateOnNewDocument",{identifier});}
}
const GROUP="(()=>{const v=window.__vocab,p=v.getPlan();return {cur:v.cur,phase:v.phase,qi:v.qi,answered:v.answered,Q:v.Q,startedAt:p&&p.startedAt};})()";
async function finishOne(p,next="Space"){
  await press(p,"keyF");await p.waitFor("window.__vocab.phase==='revealed'");await press(p,next,next==="keyK"?{key:"k",code:"KeyK",vk:75,text:"k"}:{});
  await p.waitFor("window.__vocab.cur==null&&!!document.querySelector('#again')",{timeout:6000,label:"自然完成一词主组"});
}
async function study(){
  const p=await open();try{
    await p.setViewport(1440,1000);await seed(p);
    const first=await p.eval(GROUP);await finishOne(p);
    const done=await p.eval(`({group:${GROUP},label:document.querySelector('#again').textContent,hint:document.querySelector('#hint').textContent})`);
    check(done.group.answered===1&&/空格/.test(done.label+done.hint),"完成页显示沿用空格的下一组提示",done);
    await press(p,"Space");await p.waitFor("window.__vocab.cur!=null&&window.__vocab.phase==='recall'",{timeout:6000,label:"空格继续下一组"});
    const continued=await p.eval(GROUP);
    check(continued.cur!==first.cur&&continued.answered===0,"完成一组后再次空格直接进入下一组，无鼠标",{first,done:done.group,continued});
    await seed(p,{settings:{keys:{know:'f',dont:'j',next:'k',speak:'s',star:'b',proficient:'m'}}});
    await finishOne(p,"keyK");const customDone=await p.eval(GROUP);await press(p,"keyK",{key:"k",code:"KeyK",vk:75,text:"k"});
    await p.waitFor("window.__vocab.cur!=null&&window.__vocab.phase==='recall'",{timeout:6000});
    check(customDone.cur===null&&await p.eval("window.__vocab.answered===0"),"自定义下一词键 K 在完成页继续下一组");
    await seed(p);await press(p,"keyF");await p.waitFor("window.__vocab.phase==='revealed'");
    await p.eval("window.__feedbackKeyTrace=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{const item={type:e.type,key:e.key,code:e.code,repeat:e.repeat,target:e.target.id||e.target.tagName};window.__feedbackKeyTrace.push(item);setTimeout(()=>{item.prevented=e.defaultPrevented;item.cur=window.__vocab.cur;item.active=document.activeElement.id||document.activeElement.tagName;},0);},true)");
    await p.send("Input.dispatchKeyEvent",{type:"rawKeyDown",key:" ",code:"Space",windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
    await p.waitFor("window.__vocab.cur==null");
    const heldDone=await p.eval(GROUP);
    await p.send("Input.dispatchKeyEvent",{type:"rawKeyDown",key:" ",code:"Space",windowsVirtualKeyCode:32,nativeVirtualKeyCode:32,autoRepeat:true});
    await sleep(150);check(same(heldDone,await p.eval(GROUP)),"按住最后一次空格产生的 repeat 不越过完成页");
    await p.send("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
    await press(p,"Space");await sleep(180);const released=await p.eval(`({group:${GROUP},events:window.__feedbackKeyTrace,keys:window.__vocab.getS().settings.keys,selection:getSelection().toString(),visibility:document.visibilityState,view:document.querySelector(".view.on")?.id,presentation:window.__vocab.deriveStudyPresentation(),single:window.__vocab.getS().settings.singleCharKeys,alert:document.querySelector("#appAlert")?.textContent})`);if(released.group.cur==null)console.log(JSON.stringify(released));check(released.group.cur!=null&&released.group.phase==='recall'&&released.group.answered===0,"松开后重新按键才开组，首卡仍待自评",released);
    await shot(p,"keyboard-next-group-1440");
    await seed(p);const marked=await p.eval("({i:window.__vocab.cur,word:window.__vocab.getW()[window.__vocab.cur].w})");
    await press(p,"keyM");await p.waitFor("!document.querySelector('#profFeedback').hidden",{label:"熟练即时反馈"});
    const feedback=await p.eval(`(()=>{const e=document.querySelector('#profFeedback'),r=e.getBoundingClientRect();return {hidden:e.hidden,position:getComputedStyle(e).position,text:e.textContent,top:r.top,bottom:r.bottom,height:r.height,cardHeight:document.querySelector('#card').getBoundingClientRect().height,marked:window.__vocab.isProficient(${marked.i})};})()`);
    check(feedback.marked&&['fixed','absolute'].includes(feedback.position),"熟练确认脱离页面布局，不占单词卡网格高度",feedback);
    check(await p.isClickable("#btnUnMaster"),"熟练确认里的取消入口可直接命中");
    await click(p,"#btnUnMaster");check(await p.eval(`!window.__vocab.isProficient(${marked.i})&&document.querySelector('#profFeedback').hidden`),"即时取消熟练复用正式路径并收起确认");
    await seed(p);await press(p,"keyM");await p.waitFor("!document.querySelector('#profFeedback').hidden");await shot(p,"proficient-transient");await p.mouseMove(10,10);
    await p.waitFor("document.querySelector('#profFeedback').hidden",{timeout:14000,label:"熟练确认自动收起"});
    check(await p.eval("document.querySelector('#profFeedback').hidden"),"熟练提示到时自动收起，不长期挤占或遮挡页面");
    check(p.errors().length===0,"键盘续组与熟练反馈无未捕获错误",p.errors());
  }finally{await p.close();}
}
async function card(){
  const p=await open();try{
    for(const [w,h] of [[1440,1000],[1440,520],[375,812],[320,812],[320,568]]){
      await p.setViewport(w,h,{mobile:w<500});await seed(p,{target:"church",settings:{fontSize:"large"}});
      const natural=await p.eval("window.__vocab.getW()[window.__vocab.cur].w");check(natural==='church',w+'×'+h+' 真实队列自然选出长内容词',natural);
      await press(p,"keyF");await p.waitFor("window.__vocab.phase==='revealed'");
      if(await p.eval("!!document.querySelector('#card .answer-extra')"))await click(p,"#card .answer-extra > summary");
      const geo=await p.eval(`(()=>{const c=document.querySelector('#card'),r=c.getBoundingClientRect(),m=document.querySelector('#main'),s=getComputedStyle(c);return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,card:{height:r.height,client:c.clientHeight,scroll:c.scrollHeight,overflowY:s.overflowY},main:{client:m.clientHeight,scroll:m.scrollHeight},forms:!!c.querySelector('.answer-extra')&&c.querySelector('.answer-extra').open,mean:!!c.querySelector('.mean')};})()`);
      check(geo.card.scroll<=geo.card.client+2&&!['auto','scroll'].includes(geo.card.overflowY),w+'×'+h+' 长卡完整自然伸展，没有卡内上下滚动条',geo);
      check(geo.doc<=w+1&&geo.forms&&geo.mean,w+'×'+h+' 大字、长例句和展开词形完整保留，无横向溢出',geo);
      await p.scrollIntoView("#nx");await sleep(150);check(await p.isClickable("#nx"),w+'×'+h+' 页面滚动后下一个按钮可达');
      const acts=await p.rect("#acts");check(Math.abs(acts.h-(w<=720?151:h<=650?146:156))<=1,w+'×'+h+' 动作区域保留固定高度，长卡不挤扁按钮',acts);
      await shot(p,'card-'+w+'x'+h+'-actions');
      await p.eval("document.querySelector('#main').scrollTop=0");await sleep(80);
      if(w<=375){const visible=await p.eval("(()=>{const r=document.querySelector('#card .mean').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,visible:r.top<innerHeight-16&&r.bottom>document.querySelector('header').getBoundingClientRect().bottom};})()");check(visible.visible,w+'×'+h+' 长卡首屏已能读到中文释义核心',visible);}
      await shot(p,'card-'+w+'x'+h+'-top');
    }
    await p.setViewport(375,812,{mobile:true});await seed(p,{settings:{groupSize:2}});await press(p,'keyF');await p.waitFor("window.__vocab.phase==='revealed'");
    await p.scrollIntoView('#nx');const oldWord=await p.eval('window.__vocab.cur');await click(p,'#nx');
    const advanced=await p.eval("({cur:window.__vocab.cur,scroll:document.querySelector('#main').scrollTop,phase:window.__vocab.phase})");
    check(advanced.cur!==oldWord&&advanced.phase==='recall'&&advanced.scroll<=2,'自然页面滚动到动作后，换词自动返回新词顶部',advanced);
    check(p.errors().length===0,"卡片自然布局无未捕获错误",p.errors());
  }finally{await p.close();}
}
async function settings(){
  const p=await open();try{
    for(const w of [1440,375,320]){
      await p.setViewport(w,w<500?812:1000,{mobile:w<500});await seed(p);await click(p,'[data-v="set"]');
      const freq=await p.eval(`(()=>{const d=document.querySelector('.frequency-advanced'),n=document.querySelector('#fmin');return {exists:!!d,open:d&&d.open,visible:n&&n.getClientRects().length>0};})()`);
      check(freq.exists&&freq.open&&freq.visible,w+' 精确词频区间首次默认展开',freq);
      for(const id of ['fontSizeSeg','cardDensitySeg']){
        await p.scrollIntoView('#'+id);const g=await p.eval(`(()=>{const e=document.querySelector('#${id}'),r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {w:r.width,parent:p.width,buttons:[...e.querySelectorAll('button')].map(x=>{const a=x.getBoundingClientRect();return {w:a.width,h:a.height};}),doc:document.documentElement.scrollWidth};})()`);
        check(g.w<=340&&g.w<=g.parent+1&&g.buttons.length===2&&g.buttons.every(x=>x.h>=43&&x.w<=180),w+' '+id+' 两选项采用紧凑宽度且点击区域足够',g);
        check(g.doc<=w+1,w+' '+id+' 不引起横向溢出',g);
      }
      await shot(p,'settings-compact-'+w);
    }
    check(p.errors().length===0,"设置默认展开和紧凑控件无未捕获错误",p.errors());
  }finally{await p.close();}
}
const CARDS=['statsPlanPanel','statsOverviewPanel','statsForecastPanel','surveyPanel','statsFreqPanel','statsStagesPanel','statsDaysPanel','statsHeatmapPanel','statsStoragePanel'];
const statsState="(()=>({order:[...document.querySelectorAll('#v-stats > .panel')].map(x=>x.id),open:[...document.querySelectorAll('#v-stats details.stats-details')].filter(x=>x.open).map(x=>x.id),raw:localStorage.getItem('vocab_stats_panels_v1')}))()";
const recordState="(()=>({main:localStorage.getItem('kaoyan_vocab_v1'),prof:localStorage.getItem('kaoyan_vocab_proficient_v1'),snapshot:localStorage.getItem('vocab_session_snapshot_kaoyan_v1'),group:"+GROUP+"}))()";
async function drag(p,id,targetId,{touch=false,hold=520}={}){
  await p.send("Page.bringToFront");
  const sel='[data-stats-drag="'+id+'"]';await p.scrollIntoView(sel,{block:'start'});await sleep(140);
  const from=await p.rect(sel),to=await p.rect('#'+targetId);
  const x=from.cx,y=from.cy,ty=Math.min(p.viewport.height-24,to.bottom-12,to.top+to.h*.65);let edgePause=null;
  if(touch){await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1,radiusX:8,radiusY:8,force:1}]});}
  else await p.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
  await sleep(hold);
  for(let i=1;i<=12;i++){
    const yy=y+(ty-y)*i/12;
    if(touch)await p.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:yy,id:1,radiusX:8,radiusY:8,force:1}]});
    else await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:yy,button:'left',buttons:1});
    await sleep(22);
  }
  if(hold>=420){
    if(touch&&ty>=p.viewport.height-25){const before=await p.eval("document.querySelector('#main').scrollTop");await sleep(240);const after=await p.eval("document.querySelector('#main').scrollTop");edgePause={before,after,delta:after-before};}
    // 手机大卡中间点可能在屏幕外：保持手指靠近主滚动区底边，靠产品自己的边缘自动滚动到目标。
    for(let n=0;n<100;n++){
      const done=await p.eval(`(()=>{const a=[...document.querySelectorAll('#v-stats > .panel')].map(x=>x.id);return a.indexOf(${JSON.stringify(id)})>a.indexOf(${JSON.stringify(targetId)});})()`);
      if(done)break;
      const yy=Math.min(p.viewport.height-24,ty)+(n%2?.2:0);
      if(touch)await p.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:yy,id:1,radiusX:8,radiusY:8,force:1}]});
      else await p.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:yy,button:'left',buttons:1});
      await sleep(25);
    }
  }
  if(touch)await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  else await p.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:ty,button:'left',buttons:0,clickCount:1});
  await sleep(180);
  return {from,to,x,y,ty,touch,hold,edgePause};
}
async function stats(){
  const p=await open();try{
    await p.setViewport(1440,1000);await seed(p);await click(p,'[data-v="stats"]');
    const initial=await p.eval(statsState),record=await p.eval(recordState);
    check(initial.open.length===6&&same(initial.order,CARDS),'统计9卡默认顺序完整，6张可折叠图表默认全部展开',initial);
    for(const id of ['statsForecastPanel','surveyPanel'])await click(p,'#'+id+' > summary');
    const collapsed=await p.eval(statsState);check(collapsed.open.length===4&&!collapsed.open.includes('statsForecastPanel')&&!collapsed.open.includes('surveyPanel'),'用户可自行折叠两卡，并立即记住选择',collapsed);
    const d=await drag(p,'statsPlanPanel','statsOverviewPanel');const dragged=await p.eval(statsState);
    check(dragged.order.indexOf('statsOverviewPanel')<dragged.order.indexOf('statsPlanPanel'),'真实鼠标长按拖拽交换首两张统计卡位置',{drag:d,state:dragged});
    check(same(collapsed.open,dragged.open),'拖拽只改变顺序，不触发图表折叠/展开');
    const after=await p.eval(recordState);check(same(record,after),'折叠与拖拽只写独立偏好，学习主记录/熟练/组现场保持',{before:record,after});
    await shot(p,'stats-dragged-1440');await p.reload();await p.waitFor("window.__vocab&&document.querySelector('#card')");await click(p,'[data-v="stats"]');
    const restored=await p.eval(statsState);check(same(restored.order,dragged.order)&&same(restored.open.sort(),dragged.open.sort()),'实际刷新后同时恢复统计卡片排序与折叠',restored);
    const handle='[data-stats-drag="statsPlanPanel"]';await click(p,handle);await p.eval(`document.querySelector(${JSON.stringify(handle)}).focus()`);await press(p,'ArrowUp',{modifiers:1});
    const keyboard=await p.eval(statsState);check(keyboard.order[0]==='statsPlanPanel','键盘 Alt+上方向键提供可访问的排序替代',keyboard);
    const beforeShort=await p.eval(statsState);await drag(p,'statsPlanPanel','statsOverviewPanel',{hold:80});const short=await p.eval(statsState);check(same(beforeShort.order,short.order),'短按移动未达到长按门槛时不意外排序');
    await seed(p,{statsRaw:JSON.stringify({version:1,open:['statsForecastPanel']})});await click(p,'[data-v="stats"]');const legacy=await p.eval(statsState);check(same(legacy.open,['statsForecastPanel'])&&same(legacy.order,CARDS),'旧版展开偏好继续有效，缺少排序字段采用默认顺序',legacy);
    for(const w of [375,320]){
      await p.setViewport(w,812,{mobile:true});await seed(p);await click(p,'[data-v="stats"]');
      // 折叠图表以缩短目标卡；前两张摘要卡仍由真实长按在其位置互换。
      const before=await p.eval(statsState);const td=await drag(p,'statsPlanPanel','statsOverviewPanel',{touch:true});const moved=await p.eval(statsState);
      check(moved.order.indexOf('statsOverviewPanel')<moved.order.indexOf('statsPlanPanel'),w+' 触摸长按拖拽统计卡生效',{drag:td,before,after:moved});
      check(td.edgePause&&td.edgePause.delta>0,w+' 拖拽手指停在底边时页面持续自动滚动，无需反复移动',td.edgePause);
      check(await p.eval('document.documentElement.scrollWidth<=innerWidth+1'),w+' 排序手柄与卡片没有横向溢出');await shot(p,'stats-dragged-'+w);
    }
    check(p.errors().length===0,'统计默认展开/记忆/长按排序无未捕获错误',p.errors());
  }finally{await p.close();}
}
try{for(const [name,run] of Object.entries({study,card,settings,stats})){if(!wants(name))continue;console.log('=== '+name+' ===');try{await run();}catch(e){check(false,name+' 旅程执行完整',{error:String(e.stack||e)});}}}
finally{check(same(sources,fingerprint()),'本轮取证期间运行时源字节保持一致');await rec.save({shots});conn.close();await chrome.close();await server.close();}
const counts=rec.counts();console.log(JSON.stringify({passed:counts['通过'],failed:counts['失败'],report:path.join(RESULTS_DIR,'user-feedback.json'),screenshots:shots.length}));if(counts['失败'])process.exitCode=1;
