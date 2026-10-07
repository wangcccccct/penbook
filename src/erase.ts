import { difference, intersection, union, MultiPolygon, Pair } from './ink-geometry';
import { Item, Point, localPoint, uid } from './model';
const SEGMENT_LENGTH=3;
let geometryWarningShown=false;
type Chunk={a:Pair;b:Pair;ring:Pair[]};
type ChunkIndex={points:Item['points'];half:number;cells:Map<string,Chunk[]>};
const chunkIndexes=new WeakMap<Item,ChunkIndex>();
const geometry=new WeakMap<Item,{outline:number[][];ink:MultiPolygon;visible:MultiPolygon;masks:Item['eraseMasks'];frozen:Item['frozenInk']}>();

function distance(p:Pair,a:Pair,b:Pair){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}
/** Clipping emits counterclockwise outer rings followed by clockwise holes. */
function frozenGeometry(rings:Pair[][]):MultiPolygon{
  const polygons:MultiPolygon=[];
  for(const ring of rings){let area=0;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}if(area>=0||!polygons.length)polygons.push([ring]);else polygons[polygons.length-1].push(ring);}
  return polygons;
}
function standardMask(o:Item,center:Pair,r:number,half:number):MultiPolygon{
  const cellSize=48;let index=chunkIndexes.get(o);
  if(!index||index.points!==o.points||index.half!==half){
    const cells=new Map<string,Chunk[]>(),add=(chunk:Chunk)=>{const xs=chunk.ring.map(p=>p[0]),ys=chunk.ring.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/cellSize);x<=Math.floor(Math.max(...xs)/cellSize);x++)for(let y=Math.floor(Math.min(...ys)/cellSize);y<=Math.floor(Math.max(...ys)/cellSize);y++){const key=`${x},${y}`,bucket=cells.get(key)??[];bucket.push(chunk);cells.set(key,bucket);}};
    let cursor:Pair|undefined,start:Pair|undefined,remaining=SEGMENT_LENGTH;
    const segment=(a:Pair,b:Pair)=>{const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-4)return;const dx=(b[0]-a[0])/length,dy=(b[1]-a[1])/length;add({a,b,ring:[[a[0]-dy*half,a[1]+dx*half],[b[0]-dy*half,b[1]+dx*half],[b[0]+dy*half,b[1]-dx*half],[a[0]+dy*half,a[1]-dx*half]]});};
    for(const p of o.points??[]){if(!cursor){cursor=start=[p[0],p[1]];continue;}let length=Math.hypot(p[0]-cursor[0],p[1]-cursor[1]);while(length>1e-7){const step=Math.min(length,remaining),end:Pair=[cursor[0]+(p[0]-cursor[0])*step/length,cursor[1]+(p[1]-cursor[1])*step/length];cursor=end;remaining-=step;if(remaining<1e-7){segment(start!,end);start=end;remaining=SEGMENT_LENGTH;}length=Math.hypot(p[0]-cursor[0],p[1]-cursor[1]);}}if(start&&cursor)segment(start,cursor);
    index={points:o.points,half,cells};chunkIndexes.set(o,index);
  }
  const reach=r+half/2,minX=Math.floor((center[0]-reach)/cellSize),maxX=Math.floor((center[0]+reach)/cellSize),minY=Math.floor((center[1]-reach)/cellSize),maxY=Math.floor((center[1]+reach)/cellSize),candidates=new Set<Chunk>();
  for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(const chunk of index.cells.get(`${x},${y}`)??[])candidates.add(chunk);
  const hit=[...candidates].filter(chunk=>distance(center,chunk.a,chunk.b)<=reach).map(chunk=>chunk.ring);
  return hit.map(ring=>[ring]);
}
/** Cheap local-space rejection before building outlines or running polygon clipping. */
export function eraserMayTouch(o:Item,point:Point,radius:number){const[x,y]=localPoint(o,point[0],point[1]),rx=radius*o.bw/Math.max(.001,o.w),ry=radius*o.bh/Math.max(.001,o.h);return x>=-rx&&y>=-ry&&x<=o.bw+rx&&y<=o.bh+ry;}
/** Freeze the original stroke and remove polygons, never recompute a fragment's tips. */
export function eraseStroke(o:Item,point:Point,radius:number,standard:boolean,whole:boolean,outline:number[][]):boolean{
  try{
  if(outline.length<3)return false;
  let cached=geometry.get(o);
  if(!cached||cached.outline!==outline||cached.frozen!==o.frozenInk){const ink:MultiPolygon=o.frozenInk?frozenGeometry(o.frozenInk):union([outline.map(p=>[p[0],p[1]] as Pair)]);cached={outline,ink,visible:o.eraseMasks?.length?difference(ink,o.eraseMasks):ink,masks:o.eraseMasks,frozen:o.frozenInk};geometry.set(o,cached);}
  else if(cached.masks!==o.eraseMasks){cached.visible=o.eraseMasks?.length?difference(cached.ink,o.eraseMasks):cached.ink;cached.masks=o.eraseMasks;}
  const {visible}=cached;
  const disk:Pair[]=Array.from({length:48},(_,i)=>localPoint(o,point[0]+radius*Math.cos(i*Math.PI/24),point[1]+radius*Math.sin(i*Math.PI/24)));
  if(!intersection(visible,[[disk]]).length)return false;
  if(whole)return true;
  let masks:MultiPolygon=[[disk]];
  if(standard){
    const center=localPoint(o,point[0],point[1]),r=radius*Math.max(o.bw/o.w,o.bh/o.h),half=(o.width??3)*2+2;
    // Segment selection cannot remove ink outside the cursor footprint.
    const chunks=standardMask(o,center,r,half);if(chunks.length)masks=intersection(chunks,[[disk]]);
  }
  const remaining=difference(visible,...masks.map(polygon=>[polygon]));
  if(!remaining.length)return true;
  // Store only ink that still exists, never a growing mask outside the ink.
  o.frozenInk=remaining.flat();o.eraseMasks=undefined;
  cached.visible=remaining;cached.ink=remaining;cached.masks=undefined;cached.frozen=o.frozenInk;return false;
  }catch(error){if(!geometryWarningShown){geometryWarningShown=true;console.warn('Penbook: 跳过了一个无法稳定处理的擦除区域。',error);}return false;}
}

