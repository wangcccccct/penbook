import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { build } from 'esbuild';
// Use the real renderer/export pipeline with a canvas implementation, independent
// of personal vault contents or UI events. Output is a generated binary artifact.
await build({entryPoints:['src/pdf.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'release/pdf-pipeline.mjs',logLevel:'silent'});
globalThis.document={createElement:tag=>{if(tag!=='canvas')throw new Error(`Unexpected element ${tag}`);return createCanvas(1,1);}};
globalThis.Image=Image;
const {PDFs}=await import('../release/pdf-pipeline.mjs');
await build({entryPoints:['src/render.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'release/renderer.mjs',logLevel:'silent'});
const {Renderer}=await import('../release/renderer.mjs');
const book=JSON.parse(await readFile('release/Penbook PDF 示例.penbook','utf8'));
const sentinel={host:'Obsidian reader'};globalThis.pdfjsWorker=sentinel;
const pdfs=new PDFs(p=>resolve('node_modules/pdfjs-dist',p)+'/' );
const bytes=await pdfs.export(book,book.pages,new Renderer(),'all');
if(globalThis.pdfjsWorker!==sentinel)throw new Error('Host PDF reader global was modified');
await writeFile('release/Penbook PDF regression.pdf',bytes);await pdfs.clear();
console.log('PDF pipeline exported both pages; host reader global preserved.');
