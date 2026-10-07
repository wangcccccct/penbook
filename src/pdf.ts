import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerSource from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { PDFDocument, PDFPage, PDFName, PDFRef, PDFDict, degrees } from 'pdf-lib';
import { Notebook, Page, decode } from './model';
import { Renderer } from './render';
import { BudgetCache, RenderQueue } from './resources';
import { addObjectAnnotation, applyPdfCrop, writePdfNavigation } from './pdf-annotations';
import { ANNOTATION_ATTACHMENT, AnnotationArchive } from './pdf-import';
import { NativeAnnotations } from './pdf-native-export';
async function pngBytes(canvas:HTMLCanvasElement){try{const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('无法编码页面图片')),'image/png'));return new Uint8Array(await blob.arrayBuffer());}finally{canvas.width=canvas.height=1;}}

export class PDFs {
  docs = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();
  private worker?:pdfjs.PDFWorker;
  private port?:Worker;
  private renders=new Set<pdfjs.RenderTask>();
  private queue=new RenderQueue(2);
  private backgrounds=new BudgetCache<string,HTMLCanvasElement>(32*1024*1024,canvas=>{canvas.width=canvas.height=1;});
  private generation=0;
  private leases=new Map<string,number>();
  private sizes=new Map<string,number>();
  private disposing=new Set<Promise<unknown>>();
  private idleTimer?:ReturnType<typeof setTimeout>;
  constructor(private asset: (path: string) => string) {}
  async clear() {
    if(this.idleTimer!==undefined)clearTimeout(this.idleTimer);this.idleTimer=undefined;this.leases.clear();this.sizes.clear();
    this.generation++;for(const task of this.renders)task.cancel();this.renders.clear();this.backgrounds.clear();
    const old=[...this.docs.values()],worker=this.worker,port=this.port;this.docs.clear();this.worker=undefined;this.port=undefined;
    await Promise.allSettled([...old.map(async p=>(await p).cleanup()),...this.disposing]);worker?.destroy();port?.terminate();
  }
  document(key: string, book: Notebook) {
    let p = this.docs.get(key);
    if (!p) {
      const r=book.resources[key]; if(!r || r.type!=='pdf') throw new Error('PDF 资源缺失');
      // A blob URL gives the worker the same app:// origin without modifying
      // the host window's pdfjsWorker global used by Obsidian's PDF reader.
      if(!this.worker){
        const workerUrl=URL.createObjectURL(new Blob([pdfWorkerSource],{type:'text/javascript'}));
        try{this.port=new Worker(workerUrl,{type:'module',name:'penbook-pdf'});this.worker=pdfjs.PDFWorker.create({port:this.port});}catch(error){URL.revokeObjectURL(workerUrl);this.port?.terminate();throw error;}
        void this.worker.promise.then(()=>URL.revokeObjectURL(workerUrl),()=>URL.revokeObjectURL(workerUrl));
      }
      const worker=this.worker;
      p=(async()=>{
        return pdfjs.getDocument({worker,data:decode(r.data),cMapUrl:this.asset('cmaps/'),cMapPacked:true,standardFontDataUrl:this.asset('standard_fonts/'),wasmUrl:this.asset('wasm/'),useWorkerFetch:false}).promise;
      })();
      this.docs.set(key,p);
      this.sizes.set(key,r.size??r.data.length*1.5);
      void p.catch(()=>{if(this.docs.get(key)===p)this.docs.delete(key);});
    }
    this.docs.delete(key);this.docs.set(key,p);return p;
  }
  async withDocument<T>(key:string,book:Notebook,work:(pdf:pdfjs.PDFDocumentProxy)=>Promise<T>):Promise<T>{
    const generation=this.generation;this.leases.set(key,(this.leases.get(key)??0)+1);if(this.idleTimer!==undefined)clearTimeout(this.idleTimer);
    try{return await work(await this.document(key,book));}
    finally{if(generation===this.generation){this.leases.set(key,Math.max(0,(this.leases.get(key)??1)-1));this.trimDocuments();if(this.idleTimer!==undefined)clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>void this.releaseIdleDocuments(),60000);}}
  }
  private async releaseIdleDocuments(){this.idleTimer=undefined;this.trimDocuments(true);const worker=this.worker,port=this.port;await Promise.allSettled([...this.disposing]);if(!this.docs.size&&this.worker===worker){worker?.destroy();port?.terminate();this.worker=undefined;this.port=undefined;}}
  private trimDocuments(all=false){
    let bytes=[...this.sizes.values()].reduce((sum,size)=>sum+size,0);
    for(const[key,promise]of this.docs){if(this.leases.get(key))continue;if(!all&&(this.docs.size<=1||this.docs.size<=3&&bytes<=96*1024*1024))break;this.docs.delete(key);bytes-=this.sizes.get(key)??0;this.sizes.delete(key);this.leases.delete(key);const dispose=promise.then(pdf=>pdf.loadingTask.destroy()).catch(()=>{});this.disposing.add(dispose);void dispose.finally(()=>this.disposing.delete(dispose));}
  }
  async background(canvas: HTMLCanvasElement, page: Page, book: Notebook, renderer: Renderer, scale: number,signal?:AbortSignal) {
    const generation=this.generation;
    const key=JSON.stringify([page.width,page.height,page.paper,page.color,page.spacing,page.background,page.backgroundRotation,page.backgroundCrop,page.pdfAnnotationIds,canvas.width,canvas.height]);
    const cached=this.backgrounds.get(key);if(cached){if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(cached,0,0);return;}
    await this.queue.run(async()=>{
      if(generation!==this.generation)throw new DOMException('Cancelled','AbortError');
      const reused=this.backgrounds.get(key);if(reused){canvas.getContext('2d')!.drawImage(reused,0,0);return;}
      await this.renderBackground(canvas,page,book,renderer,scale,signal);
      if(generation!==this.generation||signal?.aborted)return;
      const bytes=canvas.width*canvas.height*4;
      if(bytes<=this.backgrounds.budget){const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d')!.drawImage(canvas,0,0);this.backgrounds.set(key,copy,bytes);}
    },signal);
  }
  private async renderBackground(canvas: HTMLCanvasElement, page: Page, book: Notebook, renderer: Renderer, scale: number,signal?:AbortSignal) {
    const ctx=canvas.getContext('2d')!; ctx.clearRect(0,0,canvas.width,canvas.height);
    const bg=page.background;
    if(bg && book.resources[bg.resource]?.type==='pdf') {
      await this.withDocument(bg.resource,book,async pdf=>{const p=await pdf.getPage((bg.page??0)+1);
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const vp=p.getViewport({scale:1,rotation:(p.rotate+(page.backgroundRotation??0))%360});
      const crop=page.backgroundCrop??{x:0,y:0,w:1,h:1},sx=scale*page.width/(vp.width*crop.w),sy=scale*page.height/(vp.height*crop.h);
      const excluded=new Set<number>();if(page.pdfAnnotationIds?.length){const ids=new Set(page.pdfAnnotationIds),list=await p.getOperatorList();let hide=false;for(let i=0;i<list.fnArray.length;i++){if(list.fnArray[i]===pdfjs.OPS.beginAnnotation)hide=ids.has(list.argsArray[i][0]);if(hide)excluded.add(i);if(list.fnArray[i]===pdfjs.OPS.endAnnotation)hide=false;}}
      const task=p.render({canvasContext:ctx,canvas,viewport:vp,transform:[sx,0,0,sy,-crop.x*vp.width*sx,-crop.y*vp.height*sy],operationsFilter:excluded.size?i=>!excluded.has(i):undefined});this.renders.add(task);
      const cancel=()=>task.cancel();signal?.addEventListener('abort',cancel,{once:true});
      try{await task.promise;}finally{signal?.removeEventListener('abort',cancel);this.renders.delete(task);p.cleanup();}
      });
    } else {
      ctx.save();ctx.scale(scale,scale);renderer.paper(ctx,page);
      if(bg) { const img=await renderer.image(bg.resource,book),rotation=page.backgroundRotation??0;ctx.translate(page.width/2,page.height/2);ctx.rotate(rotation*Math.PI/180);const w=rotation%180?page.height:page.width,h=rotation%180?page.width:page.height;ctx.drawImage(img,-w/2,-h/2,w,h); }ctx.restore();
    }
  }
  async canvas(page:Page,book:Notebook,renderer:Renderer,scale=1.5, mode:'all'|'ink'|'background'='all',signal?:AbortSignal) {
    scale=Math.min(scale,Math.sqrt(16_000_000/(page.width*page.height)),16384/page.width,16384/page.height);
    const canvas=document.createElement('canvas');canvas.width=Math.round(page.width*scale);canvas.height=Math.round(page.height*scale);
    try{
    if(mode!=='ink') await this.background(canvas,page,book,renderer,scale,signal);
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(mode!=='background') { const ctx=canvas.getContext('2d')!;ctx.save();ctx.scale(scale,scale);await renderer.objects(ctx,page,book);ctx.restore(); }
    return canvas;
    }catch(error){canvas.width=canvas.height=1;throw error;}
  }
  async export(book:Notebook,pages:Page[],renderer:Renderer,mode:'all'|'ink'|'background') {
    const out=await PDFDocument.create(),archive:AnnotationArchive={format:'penbook-annotations',version:1,resources:{},pages:[]},records:{page:Page;target:import('pdf-lib').PDFPage}[]=[];
    const native=new Map<Page,PDFPage>(),nativeAnnotations=new NativeAnnotations(out,{...book,pages}),keys=new Set([...pages.filter(p=>mode!=='ink'&&p.background&&book.resources[p.background.resource]?.type==='pdf').map(p=>p.background!.resource),...pages.flatMap(p=>mode==='background'?[]:p.items.flatMap(o=>o.pdfNative?[o.pdfNative.resource]:[]))]);
    for(const key of keys){
      const resource=book.resources[key];
      const source=await PDFDocument.load(decode(resource.data)),requested=pages.filter(p=>mode!=='ink'&&p.background?.resource===key),indices=[...new Set(requested.map(p=>p.background!.page??0))],copied=await out.copyPages(source,indices);nativeAnnotations.prepare(key,source);
      for(const page of requested){
        const index=page.background!.page??0,base=copied[indices.indexOf(index)],node=base.node.clone(out.context),target=PDFPage.of(node,out.context.register(node),out);target.setRotation(degrees((target.getRotation().angle+(page.backgroundRotation??0))%360));applyPdfCrop(target,page);
        const originals=source.getPage(index).node.Annots()?.asArray()??[],annotations=base.node.Annots()?.asArray()??[],ids=new Set(page.pdfAnnotationIds),keep:PDFRef[]=[],aliases=new Map<string,PDFRef>();
        annotations.forEach((ref,i)=>{const original=originals[i],originalDict=source.context.lookup(original),parent=originalDict instanceof PDFDict&&originalDict.get(PDFName.of('Parent'));if(original instanceof PDFRef&&ids.has(`${original.objectNumber}R${original.generationNumber||''}`)||originalDict instanceof PDFDict&&originalDict.get(PDFName.of('Subtype'))===PDFName.of('Popup')&&parent instanceof PDFRef&&ids.has(`${parent.objectNumber}R${parent.generationNumber||''}`)||page.pdfLinks&&originalDict instanceof PDFDict&&originalDict.get(PDFName.of('Subtype'))===PDFName.of('Link'))return;const copiedDict=out.context.lookup(ref);if(copiedDict instanceof PDFDict){const dictionary=copiedDict.clone(out.context);dictionary.set(PDFName.of('P'),target.ref);const registered=out.context.register(dictionary);aliases.set(ref.toString(),registered);keep.push(registered);}});
        for(const ref of keep){const d=out.context.lookup(ref,PDFDict);for(const key of['Parent','Popup','IRT']){const old=d.get(PDFName.of(key)),replacement=old&&aliases.get(old.toString());if(replacement)d.set(PDFName.of(key),replacement);}}
        node.set(PDFName.of('Annots'),out.context.obj(keep));native.set(page,target);
      }
      await new Promise<void>(r=>setTimeout(r,0));
    }
    for(const page of pages) {
      let target:PDFPage;
      // Copy native PDF pages and overlay ink; original text remains searchable.
      if(native.has(page)) {
        target=native.get(page)!;out.addPage(target);
      } else {
        target=out.addPage([page.width,page.height]);
        if(mode!=='ink'){const image=await out.embedPng(await pngBytes(await this.canvas(page,book,renderer,1.5,'background')));target.drawImage(image,{x:0,y:0,width:page.width,height:page.height});}
      }
      records.push({page,target});const saved:AnnotationArchive['pages'][number]={width:page.width,height:page.height,annotations:[]};archive.pages.push(saved);
      if(mode!=='background')for(const o of page.items){if(o.pdfNative){await nativeAnnotations.add(target,page,o,renderer);continue;}saved.annotations.push(await addObjectAnnotation(out,target,page,o,book,renderer));if(o.resource&&book.resources[o.resource]?.type==='image')archive.resources[o.resource]=book.resources[o.resource];}
      await new Promise<void>(r=>setTimeout(r,0));
    }
    writePdfNavigation(out,records);
    nativeAnnotations.finish();
    if(mode!=='background')await out.attach(new TextEncoder().encode(JSON.stringify(archive)),ANNOTATION_ATTACHMENT,{mimeType:'application/json',description:'Penbook editable annotation data'});
    return out.save();
  }
}
