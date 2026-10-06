import { App, Modal, Setting } from 'obsidian';
import { Notebook, Page, Paper, newBook, clone } from './model';
import { Renderer } from './render';
import { popover, colorPopover } from './dialogs';
import { panelHeader, segments, row, section, cards, toggle, panelIcon } from './panels';

export const PAPER_NAMES:Record<Paper,string>={blank:'空白',ruled:'横线',grid:'方格',dots:'点阵',cornell:'康奈尔',music:'五线谱',planner:'月计划',tasks:'任务清单',swot:'SWOT 分析',kanban:'看板',finance:'收支账本'};
export const PAGE_SIZES=[['Goodnotes 标准尺寸',794,1123],['A3',1123,1587],['A4',794,1123],['A5',559,794],['A6',397,559],['A7',280,397],['书信',816,1056],['小报',1056,1632]]as const;
const COVERS=[['plain','纯色','简单'],['ribbon','丝带','简单'],['minimal','简约','简单'],['classic','经典','简单'],['light','素色','简单'],['waves','柔和曲线','彩色'],['letters','字母','彩色'],['leaves','叶片','彩色'],['stripes','彩色条纹','彩色'],['grid','网格','几何'],['dots','点阵','几何'],['angles','折线','几何']]as const;
export function coverPreview(el:HTMLElement,book:Pick<Notebook,'cover'|'coverStyle'|'spineColor'>){el.addClass('pb-cover-preview');el.dataset.style=book.coverStyle??'minimal';el.style.setProperty('--pb-cover-color',book.cover);el.style.setProperty('--pb-spine-color',book.spineColor??'#292929');}
export function paperPreview(el:HTMLElement,page:Page){const canvas=el.createEl('canvas',{cls:'pb-template-paper'});canvas.width=110;canvas.height=150;const ctx=canvas.getContext('2d')!;ctx.scale(110/page.width,150/page.height);new Renderer().paper(ctx,page);}
export function sizePanel(anchor:HTMLElement,page:Page,changed:()=>void){
  popover(anchor,(panel,close)=>{const draw=()=>{panel.empty();panelHeader(panel,'尺寸',close);const orientation=page.width>page.height?'landscape':'portrait';
    segments(panel,[['portrait','纵向'],['landscape','横向']],orientation,v=>{if(v!==orientation)[page.width,page.height]=[page.height,page.width];changed();draw();});
    const group=section(panel);for(const[name,w,h]of PAGE_SIZES)row(group,name,()=>{page.width=orientation==='portrait'?w:h;page.height=orientation==='portrait'?h:w;changed();draw();},(page.width===w&&page.height===h||page.width===h&&page.height===w)?'✓':'');
    row(group,'自定义',()=>{panel.empty();panelHeader(panel,'自定义尺寸',close,draw);let width=String(page.width),height=String(page.height);new Setting(panel).setName('宽度').addText(t=>t.setValue(width).onChange(v=>width=v));new Setting(panel).setName('高度').addText(t=>t.setValue(height).onChange(v=>height=v));new Setting(panel).addButton(b=>b.setButtonText('确定').setCta().onClick(()=>{const w=Number(width),h=Number(height);if(![w,h].every(n=>Number.isFinite(n)&&n>=100&&n<=4000))return;page.width=w;page.height=h;changed();close();}));});};draw();
  });
}
export function templateGallery(parent:HTMLElement,page:Page,changed:()=>void){
  for(const[category,papers]of [['基本',['blank','dots','grid','ruled']],['书写',['ruled','cornell','music']],['规划',['planner','tasks','kanban','swot','finance']]]as[string,Paper[]][]){
    parent.createEl('h4',{cls:'pb-section-title',text:category});const strip=parent.createDiv('pb-template-strip');
    for(const paper of papers){const b=strip.createEl('button',{cls:'pb-template-card',attr:{'aria-pressed':String(page.paper===paper)}});b.dataset.paper=paper;paperPreview(b,{...page,paper});b.createSpan({text:PAPER_NAMES[paper]});b.toggleClass('is-active',page.paper===paper);b.onclick=()=>{page.paper=paper;for(const choice of parent.querySelectorAll<HTMLElement>('[data-paper]')){const selected=choice.dataset.paper===paper;choice.toggleClass('is-active',selected);choice.setAttribute('aria-pressed',String(selected));}changed();};}
  }
}
export function templatePicker(anchor:HTMLElement,page:Page,apply:(page:Page)=>void){
  const draft=clone(page);popover(anchor,(panel,close)=>{panel.addClass('pb-template-popover');panelHeader(panel,'纸张模板',close);templateGallery(panel,draft,()=>{apply(draft);});
    new Setting(panel).setName('尺寸').addButton(b=>b.setButtonText(`${Math.round(draft.width)} × ${Math.round(draft.height)}`).onClick(()=>sizePanel(anchor,draft,()=>apply(draft))));
    const colors=panel.createDiv('pb-paper-colors');for(const[color,name]of[['#fffef0','黄色'],['#ffffff','白色'],['#202020','黑色']]){const b=colors.createEl('button',{attr:{title:name,'aria-label':name}});b.style.background=color;b.onclick=()=>{draft.color=color;apply(draft);};}
  });
}
export function notebookWizard(app:App,paper:Paper):Promise<Notebook|null>{
  return new Promise(resolve=>{
    class Wizard extends Modal {
      book=newBook('未命名笔记本',paper);tab:'cover'|'paper'='paper';done=false;
      onOpen(){this.modalEl.addClass('pb-notebook-modal');this.titleEl.setText('新建笔记本');this.book.cover='#ad9f88';this.book.coverStyle='minimal';this.book.hasCover=true;this.book.spineColor='#292929';this.book.language='简体中文';this.book.pages[0].color='#fffef0';this.draw();const footer=this.modalEl.createDiv('pb-newbook-footer');new Setting(footer).addButton(b=>b.setButtonText('取消').onClick(()=>this.close())).addButton(b=>b.setButtonText('创建笔记本').setCta().onClick(()=>{this.done=true;resolve(this.book);this.close();}));}
      draw(){const content=this.contentEl;content.empty();const top=content.createDiv('pb-newbook-top'),previews=top.createDiv('pb-newbook-previews');
        for(const[tab,label]of[['cover','封面'],['paper','纸张']]as const){const b=previews.createEl('button',{cls:'pb-newbook-preview'});const visual=b.createDiv();if(tab==='cover')coverPreview(visual,this.book);else paperPreview(visual,this.book.pages[0]);b.createSpan({text:label});b.toggleClass('is-active',this.tab===tab);b.onclick=()=>{this.tab=tab;this.draw();};}
        const fields=top.createDiv('pb-newbook-fields');
        const field=(label:string)=>{const row=fields.createDiv('pb-newbook-field');row.createSpan({text:label});return row.createDiv('pb-newbook-control');};
        const title=field('名称').createEl('input',{attr:{type:'text',placeholder:'未命名笔记本','aria-label':'名称'}});title.value=this.book.title==='未命名笔记本'?'':this.book.title;title.oninput=()=>this.book.title=title.value.trim()||'未命名笔记本';
        const language=field('语言').createEl('select',{attr:{'aria-label':'语言'}});for(const name of['简体中文','繁體中文','English'])language.createEl('option',{text:name,value:name});language.value=this.book.language??'简体中文';language.onchange=()=>this.book.language=language.value;
        const cover=field('封面').createEl('button',{cls:'pb-switch',attr:{role:'switch','aria-label':'使用封面','aria-checked':String(this.book.hasCover!==false)}});cover.onclick=()=>{this.book.hasCover=this.book.hasCover===false;cover.setAttribute('aria-checked',String(this.book.hasCover));};
        const size=field('尺寸').createEl('button',{text:`${this.book.pages[0].width} × ${this.book.pages[0].height}`});size.onclick=()=>sizePanel(size,this.book.pages[0],()=>this.draw());
        const color=field('颜色').createEl('button',{text:'选择颜色'});color.onclick=()=>this.colors(color);
        const gallery=content.createDiv('pb-newbook-gallery');gallery.createEl('h3',{text:this.tab==='cover'?'封面模板':'纸张模板'});
        if(this.tab==='paper')templateGallery(gallery,this.book.pages[0],()=>this.draw());else for(const category of['简单','彩色','几何']){gallery.createEl('h4',{cls:'pb-section-title',text:category});const strip=gallery.createDiv('pb-template-strip');for(const[style,label,group]of COVERS){if(group!==category)continue;const b=strip.createEl('button',{cls:'pb-template-card'});coverPreview(b.createDiv(),{...this.book,coverStyle:style});b.createSpan({text:label});b.toggleClass('is-active',style===this.book.coverStyle);b.onclick=()=>{this.book.coverStyle=style;this.draw();};}}
      }
      colors(anchor:HTMLElement){popover(anchor,(panel,close)=>{panelHeader(panel,'颜色',close);if(this.tab==='cover'){segments(panel,[['spine','编辑书脊'],['color','封面颜色']],'spine',v=>{grid(v==='spine');});}const body=panel.createDiv();const grid=(spine:boolean)=>{body.empty();cards(body,(this.tab==='paper'?['#fffef0','#ffffff','#202020']:['#292929','#315b91','#fffef0','#58816b','#ab4949','#d3b451','#ad9f88','#18233d','#eeeeee']).map(color=>({value:color,label:color,preview:el=>{const sample=el.createDiv();if(this.tab==='paper')paperPreview(sample,{...this.book.pages[0],color});else coverPreview(sample,{...this.book,spineColor:spine?color:this.book.spineColor,cover:spine?this.book.cover:color});}})),this.tab==='paper'?this.book.pages[0].color:spine?this.book.spineColor??'':this.book.cover,color=>{if(this.tab==='paper')this.book.pages[0].color=color;else if(spine)this.book.spineColor=color;else this.book.cover=color;this.draw();});};grid(this.tab==='cover');panelIcon(panel,'palette','自定义颜色',()=>colorPopover(anchor,this.tab==='paper'?this.book.pages[0].color:this.book.cover,color=>{if(this.tab==='paper')this.book.pages[0].color=color;else this.book.cover=color;this.draw();}));});}
      onClose(){if(!this.done)resolve(null);this.contentEl.empty();}
    }
    new Wizard(app).open();
  });
}
