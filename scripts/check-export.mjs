import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { resolve } from 'node:path';
// Inspect the actual output produced by Obsidian, including rotated PDF pages.
const data=new Uint8Array(await readFile(process.argv[2]));
const pdf=await getDocument({data,standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'}).promise;
if(pdf.numPages!==2)throw new Error('The demo export should contain two pages');
for(let i=1;i<=pdf.numPages;i++){
  const page=await pdf.getPage(i),viewport=page.getViewport({scale:1});
  const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),ctx=canvas.getContext('2d');
  await page.render({canvas,canvasContext:ctx,viewport}).promise;
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let count=0,x=0,y=0;for(let j=0;j<pixels.length;j+=4){if(pixels[j]>100&&pixels[j]>pixels[j+1]*1.4&&pixels[j]>pixels[j+2]*1.4){count++;x+=(j/4)%canvas.width;y+=Math.floor(j/4/canvas.width);}}
  const text=(await page.getTextContent()).items.map(t=>t.str??'').join(' ');
  if(!text.includes('Original PDF text remains searchable'))throw new Error(`Page ${i}: original text missing`);
  if(count<100||x/count<65||x/count>300||y/count<160||y/count>215)throw new Error(`Page ${i}: annotation misplaced (${x/count},${y/count})`);
  console.log(`Page ${i}: text preserved, annotation centroid (${Math.round(x/count)}, ${Math.round(y/count)}), rotation ${page.rotate}`);
}
await pdf.loadingTask.destroy();
