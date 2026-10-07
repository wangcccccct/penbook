import { getStroke } from 'perfect-freehand';
import { Item, Page, Notebook, resourceUrl } from './model';
import { erasureClipPath } from './erase';
import { BudgetCache } from './resources';
import { tableSize, wrapText } from './table';

export class Renderer {
  private outlines=new BudgetCache<Item,{points:Item['points'];key:string;outline:number[][]}>(24*1024*1024);
  private outlineKey(o:Item){return `${o.width}:${o.pen}:${JSON.stringify(o.ink)}`;}
  cacheOutline(o:Item,outline:number[][]){this.outlines.set(o,{points:o.points,key:this.outlineKey(o),outline},outline.length*48);}
  private clips=new BudgetCache<Item,{masks:Item['eraseMasks'];ink:Item['frozenInk'];path:Path2D;inkPath?:Path2D}>(16*1024*1024);
  cacheClip(o:Item,clip:string){this.clips.set(o,{masks:o.eraseMasks,ink:o.frozenInk,path:new Path2D(clip)},clip.length*4);}
  private clip(o:Item){let cached=this.clips.get(o);if(cached&&cached.masks===o.eraseMasks&&cached.ink===o.frozenInk)return cached;
    // Two intersecting clips avoid polygon boolean operations on the UI thread.
    const clip=erasureClipPath({...o,frozenInk:undefined}),ink=o.frozenInk?.map(ring=>ring.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ')+'Z').join(' '),entry={masks:o.eraseMasks,ink:o.frozenInk,path:new Path2D(clip),inkPath:ink?new Path2D(ink):undefined};this.clips.set(o,entry,(clip.length+(ink?.length??0))*4);return entry;
  }
  strokeOutline(o:Item){
    if(o.frozenInk)return o.frozenInk[0];
    const cached=this.outlines.get(o),key=this.outlineKey(o);if(cached&&cached.points===o.points&&cached.key===key)return cached.outline;
    const profile=o.ink,squeeze=1-(profile?.flatness??0)/160,points=(o.points??[]).map(p=>[p[0],p[1]/squeeze,p[2]]);
    const outline=getStroke(points,{size:o.width??3,thinning:o.pen==='ballpoint'||o.pen==='highlighter'?0:(profile?.sensitivity??50)/100,smoothing:.45+(profile?.stability??0)/200,streamline:profile?.reduceLatency===false?.4:(profile?.stability??0)/125,simulatePressure:false,last:true,start:{taper:0,cap:true},end:{taper:0,cap:true}}).map(p=>[p[0],p[1]*squeeze]);this.cacheOutline(o,outline);return outline;
  }
  images = new Map<string, Promise<HTMLImageElement>>();
  loadedImages = new BudgetCache<string, HTMLImageElement>(64*1024*1024);
  private generation=0;
  private paperTiles=new BudgetCache<string,HTMLCanvasElement>(1024*1024,canvas=>{canvas.width=canvas.height=1;});
  private textLayouts=new BudgetCache<Item,{key:string;lines:string[]}>(4*1024*1024);
  private textLines(ctx:CanvasRenderingContext2D,o:Item){const text=o.text??'',key=`${ctx.font}:${o.bw}:${text}`,cached=this.textLayouts.get(o);if(cached?.key===key)return cached.lines;const lines:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const ch of paragraph){if(ctx.measureText(line+ch).width>o.bw-16&&line){lines.push(line);line='';}line+=ch;}lines.push(line);}this.textLayouts.set(o,{key,lines},512+key.length*2+lines.reduce((sum,line)=>sum+line.length*2,0));return lines;}
  clear() { this.generation++;this.images.clear();this.loadedImages.clear();this.outlines.clear();this.clips.clear();this.paperTiles.clear();this.textLayouts.clear(); }
  cachedImage(key:string){return this.loadedImages.get(key);}
  image(key: string, book: Notebook): Promise<HTMLImageElement> {
    const loaded=this.loadedImages.get(key);if(loaded)return Promise.resolve(loaded);
    let p = this.images.get(key);
    if (!p) {
      const generation=this.generation;
      p = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image(); img.onload = () => {if(generation===this.generation)this.loadedImages.set(key,img,img.naturalWidth*img.naturalHeight*4);resolve(img);}; img.onerror = () => reject(new Error('无法加载图片'));
        const r = book.resources[key]; if (!r) { reject(new Error('图片资源缺失')); return; } img.src = resourceUrl(r);
      }).finally(()=>{if(this.images.get(key)===p)this.images.delete(key);}); this.images.set(key, p);
    }
    return p;
  }
  paper(ctx: CanvasRenderingContext2D, p: Page) {
    ctx.fillStyle = p.color; ctx.fillRect(0, 0, p.width, p.height);
    ctx.strokeStyle = '#9ba8b544'; ctx.lineWidth = 0.7; ctx.fillStyle = '#8898a977';
    const s = Math.max(8, p.spacing);
    if (p.paper === 'dots') {
      if(s>=p.width||s>=p.height)return;
      const size=Math.min(512,Math.max(1,Math.ceil(s*Math.min(2,Math.max(.25,Math.abs(ctx.getTransform().a)))))),density=size/s,key=`${s}:${size}`;
      let tile=this.paperTiles.get(key);if(!tile){tile=document.createElement('canvas');tile.width=tile.height=size;const ink=tile.getContext('2d')!;ink.scale(density,density);ink.fillStyle='#8898a977';for(const x of[0,s])for(const y of[0,s]){ink.beginPath();ink.arc(x,y,1,0,Math.PI*2);ink.fill();}this.paperTiles.set(key,tile,size*size*4);}
      const pattern=ctx.createPattern(tile,'repeat');if(pattern){pattern.setTransform(new DOMMatrix([1/density,0,0,1/density,0,0]));ctx.fillStyle=pattern;ctx.fillRect(s-2,s-2,Math.max(0,p.width-s),Math.max(0,p.height-s));}
      return;
    }
    ctx.beginPath();
    if (['ruled','grid','cornell'].includes(p.paper)) for (let y = s * 2; y < p.height - s; y += s) { ctx.moveTo(s,y); ctx.lineTo(p.width-s,y); }
    if (p.paper === 'grid') for (let x = s; x < p.width; x += s) { ctx.moveTo(x,s); ctx.lineTo(x,p.height-s); }
    if (p.paper === 'cornell') { ctx.moveTo(p.width*.28,s); ctx.lineTo(p.width*.28,p.height*.8); ctx.moveTo(s,p.height*.8); ctx.lineTo(p.width-s,p.height*.8); }
    if (p.paper === 'music') for (let y = s*2; y < p.height-s*4; y += s*4) for (let j=0;j<5;j++) { ctx.moveTo(s,y+j*8); ctx.lineTo(p.width-s,y+j*8); }
    if (p.paper === 'planner') {
      const cell = (p.width-2*s)/7;
      for (let i=0;i<=7;i++) { ctx.moveTo(s+i*cell,s*3); ctx.lineTo(s+i*cell,p.height-s); }
      for (let i=0;i<=6;i++) { const y = s*3 + (p.height-s*4)*i/6; ctx.moveTo(s,y); ctx.lineTo(p.width-s,y); }
      ctx.save(); ctx.font = '14px sans-serif'; ctx.fillStyle = '#64748b';
      ['一','二','三','四','五','六','日'].forEach((v,i)=>ctx.fillText(v,s+i*cell+10,s*2)); ctx.restore();
    }
    if(['tasks','swot','kanban','finance'].includes(p.paper)){
      const columns=p.paper==='swot'?2:p.paper==='kanban'?3:p.paper==='finance'?4:2,rows=p.paper==='swot'?2:p.paper==='kanban'?1:12;
      for(let i=0;i<=columns;i++){const x=s+(p.width-s*2)*i/columns;ctx.moveTo(x,s*3);ctx.lineTo(x,p.height-s);}
      for(let i=0;i<=rows;i++){const y=s*3+(p.height-s*4)*i/rows;ctx.moveTo(s,y);ctx.lineTo(p.width-s,y);}
      ctx.save();ctx.font='16px sans-serif';ctx.fillStyle='#64748b';const labels=p.paper==='swot'?['优势','劣势']:p.paper==='kanban'?['待办','进行中','已完成']:p.paper==='finance'?['日期','项目','收入','支出']:['任务','状态'];labels.forEach((t,i)=>ctx.fillText(t,s+(p.width-s*2)*i/columns+12,s*2));ctx.restore();
    }
    ctx.stroke();
  }
  async objects(ctx: CanvasRenderingContext2D, p: Page, book: Notebook) {
    for (const o of p.items) { const img = o.resource ? await this.image(o.resource,book) : undefined; this.draw(ctx,o,img); }
  }
  draw(ctx: CanvasRenderingContext2D, o: Item, img?: HTMLImageElement) {
    ctx.save(); ctx.translate(o.x+o.w/2,o.y+o.h/2); ctx.rotate(o.rotation*Math.PI/180); ctx.translate(-o.w/2,-o.h/2);
    ctx.scale(o.w/o.bw,o.h/o.bh); ctx.globalAlpha=o.opacity; ctx.fillStyle=o.color; ctx.strokeStyle=o.color;
    const w=o.bw,h=o.bh; ctx.lineWidth=o.width??2; ctx.lineCap='round'; ctx.lineJoin='round';
    if (o.kind==='stroke') {
      const profile=o.ink,style=o.strokeStyle??profile?.style??'solid';
      if(o.eraseMasks?.length||o.frozenInk&&style!=='solid'){const cached=this.clip(o);if(cached.inkPath)ctx.clip(cached.inkPath,'evenodd');ctx.clip(cached.path,'evenodd');}
      if(style!=='solid'){ctx.setLineDash(style==='dashed'?[ctx.lineWidth*4,ctx.lineWidth*2]:[.1,ctx.lineWidth*2]);const points=o.points??[];if(points.length){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(const p of points.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();}ctx.restore();return;}
      if(o.frozenInk){const cached=this.clip(o);ctx.fill(cached.inkPath??cached.path,'evenodd');ctx.restore();return;}
      const pts = this.strokeOutline(o);
      if (pts.length) { ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.closePath(); ctx.fill(); }
    } else if (o.kind==='image' && img) {
      const c=o.crop; if(c) ctx.drawImage(img,c.x*img.width,c.y*img.height,c.w*img.width,c.h*img.height,0,0,w,h); else ctx.drawImage(img,0,0,w,h);
    } else if(o.kind==='shape') {
      ctx.beginPath();
      ctx.setLineDash(o.strokeStyle==='dashed'?[ctx.lineWidth*4,ctx.lineWidth*2]:o.strokeStyle==='dotted'?[.1,ctx.lineWidth*2]:[]);
      if(o.shape==='rectangle') ctx.rect(0,0,w,h);
      else if(o.shape==='rounded')ctx.roundRect(0,0,w,h,Math.min(20,w/4,h/4));
      else if(o.shape==='diamond'){ctx.moveTo(w/2,0);ctx.lineTo(w,h/2);ctx.lineTo(w/2,h);ctx.lineTo(0,h/2);ctx.closePath();}
      else if(o.shape==='ellipse') ctx.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2);
      else if(o.shape==='triangle') { const vertices=o.points?.length===3?o.points:[[w/2,0],[w,h],[0,h]];ctx.moveTo(vertices[0][0],vertices[0][1]);for(const p of vertices.slice(1))ctx.lineTo(p[0],p[1]);ctx.closePath(); }
      else { const a=o.points?.[0]??[0,0], b=o.points?.[1]??[w,h]; ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]); if(o.shape==='arrow') { const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),l=16; ctx.moveTo(b[0]-l*Math.cos(angle-.45),b[1]-l*Math.sin(angle-.45)); ctx.lineTo(b[0],b[1]); ctx.lineTo(b[0]-l*Math.cos(angle+.45),b[1]-l*Math.sin(angle+.45)); } }
      if(o.fill&&!['line','arrow'].includes(o.shape??'')){ctx.save();ctx.globalAlpha*=.2;ctx.fill();ctx.restore();}
      ctx.stroke();
    } else if(o.kind==='tape'){ctx.globalAlpha*=o.revealed?.16:1;if(o.points){const pts=getStroke(o.points,{size:o.width??24,thinning:0,simulatePressure:false});if(pts.length){ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);for(const p of pts.slice(1))ctx.lineTo(p[0],p[1]);ctx.closePath();ctx.fill();}}else ctx.fillRect(0,0,w,h);
    } else if(o.kind==='table') {
      const {rows,columns:cols}=tableSize(o);ctx.beginPath();for(let i=0;i<=rows;i++){ctx.moveTo(0,h*i/rows);ctx.lineTo(w,h*i/rows);}for(let i=0;i<=cols;i++){ctx.moveTo(w*i/cols,0);ctx.lineTo(w*i/cols,h);}ctx.stroke();
      const size=o.fontSize??16,cw=w/cols,ch=h/rows;ctx.font=`${size}px ${o.font??'sans-serif'}`;ctx.textBaseline='top';ctx.textAlign='left';
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        ctx.save();ctx.beginPath();ctx.rect(c*cw+3,r*ch+3,Math.max(0,cw-6),Math.max(0,ch-6));ctx.clip();
        wrapText(o.cells?.[r]?.[c]??'',Math.max(1,cw-12),text=>ctx.measureText(text).width).forEach((line,i)=>ctx.fillText(line,c*cw+6,r*ch+6+i*size*1.25));ctx.restore();
      }
    } else {
      if(o.kind==='sticky') { ctx.fillStyle=o.backgroundColor??'#fff2a8';ctx.fillRect(0,0,w,h);ctx.fillStyle=o.color; }
      ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
      const size=o.fontSize??22;ctx.font=`${o.italic?'italic ':''}${o.bold?'bold ':''}${size}px ${o.font??'sans-serif'}`;ctx.textBaseline='top';ctx.textAlign=o.align??'left';
      let y=8;const lineHeight=o.lineHeight??1.4;for(const line of this.textLines(ctx,o)){ctx.fillText(line,ctx.textAlign==='center'?w/2:ctx.textAlign==='right'?w-8:8,y);y+=size*lineHeight;}
      if(o.kind==='link'){ctx.strokeStyle=o.color;ctx.beginPath();ctx.moveTo(8,size+10);ctx.lineTo(w-8,size+10);ctx.stroke();}
    }
    ctx.restore();
  }
}
