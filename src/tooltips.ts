/** Suppress native/Obsidian titles and show a single tooltip after deliberate hover. */
export function installTooltips(){
  let labelId=0;
  const labels=new WeakMap<Element,HTMLElement>();
  let timer:number|undefined,tip:HTMLElement|undefined,target:HTMLElement|undefined;
  const clear=()=>{if(timer!==undefined)window.clearTimeout(timer);timer=undefined;tip?.remove();tip=undefined;target=undefined;};
  const convert=(el:Element)=>{if(!(el instanceof HTMLElement)||!el.closest('.pb-root,.pb-popover,.pb-notebook-modal'))return;const label=el.getAttribute('title')??el.getAttribute('aria-label');if(!label)return;const interactive=el.matches('button,input,select,[role=button]');if(interactive){el.dataset.pbTooltip=label;if(el.hasAttribute('aria-label')){let span=labels.get(el);if(!span?.isConnected){span=document.createElement('span');span.hidden=true;span.id=`pb-label-${++labelId}`;el.insertAdjacentElement('afterend',span);labels.set(el,span);}span.textContent=el.getAttribute('aria-label');el.setAttribute('aria-labelledby',span.id);}}else el.setAttribute('aria-description',label);el.removeAttribute('title');el.removeAttribute('aria-label');};
  const scan=(node:Node)=>{if(!(node instanceof Element))return;if(node.closest('.pb-root,.pb-popover,.pb-notebook-modal')){convert(node);node.querySelectorAll('[title],[aria-label]').forEach(convert);}else node.querySelectorAll('.pb-root,.pb-popover,.pb-notebook-modal').forEach(scan);};
  const observer=new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')convert(r.target as Element);else r.addedNodes.forEach(scan);}});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['title','aria-label']});scan(document.body);
  const over=(e:PointerEvent)=>{if(e.pointerType==='touch')return;const next=(e.target as Element).closest<HTMLElement>('[data-pb-tooltip]');if(next===target)return;clear();if(!next?.dataset.pbTooltip)return;target=next;timer=window.setTimeout(()=>{if(!next.isConnected)return;tip=document.createElement('div');tip.className='pb-tooltip';tip.role='tooltip';tip.textContent=next.dataset.pbTooltip??'';document.body.appendChild(tip);const b=next.getBoundingClientRect(),r=tip.getBoundingClientRect();tip.style.left=`${Math.max(8,Math.min(innerWidth-r.width-8,b.left+(b.width-r.width)/2))}px`;tip.style.top=`${b.bottom+r.height+12<innerHeight?b.bottom+8:Math.max(8,b.top-r.height-8)}px`;},650);};
  const out=(e:PointerEvent)=>{if(target&&!target.contains(e.relatedTarget as Node|null))clear();};
  const events=new AbortController();document.addEventListener('pointerover',over,{capture:true,signal:events.signal});document.addEventListener('pointerout',out,{capture:true,signal:events.signal});for(const event of ['pointerdown','scroll','keydown'])document.addEventListener(event,clear,{capture:true,signal:events.signal});
  return ()=>{clear();events.abort();observer.disconnect();};
}
