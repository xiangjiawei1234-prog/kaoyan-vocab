#!/usr/bin/env node
/** 用户关键反馈：实际点击工作台关闭按钮/遮罩，而不只检验命中或使用 Esc。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={checks:[],errors:[],shots:[],limits:['独立Chrome；375手机仿真和1440桌面','不等同真机、读屏或其他浏览器验证']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const p=await Page.open(conn,{url:server.url()});
const scene=`JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,days:s.days,proficient:s.proficient,review:s.reviewDay,extra:s.extraDay}})())`;
async function click(selector){await p.send('Page.bringToFront');await p.scrollIntoView(selector);await sleep(180);if(!await p.isClickable(selector))throw Error('不可命中：'+selector);await p.clickSelector(selector);}
async function seed(width){
  await p.waitFor('window.__vocab');await p.setViewport(width,width<500?812:1000,{mobile:width<500});
  await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.proficient={};s.stars={};s.reviewDay={};s.extraDay={};Object.assign(s.settings,{theme:${JSON.stringify(width<500?'dark':'light')},dailyNew:5,groupSize:2,order:'freq',fmin:1,fmax:0,pmin:0,pos:[],kyOnly:false,autoResume:{enabled:false,threshold:5,idleMs:120000,countdownMs:15000}});localStorage.clear();sessionStorage.clear();localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));})()`);
  await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#ok")');await p.send('Page.bringToFront');
  await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');
}
try{
  for(const width of [1440,375])for(const entry of ['btnQuickSettings','btnStudyProfiles'])for(const method of ['button','backdrop','Escape']){
    const name=width+' '+entry+' '+method;await seed(width);const before=await p.eval(scene);
    await click('#'+entry);await p.waitFor('!document.querySelector("#settingsWorkspaceSheet").hidden');
    check(name+' 打开后背景锁定',await p.eval('document.querySelector("#main").inert&&document.querySelector(".top").inert'));
    if(method==='button'){
      await p.eval(`{const e=document.querySelector('#settingsWorkspaceSheet .sheet-panel');e.scrollTop=e.scrollHeight;}`);
      await click('#settingsWorkspaceSheet .sheet-head [data-close]');
    }else if(method==='backdrop'){
      // 遮罩被 panel 覆盖的中心不能算有效点击；使用真正露出的视口左边缘。
      await p.click(2,Math.floor((width<500?812:1000)/2));
    }else await p.key('Escape');
    await sleep(140);
    const closed=await p.eval(`({hidden:document.querySelector('#settingsWorkspaceSheet').hidden,main:document.querySelector('#main').inert,top:document.querySelector('.top').inert,focus:document.activeElement.id})`);
    check(name+' 真正关闭/解锁/回焦点',closed.hidden&&!closed.main&&!closed.top&&closed.focus==='card',closed);
    check(name+' 当前卡、判定、队列和进度保持',before===await p.eval(scene));
    if(!closed.hidden){await p.key('Escape');continue;}
    const qi=await p.eval('window.__vocab.qi');await p.key('Space');
    check(name+' 关闭后键盘翻页立即可用',await p.eval(`window.__vocab.phase==='recall'&&window.__vocab.qi===${qi+1}`));
    if(method==='button')report.shots.push(await p.screenshot('workspace-close-'+width+'-'+entry+'.png'));
  }
  // 文件读取夹具只延迟 File.text；真实change/关闭/重开仍由应用事件处理。
  await click('#btnStudyProfiles');
  await p.eval(`(()=>{const input=document.querySelector('#profilesFile'),file=new File(['{}'],'late.json',{type:'application/json'});file.text=()=>new Promise(resolve=>window.__finishWorkspaceRead=resolve);Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await p.waitFor('typeof window.__finishWorkspaceRead==="function"');
  await click('#settingsWorkspaceSheet .sheet-head [data-close]');
  check('读取文件途中关闭仍释放背景',await p.eval('document.querySelector("#settingsWorkspaceSheet").hidden&&!document.querySelector("#main").inert'));
  await click('#btnQuickSettings');await p.eval('window.__finishWorkspaceRead("{}")');await sleep(150);
  const late=await p.eval(`({quick:!document.querySelector('#workspaceQuick').hidden,preview:document.querySelector('#profilesImportPreview').hidden,message:document.querySelector('#workspaceStatus').textContent})`);
  check('重开后旧异步文件结果不污染新窗口或弹出错误',late.quick&&late.preview&&!late.message,late);
  await click('#settingsWorkspaceSheet .sheet-head [data-close]');
  report.errors=p.errors();check('关闭旅程无console错误',report.errors.length===0,report.errors);
}catch(e){check('关闭旅程执行完整',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/workspace-close.json',JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/workspace-close.json'}));process.exitCode=report.checks.some(x=>!x.ok)?1:0;