export function erasureClipPath(o:Item){const path=(rings:Pair[][])=>rings.map(ring=>ring.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ')+'Z').join(' ');try{if(o.frozenInk){if(!o.eraseMasks?.length)return path(o.frozenInk);const ink=frozenGeometry(o.frozenInk);return path((o.eraseMasks?.length?difference(ink,o.eraseMasks):ink).flat());}const pad=(o.width??3)*8+32;return `M${-pad},${-pad}H${o.bw+pad}V${o.bh+pad}H${-pad}Z `+path((o.eraseMasks??[]).flat());}catch(error){if(!geometryWarningShown){geometryWarningShown=true;console.warn('Penbook: 暂时显示完整笔迹，无法绘制擦除裁剪区域。',error);}const pad=(o.width??3)*8+32;return `M${-pad},${-pad}H${o.bw+pad}V${o.bh+pad}H${-pad}Z`;}}

/** Split connected remnants while retaining the original outline and cut edge geometry. */
export function splitErasedStroke(o:Item,outline:number[][]):Item[]{
  try{
  if(outline.length<3||!o.frozenInk&&!o.eraseMasks?.length)return[o];
  const ink:MultiPolygon=o.frozenInk?frozenGeometry(o.frozenInk):union([outline.map(p=>[p[0],p[1]] as Pair)]),visible=o.eraseMasks?.length?difference(ink,o.eraseMasks):ink;
  if(visible.length<2)return[o];
  const sx=o.w/o.bw,sy=o.h/o.bh,angle=o.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  return visible.map(polygon=>{
    const vertices=polygon.flat(),xs=vertices.map(p=>p[0]),ys=vertices.map(p=>p[1]);
    const left=Math.min(...xs),top=Math.min(...ys),bw=Math.max(.001,Math.max(...xs)-left),bh=Math.max(.001,Math.max(...ys)-top),w=bw*sx,h=bh*sy;
    const dx=(left+bw/2)*sx-o.w/2,dy=(top+bh/2)*sy-o.h/2;
    const shifted=polygon.map(ring=>ring.map(p=>[p[0]-left,p[1]-top] as Pair));
    return{...o,id:uid(),group:undefined,x:o.x+o.w/2+dx*cos-dy*sin-w/2,y:o.y+o.h/2+dx*sin+dy*cos-h/2,w,h,bw,bh,points:o.points?.map(p=>[p[0]-left,p[1]-top,p[2]] as Point),pdfMarkup:o.pdfMarkup?{...o.pdfMarkup,quadPoints:o.pdfMarkup.quadPoints?.map(p=>[p[0]-left,p[1]-top,p[2]] as Point)}:undefined,frozenInk:shifted,eraseMasks:undefined};
  });
  }catch(error){if(!geometryWarningShown){geometryWarningShown=true;console.warn('Penbook: 保留笔迹，未能完成断开分段。',error);}return[o];}
}
