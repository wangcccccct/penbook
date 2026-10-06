import { Setting } from 'obsidian';
import { icon, pathIcon, IconName, UI_ICONS } from './icons';

export function panelHeader(parent:HTMLElement,title:string,close?:()=>void,back?:()=>void){
  const header=parent.createDiv('pb-panel-header');
  if(back)panelIcon(header,'previous','返回',back);
  header.createEl('h3',{text:title});if(close){const b=header.createEl('button',{cls:'pb-panel-icon',attr:{title:'关闭','aria-label':'关闭'}});pathIcon(b,UI_ICONS.close);b.onclick=close;}
  return header;
}
export function panelIcon(parent:HTMLElement,name:IconName,title:string,click:()=>void){const b=parent.createEl('button',{cls:'pb-panel-icon',attr:{title,'aria-label':title}});icon(b,name);b.onclick=click;return b;}
export function section(parent:HTMLElement,title?:string){if(title)parent.createEl('h4',{cls:'pb-section-title',text:title});return parent.createDiv('pb-settings-group');}
export function row(parent:HTMLElement,label:string,click:()=>void,value='',name?:IconName,danger=false){
  const b=parent.createEl('button',{cls:'pb-settings-row'+(danger?' pb-danger':'' )});if(name)icon(b,name);b.createSpan({text:label});if(value==='✓')pathIcon(b,UI_ICONS.check,18);else if(value)b.createSpan({cls:'pb-row-value',text:value});icon(b,'next',18);b.onclick=click;return b;
}
export function toggle(parent:HTMLElement,label:string,value:boolean,change:(value:boolean)=>void){return new Setting(parent).setName(label).addToggle(t=>t.setValue(value).onChange(change));}
export function slider(parent:HTMLElement,label:string,value:number,min:number,max:number,step:number,change:(value:number)=>void,format=(n:number)=>`${Math.round(n)}%`){
  const block=parent.createDiv('pb-slider-setting'),heading=block.createDiv('pb-slider-heading');heading.createSpan({text:label});const output=heading.createEl('output',{text:format(value)});
  const input=block.createEl('input',{attr:{type:'range',min:String(min),max:String(max),step:String(step),value:String(value),'aria-label':label}});input.oninput=()=>{output.setText(format(Number(input.value)));input.setAttribute('aria-valuetext',output.textContent??'');change(Number(input.value));};return input;
}
export function segments<T extends string>(parent:HTMLElement,options:[T,string][],active:T,change:(value:T)=>void){const bar=parent.createDiv('pb-segments');for(const[value,label]of options){const b=bar.createEl('button',{text:label,attr:{'aria-pressed':String(active===value)}});b.toggleClass('is-active',active===value);b.onclick=()=>{for(const child of bar.querySelectorAll('button')){child.toggleClass('is-active',child===b);child.setAttribute('aria-pressed',String(child===b));}change(value);};}return bar;}
export function cards<T extends string>(parent:HTMLElement,options:{value:T;label:string;path?:string;preview?:(el:HTMLElement)=>void}[],active:T,change:(value:T)=>void){
  const grid=parent.createDiv('pb-choice-cards');for(const option of options){const b=grid.createEl('button',{attr:{'aria-label':option.label,'aria-pressed':String(active===option.value)}});b.toggleClass('is-active',active===option.value);if(option.path)pathIcon(b,option.path,30);option.preview?.(b);b.createSpan({text:option.label});b.onclick=()=>{for(const child of grid.querySelectorAll('button')){child.toggleClass('is-active',child===b);child.setAttribute('aria-pressed',String(child===b));}change(option.value);};}return grid;
}
