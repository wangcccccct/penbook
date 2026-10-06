import { Item, Point } from './model';
import { eraseStroke, eraserMayTouch, erasureClipPath, splitErasedStroke } from './erase';

export interface EraseJob { id:number; session?:string; items:{id?:string;item?:Item;outline?:number[][]}[]; segments:{from:Point;to:Point}[]; radius:number; standard:boolean; whole:boolean; split?:boolean }
export interface EraseResult { id:number; changes:{id:string;items:{item:Item;clip:string}[]}[]; error?:string }
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<EraseJob>)=>void;postMessage:(result:EraseResult)=>void};
let session:string|undefined;const sources=new Map<string,{item:Item;outline:number[][]}>();
scope.onmessage=({data:job})=>{
  try{
    if(session!==job.session){sources.clear();session=job.session;}
    const changes:EraseResult['changes']=[];
    for(const input of job.items){
      const id=input.id??input.item?.id;if(!id)throw new Error('缺少笔迹标识');
      if(input.item&&input.outline)sources.set(id,{item:input.item,outline:input.outline});
      const source=sources.get(id);if(!source)throw new Error('擦除缓存已失效');const {item,outline}=source;
      if(job.split){changes.push({id:item.id,items:splitErasedStroke(item,outline).map(item=>({item,clip:erasureClipPath(item)}))});continue;}
      let changed=false,removed=false;
      for(const {from,to} of job.segments){
        const steps=Math.max(1,Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/Math.max(2,job.radius/2)));
        for(let i=1;i<=steps;i++){
          const point:Point=[from[0]+(to[0]-from[0])*i/steps,from[1]+(to[1]-from[1])*i/steps,to[2]];
          if(!eraserMayTouch(item,point,job.radius))continue;
          const masks=item.eraseMasks,frozen=item.frozenInk;
          removed=eraseStroke(item,point,job.radius,job.standard,job.whole,outline);
          changed=changed||removed||masks!==item.eraseMasks||frozen!==item.frozenInk;
          if(removed)break;
        }
        if(removed)break;
      }
      if(changed)changes.push({id:item.id,items:removed?[]:[{item,clip:erasureClipPath(item)}]});
    }
    scope.postMessage({id:job.id,changes});if(job.split)sources.clear();
  }catch(error){scope.postMessage({id:job.id,changes:[],error:String(error)});}
};
