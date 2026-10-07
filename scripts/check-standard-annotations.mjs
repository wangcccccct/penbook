import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { createCanvas, Image, Path2D, DOMMatrix } from '@napi-rs/canvas';
import { PDFDocument, PDFDict, PDFName, PDFHexString, PDFString, PDFNumber, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

await build({entryPoints:['scripts/next-version-api.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'release/annotation-api.mjs',logLevel:'silent',plugins:[{name:'worker',setup(b){b.onResolve({filter:/pdf\.worker\.mjs$/},a=>({path:resolve('node_modules',a.path),namespace:'worker'}));b.onLoad({filter:/.*/,namespace:'worker'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}}]});
const canvas=(w=1,h=1)=>{const c=createCanvas(w,h);c.toBlob=callback=>callback(new Blob([c.toBuffer('image/png')]));return c;};
Object.assign(globalThis,{Image,Path2D,DOMMatrix,document:{createElement:()=>canvas()}});
const api=await import('../release/annotation-api.mjs'),renderer=new api.Renderer(),pdfs=new api.PDFs(p=>p),fonts=resolve('node_modules/pdfjs-dist/standard_fonts')+'/';
pdfs.document=(key,book)=>{let p=pdfs.docs.get(key);if(!p){p=getDocument({data:api.decode(book.resources[key].data),standardFontDataUrl:fonts}).promise;pdfs.docs.set(key,p);}return p;};
const source=await PDFDocument.create(),types=['Text','FreeText','Line','Square','Circle','Polygon','PolyLine','Highlight','Underline','Squiggly','StrikeOut','Stamp','Caret','Ink','FileAttachment','Sound','Movie','Screen','PrinterMark','TrapNet','Watermark','3D','Redact','Projection','RichMedia','Widget'];
for(const rotation of[0,90,180,270]){
  const p=source.addPage([700,850]);p.setRotation(degrees(rotation));
  for(let i=0;i<types.length;i++){
    const subtype=types[i],x=20+(i%4)*165,y=780-Math.floor(i/4)*100,rect=[x,y,x+120,y+40],extra={};
    if(['Line','PolyLine'].includes(subtype))extra.LE=['ClosedArrow','OpenArrow'];
    if(subtype==='Line')extra.L=[x+5,y+5,x+115,y+35];
    if(['Polygon','PolyLine'].includes(subtype))extra.Vertices=[x+5,y+5,x+60,y+35,x+115,y+5];
    if(['Highlight','Underline','Squiggly','StrikeOut','Redact'].includes(subtype))extra.QuadPoints=[x,y+40,x+120,y+40,x,y,x+120,y];
    if(subtype==='Ink')extra.InkList=[[x+5,y+5,x+60,y+35,x+115,y+5]];
    if(subtype==='FreeText')extra.DA=PDFString.of('/Helv 12 Tf 0 0 1 rg');
    if(subtype==='Text')extra.Name='Comment';
    if(subtype==='Stamp')extra.Name='Approved';
    if(subtype==='FileAttachment'){
      const stream=source.context.register(source.context.flateStream(new TextEncoder().encode('embedded attachment survives export'),{Type:'EmbeddedFile',Subtype:'text/plain'}));extra.FS=source.context.register(source.context.obj({Type:'Filespec',F:PDFString.of('proof.txt'),UF:PDFHexString.fromText('proof.txt'),EF:{F:stream}}));extra.Name='PushPin';
    }
    if(subtype==='Widget'){extra.FT='Tx';extra.T=PDFHexString.fromText(`field-${rotation}`);extra.V=PDFHexString.fromText('kept field value');extra.DA=PDFString.of('/Helv 12 Tf 0 0 0 rg');}
    const appearance=!['Ink','Highlight','Underline','Squiggly','StrikeOut'].includes(subtype)?source.context.register(source.context.flateStream('0.15 0.45 0.75 rg 0 0 120 40 re f 1 1 1 RG 2 w 5 5 m 115 35 l S',{Type:'XObject',Subtype:'Form',BBox:[0,0,120,40]})):undefined;
    const d=source.context.obj({Type:'Annot',Subtype:subtype,P:p.ref,Rect:rect,F:4,C:[0.2,0.3,0.8],CA:.6,BS:{W:2},Contents:PDFHexString.fromText(`${subtype} 中文备注`),T:PDFHexString.fromText('Author'),Subj:PDFHexString.fromText('Subject'),...(appearance?{AP:{N:appearance}}:{}),...extra}),ref=source.context.register(d);p.node.addAnnot(ref);
    if(subtype==='Text'){const popup=source.context.register(source.context.obj({Type:'Annot',Subtype:'Popup',P:p.ref,Parent:ref,Rect:[x+125,y,x+155,y+50],Open:true}));d.set(PDFName.of('Popup'),popup);p.node.addAnnot(popup);}
  }
  const reply=source.context.register(source.context.obj({Type:'Annot',Subtype:'Text',P:p.ref,Rect:[360,60,390,90],F:4,Contents:PDFHexString.fromText('reply comment'),IRT:p.node.Annots().asArray()[0],RT:'R'}));p.node.addAnnot(reply);
  const parent=source.context.register(source.context.obj({FT:'Btn',Ff:32768,T:PDFHexString.fromText(`radio-${rotation}`),V:'Choice1'})),kids=[];
  for(let j=0;j<2;j++){
    const ap=source.context.register(source.context.flateStream(`${j?.7:.2} 0.3 0.8 rg 0 0 30 30 re f`,{Type:'XObject',Subtype:'Form',BBox:[0,0,30,30]})),state=j?'Choice2':'Choice1',ref=source.context.register(source.context.obj({Type:'Annot',Subtype:'Widget',P:p.ref,Parent:parent,Rect:[20+j*60,60,50+j*60,90],AS:j?'Off':state,AP:{N:{[state]:ap,Off:ap}}}));kids.push(ref);p.node.addAnnot(ref);
  }
  source.context.lookup(parent,PDFDict).set(PDFName.of('Kids'),source.context.obj(kids));
  const hiddenParent=source.context.register(source.context.obj({FT:'Tx',T:PDFHexString.fromText(`hidden-${rotation}`),V:PDFHexString.fromText('hidden value')})),hidden=source.context.register(source.context.obj({Type:'Annot',Subtype:'Widget',P:p.ref,Parent:hiddenParent,Rect:[500,60,620,90],F:2}));source.context.lookup(hiddenParent,PDFDict).set(PDFName.of('Kids'),source.context.obj([hidden]));p.node.addAnnot(hidden);
}
const bytes=await source.save(),book=api.newBook('Annotation coverage');book.resources.source={type:'pdf',mime:'application/pdf',name:'annotations.pdf',data:api.encode(bytes)};
const doc=await pdfs.document('source',book);book.pages=await api.importPdfPages(doc,'source','annotations.pdf',book);
for(const page of book.pages){const present=new Set(page.items.map(o=>o.pdfNative?.subtype??o.pdfMarkup?.subtype));assert.deepEqual([...present].sort(),types.slice().sort());}
const output=await pdfs.export(book,book.pages,renderer,'all');await writeFile('release/standard-annotations.pdf',output);
const out=await PDFDocument.load(output),parsed=await getDocument({data:output.slice(),standardFontDataUrl:fonts}).promise;
for(let i=0;i<4;i++){
  const dictionaries=out.getPage(i).node.Annots().asArray().map(r=>out.context.lookup(r,PDFDict)),subtypes=dictionaries.map(d=>d.get(PDFName.of('Subtype')).decodeText());assert.deepEqual([...new Set(subtypes)].sort(),[...types,'Popup'].sort());
  const file=dictionaries.find(d=>d.get(PDFName.of('Subtype'))===PDFName.of('FileAttachment')),fs=file.lookup(PDFName.of('FS'),PDFDict);assert.equal(fs.lookup(PDFName.of('UF'),PDFHexString).decodeText(),'proof.txt');const embedded=out.context.lookup(fs.lookup(PDFName.of('EF'),PDFDict).get(PDFName.of('F')));assert.equal(inflateSync(embedded.getContents()).toString(),'embedded attachment survives export');
  const widget=dictionaries.find(d=>d.get(PDFName.of('Subtype'))===PDFName.of('Widget')&&d.lookup(PDFName.of('Parent'),PDFDict).lookupMaybe(PDFName.of('T'),PDFHexString)?.decodeText()===`field-${i*90}`);assert.equal(widget.lookup(PDFName.of('Parent'),PDFDict).lookup(PDFName.of('V'),PDFHexString).decodeText(),'kept field value');
  const popup=dictionaries.find(d=>d.get(PDFName.of('Subtype'))===PDFName.of('Popup'));assert.ok(dictionaries.includes(out.context.lookup(popup.get(PDFName.of('Parent')))));
  const p=await parsed.getPage(i+1),vp=p.getViewport({scale:1}),actual=canvas(vp.width,vp.height);await p.render({canvas:actual,canvasContext:actual.getContext('2d'),viewport:vp}).promise;
  const expected=await pdfs.canvas(book.pages[i],book,renderer,1),a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=expected.getContext('2d').getImageData(0,0,actual.width,actual.height).data;let difference=0;for(let j=0;j<a.length;j+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(a[j+k]-b[j+k])))>64)difference++;
  assert.ok(difference/(actual.width*actual.height)<.02,`rotation ${i*90}: appearance mismatch ${difference/(actual.width*actual.height)}`);expected.width=expected.height=1;
}
const fields=out.catalog.lookup(PDFName.of('AcroForm'),PDFDict).lookup(PDFName.of('Fields'));assert.equal(fields.size(),12);const roots=fields.asArray().map(ref=>out.context.lookup(ref,PDFDict));assert.equal(roots.find(d=>d.lookup(PDFName.of('T'),PDFHexString).decodeText()==='radio-0').lookup(PDFName.of('Kids')).size(),2);assert.equal(roots.find(d=>d.lookup(PDFName.of('T'),PDFHexString).decodeText()==='hidden-0').lookup(PDFName.of('V'),PDFHexString).decodeText(),'hidden value');
const firstAnnotations=out.getPage(0).node.Annots().asArray().map(ref=>out.context.lookup(ref,PDFDict)),reply=firstAnnotations.find(d=>d.lookupMaybe(PDFName.of('Contents'),PDFHexString)?.decodeText()==='reply comment');assert.ok(firstAnnotations.includes(out.context.lookup(reply.get(PDFName.of('IRT')))));
const roundBook=api.newBook(),round=await api.importPdfPages(parsed,'round','round.pdf',roundBook);assert.equal(round[0].items.length,types.length+3);assert.equal(round[0].items.find(o=>o.pdfNative?.subtype==='Stamp').text,'Stamp 中文备注');
// Native annotations must survive cross-notebook copy without relying on the source vault file.
const stamp=book.pages[0].items.find(o=>o.pdfNative?.subtype==='Stamp'),other=api.newBook('Copy');other.pages[0].items=api.pasteItems(api.selectionClipboard([stamp],book),other);other.pages[0].items[0].rotation=37;other.pages[0].items[0].w*=1.4;other.pages[0].items[0].text='Edited stamp comment';
const copied=await pdfs.export(other,other.pages,renderer,'ink'),copyDoc=await PDFDocument.load(copied),copyAnnotation=copyDoc.context.lookup(copyDoc.getPage(0).node.Annots().asArray()[0],PDFDict);assert.equal(copyAnnotation.get(PDFName.of('Subtype')),PDFName.of('Stamp'));assert.equal(copyAnnotation.lookup(PDFName.of('Contents'),PDFHexString).decodeText(),'Edited stamp comment');
const copyParsed=await getDocument({data:copied,standardFontDataUrl:fonts}).promise,copyPage=await copyParsed.getPage(1),copyVp=copyPage.getViewport({scale:1}),copyCanvas=canvas(copyVp.width,copyVp.height);await copyPage.render({canvas:copyCanvas,canvasContext:copyCanvas.getContext('2d'),viewport:copyVp}).promise;const expectedCopy=await pdfs.canvas(other.pages[0],other,renderer,1),ca=copyCanvas.getContext('2d').getImageData(0,0,copyCanvas.width,copyCanvas.height).data,cb=expectedCopy.getContext('2d').getImageData(0,0,copyCanvas.width,copyCanvas.height).data;let drift=0;for(let j=0;j<ca.length;j+=4)if(Math.max(...[0,1,2].map(k=>Math.abs(ca[j+k]-cb[j+k])))>64)drift++;assert.ok(drift/(copyCanvas.width*copyCanvas.height)<.003);await copyParsed.loadingTask.destroy();
const deleted=structuredClone(book);deleted.pages[0].items=deleted.pages[0].items.filter(o=>o.pdfNative?.subtype!=='Stamp'&&o.text!=='Text 中文备注');const deletedBytes=await pdfs.export(deleted,[deleted.pages[0]],renderer,'all'),deletedDoc=await PDFDocument.load(deletedBytes),remaining=deletedDoc.getPage(0).node.Annots().asArray().map(ref=>deletedDoc.context.lookup(ref,PDFDict));assert.ok(!remaining.some(d=>['Stamp','Popup'].includes(d.get(PDFName.of('Subtype')).decodeText())));
const text=book.pages[0].items.find(o=>o.pdfNative?.subtype==='FreeText'),editedBook=api.newBook();editedBook.pages[0].items=api.pasteItems(api.selectionClipboard([text],book),editedBook);Object.assign(editedBook.pages[0].items[0],{text:'Changed FreeText 中文',fontSize:24,color:'#a00000',h:90,bh:90});const textBytes=await pdfs.export(editedBook,editedBook.pages,renderer,'ink'),textPdf=await getDocument({data:textBytes,standardFontDataUrl:fonts}).promise,textPage=await textPdf.getPage(1),textAnnotation=(await textPage.getAnnotations())[0];assert.equal(textAnnotation.subtype,'FreeText');assert.equal(textAnnotation.contentsObj.str,'Changed FreeText 中文');assert.equal(textAnnotation.defaultAppearanceData.fontSize,24);const tv=textPage.getViewport({scale:1}),tc=canvas(tv.width,tv.height);await textPage.render({canvas:tc,canvasContext:tc.getContext('2d'),viewport:tv}).promise;const pixels=tc.getContext('2d').getImageData(0,0,tc.width,tc.height).data;let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>100&&pixels[i+1]<60&&pixels[i+2]<60)red++;assert.ok(red>20,'FreeText appearance did not update after editing');await textPdf.loadingTask.destroy();
await parsed.loadingTask.destroy();await pdfs.clear();console.log(`PASS: ${types.length} annotation subtypes × 4 rotations, native appearance comparison, popup parents, embedded files, forms, comments, round-trip and cross-notebook transformed copies.`);
