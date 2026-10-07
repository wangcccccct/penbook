import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root=resolve('release'),plugin=resolve(root,'penbook'),manifest=JSON.parse(await readFile(resolve(plugin,'manifest.json'),'utf8')),pkg=JSON.parse(await readFile('package.json','utf8'));
assert.equal(manifest.version,pkg.version);
const allowed=new Set(['main.js','manifest.json','styles.css','LICENSE','THIRD_PARTY_NOTICES.md','licenses','cmaps','standard_fonts','wasm']);
for(const entry of await readdir(plugin)){assert.ok(allowed.has(entry),`Unexpected release file: ${entry}`);}
for(const required of allowed){assert.ok((await stat(resolve(plugin,required))).size>0,`Empty release entry: ${required}`);}
const archive=execFileSync('zip',['-qr','-','penbook'],{cwd:root,maxBuffer:64*1024*1024});await writeFile(resolve(root,'penbook.zip'),archive);
execFileSync('unzip',['-tq',resolve(root,'penbook.zip')],{stdio:'pipe'});
const entries=execFileSync('unzip',['-Z1',resolve(root,'penbook.zip')],{encoding:'utf8'}).trim().split('\n');
for(const name of ['main.js','manifest.json','styles.css','LICENSE','THIRD_PARTY_NOTICES.md'])assert.ok(entries.includes(`penbook/${name}`));
for(const dir of ['cmaps','standard_fonts','wasm','licenses'])assert.ok(entries.some(path=>path.startsWith(`penbook/${dir}/`)&&!path.endsWith('/')));
const sums=[];for(const path of ['penbook.zip','penbook/main.js','penbook/manifest.json','penbook/styles.css'])sums.push(`${createHash('sha256').update(await readFile(resolve(root,path))).digest('hex')}  ${path.replace('penbook/','')}`);
await writeFile(resolve(root,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log(`Penbook ${manifest.version}: ${entries.length} ZIP entries, ${(archive.length/1024/1024).toFixed(2)} MB, archive integrity checked.`);
