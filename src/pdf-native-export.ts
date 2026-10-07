import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectCopier, PDFPage, PDFRef, PDFStream, PDFString } from 'pdf-lib';
import { Item, Notebook, Page, nativeTextStyle } from './model';
import { Renderer } from './render';
import { unitToPdf } from './pdf-annotations';

type Matrix=number[];
const name=PDFName.of;
const values=(dict:PDFDict,key:string,fallback:number[])=>{const a=dict.lookupMaybe(name(key),PDFArray);return a?a.asArray().map(v=>dict.context.lookup(v,PDFNumber).asNumber()):fallback;};
const point=(m:Matrix,x:number,y:number):[number,number]=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const multiply=(a:Matrix,b:Matrix):Matrix=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],...point(a,b[4],b[5])];
const bounds=(points:number[][])=>[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
const corners=(r:number[])=>[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]];
const number=(v:number)=>v.toFixed(6).replace(/\.?0+$/,'')||'0';

/** Copy original dictionaries/streams, while remapping their page-space geometry. */
export class NativeAnnotations {
  private originals=new Map<string,{dict:PDFDict;popup?:PDFDict;reply?:string}>();
  private replies:{dict:PDFDict;page:PDFPage;key:string}[]=[];
  private exported=new Map<string,PDFRef>();
  private globalReplies=new Map<string,PDFRef>();
  private fields:PDFRef[]=[];
  constructor(private out:PDFDocument,private book:Notebook){}
  prepare(key:string,source:PDFDocument){
    const copier=PDFObjectCopier.for(source.context,this.out.context);
    const wanted=new Set(this.book.pages.flatMap(p=>p.items.filter(o=>o.pdfNative?.resource===key).map(o=>o.pdfNative!.id)));
    for(const p of source.getPages())for(const ref of p.node.Annots()?.asArray()??[]){
      if(!(ref instanceof PDFRef))continue;const id=`${ref.objectNumber}R${ref.generationNumber||''}`;if(!wanted.has(id))continue;
      const original=source.context.lookup(ref,PDFDict),dict=original.clone(source.context),popupRef=original.get(name('Popup')),reply=original.get(name('IRT'));
      for(const k of['P','Popup','IRT','StructParent'])dict.delete(name(k));
      if(dict.get(name('Subtype'))===name('Widget')){
        const chain:PDFDict[]=[original],seen=new Set<PDFDict>(chain);let parent=original.lookupMaybe(name('Parent'),PDFDict);
        while(parent&&!seen.has(parent)){chain.push(parent);seen.add(parent);parent=parent.lookupMaybe(name('Parent'),PDFDict);}
        for(const k of['FT','Ff','V','DV','DA','DR','Q','Opt','MaxLen'])if(!dict.has(name(k)))for(const d of chain)if(d.has(name(k))){dict.set(name(k),d.get(name(k))!);break;}
        const acro=source.catalog.lookupMaybe(name('AcroForm'),PDFDict);if(!dict.has(name('DR'))&&acro?.has(name('DR')))dict.set(name('DR'),acro.get(name('DR'))!);
        dict.delete(name('Parent'));dict.delete(name('Kids'));
      }
      let popup:PDFDict|undefined;const raw=popupRef&&source.context.lookup(popupRef);if(raw instanceof PDFDict){const d=raw.clone(source.context);d.delete(name('P'));d.delete(name('Parent'));popup=copier.copy(d);}
      this.originals.set(`${key}:${id}`,{dict:copier.copy(dict),popup,reply:reply instanceof PDFRef?`${key}:${reply.objectNumber}R${reply.generationNumber||''}`:undefined});
    }
  }
  async add(target:PDFPage,page:Page,o:Item,renderer:Renderer){
    const meta=o.pdfNative!,saved=this.originals.get(`${meta.resource}:${meta.id}`);if(!saved)throw new Error(`找不到原始 PDF 批注：${meta.subtype}`);
    const editedText=meta.baselineStyle!==undefined&&meta.baselineStyle!==nativeTextStyle(o),dict=saved.dict.clone(this.out.context),local=(x:number,y:number)=>{
      const a=o.rotation*Math.PI/180,dx=x*o.w/o.bw-o.w/2,dy=y*o.h/o.bh-o.h/2;
      return unitToPdf((o.x+o.w/2+dx*Math.cos(a)-dy*Math.sin(a))/page.width,(o.y+o.h/2+dx*Math.sin(a)+dy*Math.cos(a))/page.height,target.getCropBox(),target.getRotation().angle);
    },map=(x:number,y:number)=>{const p=point(meta.matrix,x,y);return local(p[0],p[1]);},origin=map(0,0),x=map(1,0),y=map(0,1),matrix=[x[0]-origin[0],x[1]-origin[1],y[0]-origin[0],y[1]-origin[1],...origin],old=values(dict,'Rect',[0,0,1,1]),rect=bounds(corners(editedText?[0,0,o.bw,o.bh]:old).map(p=>editedText?local(p[0],p[1]):map(p[0],p[1])));
    dict.set(name('Rect'),this.out.context.obj(rect));dict.set(name('P'),target.ref);dict.set(name('NM'),PDFHexString.fromText(o.id));dict.set(name('Contents'),PDFHexString.fromText(o.text??''));
    if(meta.author!==undefined&&meta.subtype!=='Widget')dict.set(name('T'),PDFHexString.fromText(meta.author));if(meta.subject!==undefined)dict.set(name('Subj'),PDFHexString.fromText(meta.subject));
    for(const key of['L','Vertices','QuadPoints','CL']){const a=dict.lookupMaybe(name(key),PDFArray);if(a){const pts=values(dict,key,[]),mapped:number[]=[];for(let i=0;i+1<pts.length;i+=2)mapped.push(...map(pts[i],pts[i+1]));dict.set(name(key),this.out.context.obj(mapped));}}
    const lists=dict.lookupMaybe(name('InkList'),PDFArray);if(lists)dict.set(name('InkList'),this.out.context.obj(lists.asArray().map(value=>{const list=this.out.context.lookup(value,PDFArray).asArray().map(n=>this.out.context.lookup(n,PDFNumber).asNumber()),mapped:number[]=[];for(let i=0;i+1<list.length;i+=2)mapped.push(...map(list[i],list[i+1]));return mapped;})));
    if(editedText){dict.delete(name('AP'));dict.delete(name('RC'));dict.delete(name('DS'));const rgb=/^#[0-9a-f]{6}$/i.test(o.color)?[1,3,5].map(i=>parseInt(o.color.slice(i,i+2),16)/255):[0,0,0];dict.set(name('DA'),PDFString.of(`/Helv ${o.fontSize??16} Tf ${rgb.join(' ')} rg`));}
    // PDF.js derives FreeText's editor properties from the appearance stream.
    const font=meta.subtype==='FreeText'?{Helv:{Type:'Font',Subtype:'Type1',BaseFont:'Helvetica'}}:undefined,color=/^#[0-9a-f]{6}$/i.test(o.color)?[1,3,5].map(i=>parseInt(o.color.slice(i,i+2),16)/255):[0,0,0],textHint=font?`BT /Helv ${o.fontSize??16} Tf ${color.join(' ')} rg 3 Tr () Tj ET\n`:'';
    const appearance=dict.lookupMaybe(name('AP'),PDFDict);
    if(appearance){
      const ap=appearance.clone(this.out.context);
      const wrap=(stream:PDFStream)=>{
        const box=values(stream.dict,'BBox',old),formMatrix=values(stream.dict,'Matrix',[1,0,0,1,0,0]),bb=bounds(corners(box).map(p=>point(formMatrix,p[0],p[1]))),sx=(old[2]-old[0])/(bb[2]-bb[0]||1),sy=(old[3]-old[1])/(bb[3]-bb[1]||1),placement=[sx,0,0,sy,old[0]-bb[0]*sx,old[1]-bb[1]*sy],m=multiply(matrix,placement);
        return this.out.context.register(this.out.context.flateStream(`${textHint}q /Layer gs ${m.map(number).join(' ')} cm /Original Do Q`,{Type:'XObject',Subtype:'Form',BBox:rect,Resources:{...(font?{Font:font}:{}),XObject:{Original:this.out.context.register(stream)},ExtGState:{Layer:{Type:'ExtGState',ca:o.opacity,CA:o.opacity}}}}));
      };
      for(const key of['N','R','D']){const value=ap.get(name(key)),object=value&&this.out.context.lookup(value);if(object instanceof PDFStream)ap.set(name(key),wrap(object));else if(object instanceof PDFDict){const states=object.clone(this.out.context);for(const [state,ref]of object.entries()){const stream=this.out.context.lookup(ref);if(stream instanceof PDFStream)states.set(state,wrap(stream));}ap.set(name(key),states);}}
      dict.set(name('AP'),ap);
    }else if(o.resource){
      const canvas=document.createElement('canvas'),scale=Math.min(2,Math.sqrt(1_000_000/(o.bw*o.bh)));canvas.width=Math.max(1,Math.ceil(o.bw*scale));canvas.height=Math.max(1,Math.ceil(o.bh*scale));
      try{const ctx=canvas.getContext('2d')!;ctx.scale(scale,scale);if(editedText)renderer.draw(ctx,{...o,x:0,y:0,w:o.bw,h:o.bh,rotation:0,opacity:1});else ctx.drawImage(await renderer.image(o.resource,this.book),0,0,o.bw,o.bh);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('无法导出批注外观')),'image/png')),image=await this.out.embedPng(await blob.arrayBuffer());
        const local=(lx:number,ly:number)=>{const a=o.rotation*Math.PI/180,dx=lx*o.w/o.bw-o.w/2,dy=ly*o.h/o.bh-o.h/2;return unitToPdf((o.x+o.w/2+dx*Math.cos(a)-dy*Math.sin(a))/page.width,(o.y+o.h/2+dx*Math.sin(a)+dy*Math.cos(a))/page.height,target.getCropBox(),target.getRotation().angle);},p=local(0,o.bh),q=local(o.bw,o.bh),r=local(0,0),m=[q[0]-p[0],q[1]-p[1],r[0]-p[0],r[1]-p[1],...p],ref=this.out.context.register(this.out.context.flateStream(`${textHint}q /Layer gs ${m.map(number).join(' ')} cm /Image Do Q`,{Type:'XObject',Subtype:'Form',BBox:rect,Resources:{...(font?{Font:font}:{}),XObject:{Image:image.ref},ExtGState:{Layer:{Type:'ExtGState',ca:o.opacity,CA:o.opacity}}}}));dict.set(name('AP'),this.out.context.obj({N:ref}));
      }finally{canvas.width=canvas.height=1;}
    }
    const ref=this.out.context.register(dict);target.node.addAnnot(ref);this.exported.set(`${target.ref}:${meta.resource}:${meta.id}`,ref);
    if(!this.globalReplies.has(`${meta.resource}:${meta.id}`))this.globalReplies.set(`${meta.resource}:${meta.id}`,ref);
    if(saved.reply)this.replies.push({dict,page:target,key:saved.reply});
    if(saved.popup){const popup=saved.popup.clone(this.out.context),r=values(popup,'Rect',old);popup.set(name('Rect'),this.out.context.obj(bounds(corners(r).map(p=>map(p[0],p[1])))));popup.set(name('P'),target.ref);popup.set(name('Parent'),ref);const pr=this.out.context.register(popup);dict.set(name('Popup'),pr);target.node.addAnnot(pr);}
    if(meta.subtype==='Widget'){dict.set(name('T'),PDFHexString.fromText(meta.fieldName??o.id));this.fields.push(ref);}
  }
  finish(){
    for(const {dict,page,key}of this.replies){const ref=this.exported.get(`${page.ref}:${key}`)??this.globalReplies.get(key);if(ref)dict.set(name('IRT'),ref);}
    // Retained hidden widgets also need a field root in the output catalog.
    for(const p of this.out.getPages())for(const ref of p.node.Annots()?.asArray()??[]){if(!(ref instanceof PDFRef)||this.fields.includes(ref))continue;const d=this.out.context.lookup(ref);if(!(d instanceof PDFDict)||d.get(name('Subtype'))!==name('Widget'))continue;
      const chain=[d],seen=new Set(chain);let parent=d.lookupMaybe(name('Parent'),PDFDict);while(parent&&!seen.has(parent)){chain.push(parent);seen.add(parent);parent=parent.lookupMaybe(name('Parent'),PDFDict);}
      for(const key of['FT','Ff','V','DV','DA','DR','Q','Opt','MaxLen'])if(!d.has(name(key)))for(const ancestor of chain)if(ancestor.has(name(key))){d.set(name(key),ancestor.get(name(key))!);break;}
      const parts=chain.slice().reverse().flatMap(ancestor=>{const title=ancestor.get(name('T'));return title instanceof PDFHexString||title instanceof PDFString?[title.decodeText()]:[];});
      if(parts.length)d.set(name('T'),PDFHexString.fromText(parts.join('.')));
      d.delete(name('Parent'));d.delete(name('Kids'));this.fields.push(ref);
    }
    const groups=new Map<string,{root:PDFDict;ref:PDFRef;kids:PDFRef[]}>();
    for(const ref of this.fields){const d=this.out.context.lookup(ref,PDFDict),title=d.get(name('T'))?.toString()??ref.toString();let group=groups.get(title);
      if(!group){const root=this.out.context.obj({});for(const key of['T','FT','Ff','V','DV','DA','DR','Q','Opt','MaxLen'])if(d.has(name(key)))root.set(name(key),d.get(name(key))!);group={root,ref:this.out.context.register(root),kids:[]};groups.set(title,group);}
      group.kids.push(ref);d.set(name('Parent'),group.ref);for(const key of['T','FT','Ff','V','DV','DA','DR','Q','Opt','MaxLen'])d.delete(name(key));
    }
    for(const group of groups.values())group.root.set(name('Kids'),this.out.context.obj(group.kids));
    if(groups.size)this.out.catalog.set(name('AcroForm'),this.out.context.obj({Fields:[...groups.values()].map(g=>g.ref),NeedAppearances:false}));
  }
}
