/** Byte/weight bounded LRU. The newest entry is retained only if it fits. */
export class BudgetCache<K,V>{
  private entries=new Map<K,{value:V;weight:number}>();
  private used=0;
  constructor(readonly budget:number,private dispose?:(value:V)=>void){}
  get size(){return this.entries.size;}
  get weight(){return this.used;}
  get(key:K){const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
  set(key:K,value:V,weight:number){this.delete(key);if(weight>this.budget)return false;this.entries.set(key,{value,weight});this.used+=weight;while(this.used>this.budget){const oldest=this.entries.keys().next().value!;this.delete(oldest);}return true;}
  delete(key:K){const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);this.used-=entry.weight;this.dispose?.(entry.value);}
  clear(){for(const key of this.entries.keys())this.delete(key);}
}

/** Limit concurrent raster jobs, and skip queued work whose view was discarded. */
export class RenderQueue{
  private running=0;
  private waiting:(()=>void)[]=[];
  constructor(private limit=2){}
  async run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(this.running>=this.limit)await new Promise<void>((resolve,reject)=>{
      const ready=()=>{signal?.removeEventListener('abort',abort);resolve();};
      const abort=()=>{const i=this.waiting.indexOf(ready);if(i>=0)this.waiting.splice(i,1);reject(new DOMException('Cancelled','AbortError'));};
      this.waiting.push(ready);signal?.addEventListener('abort',abort,{once:true});
    });
    else this.running++;
    try{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');return await work();}
    finally{const next=this.waiting.shift();if(next)next();else this.running--;}
  }
}
