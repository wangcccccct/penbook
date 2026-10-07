import { PDFDocument, PDFPage, PDFName, PDFHexString, PDFString, PDFRef } from 'pdf-lib';
import { Item, Page, Notebook } from './model';
import { Renderer } from './render';
import { getStroke } from 'perfect-freehand';
import { erasureClipPath } from './erase';
import type { AnnotationArchive } from './pdf-import';

type Box={x:number;y:number;width:number;height:number};
export function unitToPdf(u:number,v:number,box:Box,rotation:number):[number,number]{
  const r=(rotation%360+360)%360;
  if(r===90)return[box.x+v*box.width,box.y+u*box.height];
  if(r===180)return[box.x+(1-u)*box.width,box.y+v*box.height];
  if(r===270)return[box.x+(1-v)*box.width,box.y+(1-u)*box.height];
  return[box.x+u*box.width,box.y+(1-v)*box.height];
}
export function applyPdfCrop(out:PDFPage,page:Page){
  const c=page.backgroundCrop;if(!c)return;const box=out.getCropBox(),r=out.getRotation().angle,a=unitToPdf(c.x,c.y,box,r),b=unitToPdf(c.x+c.w,c.y+c.h,box,r);
  out.setCropBox(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));
}
const world=(o:Item,x:number,y:number):[number,number]=>{const a=o.rotation*Math.PI/180,dx=x*o.w/o.bw-o.w/2,dy=y*o.h/o.bh-o.h/2;return[o.x+o.w/2+dx*Math.cos(a)-dy*Math.sin(a),o.y+o.h/2+dx*Math.sin(a)+dy*Math.cos(a)];};
const rgb=(color:string)=>/^#[0-9a-f]{6}$/i.test(color)?[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255):[0,0,0];
const number=(value:number)=>Math.abs(value)<.000001?'0':value.toFixed(6).replace(/\.?0+$/,'');
const path=(points:number[][],close=false)=>points.map((p,i)=>`${number(p[0])} ${number(p[1])} ${i?'l':'m'}`).join('\n')+(close?'\nh':'');
const clipCommands=(d:string)=>d.replace(/[ML]\s*(-?[\d.]+(?:e[+-]?\d+)?)[, ]+(-?[\d.]+(?:e[+-]?\d+)?)/gi,(command,x,y)=>`${number(Number(x))} ${number(Number(y))} ${command[0].toUpperCase()==='M'?'m':'l'}\n`).replace(/Z/gi,'h\n');
function vectorAppearance(o:Item,renderer:Renderer):string|undefined{
  const w=o.bw,h=o.bh,width=o.width??2,color=rgb(o.color).join(' '),style=o.strokeStyle??o.ink?.style??'solid';
  let ops=`${color} rg ${color} RG ${width} w 1 J 1 j\n`;
  if(style!=='solid')ops+=`[${style==='dashed'?`${width*4} ${width*2}`:`0.1 ${width*2}`}] 0 d\n`;
  if(o.kind==='stroke'){
    if(o.eraseMasks?.length||o.frozenInk&&style!=='solid')ops+=clipCommands(erasureClipPath(o))+'W* n\n';
    return ops+(style==='solid'?(o.frozenInk??[renderer.strokeOutline(o)]).map(r=>path(r,true)).join('\n')+'\nf*':path(o.points??[])+'\nS');
  }
  if(o.kind==='tape')return ops+(o.points?path(getStroke(o.points,{size:o.width??24,thinning:0,simulatePressure:false}),true):`0 0 ${w} ${h} re`)+'\nf';
  if(o.kind!=='shape')return;
  let d='';
  if(o.shape==='ellipse'){
    const k=.552284749831,cx=w/2,cy=h/2;d=`${w} ${cy} m ${w} ${cy+k*cy} ${cx+k*cx} ${h} ${cx} ${h} c ${cx-k*cx} ${h} 0 ${cy+k*cy} 0 ${cy} c 0 ${cy-k*cy} ${cx-k*cx} 0 ${cx} 0 c ${cx+k*cx} 0 ${w} ${cy-k*cy} ${w} ${cy} c h`;
  }else if(o.shape==='rounded'){
    const r=Math.min(20,w/4,h/4),k=r*.552284749831;
    d=`${r} 0 m ${w-r} 0 l ${w-r+k} 0 ${w} ${r-k} ${w} ${r} c ${w} ${h-r} l ${w} ${h-r+k} ${w-r+k} ${h} ${w-r} ${h} c ${r} ${h} l ${r-k} ${h} 0 ${h-r+k} 0 ${h-r} c 0 ${r} l 0 ${r-k} ${r-k} 0 ${r} 0 c h`;
  }else if(o.shape==='rectangle')d=`0 0 ${w} ${h} re`;
  else if(o.shape==='triangle')d=path(o.points?.length===3?o.points:[[w/2,0],[w,h],[0,h]],true);
  else if(o.shape==='diamond')d=path([[w/2,0],[w,h/2],[w/2,h],[0,h/2]],true);
  else{const a=o.points?.[0]??[0,0],b=o.points?.[1]??[w,h],angle=Math.atan2(b[1]-a[1],b[0]-a[0]);d=path([a,b]);if(o.shape==='arrow')d+='\n'+path([[b[0]-16*Math.cos(angle-.45),b[1]-16*Math.sin(angle-.45)],b,[b[0]-16*Math.cos(angle+.45),b[1]-16*Math.sin(angle+.45)]]);}
  return ops+(o.fill&&!['line','arrow'].includes(o.shape??'')?`q /Fill gs ${d} f Q\n`:'')+d+'\nS';
}
export async function addObjectAnnotation(out:PDFDocument,target:PDFPage,page:Page,o:Item,book:Notebook,renderer:Renderer):Promise<AnnotationArchive['pages'][number]['annotations'][number]>{
  const map=(x:number,y:number)=>unitToPdf(x/page.width,y/page.height,target.getCropBox(),target.getRotation().angle);
  const local=(x:number,y:number)=>{const p=world(o,x,y);return map(p[0],p[1]);};
  const pad=Math.max(2,o.width??2),corners=[local(-pad,-pad),local(o.bw+pad,-pad),local(o.bw+pad,o.bh+pad),local(-pad,o.bh+pad)],rect=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))];
  const origin=local(0,0),a=local(1,0),b=local(0,1),matrix=[a[0]-origin[0],a[1]-origin[1],b[0]-origin[0],b[1]-origin[1],...origin];
  const opacity=o.opacity*(o.kind==='tape'&&o.revealed?0.16:1),vector=vectorAppearance(o,renderer);let stream='',resources:any={ExtGState:{Opacity:{Type:'ExtGState',ca:opacity,CA:opacity},Fill:{Type:'ExtGState',ca:opacity*.2,CA:opacity}}};
  if(vector!==undefined)stream=`q /Opacity gs ${matrix.map(number).join(' ')} cm\n${vector}\nQ`;
  else{
    const screen=[world(o,-pad,-pad),world(o,o.bw+pad,-pad),world(o,o.bw+pad,o.bh+pad),world(o,-pad,o.bh+pad)],sx=Math.min(...screen.map(p=>p[0])),sy=Math.min(...screen.map(p=>p[1])),sw=Math.max(...screen.map(p=>p[0]))-sx,sh=Math.max(...screen.map(p=>p[1]))-sy,scale=Math.min(1.5,Math.sqrt(1_000_000/(sw*sh)));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(sw*scale));canvas.height=Math.max(1,Math.ceil(sh*scale));
    try{const ctx=canvas.getContext('2d')!;ctx.scale(scale,scale);ctx.translate(-sx,-sy);renderer.draw(ctx,o,o.resource?await renderer.image(o.resource,book):undefined);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('无法编码批注')),'image/png')),image=await out.embedPng(await blob.arrayBuffer());
      const origin=map(sx,sy+sh),right=map(sx+sw,sy+sh),top=map(sx,sy),m=[right[0]-origin[0],right[1]-origin[1],top[0]-origin[0],top[1]-origin[1],...origin];resources={XObject:{Image:image.ref}};stream=`q ${m.map(number).join(' ')} cm /Image Do Q`;
    }finally{canvas.width=canvas.height=1;}
  }
  const ap=out.context.register(out.context.flateStream(stream,{Type:'XObject',Subtype:'Form',BBox:rect,Resources:resources}));
  let subtype='Stamp';const extra:any={};
  if(o.kind==='stroke'&&o.pen!=='highlighter'){subtype='Ink';extra.InkList=[(o.points??[]).flatMap(p=>local(p[0],p[1]))];}
  else if(o.kind==='stroke'&&o.pen==='highlighter'){subtype='Highlight';extra.QuadPoints=[...local(0,0),...local(o.bw,0),...local(0,o.bh),...local(o.bw,o.bh)];}
  else if(o.kind==='sticky'){subtype='Text';extra.Name='Comment';}
  else if(o.kind==='text'){subtype='FreeText';extra.DA=PDFString.of(`/Helv ${o.fontSize??22} Tf ${rgb(o.color).join(' ')} rg`);}
  else if(o.kind==='shape'){
    if(['line','arrow'].includes(o.shape??'')){subtype='Line';const a=o.points?.[0]??[0,0],b=o.points?.[1]??[o.bw,o.bh];extra.L=[...local(a[0],a[1]),...local(b[0],b[1])];if(o.shape==='arrow')extra.LE=['None','OpenArrow'];}
    else if(o.shape==='triangle'||o.shape==='diamond'){subtype='Polygon';extra.Vertices=(o.shape==='diamond'?[[o.bw/2,0],[o.bw,o.bh/2],[o.bw/2,o.bh],[0,o.bh/2]]:o.points?.length===3?o.points:[[o.bw/2,0],[o.bw,o.bh],[0,o.bh]]).flatMap(p=>local(p[0],p[1]));}
    else subtype=o.shape==='ellipse'?'Circle':'Square';
  }
  else if(o.kind==='link'){subtype='Link';if(o.target)extra.A={S:'URI',URI:PDFString.of(o.target)};extra.Border=[0,0,0];}
  const contents=o.kind==='table'?(o.cells??[]).map(r=>r.join('\t')).join('\n'):o.text??'',ref=out.context.register(out.context.obj({Type:'Annot',Subtype:subtype,Rect:rect,P:target.ref,F:4,CA:opacity,C:rgb(o.color),BS:{W:o.width??2,S:'S'},Contents:PDFHexString.fromText(contents),NM:PDFString.of(o.id),AP:{N:ap},...extra}));target.node.addAnnot(ref);
  const native:Record<string,unknown>={subtype,color:rgb(o.color).map(v=>Math.round(v*255)),width:o.kind==='link'?0:o.width??2,modificationDate:null,rotation:0};
  if(extra.InkList){native.inkLists=extra.InkList;native.opacity=opacity;}
  if(extra.QuadPoints){native.quadPoints=extra.QuadPoints;native.opacity=opacity;}
  if(extra.L)native.lineCoordinates=extra.L;
  if(extra.Vertices)native.vertices=extra.Vertices;
  if(o.kind==='text')native.fontSize=o.fontSize??22;
  if(o.kind==='link'&&o.target)native.url=o.target;
  return{id:`${ref.objectNumber}R${ref.generationNumber||''}`,rect,contents,native,item:o};
}
export function writePdfNavigation(out:PDFDocument,records:{page:Page;target:PDFPage}[]){
  const destinations=new Map(records.map(r=>[r.page.id,r.target.ref]));
  for(const {page,target}of records)for(const link of page.pdfLinks??[]){
    const a=unitToPdf(link.x/page.width,link.y/page.height,target.getCropBox(),target.getRotation().angle),b=unitToPdf((link.x+link.w)/page.width,(link.y+link.h)/page.height,target.getCropBox(),target.getRotation().angle),dest=link.page&&destinations.get(link.page);
    if(!dest&&!link.url)continue;const value:any={Type:'Annot',Subtype:'Link',Rect:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],Border:[0,0,0],P:target.ref};
    if(dest)value.Dest=[dest,PDFName.of('Fit')];else value.A={S:'URI',URI:PDFString.of(link.url!)};target.node.addAnnot(out.context.register(out.context.obj(value)));
  }
  const entries=records.flatMap(({page,target})=>(page.pdfBookmarks??(page.outline?[{title:page.outline,level:0}]:[])).map(b=>({...b,target})));
  if(!entries.length)return;
  type Node={ref:PDFRef;children:Node[];title:string;target?:PDFPage};const root:Node={ref:out.context.nextRef(),children:[],title:''},stack=[root];
  for(const entry of entries){const level=Math.max(0,Math.min(entry.level,stack.length-1));stack.length=level+1;const n:Node={ref:out.context.nextRef(),children:[],title:entry.title,target:entry.target};stack[level].children.push(n);stack.push(n);}
  const write=(n:Node,parent?:Node,prev?:Node,next?:Node)=>{
    const value:any=n===root?{Type:'Outlines'}:{Title:PDFHexString.fromText(n.title),Parent:parent!.ref,Dest:[n.target!.ref,PDFName.of('Fit')]};
    if(prev)value.Prev=prev.ref;if(next)value.Next=next.ref;if(n.children.length){value.First=n.children[0].ref;value.Last=n.children[n.children.length-1].ref;value.Count=n.children.length;}
    out.context.assign(n.ref,out.context.obj(value));n.children.forEach((child,i)=>write(child,n,n.children[i-1],n.children[i+1]));
  };write(root);out.catalog.set(PDFName.of('Outlines'),root.ref);
}
