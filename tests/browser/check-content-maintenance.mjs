#!/usr/bin/env node
/** M03–M06 内容与M07词表切书的真实页面回归；沿用无依赖CDP，不加入默认Node汇总。 */
import fs from 'node:fs';
import {startStaticServer,launchChrome,connect,Page,sleep,RESULTS_DIR} from './cdp.mjs';

const CASES=[
  {id:'M03',word:'resit',books:['cet4','combined'],ph:'ˌriːˈsɪt',
    fm:'第三人称单数 resits；现在分词 resitting；过去式 resat；过去分词 resat',
    ex:'He had to resit the exam because his grade was too low.',src:'自编'},
  {id:'M04',word:'shifty',books:['cet6','combined'],
    meaning:'a. 躲闪的, 显得不诚实的, 变化的',
    ex:'His shifty eyes made the interviewer doubt his story.',src:'自编'},
  {id:'M05',word:'wad',books:['kaoyan','combined'],
    ex:'Please wad the paper into a ball.',src:'自编'},
  {id:'M06',word:'firefight',books:['kaoyan','combined'],pos:'名词',
    ex:'The soldiers took cover during a brief firefight.',src:'自编'},
  {id:'M06-preserved',word:'firefighting',books:['kaoyan','combined'],
    ex:'This deficit is a testament to the effectiveness of modern firefighting, said Kelly Martin, a past president of the International Association of Wildland Fire.',src:'英语一 2026'}
];
const server=await startStaticServer(),chrome=await launchChrome({windowSize:'1440,1000'}),conn=await connect(chrome.wsUrl);
const report={browser:await conn.send('Browser.getVersion'),checks:[],samples:[],shots:[],errors:[],listSwitches:[],
  fixture:'独立临时profile：每例清空本书学习记录，把除目标词外的词在熟练夹具map标1，由真实main组自然配出唯一目标。大量熟练只是测试夹具，不是用户操作或生产数据。不直接改Q/cur/answered，不伪造已完成组；揭示只由真实F判定产生。',
  limits:['Chrome headless only; 375×812/1440×1000 representative widths','Mobile emulation is not a real device','Only the named M03–M06 content and preserved firefighting references; not a full dictionary audit','No audio playback or linguistic evidence validation; dictionary evidence is recorded by the content task']};
