import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createCanvas, Image, Path2D, DOMMatrix, loadImage } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFDict, PDFHexString, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

await build({entryPoints:['scripts/next-version-api.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'release/next-version-api.mjs',logLevel:'silent',plugins:[{name:'worker-source',setup(b){b.onResolve({filter:/pdf\.worker\.mjs$/},args=>({path:resolve('node_modules',args.path),namespace:'worker-source'}));b.onLoad({filter:/.*/,namespace:'worker-source'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));}}]});
const canvas=(w=1,h=1)=>{const c=createCanvas(w,h);c.toBlob=callback=>callback(new Blob([c.toBuffer('image/png')]));return c;};
Object.assign(globalThis,{Image,Path2D,DOMMatrix,document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas();}}});
const api=await import('../release/next-version-api.mjs');
const renderer=new api.Renderer(),pdfs=new api.PDFs(p=>resolve('node_modules/pdfjs-dist',p)+'/');
pdfs.document=(key,book)=>{let p=pdfs.docs.get(key);if(!p){p=getDocument({data:api.decode(book.resources[key].data),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'}).promise;pdfs.docs.set(key,p);}return p;};
const native=await PDFDocument.create(),font=await native.embedFont(StandardFonts.Helvetica);
for(const rotation of [0,90,180,270]){
  const p=native.addPage([400,300]);p.setRotation(degrees(rotation));p.drawText('Original PDF searchable text',{x:30,y:270,size:12,font});p.drawRectangle({x:15,y:15,width:20,height:20,color:rgb(0,0,1)});
  const ap=native.context.register(native.context.flateStream('0 1 0 RG 3 w 50 150 80 60 re S',{Type:'XObject',Subtype:'Form',BBox:[48,148,132,212]}));
  p.node.addAnnot(native.context.register(native.context.obj({Type:'Annot',Subtype:'Square',Rect:[48,148,132,212],C:[0,1,0],BS:{W:3},Contents:PDFHexString.fromText('editable square'),AP:{N:ap}})));
  p.node.addAnnot(native.context.register(native.context.obj({Type:'Annot',Subtype:'Ink',Rect:[40,60,140,100],C:[1,0,0],BS:{W:5},InkList:[[40,80,90,100,140,80]],Contents:PDFHexString.fromText('native ink')})));
}
const sourcePages=native.getPages();sourcePages[0].node.addAnnot(native.context.register(native.context.obj({Type:'Annot',Subtype:'Link',Rect:[30,240,200,260],Border:[0,0,0],Dest:[sourcePages[1].ref,PDFName.of('Fit')]})));
const root=native.context.nextRef(),first=native.context.nextRef(),child=native.context.nextRef();
native.context.assign(root,native.context.obj({Type:'Outlines',First:first,Last:first,Count:2}));
native.context.assign(first,native.context.obj({Title:PDFHexString.fromText('Chapter 1'),Parent:root,Dest:[sourcePages[0].ref,PDFName.of('Fit')],First:child,Last:child,Count:1}));
native.context.assign(child,native.context.obj({Title:PDFHexString.fromText('Section 1.1'),Parent:first,Dest:[sourcePages[1].ref,PDFName.of('Fit')]}));native.catalog.set(PDFName.of('Outlines'),root);
const sourceBytes=await native.save(),book=api.newBook('Version regression');book.resources.source={type:'pdf',name:'fixture.pdf',mime:'application/pdf',data:api.encode(sourceBytes)};
const sourceDoc=await pdfs.document('source',book);book.pages=await api.importPdfPages(sourceDoc,'source','fixture.pdf',book);
console.log('Imported native PDF fixture.');
assert.equal(book.pages.length,4);assert.equal(book.pages[0].pdfLinks[0].page,book.pages[1].id);assert.equal(book.pages[1].pdfBookmarks[0].level,1);
assert.ok(book.pages.every(p=>p.items.length===2&&p.pdfText.includes('Original PDF searchable text')));
const merged=api.newBook(),copies=api.copyPages(book.pages,book,merged);assert.equal(copies[0].pdfLinks[0].page,copies[1].id);assert.equal(Object.keys(merged.resources).length,1);assert.equal(merged.resources[copies[0].background.resource].data,book.resources.source.data);
const single=api.copyPages([book.pages[0]],book,api.newBook(),id=>`obsidian://penbook?page=${id}`)[0];assert.equal(single.pdfLinks[0].page,undefined);assert.ok(single.pdfLinks[0].url.includes(book.pages[1].id));
const table={...api.item('table',170,80,180,110,'#222222'),rows:2,columns:2,cells:[['A&B','中文'],['Line 1\nLine 2','<>']],fontSize:14};book.pages[0].items.push(table);
const tape={...api.item('tape',200,210,100,25,'#e79757'),points:[[0,12,.5],[100,12,.5]],width:24};book.pages[0].items.push(tape);
const clip=api.selectionClipboard([table],book),other=api.newBook();other.pages[0].items=api.pasteItems(clip,other);assert.notEqual(other.pages[0].items[0].id,table.id);assert.deepEqual(other.pages[0].items[0].cells,table.cells);other.pages[0].items[0].cells[0][0]='different';assert.equal(table.cells[0][0],'A&B');
assert.deepEqual(api.parseBook(JSON.stringify(book)).pages[0].items.find(o=>o.kind==='table').cells,table.cells);
for(const size of [0,1,2,3,32765,32766,32767,65537]){const bytes=Uint8Array.from({length:size},(_,i)=>i%256);assert.deepEqual(api.decode(api.encode(bytes)),bytes);}
const measurement=canvas().getContext('2d'),svg=`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">${api.itemSvg(table,book,renderer,measurement,'table')}${api.itemSvg(tape,book,renderer,measurement,'tape')}</svg>`;
assert.ok(!svg.includes('<image'));assert.ok(svg.includes('A&amp;B'));assert.ok(svg.includes('<text'));await loadImage(Buffer.from(svg));await writeFile('release/next-version-objects.svg',svg);console.log('Generated and rendered vector SVG.');
const frozen={...api.item('stroke',0,0,100,100,'#000000'),pen:'ballpoint',points:[[0,50,.5],[100,50,.5]],frozenInk:[[[0,0],[100,0],[100,100],[0,100]],[[30,30],[70,30],[70,70],[30,70]]]};
const holeSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${api.itemSvg(frozen,book,renderer,measurement,'hole')}</svg>`,holeCanvas=canvas(100,100);holeCanvas.getContext('2d').drawImage(await loadImage(Buffer.from(holeSvg)),0,0);assert.equal(holeCanvas.getContext('2d').getImageData(50,50,1,1).data[3],0);assert.equal(holeCanvas.getContext('2d').getImageData(10,10,1,1).data[3],255);
const picture=canvas(40,20);picture.getContext('2d').fillStyle='#4455ff';picture.getContext('2d').fillRect(0,0,40,20);book.resources.picture={type:'image',mime:'image/png',name:'fixture.png',data:api.encode(picture.toBuffer('image/png'))};
const imageItem={...api.item('image',180,120,50,30),resource:'picture',crop:{x:.1,y:.1,w:.8,h:.8}};book.pages[1].items.push(imageItem);const imagePaste=api.pasteItems(api.selectionClipboard([imageItem],book),other)[0];assert.equal(other.resources[imagePaste.resource].data,book.resources.picture.data);
for(const page of book.pages)api.cropPage(page,10,20,page.width-40,page.height-50);
const output=await pdfs.export(book,book.pages,renderer,'all');await writeFile('release/next-version-regression.pdf',output);
console.log('Exported editable PDF annotations.');
const exported=await getDocument({data:output.slice(),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'}).promise;
console.log('Loaded exported PDF.');
for(let i=0;i<4;i++){
  const p=await exported.getPage(i+1),vp=p.getViewport({scale:1}),expected=book.pages[i];assert.equal(vp.width,expected.width);assert.equal(vp.height,expected.height);
  const annotations=await p.getAnnotations();assert.equal(annotations.filter(a=>a.annotationType===15).length,1);assert.ok((await p.getTextContent()).items.map(t=>t.str??'').join(' ').includes('Original PDF searchable text'));
  console.log(`Rendering page ${i+1}, ${annotations.length} annotations.`);const c=canvas(Math.ceil(vp.width),Math.ceil(vp.height));await p.render({canvas:c,canvasContext:c.getContext('2d'),viewport:vp}).promise;await writeFile(`release/next-version-page-${i+1}.png`,c.toBuffer('image/png'));
  const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let red=0,green=0;for(let j=0;j<pixels.length;j+=4){if(pixels[j]>150&&pixels[j+1]<100&&pixels[j+2]<100)red++;if(pixels[j+1]>100&&pixels[j]<100&&pixels[j+2]<100)green++;}assert.ok(red>100&&green>100,`rotated page ${i+1} lost annotations (${red}, ${green})`);
  const expectedCanvas=await pdfs.canvas(expected,book,renderer,1),expectedPixels=expectedCanvas.getContext('2d').getImageData(0,0,c.width,c.height).data;
  let differing=0;for(let j=0;j<pixels.length;j+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(pixels[j+k]-expectedPixels[j+k])))>64)differing++;
  assert.ok(differing/(c.width*c.height)<.03,`page ${i+1}: PDF/canvas mismatch ${differing/(c.width*c.height)}`);expectedCanvas.width=expectedCanvas.height=1;
}
assert.equal((await exported.getOutline())[0].items[0].title,'Section 1.1');
const roundTrip=api.newBook(),roundPages=await api.importPdfPages(exported,'output','output.pdf',roundTrip);assert.deepEqual(roundPages[0].items.find(o=>o.kind==='table').cells,table.cells);assert.equal(roundPages[0].items.filter(o=>o.kind==='table').length,1);
const restoredImage=roundPages[1].items.find(o=>o.kind==='image');assert.deepEqual(restoredImage.crop,imageItem.crop);assert.equal(roundTrip.resources[restoredImage.resource].data,book.resources.picture.data);
// A third-party editor can change geometry/color without changing Rect or Contents.
const edited=await PDFDocument.load(output),inkDict=edited.getPage(0).node.Annots().asArray().map(ref=>edited.context.lookup(ref)).find(d=>d instanceof PDFDict&&d.get(PDFName.of('Subtype'))===PDFName.of('Ink'));
inkDict.set(PDFName.of('C'),edited.context.obj([0,0,1]));inkDict.set(PDFName.of('InkList'),edited.context.obj([[40,80,90,90,140,80]]));
const editedDoc=await getDocument({data:await edited.save(),standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts')+'/'}).promise,editedPages=await api.importPdfPages(editedDoc,'edited','edited.pdf',api.newBook());
const editedInk=editedPages[0].items.find(o=>o.kind==='stroke');assert.equal(editedInk.color,'#0000ff');assert.equal(editedInk.points[1][1]-editedInk.points[0][1],-10);await editedDoc.loadingTask.destroy();
// Deleting imported objects must remove their original PDF annotation too.
const removed=structuredClone(book);removed.pages[0].items=[];const deleted=await pdfs.export(removed,[removed.pages[0]],renderer,'all'),deletedDoc=await getDocument({data:deleted}).promise;assert.equal((await(await deletedDoc.getPage(1)).getAnnotations()).filter(a=>a.annotationType!==2).length,0);
await deletedDoc.loadingTask.destroy();await exported.loadingTask.destroy();await pdfs.clear();
console.log('PASS: editable tables, shared clipboard, vector SVG, native PDF annotations, deletion, links, bookmarks, cropped pages at 0/90/180/270°, searchable text, and PDF round-trip.');

if(process.argv.includes('--large')){
  const source=Buffer.from(sourceBytes),marker=source.lastIndexOf('startxref'),padding=Buffer.alloc(151*1024*1024,32);padding[0]=37;padding[padding.length-1]=10;
  const bytes=Buffer.concat([source.subarray(0,marker),padding,source.subarray(marker)]);
  const largeBook=api.newBook();largeBook.resources.source={type:'pdf',name:'missing-original.pdf',mime:'application/pdf',data:api.encode(bytes),size:bytes.length};largeBook.resources.picture=book.resources.picture;largeBook.pages=structuredClone(book.pages);
  // Only the notebook is written: there is no source PDF on disk to fall back to.
  await writeFile('release/embedded-pdf-regression.penbook',JSON.stringify(largeBook));
  const reopened=api.parseBook(await readFile('release/embedded-pdf-regression.penbook','utf8'));
  const digest=value=>createHash('sha256').update(value).digest('hex');
  assert.equal(digest(api.decode(reopened.resources.source.data)),digest(bytes));assert.equal(reopened.resources.source.path,undefined);
  const largePdfs=new api.PDFs(p=>p),start=performance.now(),result=await largePdfs.export(reopened,reopened.pages,renderer,'all');
  const check=await PDFDocument.load(result);assert.equal(check.getPageCount(),4);console.log(`PASS: ${(bytes.length/1024/1024).toFixed(1)} MB embedded PDF: notebook save/reopen preserves original bytes without a source file; ${(performance.now()-start).toFixed(0)} ms export.`);await largePdfs.clear();
}
