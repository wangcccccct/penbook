import { getStroke } from 'perfect-freehand';
import { Item, Notebook, resourceUrl } from './model';
import { Renderer } from './render';
import { erasureClipPath } from './erase';
import { tableSize, wrapText } from './table';

export const escapeXml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const number=(value:number)=>Math.abs(value)<.000001?'0':value.toFixed(6).replace(/\.?0+$/,'');
const ringPath=(rings:number[][][])=>rings.map(points=>points.map((p,i)=>`${i?'L':'M'}${number(p[0])},${number(p[1])}`).join(' ')+'Z').join(' ');
export function itemSvg(o:Item,book:Notebook,renderer:Renderer,ctx:CanvasRenderingContext2D,id:string):string {
  const w=o.bw,h=o.bh,color=escapeXml(o.color),width=o.width??2;
  const transform=`translate(${o.x+o.w/2} ${o.y+o.h/2}) rotate(${o.rotation}) translate(${-o.w/2} ${-o.h/2}) scale(${o.w/w} ${o.h/h})`;
  const dash=o.strokeStyle??o.ink?.style??'solid',stroke=`stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash==='solid'?'':` stroke-dasharray="${dash==='dashed'?`${width*4} ${width*2}`:`0.1 ${width*2}`}"`}`;
  let content='',defs='';
  const clipped=(body:string,x=0,y=0,cw=w,ch=h,key=id)=>{
    defs+=`<clipPath id="clip-${key}"><rect x="${x}" y="${y}" width="${cw}" height="${ch}"/></clipPath>`;
    return `<g clip-path="url(#clip-${key})">${body}</g>`;
  };
  const text=(value:string,x:number,y:number,cw:number,size:number,align:CanvasTextAlign='left')=>{
    ctx.font=`${o.italic?'italic ':''}${o.bold?'bold ':''}${size}px ${o.font??'sans-serif'}`;
    const lines=wrapText(value,Math.max(1,cw),v=>ctx.measureText(v).width),anchor=align==='center'?'middle':align==='right'?'end':'start';
    return `<text x="${x}" y="${y}" dominant-baseline="hanging" text-anchor="${anchor}" fill="${color}" font-family="${escapeXml(o.font??'sans-serif')}" font-size="${size}"${o.bold?' font-weight="bold"':''}${o.italic?' font-style="italic"':''}>${lines.map((line,i)=>`<tspan x="${x}" dy="${i?size*(o.lineHeight??(o.kind==='table'?1.25:1.4)):0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
  };
  if(o.kind==='stroke'){
    let path:string;
    if(dash==='solid')path=ringPath(o.frozenInk??[renderer.strokeOutline(o)]);
    else path=(o.points??[]).map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ');
    content=`<path d="${path}" ${dash==='solid'?`fill="${color}" fill-rule="evenodd"`:`fill="none" ${stroke}`}/>`;
    if(o.eraseMasks?.length||o.frozenInk&&dash!=='solid'){
      defs+=`<clipPath id="erase-${id}"><path d="${erasureClipPath(o)}" clip-rule="evenodd"/></clipPath>`;
      content=`<g clip-path="url(#erase-${id})">${content}</g>`;
    }
  }else if(o.kind==='image'){
    const resource=o.resource&&book.resources[o.resource];if(!resource)return '';
    const c=o.crop??{x:0,y:0,w:1,h:1};
    content=`<svg width="${w}" height="${h}" viewBox="${c.x} ${c.y} ${c.w} ${c.h}" preserveAspectRatio="none"><image width="1" height="1" preserveAspectRatio="none" href="${escapeXml(resourceUrl(resource))}"/></svg>`;
  }else if(o.kind==='shape'){
    let d='';const filled=o.fill&&!['line','arrow'].includes(o.shape??''),paint=`fill="${filled?color:'none'}"${filled?' fill-opacity="0.2"':''} ${stroke}`;
    if(o.shape==='rectangle'||o.shape==='rounded')content=`<rect width="${w}" height="${h}"${o.shape==='rounded'?` rx="${Math.min(20,w/4,h/4)}"`:''} ${paint}/>`;
    else if(o.shape==='ellipse')content=`<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" ${paint}/>`;
    else {
      if(o.shape==='triangle')d=ringPath([o.points?.length===3?o.points:[[w/2,0],[w,h],[0,h]]]);
      else if(o.shape==='diamond')d=`M${w/2},0 L${w},${h/2} L${w/2},${h} L0,${h/2} Z`;
      else{const a=o.points?.[0]??[0,0],b=o.points?.[1]??[w,h],angle=Math.atan2(b[1]-a[1],b[0]-a[0]);d=`M${a[0]},${a[1]} L${b[0]},${b[1]}`;if(o.shape==='arrow')d+=` M${b[0]-16*Math.cos(angle-.45)},${b[1]-16*Math.sin(angle-.45)} L${b[0]},${b[1]} L${b[0]-16*Math.cos(angle+.45)},${b[1]-16*Math.sin(angle+.45)}`;}
      content=`<path d="${d}" ${paint}/>`;
    }
  }else if(o.kind==='tape'){
    content=o.points?`<path d="${ringPath([getStroke(o.points,{size:o.width??24,thinning:0,simulatePressure:false})])}" fill="${color}"/>`:`<rect width="${w}" height="${h}" fill="${color}"/>`;
  }else if(o.kind==='table'){
    const {rows,columns}=tableSize(o),cw=w/columns,ch=h/rows;let d='';
    for(let r=0;r<=rows;r++)d+=`M0,${r*ch} L${w},${r*ch} `;
    for(let c=0;c<=columns;c++)d+=`M${c*cw},0 L${c*cw},${h} `;
    content=`<path d="${d}" fill="none" ${stroke}/>`;
    for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)content+=clipped(text(o.cells?.[r]?.[c]??'',c*cw+6,r*ch+6,cw-12,o.fontSize??16),c*cw+3,r*ch+3,Math.max(0,cw-6),Math.max(0,ch-6),`${id}-${r}-${c}`);
  }else{
    if(o.kind==='sticky')content+=`<rect width="${w}" height="${h}" fill="${escapeXml(o.backgroundColor??'#fff2a8')}"/>`;
    const align=o.align??'left',x=align==='center'?w/2:align==='right'?w-8:8,size=o.fontSize??22;
    content+=clipped(text(o.text??'',x,8,w-16,size,align));
    if(o.kind==='link')content+=`<path d="M8,${size+10} L${w-8},${size+10}" fill="none" ${stroke}/>`;
  }
  return `<g transform="${transform}" opacity="${o.opacity*(o.kind==='tape'&&o.revealed?0.16:1)}">${defs?`<defs>${defs}</defs>`:''}${content}</g>`;
}