const check=(name,ok,actual)=>{report.checks.push({name,ok:!!ok,actual});console.log((ok?'PASS ':'FAIL ')+name);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const learning=`(() => {const v=window.__vocab,s=v.getS();return {book:v.getBook(),cur:v.cur,phase:v.phase,verdict:v.verdict,qi:v.qi,Q:v.Q,total:v.getGroupTotal(),answered:v.answered,plan:v.getPlan(),progress:s.progress,days:s.days,reviewDay:s.reviewDay,extraDay:s.extraDay,drill:v.drillMode,extra:v.isExtraSubgroup(),newOnly:v.isNewOnlySubgroup()};})()`;
let p;
async function shot(name){
  // 等自然切页/入卡动画完成；不改 CSS、不隐藏 toast 或其他真实页面状态。
  await sleep(280);report.shots.push(await p.screenshot('content-maintenance-'+name+'.png'));
}
async function chooseBook(book){
  if(await p.eval('window.__vocab.getBook()')===book)return;
  const before=await p.eval(`({book:window.__vocab.getBook(),list:document.querySelector('#v-list').classList.contains('on'),index:window.__vocab.getListActiveWord(),width:innerWidth})`);
  await p.clickSelector('#btnBooks');await p.waitFor('!document.querySelector("#bookSheet").hidden');
  const button='#bookList [data-book="'+book+'"]';await p.scrollIntoView(button);await p.clickSelector(button);
  await p.waitFor(`window.__vocab.getBook()===${JSON.stringify(book)}&&document.querySelector('#bookSheet').hidden`);
  if(before.list){
    const after=await p.eval(`(() => {const v=window.__vocab;return {book:v.getBook(),count:v.getW().length,index:v.getListActiveWord(),focus:document.activeElement.id,rows:[...document.querySelectorAll('#listInner [data-open-word]')].map(e=>Number(e.dataset.openWord)),stops:document.querySelectorAll('#listInner [tabindex="0"]').length};})()`);
    const high=before.index>=after.count;report.listSwitches.push({before,after,high});
    check('M07 词表切书后目标索引/焦点有效 '+before.book+'→'+book+' '+before.width,
      after.book===book&&(after.index===null||after.index>=0&&after.index<after.count)
      &&after.rows.every(i=>i>=0&&i<after.count)&&after.focus==='btnBooks'
      &&after.stops===(after.rows.length?1:0),{before,after,high});
  }
}
async function seedOnlyTarget(book,word){
  await chooseBook(book);
  const fixture=await p.eval(`(() => {
    const v=window.__vocab,s=JSON.parse(JSON.stringify(v.getS())),words=v.getW(),index=words.findIndex(x=>x.w===${JSON.stringify(word)});
    if(index<0)throw new Error('目标词不存在：'+${JSON.stringify(book+' '+word)});
    const prof=Object.fromEntries(words.filter((x,i)=>i!==index).map(x=>[x.w,1]));
    s.progress={};s.days={};s.proficient=prof;s.stars={};s.timeSec=0;s.spelling={};s.reviewDay={};s.extraDay={};
    Object.assign(s.settings,{theme:'light',fontSize:'standard',fmin:1,fmax:0,pmin:0,pos:[],posMode:'primary',kyOnly:false,order:'freq',dailyNew:1,groupSize:1,dailyReviewCap:100,backlogGuard:true,showPh:true,showEx:true,showFm:true,autoSpk:false,singleCharKeys:true,keys:{know:'f',dont:'j',next:' ',speak:'s',star:'b',proficient:'m'},autoResume:{enabled:false,threshold:1,idleMs:30000,countdownMs:3000}});
    const keys=v.getStorageKeys().books[${JSON.stringify(book)}];
    localStorage.setItem(keys.state,JSON.stringify(s));localStorage.setItem(keys.prof,JSON.stringify(prof));localStorage.removeItem(keys.survey);
    Object.keys(localStorage).filter(k=>k.startsWith('vocab_session_snapshot_')).forEach(k=>localStorage.removeItem(k));
    localStorage.removeItem('vocab_autoresume_pause_v1');localStorage.removeItem('vocab_autoresume_lease_v1');
    localStorage.setItem('vocab_guide_v1',JSON.stringify({version:1,dismissedAt:new Date().toISOString()}));
    return {book:${JSON.stringify(book)},word:${JSON.stringify(word)},index,wordCount:words.length,proficient:Object.keys(prof).length};
  })()`);
  await p.reload();await p.waitFor(`window.__vocab&&window.__vocab.getBook()===${JSON.stringify(book)}&&document.querySelector('#no')`);
  await sleep(100);return fixture;
}
async function content(root){
  return p.eval(`(() => {
    const e=document.querySelector(${JSON.stringify(root)}),ex=e.querySelector('.ex'),clone=ex?.cloneNode(true);
    clone?.querySelectorAll('.src').forEach(x=>x.remove());
    const text=s=>e.querySelector(s)?.textContent.trim()||'';
    const v=window.__vocab,word=${root==='#card'?"text('.word')":"document.querySelector('#wordTitle').textContent.trim()"},raw=v.getW().find(x=>x.w===word);
    return {word,ph:text('.ph'),meaning:text('.mean .sense-dictionary')||text('.mean'),pos:text('.posline')||text('.pos-tag'),fm:text('.fm'),example:clone?.textContent.trim()||'',source:text('.ex .src'),highlight:[...e.querySelectorAll('.ex .ex-current')].map(x=>x.textContent),raw:raw?{ph:raw.ph,p:raw.p,m:raw.m,ex:raw.ex,src:raw.src,fm:raw.fm}:null};
  })()`);
}
function checkContent(label,c,actual){
  if(c.ph)check(label+' 单一主音标及正确屈折',actual.ph==='/'+c.ph+'/'
    &&(actual.ph.match(/\//g)||[]).length===2&&actual.fm.includes(c.fm)
    &&!/\b(?:resiting|resited)\b/.test(actual.fm),actual);
  if(c.meaning)check(label+' 中文义覆盖躲闪语境并保留原义',actual.meaning===c.meaning
    &&actual.meaning.includes('躲闪')&&actual.meaning.includes('显得不诚实')&&actual.meaning.includes('变化的'),actual);
  if(c.pos)check(label+' 主名词词性正确',actual.pos==='名词'&&actual.raw?.p===0,actual);
  const source=c.src==='自编'?'— 自编例句':'— 真题例句 · '+c.src;
  check(label+' 完整例句/来源/目标词形真实渲染',actual.word===c.word&&actual.example===c.ex
    &&actual.source===source&&actual.highlight.includes(c.word)
    &&(c.word!=='wad'||!actual.example.includes('wading'))
    &&(c.word!=='firefight'||!actual.example.includes('firefighting')),actual);
}
async function geometry(label,root){
  const actual=await p.eval(`(() => {const e=document.querySelector(${JSON.stringify(root)}),r=e.getBoundingClientRect(),acts=document.querySelector('#acts').getBoundingClientRect();return {width:innerWidth,height:innerHeight,doc:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,client:e.clientWidth,actsTop:acts.top};})()`);
  const card=root==='#card';
  check(label+' 页面与内容无横向溢出/边界正确',actual.doc<=actual.width+1&&actual.scroll<=actual.client+1
    &&actual.left>=-1&&actual.right<=actual.width+1&&(card?actual.bottom<=actual.actsTop+1:actual.top>=-1&&actual.bottom<=actual.height+1),actual);
}
try{
  p=await Page.open(conn,{url:server.url()});await p.waitFor('window.__vocab&&document.querySelector("#card")');
  for(const width of [375,1440]){
    await p.setViewport(width,width===375?812:1000,{mobile:width===375});
    for(const c of CASES)for(const book of c.books){
      const label=c.id+' '+book+' '+c.word+' '+width;
      const fixture=await seedOnlyTarget(book,c.word),initial=await p.eval(learning);
      check(label+' 熟练夹具由main自然配词且尚未作答',fixture.proficient===fixture.wordCount-1
        &&initial.Q.length===1&&initial.Q[0]===fixture.index&&initial.cur===fixture.index&&initial.total===1
        &&initial.answered===0&&initial.phase==='recall'&&Object.keys(initial.progress).length===0
        &&!initial.drill&&!initial.extra&&!initial.newOnly,fixture);
      if(c.ph){const recall=await content('#card');check(label+' 未揭示卡片主音标正确',recall.ph==='/'+c.ph+'/',recall);}
      await p.key('keyF');await p.waitFor('window.__vocab.phase==="revealed"');
      const judged=await p.eval(learning),counts=Object.values(judged.days).reduce((n,d)=>({n:n.n+(d.n||0),r:n.r+(d.r||0)}),{n:0,r:0});
      check(label+' 仅真实F产生一次主学习判定',judged.answered===1&&judged.verdict===true
        &&Object.keys(judged.progress).length===1&&judged.progress[fixture.index]?.[4]>0
        &&counts.n===1&&counts.r===1&&(judged.reviewDay.used||0)===0,judged);
      if(c.fm){await p.scrollIntoView('#card .answer-extra > summary');await p.clickSelector('#card .answer-extra > summary');}
      const card=await content('#card');checkContent(label+' 卡片',c,card);await geometry(label+' 卡片','#card');
      await p.scrollIntoView(c.fm?'#card .answer-extra':'#card .ex');await shot(c.id+'-'+book+'-'+c.word+'-'+width+'-card');
      const beforeDetails=await p.eval(learning);
      await p.clickSelector('[data-v="list"]');await p.clickSelector('#q');await p.insertText(c.word);
      const row='[data-open-word="'+fixture.index+'"]';await p.waitFor(`document.querySelector(${JSON.stringify(row)})`);
      await p.scrollIntoView(row);await p.clickSelector(row);await p.waitFor('!document.querySelector("#wordSheet").hidden');
      const detail=await content('#wordDetail');checkContent(label+' 详情',c,detail);
      await geometry(label+' 详情','#wordSheet .sheet-panel');
      await p.scrollIntoView(c.fm?'#wordDetail .fm':'#wordDetail .ex');await shot(c.id+'-'+book+'-'+c.word+'-'+width+'-detail');
      await p.key('Escape');await p.waitFor('document.querySelector("#wordSheet").hidden');
      check(label+' 查词详情保持已揭示组与学习记录',same(beforeDetails,await p.eval(learning)));
      report.samples.push({label,fixture,card,detail});
    }
  }
  check('M07 实际覆盖综合高索引切回较短词书',report.listSwitches.some(x=>x.high),report.listSwitches.filter(x=>x.high));
}catch(error){check('内容浏览器检查脚本执行完整',false,String(error.stack||error));}
finally{
  if(p)report.errors=p.errors();check('浏览器无新增console错误',report.errors.length===0,report.errors);
  fs.mkdirSync(RESULTS_DIR,{recursive:true});fs.writeFileSync(RESULTS_DIR+'/content-maintenance.json',JSON.stringify(report,null,2));
  if(p)await p.close();conn.close();await chrome.close();await server.close();
}
console.log(JSON.stringify({passed:report.checks.filter(x=>x.ok).length,failed:report.checks.filter(x=>!x.ok).length,report:RESULTS_DIR+'/content-maintenance.json',screenshots:report.shots.length}));
if(report.checks.some(x=>!x.ok))process.exitCode=1;
