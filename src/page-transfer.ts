import { Notebook, Page, clone, uid } from './model';

export function copyPages(pages:Page[],source:Notebook,target:Notebook,pageUrl?:(id:string)=>string):Page[]{
  const ids=new Map(pages.map(p=>[p.id,uid()])),resources=new Map<string,string>(),groups=new Map<string,string>();
  const resource=(key:string)=>{
    if(resources.has(key))return resources.get(key)!;
    const value=source.resources[key];if(!value)throw new Error('页面资源缺失');
    const existing=Object.entries(target.resources).find(([,r])=>r===value||r.type===value.type&&r.data===value.data);
    const id=existing?.[0]??uid();target.resources[id]=value;resources.set(key,id);return id;
  };
  return pages.map(original=>{
    const p=clone(original);p.id=ids.get(original.id)!;
    if(p.background)p.background.resource=resource(p.background.resource);
    for(const o of p.items){o.id=uid();if(o.resource)o.resource=resource(o.resource);if(o.pdfNative)o.pdfNative.resource=resource(o.pdfNative.resource);if(o.group){if(!groups.has(o.group))groups.set(o.group,uid());o.group=groups.get(o.group);}}
    for(const link of p.pdfLinks??[]){if(!link.page)continue;const id=ids.get(link.page);if(id)link.page=id;else if(!target.pages.some(p=>p.id===link.page)){if(pageUrl)link.url=pageUrl(link.page);delete link.page;}}
    return p;
  });
}
