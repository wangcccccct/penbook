import { App, Modal, Setting, FuzzySuggestModal, TFile } from 'obsidian';
let closePopover:(()=>void)|undefined;
let popoverAnchor:HTMLElement|undefined;
const anchorKey=(el:HTMLElement)=>el.dataset.pbPopoverKey??el.getAttribute('aria-label');
function sameAnchor(el:HTMLElement){return el===popoverAnchor||!!popoverAnchor&&!!anchorKey(el)&&anchorKey(el)===anchorKey(popoverAnchor);}
export function dismissPopoverFor(anchor:HTMLElement){if(closePopover&&sameAnchor(anchor)){closePopover();return true;}return false;}
export function popover(anchor:HTMLElement,build:(content:HTMLElement,close:()=>void)=>void){
  closePopover?.();const panel=document.body.createDiv('pb-popover');panel.setAttribute('role','dialog');const arrow=document.body.createDiv('pb-popover-arrow');const events=new AbortController();
  let observer:ResizeObserver|undefined,closed=false;
  const close=()=>{if(closed)return;closed=true;observer?.disconnect();events.abort();panel.remove();arrow.remove();if(closePopover===close){closePopover=undefined;popoverAnchor=undefined;}if(anchor.isConnected)anchor.focus({preventScroll:true});};closePopover=close;popoverAnchor=anchor;
  const original=anchor.getBoundingClientRect();
  const position=()=>{const r=anchor.isConnected?anchor.getBoundingClientRect():original,below=window.innerHeight-r.bottom-20,above=panel.scrollHeight>below&&r.top-20>below;panel.style.maxHeight=`${Math.max(120,Math.min(window.innerHeight-16,above?r.top-20:below))}px`;const width=panel.offsetWidth,height=panel.offsetHeight,left=Math.max(8,Math.min(r.left+r.width/2-width/2,window.innerWidth-width-8)),top=Math.max(8,Math.min(window.innerHeight-height-8,above?r.top-height-12:r.bottom+12));panel.style.left=`${left}px`;panel.style.top=`${top}px`;arrow.style.left=`${left+Math.max(18,Math.min(width-18,r.left+r.width/2-left))-6}px`;arrow.style.top=`${above?top+height-6:top-6}px`;arrow.toggleClass('pb-arrow-above',above);};
  build(panel,close);position();observer=new ResizeObserver(position);observer.observe(panel);
  document.addEventListener('pointerdown',e=>{const target=e.target as HTMLElement,button=target.closest<HTMLElement>('button');if(!panel.contains(target)&&!anchor.contains(target)&&!(button&&sameAnchor(button)))close();},{capture:true,signal:events.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}},{capture:true,signal:events.signal});
  window.addEventListener('resize',close,{signal:events.signal});panel.querySelector<HTMLElement>('input,button')?.focus({preventScroll:true});
}
let lastToolAnchor:HTMLElement|null=null;
export function rememberAnchor(anchor:HTMLElement|null){lastToolAnchor=anchor;if(!anchor)closePopover?.();}
export function toolAnchor(){const active=document.activeElement instanceof HTMLElement?document.activeElement.closest<HTMLElement>('.pb-button'):null;return active??(lastToolAnchor?.isConnected?lastToolAnchor:null);}
export function colorPopover(anchor:HTMLElement,value:string,apply:(color:string)=>void){
  popover(anchor,(panel,close)=>{panel.setAttribute('aria-label','墨水颜色');let current=value;
    colorControl(panel,value,color=>current=color);
    new Setting(panel).addButton(b=>b.setButtonText('取消').onClick(close)).addButton(b=>b.setButtonText('确定').setCta().onClick(()=>{apply(current);close();}));
  });
}
export function colorControl(parent:HTMLElement,value:string,change:(color:string)=>void){
  const picker=parent.createDiv('pb-color-picker'),plane=picker.createDiv('pb-color-plane'),handle=plane.createDiv('pb-color-handle');
  plane.tabIndex=0;plane.setAttribute('role','slider');plane.setAttribute('aria-label','颜色饱和度与亮度');
  const hue=picker.createEl('input',{cls:'pb-hue',attr:{type:'range',min:'0',max:'360',step:'1','aria-label':'色相'}});
  const row=picker.createDiv('pb-color-value'),sample=row.createDiv('pb-color-preview'),hex=row.createEl('input',{attr:{type:'text','aria-label':'十六进制颜色',value}});
  let h=0,s=1,v=1;
  const read=(color:string)=>{const n=parseInt(color.slice(1),16),r=(n>>16&255)/255,g=(n>>8&255)/255,b=(n&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;v=max;s=max?d/max:0;h=d?60*(max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4):0;hue.value=String(h);};
  const update=()=>{const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];const color='#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');plane.style.backgroundColor=`hsl(${h} 100% 50%)`;handle.style.left=`${s*100}%`;handle.style.top=`${(1-v)*100}%`;sample.style.background=color;hex.value=color;plane.setAttribute('aria-valuetext',color);change(color);};
  hue.oninput=()=>{h=Number(hue.value);update();};hex.onchange=()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value)){read(hex.value);update();}else update();};
  const point=(e:PointerEvent)=>{const r=plane.getBoundingClientRect();s=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));v=1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));update();};
  plane.onpointerdown=e=>{e.preventDefault();plane.setPointerCapture(e.pointerId);point(e);};plane.onpointermove=e=>{if(plane.hasPointerCapture(e.pointerId))point(e);};
  plane.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();s=Math.max(0,Math.min(1,s+(e.key==='ArrowRight'?.02:e.key==='ArrowLeft'?-.02:0)));v=Math.max(0,Math.min(1,v+(e.key==='ArrowUp'?.02:e.key==='ArrowDown'?-.02:0)));update();};read(value);update();
}
export interface Field { key:string; name:string; value:string; type?:'text'|'textarea'|'color'|'number'; options?:Record<string,string> }
export function sizeControl(parent:HTMLElement,title:string,value:number,min:number,max:number,step:number,kind:'circle'|'line',change:(value:number)=>void){
  const control=parent.createDiv('pb-size-control');
  const preview=control.createDiv('pb-size-preview');preview.setAttribute('aria-hidden','true');
  const sample=preview.createDiv(kind==='circle'?'pb-size-circle':'pb-size-line');
  const range=control.createEl('input',{attr:{type:'range',min:String(min),max:String(max),step:String(step),value:String(value),'aria-label':title}});
  const update=()=>{const n=Number(range.value);sample.style.width=kind==='circle'?`${n*2}px`:'64px';sample.style.height=kind==='circle'?`${n*2}px`:`${n}px`;range.setAttribute('aria-valuetext',String(n));range.title=`${title}：${n}`;};
  range.oninput=()=>{update();change(Number(range.value));};update();return control;
}
export function sizeDialog(app:App,title:string,value:number,min:number,max:number,step:number,kind:'circle'|'line'):Promise<number|null>{
  return new Promise(resolve=>{
    const anchor=toolAnchor();if(anchor){let current=value,done=false;popover(anchor,(panel,close)=>{panel.addClass('pb-size-popover');panel.createEl('h3',{text:title});sizeControl(panel,title,current,min,max,step,kind,n=>current=n);new Setting(panel).addButton(b=>b.setButtonText('取消').onClick(()=>{resolve(null);close();})).addButton(b=>b.setButtonText('确定').setCta().onClick(()=>{done=true;resolve(current);close();}));const observer=new MutationObserver(()=>{if(!panel.isConnected){observer.disconnect();if(!done)resolve(null);}});observer.observe(document.body,{childList:true});});return;}
    class SizeDialog extends Modal {
      result:number|null=null;current=value;
      onOpen(){this.titleEl.setText(title);this.contentEl.addClass('pb-size-dialog');sizeControl(this.contentEl,title,this.current,min,max,step,kind,n=>this.current=n);
        new Setting(this.contentEl).addButton(b=>b.setButtonText('取消').onClick(()=>this.close())).addButton(b=>b.setButtonText('确定').setCta().onClick(()=>{this.result=this.current;this.close();}));}
      onClose(){resolve(this.result);this.contentEl.empty();}
    }
    new SizeDialog(app).open();
  });
}
export function confirmAction(app:App,title:string,message:string,confirm='确定'):Promise<boolean>{
  return new Promise(resolve=>{
    class Confirmation extends Modal {
      confirmed=false;
      onOpen(){
        this.titleEl.setText(title);
        this.contentEl.createEl('p',{text:message});
        new Setting(this.contentEl)
          .addButton(b=>b.setButtonText('取消').onClick(()=>this.close()))
          .addButton(b=>b.setButtonText(confirm).setWarning().onClick(()=>{this.confirmed=true;this.close();}));
      }
      onClose(){resolve(this.confirmed);this.contentEl.empty();}
    }
    new Confirmation(app).open();
  });
}
export function form(app:App,title:string,fields:Field[],confirm='确定'):Promise<Record<string,string>|null> {
  return new Promise(resolve=>{
    const anchor=toolAnchor();if(anchor){const values=Object.fromEntries(fields.map(f=>[f.key,f.value]));let done=false;
      popover(anchor,(panel,close)=>{panel.createEl('h3',{text:title});for(const f of fields){const setting=new Setting(panel).setName(f.name);
        if(f.options)setting.addDropdown(d=>d.addOptions(f.options!).setValue(f.value).onChange(v=>values[f.key]=v));
        else if(f.type==='color')colorControl(setting.controlEl,f.value,v=>values[f.key]=v);
        else if(f.type==='textarea')setting.addTextArea(t=>t.setValue(f.value).onChange(v=>values[f.key]=v));
        else setting.addText(t=>{t.inputEl.type=f.type??'text';t.setValue(f.value).onChange(v=>values[f.key]=v);});}
        new Setting(panel).addButton(b=>b.setButtonText('取消').onClick(()=>{resolve(null);close();})).addButton(b=>b.setButtonText(confirm).setCta().onClick(()=>{done=true;resolve(values);close();}));
        const observer=new MutationObserver(()=>{if(!panel.isConnected){observer.disconnect();if(!done)resolve(null);}});observer.observe(document.body,{childList:true});});return;}
    class Dialog extends Modal {
      done=false; values=Object.fromEntries(fields.map(f=>[f.key,f.value]));
      onOpen(){
        this.titleEl.setText(title);
        for(const f of fields){const s=new Setting(this.contentEl).setName(f.name);
          if(f.options)s.addDropdown(d=>d.addOptions(f.options!).setValue(f.value).onChange(v=>this.values[f.key]=v));
          else if(f.type==='textarea')s.addTextArea(t=>t.setValue(f.value).onChange(v=>this.values[f.key]=v));
          else s.addText(t=>{t.inputEl.type=f.type??'text';t.setValue(f.value).onChange(v=>this.values[f.key]=v);});
        }
        new Setting(this.contentEl).addButton(b=>b.setButtonText('取消').onClick(()=>this.close())).addButton(b=>b.setButtonText(confirm).setCta().onClick(()=>{this.done=true;resolve(this.values);this.close();}));
      }
      onClose(){if(!this.done)resolve(null);this.contentEl.empty();}
    }
    new Dialog(app).open();
  });
}
export function pickFile(app:App,filter:(file:TFile)=>boolean,title:string):Promise<TFile|null>{
  return new Promise(resolve=>{
    class Picker extends FuzzySuggestModal<TFile>{
      done=false;getItems(){return this.app.vault.getFiles().filter(filter);}getItemText(f:TFile){return f.path;}
      onChooseItem(f:TFile){this.done=true;resolve(f);}onClose(){super.onClose();if(!this.done)resolve(null);}
    }
    const p=new Picker(app);p.setPlaceholder(title);p.open();
  });
}
export async function localFile(accept:string):Promise<File|null>{
  return new Promise(resolve=>{
    const input=document.createElement('input');input.type='file';input.accept=accept;
    input.onchange=()=>resolve(input.files?.[0]??null);input.addEventListener('cancel',()=>resolve(null));input.click();
  });
}
