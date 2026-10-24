#!/usr/bin/env node
/** O1 两页真实表单交错；延后 storage 通知模拟已写入但尚未送达的远端更新。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={checks:[],errors:[],shots:[],limits:['独立Chrome两同源页面','只延后storage事件，不伪造业务状态或改写提交函数','不宣称localStorage有跨页CAS或锁']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const key='vocab_device_preferences_v1';
async function ready(p){await p.waitFor('window.__vocab && window.__vocab.getPreferenceOwnership().usable');}
async function click(p,s){await p.send('Page.bringToFront');await p.scrollIntoView(s);await sleep(140);if(!await p.isClickable(s))throw Error('不可点击：'+s);await p.clickSelector(s);await sleep(100);}
async function pair(){
  const a=await Page.open(conn,{url:server.url()});await ready(a);
  await a.eval(`localStorage.clear();sessionStorage.clear();localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));`);
  await a.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__holdPreferenceEvents=false;window.addEventListener('storage',e=>{if(window.__holdPreferenceEvents&&e.key===${JSON.stringify(key)})e.stopImmediatePropagation()},true);`});
  await a.reload();await ready(a);
  const b=await Page.open(conn,{url:server.url()});await ready(b);
  await b.eval(`sessionStorage.setItem('vocab_page_book_v1','cet4')`);await b.reload();await ready(b);
  await click(a,'[data-v="set"]');await click(b,'[data-v="set"]');
  return {a,b};
}
const raw=p=>p.eval(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
const scene=p=>p.eval(`JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,Q:v.Q,phase:v.phase,qi:v.qi,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,days:s.days,review:s.reviewDay,extra:s.extraDay,prof:s.proficient}})())`);
async function close({a,b}){report.errors.push(...a.errors(),...b.errors());await a.close();await b.close();}
try{
  let p=await pair();
  try{
    const before=await scene(p.a);
    await click(p.b,'[data-theme="dark"]');
    await p.a.waitFor(`window.__vocab.getS().settings.theme==='dark'`);
    check('正常设备偏好通知同步到另一书，现场不重建',before===await scene(p.a));
    check('两页各自保持词书',(await p.a.eval('window.__vocab.getBook()'))==='kaoyan'&&(await p.b.eval('window.__vocab.getBook()'))==='cet4');
  }finally{await close(p);}
  p=await pair();
  try{
    const before=await scene(p.a);await p.a.eval('window.__holdPreferenceEvents=true');
    await click(p.b,'[data-font-size="large"]');
    check('已写入的远端值与尚未收到通知的本页快照确实不同',(await raw(p.a)).shared.fontSize==='large'&&(await p.a.eval('window.__vocab.getS().settings.fontSize'))==='standard');
    await click(p.a,'[data-theme="dark"]');
    const stored=await raw(p.a);
    check('不同字段交错提交合并最新值，不覆盖远端字号',stored.shared.theme==='dark'&&stored.shared.fontSize==='large',stored.shared);
    check('交错表单提交不重建本组或改学习进度',before===await scene(p.a));
  }finally{await close(p);}
  p=await pair();
  try{
    const before=await scene(p.a);await p.a.eval('window.__holdPreferenceEvents=true');
    await click(p.b,'[data-theme="auto"]');
    check('同字段竞争前置：远端auto、本页仍light',(await raw(p.a)).shared.theme==='auto'&&(await p.a.eval('window.__vocab.getS().settings.theme'))==='light');
    await click(p.a,'[data-theme="dark"]');
    const stored=await raw(p.a),ui=await p.a.eval(`({theme:window.__vocab.getS().settings.theme,notice:[document.querySelector('#toast')?.textContent,document.querySelector('#appAlertBody')?.textContent].join(' ')})`);
    check('同字段远端已改时拒绝旧基线提交并解释，不静默覆盖设备值',stored.shared.theme==='auto'&&/另一|冲突|同步|更新/.test(ui.notice),{stored:stored.shared.theme,ui});
    check('同字段冲突不影响学习现场',before===await scene(p.a));
    report.shots.push(await p.a.screenshot('preference-concurrency-same-field.png'));
  }finally{await close(p);}
  check('真实双页交错无console错误',report.errors.length===0,report.errors);
}catch(e){check('交错旅程执行完整',false,{error:String(e),stack:e.stack});}
finally{
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/preference-concurrency.json',JSON.stringify(report,null,2));
  await conn.close();await chrome.close();await server.close();
}
const passed=report.checks.filter(x=>x.ok).length,failed=report.checks.length-passed;
console.log(JSON.stringify({passed,failed,report:RESULTS_DIR+'/preference-concurrency.json'}));process.exitCode=failed?1:0;
