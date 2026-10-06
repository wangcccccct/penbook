import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
const render=await build({entryPoints:['src/render.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {Renderer}=await import('data:text/javascript;base64,'+Buffer.from(render.outputFiles[0].text).toString('base64'));
const renderer=new Renderer();
const compiled=await build({entryPoints:['src/erase-worker.ts'],bundle:true,write:false,format:'iife',platform:'node'});
const worker=new Worker('const {parentPort}=require("node:worker_threads");globalThis.postMessage=data=>parentPort.postMessage(data);parentPort.on("message",data=>globalThis.onmessage({data}));'+compiled.outputFiles[0].text,{eval:true});
const send=job=>new Promise((resolve,reject)=>{const done=result=>{worker.off('error',fail);result.error?reject(new Error(result.error)):resolve(result);},fail=error=>{worker.off('message',done);reject(error);};worker.once('message',done);worker.once('error',fail);worker.postMessage(job)});
try {
  const book=JSON.parse(await readFile(process.argv[2],'utf8'));
  const page=book.pages.find(p=>p.items.some(o=>o.kind==='stroke'));
  const items=page.items.filter(o=>o.kind==='stroke');
  const target=items.filter(o=>o.frozenInk).sort((a,b)=>b.w*b.h-a.w*a.h)[0]??items[0];
  const x=target.x+target.w/2,y=target.y+target.h/2;
  const start=performance.now();
  const result=await send({id:1,session:'real',items:items.map(item=>({item,outline:renderer.strokeOutline(item)})),segments:Array.from({length:16},(_,i)=>({from:[x-40+i*5,y,.5],to:[x-35+i*5,y,.5]})),radius:22,standard:true,whole:false});
  const middle=performance.now();
  const split=await send({id:2,session:'real',items:result.changes.filter(c=>c.items.length).map(c=>({id:c.id})),segments:[],radius:22,standard:true,whole:false,split:true});
  console.log(JSON.stringify({tested:items.length,changes:result.changes.length,dragMs:Math.round(middle-start),releaseMs:Math.round(performance.now()-middle),objects:split.changes.reduce((n,c)=>n+c.items.length,0),error:result.error??split.error}));
  if(process.argv.includes('--stress')){
    let current=structuredClone(items),id=3;const timings=[],releases=[];
    for(let round=0;round<60;round++){
      const target=current[round%current.length],x=target.x+target.w/2,y=target.y+target.h/2,session=`stress-${round}`,start=performance.now();
      const cut=await send({id:id++,session,items:current.map(item=>({item,outline:renderer.strokeOutline(item)})),segments:Array.from({length:16},(_,i)=>({from:[x-40+i*5,y,.5],to:[x-35+i*5,y,.5]})),radius:22,standard:round%2===0,whole:false});timings.push(performance.now()-start);
      const apply=changes=>{const map=new Map(changes.map(c=>[c.id,c.items.map(e=>e.item)]));current=current.flatMap(o=>map.get(o.id)??[o]);};apply(cut.changes);
      const releaseStart=performance.now(),end=await send({id:id++,session,items:current.filter(o=>cut.changes.some(c=>c.id===o.id)).map(o=>({id:o.id})),segments:[],radius:22,standard:false,whole:false,split:true});releases.push(performance.now()-releaseStart);apply(end.changes);current=JSON.parse(JSON.stringify(current));
    }
    timings.sort((a,b)=>a-b);console.log(JSON.stringify({stressRounds:60,dragMedianMs:Math.round(timings[30]),dragMaxMs:Math.round(timings.at(-1)),releaseMaxMs:Math.round(Math.max(...releases)),objects:current.length}));
  }
} finally {await worker.terminate();}
