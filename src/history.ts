import { Item, Notebook, clone } from './model';
export type Snapshot=Pick<Notebook,'pages'|'title'|'cover'|'tags'>;
/** Share unchanged immutable item copies between history entries. */
export class SnapshotStore{
  private items=new WeakMap<Item,{key:string;points:Item['points'];masks:Item['eraseMasks'];ink:Item['frozenInk'];copy:Item}>();
  capture(book:Notebook):Snapshot{
    return{title:book.title,cover:book.cover,tags:[...book.tags],pages:book.pages.map(page=>{
      const items=page.items.map(item=>{
        const {points,eraseMasks,frozenInk,...rest}=item,key=JSON.stringify(rest),cached=this.items.get(item);
        if(cached&&cached.key===key&&cached.points===points&&cached.masks===eraseMasks&&cached.ink===frozenInk)return cached.copy;
        const copy=clone(item);this.items.set(item,{key,points,masks:eraseMasks,ink:frozenInk,copy});return copy;
      });
      const {items:ignored,...rest}=page;return{...clone(rest),items};
    })};
  }
  clear(){this.items=new WeakMap();}
}
/** Estimate unique retained data without serializing point arrays. */
export function historyWeight(snapshots:Snapshot[]){
  const seen=new Set<Item>();let bytes=0;
  for(const snapshot of snapshots){bytes+=snapshot.pages.length*256;for(const page of snapshot.pages)for(const item of page.items){if(seen.has(item))continue;seen.add(item);bytes+=512+(item.text?.length??0)*2+(item.points?.length??0)*32;for(const polygon of item.eraseMasks??[])for(const ring of polygon)bytes+=ring.length*24;for(const ring of item.frozenInk??[])bytes+=ring.length*24;}}
  return bytes;
}
