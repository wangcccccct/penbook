import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Item, Notebook, encode, item, localPoint, uid } from './model';

export function bindNative(o:Item,a:any,page:pdfjs.PDFPageProxy,key:string){
  const vp=page.getViewport({scale:1}),point=(x:number,y:number)=>{const p=vp.convertToViewportPoint(x,y);return localPoint(o,p[0],p[1]);},origin=point(0,0),x=point(1,0),y=point(0,1);
  o.pdfNative={resource:key,page:page.pageNumber-1,id:a.id,subtype:a.subtype??'Unknown',matrix:[x[0]-origin[0],x[1]-origin[1],y[0]-origin[0],y[1]-origin[1],...origin],author:a.titleObj?.str,subject:a.subject,fieldName:a.fieldName};o.pdfAnnotationId=a.id;
}
export async function nativePreview(a:any,page:pdfjs.PDFPageProxy,key:string,book:Notebook):Promise<Item>{
  const vp=page.getViewport({scale:1}),rect=a.rect??[0,0,24,24],p=vp.convertToViewportPoint(rect[0],rect[1]),q=vp.convertToViewportPoint(rect[2],rect[3]),x=Math.min(p[0],q[0]),y=Math.min(p[1],q[1]),w=Math.max(1,Math.abs(p[0]-q[0])),h=Math.max(1,Math.abs(p[1]-q[1]));
  const o={...item('image',x,y,w,h,'#000000'),text:a.contentsObj?.str??a.contents??''},canvas=document.createElement('canvas'),scale=Math.min(2,Math.sqrt(1_000_000/(w*h)),8192/w,8192/h);
  canvas.width=Math.max(1,Math.ceil(w*scale));canvas.height=Math.max(1,Math.ceil(h*scale));
  try{
    const list=await page.getOperatorList(),indices=new Set<number>();let selected=false;
    for(let i=0;i<list.fnArray.length;i++){if(list.fnArray[i]===pdfjs.OPS.beginAnnotation)selected=list.argsArray[i][0]===a.id;if(selected||list.fnArray[i]===pdfjs.OPS.dependency)indices.add(i);if(list.fnArray[i]===pdfjs.OPS.endAnnotation)selected=false;}
    const ctx=canvas.getContext('2d')!;
    if(indices.size&&[...indices].some(i=>list.fnArray[i]===pdfjs.OPS.beginAnnotation))await page.render({canvas,canvasContext:ctx,viewport:vp,transform:[scale,0,0,scale,-x*scale,-y*scale],background:'rgba(0,0,0,0)',operationsFilter:i=>indices.has(i)}).promise;
    else if(a.subtype==='FreeText'){ctx.scale(scale,scale);const color=a.defaultAppearanceData?.fontColor??[0,0,0],size=a.defaultAppearanceData?.fontSize||16;ctx.fillStyle=`rgb(${Array.from(color).join(',')})`;ctx.font=`${size}px sans-serif`;ctx.textBaseline='top';String(o.text).split('\n').forEach((line,i)=>ctx.fillText(line,0,i*size*1.2,w));}
    else{ctx.scale(scale,scale);ctx.fillStyle='#f4e4a0';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#887133';ctx.lineWidth=Math.min(2,w/8,h/8);ctx.strokeRect(1,1,Math.max(0,w-2),Math.max(0,h-2));ctx.fillStyle='#40351c';ctx.font=`${Math.max(6,Math.min(14,w/4,h/2))}px sans-serif`;ctx.fillText(a.subtype??'PDF',3,Math.min(h-2,16));}
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('无法生成 PDF 批注预览')),'image/png')),resource=uid();book.resources[resource]={type:'image',mime:'image/png',name:`${a.subtype??'PDF'} annotation.png`,data:encode(new Uint8Array(await blob.arrayBuffer()))};o.resource=resource;bindNative(o,a,page,key);return o;
  }finally{canvas.width=canvas.height=1;}
}
