#!/usr/bin/env node
/** 首次进入时看见真实首词；非模态说明、键盘学习与只提示一次的完整旅程。 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR,REPO_ROOT} from './cdp.mjs';
const files=['index.html','js/app.js','css/app.css','sw.js'];
const fingerprint=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,f))).digest('hex')]));
const report={sources:fingerprint(),checks:[],errors:[],shots:[],limits:['Chrome隔离profile；短屏/大字仿真不等同真机或读屏','只以存储初始化未学记录，实际队列由应用开组；不直接改cur/Q']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl),p=await Page.open(conn,{url:server.url()});
const scene=`JSON.stringify((()=>{const v=window.__vocab,s=v.getS();return {cur:v.cur,Q:v.Q,qi:v.qi,phase:v.phase,verdict:v.verdict,answered:v.answered,plan:v.getPlan(),progress:s.progress,review:s.reviewDay,extra:s.extraDay}})())`;
async function click(s){await p.send('Page.bringToFront');await p.scrollIntoView(s);await sleep(100);await p.clickSelector(s);}
try{
  await p.waitFor('window.__vocab');
  for(const [w,h,large] of [[320,568,false],[320,812,true],[375,667,false],[375,812,true],[1440,900,false]]){
    const name=w+'×'+h+(large?' 深色大字':' 默认');
    await p.setViewport(w,h,{mobile:w<500});
    await p.eval(`(()=>{const s=JSON.parse(JSON.stringify(window.__vocab.getS()));s.progress={};s.days={};s.proficient={};s.stars={};s.reviewDay={};s.extraDay={};Object.assign(s.settings,{fontSize:${large?"'large'":"'standard'"},theme:${large?"'dark'":"'light'"},dailyNew:20,groupSize:30,order:'shuffle',pmin:2,fmin:1,fmax:0,pos:[],kyOnly:false,autoSpk:false});localStorage.clear();sessionStorage.clear();${large?"localStorage.setItem('kaoyan_vocab_v1',JSON.stringify(s));localStorage.setItem('kaoyan_vocab_proficient_v1','{}');":""}})()`);
    await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#card .word")');await p.send('Page.bringToFront');await sleep(200);
    const g=await p.eval(`(()=>{const r=s=>{const e=document.querySelector(s),x=e.getBoundingClientRect();return {top:x.top,bottom:x.bottom,width:x.width,height:x.height};};return {word:r('#card .word'),main:r('#main'),header:r('.top'),banner:r('#guideBanner'),stat:r('.stat-line'),toolbar:r('.drill-bar'),width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,mainInert:document.querySelector('#main').inert,guideVisible:!document.querySelector('#guideBanner').hidden,modal:[...document.querySelectorAll('.sheet')].some(x=>!x.hidden),outside:!document.querySelector('#main').contains(document.querySelector('#guideBanner'))};})()`);
    check(name+' 首词完整出现在可见主区，无需先关闭引导或滚动',g.word.top>=g.main.top-1&&g.word.bottom<=Math.min(g.height,g.main.bottom)+1,g);
    check(name+' 引导非模态、主区可用、无横向溢出',g.guideVisible&&!g.modal&&!g.mainInert&&g.outside&&g.doc<=w+1,g);
    report.shots.push(await p.screenshot('first-use-'+w+'x'+h+(large?'-large':'')+'.png'));
    await p.key('keyF');check(name+' 引导显示时F立即判定',await p.eval('window.__vocab.phase==="revealed"&&window.__vocab.verdict===true'));
    await p.key('Space');check(name+' 引导显示时空格立即翻页',await p.eval('window.__vocab.phase==="recall"&&window.__vocab.answered===1'));
    const before=await p.eval(scene);await click('#guideBannerOpen');await p.waitFor('!document.querySelector("#guideSheet").hidden');
    const guide=await p.eval(`({text:document.querySelector('#guideSheet').textContent,banner:document.querySelector('#guideBanner').hidden,independent:!!localStorage.getItem('vocab_guide_v1')})`);
    check(name+' 简短提示仍可一次打开完整规则且不改本组',guide.banner&&guide.independent&&['词书','每日','范围','全书','熟练','备份'].every(k=>guide.text.includes(k))&&before===await p.eval(scene),guide);
    await p.key('Escape');check(name+' 关闭说明回词卡，背景已解锁',await p.eval('document.querySelector("#guideSheet").hidden&&!document.querySelector("#main").inert&&document.activeElement.id==="card"'));
    await p.reload();await p.waitFor('window.__vocab&&document.querySelector("#card")');
    check(name+' 看过说明后刷新不再显示首次提示',await p.eval('document.querySelector("#guideBanner").hidden'));
  }
  report.errors=p.errors();check('首次使用旅程无浏览器异常',report.errors.length===0,report.errors);
  report.sourcesAfter=fingerprint();check('取证期间运行时字节一致',JSON.stringify(report.sources)===JSON.stringify(report.sourcesAfter));
}catch(e){check('首次使用旅程执行完整',false,String(e.stack||e));}
finally{fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/first-use.json',JSON.stringify(report,null,2));await p.close();conn.close();await chrome.close();await server.close();}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/first-use.json',screenshots:report.shots.length}));process.exitCode=report.checks.some(x=>!x.ok)?1:0;
