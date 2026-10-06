import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerSource from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { PDFDocument, degrees } from 'pdf-lib';
import { Notebook, Page, decode } from './model';
import { Renderer } from './render';
import { BudgetCache, RenderQueue } from './resources';
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
      p=pdfjs.getDocument({ worker,data:decode(r.data), cMapUrl:this.asset('cmaps/'), cMapPacked:true, standardFontDataUrl:this.asset('standard_fonts/'), wasmUrl:this.asset('wasm/'), useWorkerFetch:false }).promise;
      this.docs.set(key,p);
      this.sizes.set(key,r.data.length*1.5);
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
    for(const[key,promise]of this.docs){if(this.leases.get(key))continue;if(!all&&(this.docs.size<=1||this.docs.size<=3&&bytes<=96*1024*1024))break;this.docs.delete(key);bytes-=this.sizes.get(key)??0;this.sizes.delete(key);this.leases.delete(key);const dispose=promise.then(pdf=>pdf.cleanup()).catch(()=>{});this.disposing.add(dispose);void dispose.finally(()=>this.disposing.delete(dispose));}
  }
  async background(canvas: HTMLCanvasElement, page: Page, book: Notebook, renderer: Renderer, scale: number,signal?:AbortSignal) {
    const generation=this.generation;
    const key=JSON.stringify([page.width,page.height,page.paper,page.color,page.spacing,page.background,page.backgroundRotation,canvas.width,canvas.height]);
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
      const task=p.render({canvasContext:ctx,canvas,viewport:vp,transform:[scale*page.width/vp.width,0,0,scale*page.height/vp.height,0,0]});this.renders.add(task);
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
    const out=await PDFDocument.create(); const sources=new Map<string,PDFDocument>();
    for(const page of pages) {
      const bg=page.background;
      // Copy native PDF pages and overlay ink; original text remains searchable.
      if(mode!=='ink'&&bg&&book.resources[bg.resource]?.type==='pdf') {
        let source=sources.get(bg.resource);if(!source){source=await PDFDocument.load(decode(book.resources[bg.resource].data));sources.set(bg.resource,source);}
        const [copied]=await out.copyPages(source,[bg.page??0]);copied.setRotation(degrees((copied.getRotation().angle+(page.backgroundRotation??0))%360));out.addPage(copied);
        if(mode==='all') {
          const image=await out.embedPng(await pngBytes(await this.canvas(page,book,renderer,1.5,'ink')));
          const box=copied.getCropBox(), rotation=((copied.getRotation().angle%360)+360)%360;
          const x=box.x+(rotation===90||rotation===180?box.width:0),y=box.y+(rotation===180||rotation===270?box.height:0);
          copied.drawImage(image,{x,y,width:rotation%180?box.height:box.width,height:rotation%180?box.width:box.height,rotate:degrees(rotation)});
        }
      } else {
        const canvas=await this.canvas(page,book,renderer,1.5,mode), image=await out.embedPng(await pngBytes(canvas));
        out.addPage([page.width,page.height]).drawImage(image,{x:0,y:0,width:page.width,height:page.height});
      }
    }
    return out.save();
  }
}
