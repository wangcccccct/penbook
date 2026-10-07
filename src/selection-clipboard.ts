import { Item, Notebook, clone, uid } from './model';
export interface SelectionClipboard { items:Item[]; resources:Notebook['resources']; }
export function selectionClipboard(items:Item[],book:Notebook):SelectionClipboard {
  const resources:Notebook['resources']={};
  for(const o of items)for(const key of[o.resource,o.pdfNative?.resource])if(key&&book.resources[key])resources[key]=book.resources[key];
  return {items:clone(items),resources:{...resources}};
}
export function pasteItems(clipboard:SelectionClipboard,book:Notebook,offset=20):Item[] {
  const groups=new Map<string,string>(),resources=new Map<string,string>();
  for(const [key,resource]of Object.entries(clipboard.resources)){
    const existing=Object.entries(book.resources).find(([,r])=>r===resource||r.type===resource.type&&r.data===resource.data);
    const target=existing?.[0]??uid();resources.set(key,target);if(!existing)book.resources[target]=resource;
  }
  return clone(clipboard.items).map(o=>{
    o.id=uid();o.x+=offset;o.y+=offset;o.locked=false;delete o.pdfAnnotationId;
    if(o.resource)o.resource=resources.get(o.resource)??o.resource;
    if(o.pdfNative)o.pdfNative.resource=resources.get(o.pdfNative.resource)??o.pdfNative.resource;
    if(o.group){if(!groups.has(o.group))groups.set(o.group,uid());o.group=groups.get(o.group);}
    return o;
  });
}
