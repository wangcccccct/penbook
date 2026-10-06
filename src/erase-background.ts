import source from 'penbook:erase-worker';
import type { EraseJob, EraseResult } from './erase-worker';

/** Geometry never runs on Obsidian's UI thread, including release-time splitting. */
export class BackgroundEraser {
  private worker?:Worker;
  private sequence=0;
  private session?:string;
  private known=new WeakSet<object>();
  private idleTimer?:ReturnType<typeof setTimeout>;
  private pending=new Map<number,{resolve:(result:EraseResult)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private start(){
    if(this.worker)return this.worker;
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try{this.worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
    this.worker.onmessage=({data}:MessageEvent<EraseResult>)=>{const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);for(const change of data.changes)for(const entry of change.items)this.known.add(entry.item);data.error?p.reject(new Error(data.error)):p.resolve(data);if(!this.pending.size)this.idleTimer=setTimeout(()=>this.stop(),30000);};
    this.worker.onerror=()=>this.stop(new Error('擦除后台线程无法运行'));
    return this.worker;
  }
  execute(job:Omit<EraseJob,'id'>):Promise<EraseResult>{
    const worker=this.start(),id=++this.sequence;
    if(this.idleTimer!==undefined)clearTimeout(this.idleTimer);this.idleTimer=undefined;
    if(this.session!==job.session){this.session=job.session;this.known=new WeakSet();}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.stop(new Error('擦除计算超时，已停止后台任务并保留已完成的修改')),10000);
      this.pending.set(id,{resolve,reject,timer});
      const items=job.items.map(input=>input.item&&this.known.has(input.item)?{id:input.item.id}:input);
      for(const input of job.items)if(input.item)this.known.add(input.item);
      try{worker.postMessage({...job,items,id});}catch(error){this.stop(error instanceof Error?error:new Error(String(error)));}
    });
  }
  stop(error=new Error('擦除任务已取消')){if(this.idleTimer!==undefined)clearTimeout(this.idleTimer);this.idleTimer=undefined;this.worker?.terminate();this.worker=undefined;this.known=new WeakSet();this.session=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
}
