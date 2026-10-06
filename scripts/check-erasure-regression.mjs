import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCanvas, Path2D} from '@napi-rs/canvas';
globalThis.Path2D=Path2D;
const compiled=await build({stdin:{contents:"export {Renderer} from './src/render';export {eraseStroke,splitErasedStroke} from './src/erase';export {stroke,newBook,parseBook} from './src/model';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {Renderer,eraseStroke,splitErasedStroke,stroke,newBook,parseBook}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const renderer=new Renderer();
const pixels=items=>{const canvas=createCanvas(600,600),ctx=canvas.getContext('2d');for(const o of items)renderer.draw(ctx,o);return ctx.getImageData(0,0,600,600).data;};
const world=(o,x,y)=>{const a=o.rotation*Math.PI/180,dx=x*o.w/o.bw-o.w/2,dy=y*o.h/o.bh-o.h/2;return[o.x+o.w/2+dx*Math.cos(a)-dy*Math.sin(a),o.y+o.h/2+dx*Math.sin(a)+dy*Math.cos(a),.5];};
let checked=0;
for(const standard of[false,true])for(const rotation of[0,37,90,173])for(const scale of[[1,1],[1.8,.6],[.6,1.8]])for(const radius of[8,22,45]){
  const o=stroke([[150,250,.5],[350,250,.5]],'#000',24,'ballpoint');o.rotation=rotation;o.w*=scale[0];o.h*=scale[1];
  const outline=renderer.strokeOutline(o),before=pixels([o]),center=world(o,o.bw/2,o.bh/2);
  assert.equal(eraseStroke(o,center,radius,standard,false,outline),false);
  assert(o.frozenInk?.length);assert.equal(o.eraseMasks,undefined);
  const after=pixels([o]);let removed=0;
  for(let y=0;y<600;y++)for(let x=0;x<600;x++){
    const i=(y*600+x)*4+3,d=Math.hypot(x+.5-center[0],y+.5-center[1]);
    if(before[i]>250&&after[i]<220){removed++;assert(d<=radius+2,`outside preview: ${standard}/${rotation}/${scale}/${x},${y}/${before[i]},${after[i]}/${d}`);}
    if(before[i]>250&&d<radius-1.5)assert(after[i]<8,`ink remains inside preview: ${standard}/${rotation}/${scale}/${d}`);
  }
  assert(removed>0);const parts=splitErasedStroke(o,outline);if(radius>=22)assert.equal(parts.length,2);else assert(parts.length>=1);
  const split=pixels(parts);let drift=0;for(let i=3;i<after.length;i+=4)if(Math.abs(after[i]-split[i])>16)drift++;assert(drift<20,`split pixel drift ${drift}`);
  const book=newBook();book.pages[0].items=parts;assert.deepEqual(pixels(parseBook(JSON.stringify(book)).pages[0].items),split);checked++;
}
// A cut inside a filled contour must remain a hole through reload and another cut.
const filled=stroke([[100,100,.5],[300,300,.5]],'#000',12,'ballpoint');filled.frozenInk=[[[0,0],[filled.bw,0],[filled.bw,filled.bh],[0,filled.bh]]];
eraseStroke(filled,world(filled,80,80),15,false,false,renderer.strokeOutline(filled));assert.equal(filled.frozenInk.length,2);
const holeBook=newBook();holeBook.pages[0].items=[filled];const reloaded=parseBook(JSON.stringify(holeBook)).pages[0].items[0];assert.deepEqual(pixels([filled]),pixels([reloaded]));
eraseStroke(reloaded,world(reloaded,140,140),15,false,false,renderer.strokeOutline(reloaded));assert.equal(reloaded.frozenInk.length,3);
console.log(JSON.stringify({pixelCases:checked,holeReload:true,splitReload:true}));
