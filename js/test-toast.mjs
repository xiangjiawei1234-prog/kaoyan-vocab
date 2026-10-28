/** P08 普通提示生命周期；受控时钟执行真实app.js，不复制计时/呈现业务逻辑。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const words=fs.readFileSync(new URL('./words-data.js',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8').replace('window.__vocab = {','window.__vocab = { toastForTest: toast, openSheetForToastTest: openSheet, alertForToastTest: showAlert,');
function browser(){
 let now=new Date(2026,9,25,12).getTime(),next=0,document;
 const registry=new Map(),events=new Map(),windowEvents=new Map(),timers=[],storage=new Map();
 const fire=(map,type,event={})=>{const e={type,target:document.body,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...event};for(const fn of map.get(type)||[])fn(e);return e;};
 function element(tag='div'){
  const classes=new Set(),handlers=new Map(),attrs=new Map();
  const e={tagName:tag.toUpperCase(),id:'',style:{setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}},dataset:{},value:'',checked:false,disabled:false,hidden:false,open:false,inert:false,files:[],scrollTop:0,clientHeight:600,clientWidth:800,offsetWidth:100,offsetHeight:44,children:[],parentNode:null,_text:'',
   classList:{add(...n){n.forEach(v=>classes.add(v));},remove(...n){n.forEach(v=>classes.delete(v));},contains:n=>classes.has(n),toggle(n,force){const on=force??!classes.has(n);on?classes.add(n):classes.delete(n);return on;}},
   addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},removeEventListener(){},
   emit(type,ev={}){const event={type,target:e,relatedTarget:null,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...ev};for(const fn of handlers.get(type)||[])fn(event);e['on'+type]?.(event);if(['focusin','focusout','keydown'].includes(type)&&!event.cancelBubble&&e.parentNode)return e.parentNode.emit(type,event);return event;},
   appendChild(c){if(c.parentNode)c.parentNode.removeChild(c);e.children.push(c);c.parentNode=e;if(c.id)registry.set('#'+c.id,c);return c;},
   insertBefore(c,ref){if(!ref)return e.appendChild(c);if(c.parentNode)c.parentNode.removeChild(c);const at=e.children.indexOf(ref);e.children.splice(at<0?e.children.length:at,0,c);c.parentNode=e;return c;},
   removeChild(c){e.children=e.children.filter(x=>x!==c);c.parentNode=null;return c;},remove(){e.parentNode?.removeChild(e);},
   contains(n){return n===e||e.children.some(c=>c.contains?.(n));},
   matches(s){return s.split(',').some(t=>{t=t.trim();if(t===':hover')return !!e.hovered;if(t===':focus-within')return e.contains(document.activeElement);if(t==='.sheet')return classes.has('sheet');if(t.startsWith('#'))return '#'+e.id===t;if(t.startsWith('.'))return classes.has(t.slice(1));if(t==='[hidden]')return e.hidden;if(t==='[inert]')return e.inert;return t.toUpperCase()===e.tagName;});},
   closest(s){for(let n=e;n;n=n.parentNode)if(n.matches?.(s))return n;return null;},
   querySelector(s){if(s==='.sheet-panel'){let p=e.children.find(c=>c.classList.contains('sheet-panel'));if(!p){p=element();p.classList.add('sheet-panel');e.appendChild(p);}return p;}return e.querySelectorAll(s)[0]||null;},
   querySelectorAll(s){const out=[];for(const c of e.children){if(c.matches?.(s))out.push(c);out.push(...(c.querySelectorAll?.(s)||[]));}return out;},
   setAttribute(k,v){attrs.set(k,String(v));if(k==='id'){e.id=String(v);registry.set('#'+v,e);}},getAttribute:k=>attrs.get(k)??null,removeAttribute(k){attrs.delete(k);},
   focus(){const old=document.activeElement;if(old===e)return;document.activeElement=e;old?.emit?.('focusout',{relatedTarget:e});fire(events,'focusout',{target:old||document.body,relatedTarget:e});e.emit('focusin',{relatedTarget:old});fire(events,'focusin',{target:e,relatedTarget:old});},
   blur(){if(document.activeElement!==e)return;document.activeElement=document.body;e.emit('focusout',{relatedTarget:document.body});fire(events,'focusout',{target:e,relatedTarget:document.body});},
   click(){e.onclick?.({target:e,currentTarget:e,detail:1,preventDefault(){},stopPropagation(){}});},
   getBoundingClientRect(){return {left:0,right:100,top:100,bottom:144,width:100,height:44};},getClientRects(){return e.hidden?[]:[e.getBoundingClientRect()];},
   scrollIntoView(){}
  };
  Object.defineProperties(e,{textContent:{get(){return e._text+e.children.map(c=>c.textContent||'').join('');},set(v){e._text=String(v);e.children.forEach(c=>c.parentNode=null);e.children=[];}},innerHTML:{get(){return e._html||'';},set(v){e._html=String(v);}},isConnected:{get(){return e===document?.body||!!e.parentNode?.isConnected;}},firstChild:{get(){return e.children[0]||null;}},nextSibling:{get(){return e.parentNode?.children[e.parentNode.children.indexOf(e)+1]||null;}}});
  return e;
 }
 function query(s){if(s==='.view.on')return views.find(e=>e.classList.contains('on'))||null;if(!registry.has(s)){const e=element(['#q','#settingsSearch','#listViewName'].includes(s)?'input':'div');e.id=s.startsWith('#')?s.slice(1):'';registry.set(s,e);}return registry.get(s);}
 const views=['study','list','stats','set'].map(v=>query('#v-'+v));views[0].classList.add('on');
 const nav=['study','list','stats','set'].map(v=>{const e=element('button');e.dataset.v=v;return e;});
 const keys=['know','dont','next','speak','star','proficient'].map(k=>{const e=element('button');e.dataset.k=k;return e;});
 const queryAll=s=>s==='.view'?views:s==='.nav button'?nav:s==='.keybtn'?keys:[];
 document={querySelector:query,querySelectorAll:queryAll,documentElement:{dataset:{},style:{}},body:element('body'),activeElement:null,visibilityState:'visible',createElement:element,addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},removeEventListener(){}};
 document.activeElement=document.body;
 document.body.appendChild(query('#main'));views.forEach(v=>query('#main').appendChild(v));document.body.appendChild(query('.top'));
 document.body.appendChild(query('#toast'));const dismiss=query('#toastDismiss');dismiss.tagName='BUTTON';dismiss.hidden=true;query('#toast').appendChild(dismiss);
 for(const id of ['helpSheet','bookSheet','wordSheet','settingsWorkspaceSheet','spellingSheet','printSheet','txtSplitSheet','importSheet']){const e=query('#'+id);e.classList.add('sheet');e.hidden=true;document.body.appendChild(e);}
 query('#fst').value='all';query('#fsc').value='scope';query('#appAlert').hidden=true;query('#profFeedback').hidden=true;
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const window={document,innerWidth:1200,innerHeight:800,addEventListener(type,fn){if(!windowEvents.has(type))windowEvents.set(type,[]);windowEvents.get(type).push(fn);},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame(fn){fn();},cancelAnimationFrame(){},getSelection:()=>({toString:()=>''})};
 const context=vm.createContext({window,document,Date:FakeDate,console,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},setTimeout(fn,ms){const t={id:++next,fn,due:now+ms,canceled:false};timers.push(t);return t.id;},clearTimeout(id){const t=timers.find(t=>t.id===id);if(t)t.canceled=true;},setInterval(){return 0;},clearInterval(){},requestAnimationFrame(fn){fn();},cancelAnimationFrame(){},confirm:()=>true,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL(){}},FileReader:class{},SpeechSynthesisUtterance:class{},speechSynthesis:{cancel(){},speak(){}},performance:{now:()=>now},structuredClone:v=>JSON.parse(JSON.stringify(v))});
 vm.runInContext(words,context,{filename:'words-data.js'});vm.runInContext(source,context,{filename:'app.js'});
 const T=window.__vocab;
 return {T,document,query,timers,context,storage,toast:T.toastForTest,
  advance(ms){const end=now+ms;for(;;){const t=timers.filter(t=>!t.canceled&&t.due<=end).sort((a,b)=>a.due-b.due)[0];if(!t)break;now=t.due;t.canceled=true;t.fn();}now=end;},
  hidden(on){document.visibilityState=on?'hidden':'visible';fire(events,'visibilitychange');},
  scroll(){fire(events,'scroll',{target:query('#main')});},
  key(target,key,extra={}){const e=target.emit('keydown',{key,...extra});if(!e.defaultPrevented)fire(events,'keydown',{target,key,...extra});return e;},
  enter(){query('#toast').hovered=true;query('#toast').emit('pointerenter');},
  leave(){query('#toast').hovered=false;query('#toast').emit('pointerleave');},
  visible:()=>query('#toast').classList.contains('on'),
  close:()=>query('#toastDismiss')
 };
}
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.log('FAIL '+name+': '+e.message);}}
const medium='提'.repeat(20),long='长'.repeat(1000);
test('短提示保持2200ms，文本兼容且不自动抢焦点',()=>{const b=browser(),focus=b.document.activeElement;b.toast('已收藏');assert.equal(b.query('#toast').textContent,'已收藏');assert.equal(b.document.activeElement,focus);b.advance(2199);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('20码点长提示2740ms，超过旧2200ms仍可读',()=>{const b=browser();b.toast(medium);b.advance(2200);assert.ok(b.visible());b.advance(539);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('长度按Unicode码点计算且上限8000ms',()=>{const b=browser();b.toast('😀'.repeat(14));b.advance(2200);assert.ok(!b.visible());b.toast(long);b.advance(7999);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('长提示提供可主动收起的44px语义按钮，短提示不增加Tab目标',()=>{const b=browser();b.toast('短');assert.ok(b.close().hidden);b.toast(medium);assert.equal(b.close().hidden,false);assert.equal(b.close().getAttribute('aria-label'),'收起提示');b.close().click();assert.ok(!b.visible());});
test('悬停暂停后仅继续剩余2240ms，不重置整轮',()=>{const b=browser();b.toast(medium);b.advance(500);b.enter();b.advance(10000);assert.ok(b.visible());b.leave();b.advance(2239);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('焦点与悬停同时有效，移出其中一项不会恢复计时',()=>{const b=browser();b.toast(medium);b.advance(500);b.enter();b.close().focus();b.leave();b.advance(10000);assert.ok(b.visible());b.close().blur();b.advance(2239);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('后台暂停、回前台继续剩余，不补记阅读时间',()=>{const b=browser();b.toast(medium);b.advance(200);b.hidden(true);b.advance(60000);assert.ok(b.visible());b.hidden(false);b.advance(2539);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('旧计时回调迟到不能收起新消息',()=>{const b=browser();b.toast(medium);const old=b.timers.filter(t=>!t.canceled).at(-1);b.advance(100);b.toast('新消息');old.fn();assert.ok(b.visible());assert.equal(b.query('#toast').textContent,'新消息');b.advance(2200);assert.ok(!b.visible());});
test('更换长消息保留真实悬停原因，直到离开才开始新计时',()=>{const b=browser();b.toast(medium);b.enter();b.toast('更'.repeat(30));b.advance(10000);assert.ok(b.visible());b.leave();b.advance(3639);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('旧消息暂停前的回调迟到也不能绕过当前暂停',()=>{const b=browser();b.toast(medium);const old=b.timers.filter(t=>!t.canceled).at(-1);b.advance(500);b.enter();old.fn();assert.ok(b.visible());b.leave();b.advance(2240);assert.ok(!b.visible());});
test('后台与悬停组合暂停，只解除其中一项不能开表',()=>{const b=browser();b.toast(medium);b.advance(400);b.enter();b.hidden(true);b.leave();b.advance(50000);assert.ok(b.visible());b.hidden(false);b.advance(2339);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('后台产生新提示不消费其完整阅读余量',()=>{const b=browser();b.hidden(true);b.toast(medium);b.advance(60000);assert.ok(b.visible());b.hidden(false);b.advance(2739);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('新消息替换已聚焦收起按钮时保留焦点，短确认也不留下隐藏焦点',()=>{const b=browser();b.toast(medium);const button=b.close();button.focus();b.toast('新确认');assert.equal(b.close(),button);assert.equal(b.document.activeElement,button);assert.equal(button.hidden,false);b.advance(10000);assert.ok(b.visible());button.blur();b.advance(2199);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('Escape仅在提示获得焦点时收起，候选事件不穿透',()=>{const b=browser();b.toast(medium);b.key(b.document.body,'Escape');assert.ok(b.visible());b.close().focus();b.key(b.close(),'Escape',{isComposing:true,keyCode:229});assert.ok(b.visible());b.key(b.close(),'Escape');assert.ok(!b.visible());assert.equal(b.document.activeElement,b.query('#card'));});
test('组合Escape与重复/Dead/AltGraph事件放行，不抢模态键盘语义',()=>{const b=browser();b.toast(medium);b.close().focus();for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{repeat:true},{keyCode:229},{getModifierState:k=>k==='AltGraph'}]){const e=b.key(b.close(),'Escape',extra);assert.ok(!e.defaultPrevented);assert.ok(b.visible());}b.key(b.close(),'Escape');assert.ok(!b.visible());});
test('模态长提示只挂一份在面板内，不破坏业务状态；关闭不留外部按钮',()=>{const b=browser();b.T.openSheetForToastTest('#spellingSheet');const panel=b.query('#spellingSheet').querySelector('.sheet-panel');b.query('#spellFeedback').textContent='正确：sample';const focus=b.document.activeElement;b.toast(medium);assert.ok(panel.contains(b.query('#toast')));assert.ok(panel.contains(b.close()));assert.equal(b.document.activeElement,focus);assert.equal(b.query('#spellFeedback').textContent,'正确：sample');b.T.closeSheet();assert.ok(!b.visible());assert.equal(b.query('#toast').parentNode,b.document.body);assert.equal(b.document.activeElement,b.query('#card'));});
test('开模态清理原普通提示，不修改持续错误',()=>{const b=browser();b.T.alertForToastTest('保存失败','现有记录保留');b.toast(medium);b.T.openSheetForToastTest('#helpSheet');assert.ok(!b.visible());assert.equal(b.query('#appAlert').hidden,false);assert.equal(b.query('#appAlertTitle').textContent,'保存失败');});
test('普通提示自动结束不收起或改写持续错误',()=>{const b=browser();b.T.alertForToastTest('保存失败','请导出救援备份');b.toast('已收藏');b.advance(2200);assert.ok(!b.visible());assert.equal(b.query('#appAlert').hidden,false);assert.equal(b.query('#appAlertTitle').textContent,'保存失败');assert.equal(b.query('#appAlertBody').textContent,'请导出救援备份');});
test('无完整安全空隙时转主区状态，离屏暂停，滚动可读后沿余量继续且位置锁定',()=>{const b=browser();const rect=(top,bottom)=>()=>({top,bottom,height:bottom-top,left:0,right:100,width:100});b.query('.top').getBoundingClientRect=rect(0,100);b.query('#appAlert').hidden=false;b.query('#appAlert').getBoundingClientRect=rect(100,200);b.query('#acts').getBoundingClientRect=rect(220,800);b.query('#main').getBoundingClientRect=rect(200,800);b.query('#toast').getBoundingClientRect=rect(100,160);b.toast(medium);assert.equal(b.query('#toast').dataset.placement,'context');assert.equal(b.query('#toast').parentNode,b.query('#main'));b.advance(10000);assert.ok(b.visible());b.query('#toast').getBoundingClientRect=rect(260,320);b.scroll();assert.equal(b.query('#toast').dataset.placement,'context');b.advance(2739);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('运行中提示在滚动后转离屏上下文时立刻暂停，空隙全覆盖也不假设整屏可用',()=>{const b=browser();const rect=(top,bottom)=>()=>({top,bottom,height:bottom-top,left:0,right:100,width:100});b.toast(medium);b.advance(500);b.query('.top').getBoundingClientRect=rect(0,800);b.query('#main').getBoundingClientRect=rect(200,800);b.query('#toast').getBoundingClientRect=rect(100,160);b.scroll();assert.equal(b.query('#toast').dataset.placement,'context');b.advance(10000);assert.ok(b.visible());b.query('#toast').getBoundingClientRect=rect(260,320);b.scroll();b.advance(2239);assert.ok(b.visible());b.advance(1);assert.ok(!b.visible());});
test('普通提示不改学习现场、配额、存储或学习活动时刻',()=>{const b=browser();const snap=()=>JSON.stringify({S:b.T.getS(),Q:b.T.Q,cur:b.T.cur,qi:b.T.qi,phase:b.T.phase,answered:b.T.answered,plan:b.T.getPlan(),storage:[...b.storage],study:b.context.window.__vocabStudy.getDebug()});const before=snap();b.toast(medium);b.advance(500);b.enter();b.leave();b.close().click();assert.equal(snap(),before);});
console.log(JSON.stringify({passed,failed}));process.exitCode=failed?1:0;
