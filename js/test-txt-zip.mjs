/** ZIP helper 的独立兼容验证：Python zipfile 解压并校验 CRC，不复制 ZIP 生成算法。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {spawnSync} from "node:child_process";

const source = fs.readFileSync(new URL("./txt-zip.js", import.meta.url), "utf8");
const boot = {window:{}}; vm.createContext(boot);
vm.runInContext(source, boot, {filename:"txt-zip.js"});
assert.equal(typeof boot.window.createTxtZipBytes, "function", "加载时不要求 TextEncoder 或 DOM");
const box = {window:{}, TextEncoder}; vm.createContext(box);
vm.runInContext(source, box, {filename:"txt-zip.js"});
const makeZip = box.window.createTxtZipBytes;
const python = `import sys,json,base64,io,zipfile,binascii
payload=json.load(sys.stdin)
data=base64.b64decode(payload['zip'])
with zipfile.ZipFile(io.BytesIO(data),'r') as z:
    assert z.testzip() is None
    actual=[]
    for info in z.infolist():
        content=z.read(info.filename)
        assert info.compress_type == zipfile.ZIP_STORED
        assert info.flag_bits & 0x800
        assert info.CRC == binascii.crc32(content) & 0xffffffff
        actual.append({'name':info.filename,'text':content.decode('utf-8'),'date':info.date_time})
    print(json.dumps(actual,ensure_ascii=False))
`;
function readZip(bytes) {
  const run = spawnSync("python3", ["-c",python], {input:JSON.stringify({zip:Buffer.from(bytes).toString("base64")}),encoding:"utf8",maxBuffer:4*1024*1024});
  assert.equal(run.status,0,run.stderr || run.error?.message);
  return JSON.parse(run.stdout);
}
let passed=0;
function test(label,fn) {fn();passed++;console.log("PASS  "+label);}
test("空 ZIP 可以由标准库打开，包含零文件",()=>{
  const bytes=makeZip([]);
  assert.equal(bytes.length,22);
  assert.deepEqual(readZip(bytes),[]);
});
test("中文文件名、多文件、非 ASCII 文本和空文件原样解压且 CRC 正确",()=>{
  const files=[
    {name:"综合词书_第001份_4000词.txt",text:"alpha\nbeta\n"},
    {name:"综合词书_第002份_2词.txt",text:"café\n你好\n😀\n"},
    {name:"empty.txt",text:""}
  ];
  const actual=readZip(makeZip(files));
  assert.deepEqual(actual.map(({name,text})=>({name,text})),files);
  assert.ok(actual.every(x=>JSON.stringify(x.date)==="[1980,1,1,0,0,0]"));
});
test("内容含换行/空字节且跨 64KB 时，中央目录偏移和大小仍正确",()=>{
  const files=[{name:"large.txt",text:"word\n".repeat(20000)+"\0end\n"},{name:"后续.txt",text:"next\n"}];
  const actual=readZip(makeZip(files));
  assert.deepEqual(actual.map(({name,text})=>({name,text})),files);
});
test("相同输入产生完全一致的字节，并保留 UTF-8 标志",()=>{
  const files=[{name:"第一份.txt",text:"abc\n"}];
  const a=makeZip(files), b=makeZip(files);
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
  const view=new DataView(a.buffer,a.byteOffset,a.byteLength);
  assert.equal(view.getUint32(0,true),0x04034B50);
  assert.equal(view.getUint16(6,true),0x800);
  assert.equal(view.getUint16(8,true),0);
});
test("无效输入、重复或含路径的文件名被拒绝，不生成模糊或危险条目",()=>{
  for(const value of [null,{},[null],[{name:"",text:"a"}],[{name:"a.txt",text:1}],
    [{name:"../a.txt",text:"a"}],[{name:"dir\\a.txt",text:"a"}],[{name:"a\0.txt",text:"a"}],
    [{name:"a.txt",text:"a"},{name:"a.txt",text:"b"}]]) assert.throws(()=>makeZip(value));
  assert.throws(()=>makeZip([{name:"字".repeat(22000),text:"x"}]));
  assert.throws(()=>makeZip(new Array(65536)));
});
console.log(`TXT ZIP 结果：${passed} 通过，0 失败`);
