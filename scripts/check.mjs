import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ignore=new Set(['node_modules','.git','data']);

async function walk(dir){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(ignore.has(e.name))continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory())out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

const files=await walk(root);
const secretPatterns=[
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /sb_secret_[A-Za-z0-9_-]{20,}/
];
const bad=[];
for(const f of files){
  const b=await fs.readFile(f);
  if(b.includes(0))continue;
  const s=b.toString('utf8');
  for(const pattern of secretPatterns)if(pattern.test(s))bad.push(`${path.relative(root,f)}: ${pattern}`);
}
if(bad.length){
  console.error('Potential secret material found:\n'+bad.join('\n'));
  process.exit(1);
}
console.log(`Static secret scan: PASS (${files.length} files)`);

const contractDir=path.join(root,'contract');
const registry=JSON.parse(await fs.readFile(path.join(contractDir,'criterion-registry.json'),'utf8'));
const expectedCriteria=Array.from({length:35},(_,i)=>`T04-C${String(i+1).padStart(2,'0')}`);
const actualCriteria=registry.criteria.map((x)=>x.id||x.criterion_id);
if(JSON.stringify(actualCriteria)!==JSON.stringify(expectedCriteria)){
  throw new Error(`criterion registry mismatch: ${JSON.stringify(actualCriteria)}`);
}
console.log('Criterion registry: PASS (T04-C01…T04-C35 exactly once and in order)');

const manifest=JSON.parse(await fs.readFile(path.join(contractDir,'asset-manifest.json'),'utf8'));
if(manifest.hash_algorithm!=='sha256')throw new Error('unsupported contract manifest hash algorithm');
for(const entry of manifest.files){
  const full=path.join(contractDir,entry.path);
  const data=await fs.readFile(full);
  if(data.byteLength!==entry.bytes)throw new Error(`contract byte-size mismatch: ${entry.path}`);
  const digest=crypto.createHash('sha256').update(data).digest('hex');
  if(digest!==entry.sha256)throw new Error(`contract SHA-256 mismatch: ${entry.path}`);
}
console.log(`Official contract integrity: PASS (${manifest.files.length} files match byte sizes and SHA-256)`);
