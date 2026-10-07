import { TextFileView, WorkspaceLeaf, Notice, Menu, TFile, normalizePath, Setting, Scope } from 'obsidian';
import PenbookPlugin, { PAPERS } from './main';
import { Notebook, Page, Item, Point, Pen, Shape, Paper, InkProfile, Resource, DEFAULT_INK, uid, clone, newBook, newPage, parseBook, item, stroke, contains, localPoint, inPolygon, encode, decode, resourceUrl } from './model';
import { Renderer } from './render';
import { PDFs } from './pdf';
import { copyPages } from './page-transfer';
import { form, pickFile, localFile, confirmAction, sizeControl, sizeDialog, popover, rememberAnchor, toolAnchor, dismissPopoverFor, editTable } from './dialogs';
import { icon, pathIcon, dropdownIcon, PEN_ICONS, SHAPE_ICONS, ERASER_ICONS, SELECT_ALL_ICON, LASER_ICON, UI_ICONS, ICONS, actionIcon } from './icons';
import { panelHeader, section, row, toggle, slider, cards, segments } from './panels';
import { inkPalette } from './palette';
import { templatePicker } from './templates';
import { calculate } from './calculate';
import { recognizeShape } from './auto-shape';
import { fontSelect } from './fonts';
import { itemSvg } from './svg-export';
import { BackgroundEraser } from './erase-background';
import { SnapshotStore, Snapshot, historyWeight } from './history';
import { extendLaserTrail } from './laser';
import { SHORTCUTS, ShortcutAction, EDIT_ACTIONS, SELECTION_ACTIONS, shortcutAction, shortcutHint } from './shortcuts';
import { pageAtOffset } from './page-navigation';
import { SelectionClipboard, selectionClipboard, pasteItems } from './selection-clipboard';
import { importPdfPages } from './pdf-import';
import { cropPage, rotateCrop } from './page-crop';

export const VIEW_TYPE='penbook-view';
const AUTO_SHAPE_MOVE_THRESHOLD=8;
type Tool='pen'|'eraser'|'lasso'|'shape'|'text'|'sticky'|'link'|'table'|'hand'|'laser'|'tape';
interface Surface {page:Page;sheet:HTMLElement;bg:HTMLCanvasElement;ink:HTMLCanvasElement;ui:HTMLCanvasElement;text:HTMLElement;epoch:number;visible?:boolean;backgroundReady?:boolean;controller?:AbortController;paintVersion?:number;images?:Map<string,HTMLImageElement>;}
interface SelectionFrame {cx:number;cy:number;w:number;h:number;angle:number;}
interface Gesture {pointer:number;surface:Surface;tool:Tool;points:Point[];start:Point;last:Point;lastMoved?:number;holdPoint?:Point;snapped?:Item;edited?:boolean;erasedStrokes?:Set<string>;eraseOutlines?:Map<string,number[][]>;eraseSession?:string;eraseQueue?:{from:Point;to:Point}[];erasePending?:Promise<void>;ending?:Promise<void>;finalized?:boolean;mode?:'move'|'resize'|'rotate';original?:Item[];frame?:SelectionFrame;before?:Snapshot;}

export class PenbookView extends TextFileView {
  book:Notebook=newBook();index=0;valid=false;raw='';
  root!:HTMLElement;toolbar!:HTMLElement;toolbarWrap!:HTMLElement;contextWrap!:HTMLElement;contextEl!:HTMLElement;sidebar!:HTMLElement;stage!:HTMLElement;pagesEl!:HTMLElement;footer!:HTMLElement;selectionBar!:HTMLElement;
  renderer=new Renderer();pdfs:PDFs;surfaces:Surface[]=[];
  tool:Tool='pen';pen:Pen='fountain';shape:Shape='rectangle';color:string;width:number;eraserSize=22;
  zoom=0.8;layout:'single'|'continuous'|'spread'='continuous';reading=false;fingerInk=false;selection=new Set<string>();
  undoStack:Snapshot[]=[];redoStack:Snapshot[]=[];gesture?:Gesture;
  get clipboard(){return this.plugin.selectionClipboard;}
  set clipboard(value:SelectionClipboard|null){this.plugin.selectionClipboard=value;}
  touches=new Map<number,{x:number;y:number}>();pinch?:{distance:number;zoom:number;cx:number;cy:number};lastPen=0;
  renderEpoch=0;thumbEpoch=0;closed=false;sidebarQuery='';penButtons=new Map<Tool,HTMLButtonElement>();resizeObserver?:ResizeObserver;
  private saveTimer?:number;private dirty=false;private saving:Promise<void>=Promise.resolve();
  private wasActive=false;
  private pageObservers:IntersectionObserver[]=[];private thumbObservers:IntersectionObserver[]=[];
  private toolbarLeft!:HTMLElement;private toolbarRight!:HTMLElement;private toolbarScrollWrap!:HTMLElement;private contextRow!:HTMLElement;private historyEl!:HTMLElement;
  private laserTrail?:{surface:Surface;points:{point:Point;start:boolean}[];releasedAt?:number};private laserFrame?:number;
  private selectionKey='';private selectionAngle=0;
  private shapeTimer?:number;private automaticShape=true;
  private hover?:{surface:Surface;point:Point};
  private eraserCursorRects=new WeakMap<Surface,{x:number;y:number;w:number;h:number}>();
  private backgroundEraser=new BackgroundEraser();
  private snapshots=new SnapshotStore();
  private lastWritten?:string;
  private thumbsController?:AbortController;
  private repaintFrame?:number;
  private pageScrollFrame?:number;
  private previewFrame?:number;
  private previewWork?:()=>void;
  private sidebarStructure='';
  private sidebarElement?:HTMLElement;
  private thumbPainters=new Map<string,()=>void>();
  private pageCards=new Map<string,HTMLElement>();
  private thumbFrame?:number;
  private sidebarItems=new Map<string,{items:Item[];length:number}>();
  private pendingThumbs=new Set<string>();
  private uiTheme?:{root:HTMLElement;accent:string;background:string;muted:string};
  private laserMode:'dot'|'line'='line';private tapeStraight=true;private tapeColor='#e79757';private stickyColor='#fff2a8';private sampleColor=false;private previousTool:Tool='pen';
  private textStyle={fontSize:22,font:'sans-serif',bold:false,italic:false,align:'left' as CanvasTextAlign,lineHeight:1.4,pinned:false};
  private inlineEditor?:{finish:(commit:boolean)=>void;refresh:()=>void};private inlineEditingId?:string;
  constructor(leaf:WorkspaceLeaf,public plugin:PenbookPlugin){super(leaf);this.pdfs=new PDFs(p=>plugin.asset(p));this.color=plugin.settings.penColor;this.width=plugin.settings.penWidth;this.fingerInk=plugin.settings.fingerInk;this.scope=new Scope(this.app.scope);this.scope.register(null,null,e=>this.key(e)?false:undefined);}
  getViewType(){return VIEW_TYPE;}getDisplayText(){return this.file?.basename??'Penbook';}getIcon(){return 'pb-pen';}
  getViewData(){if(!this.valid)return this.raw;if(!this.dirty&&!this.gesture&&this.raw)return this.raw;return JSON.stringify(this.book);}
  setViewData(data:string,clear:boolean){
    // Vault echoes our own saves; rebuilding here would discard an active text editor.
    if(!clear&&this.valid&&(data===this.lastWritten||data===this.raw&&!this.dirty&&!this.gesture))return;
    if(clear)this.clear();this.raw=data;
    try{this.book=parseBook(data);this.valid=true;this.index=Math.min(this.index,this.book.pages.length-1);this.selection.clear();this.renderer.clear();void this.pdfs.clear();this.render();}
    catch(error){this.valid=false;this.contentEl.empty();this.contentEl.createDiv({cls:'pb-error',text:String(error)});}
  }
  clear(){this.finishGesture(false);this.releaseSurfaces();this.thumbsController?.abort();this.snapshots.clear();this.undoStack=[];this.redoStack=[];this.selection.clear();this.index=0;this.valid=false;this.renderer.clear();void this.pdfs.clear();if(this.saveTimer)window.clearTimeout(this.saveTimer);this.dirty=false;this.lastWritten=undefined;}
  async onOpen(){this.closed=false;this.contentEl.style.padding='0';
    this.wasActive=this.app.workspace.getActiveViewOfType(PenbookView)===this;
    this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{const active=leaf?.view===this;if(this.wasActive&&!active)void this.run(()=>this.savePendingEdits());this.wasActive=active;}));
    // Obsidian waits for quit Tasks; an async beforeunload callback alone cannot
    // keep the window alive until the vault write has completed.
    this.registerEvent(this.app.workspace.on('quit',tasks=>tasks.add(()=>this.savePendingEdits())));
    const doc=this.contentEl.ownerDocument,win=doc.defaultView;
    if(win)this.registerDomEvent(win,'blur',()=>void this.run(()=>this.savePendingEdits()));
    this.registerDomEvent(doc,'visibilitychange',()=>{if(doc.hidden)void this.run(()=>this.savePendingEdits());});
    this.registerEvent(this.app.workspace.on('css-change',()=>{this.uiTheme=undefined;for(const s of this.surfaces)if(s.visible)this.paintUI(s);}));
    this.registerDomEvent(this.contentEl,'keydown',e=>this.key(e));
    this.registerDomEvent(this.contentEl,'paste',e=>void this.pasteEvent(e));
    this.registerDomEvent(this.contentEl,'dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();this.root?.addClass('pb-drop');}});
    this.registerDomEvent(this.contentEl,'dragleave',()=>this.root?.removeClass('pb-drop'));
    this.registerDomEvent(this.contentEl,'drop',e=>{this.root?.removeClass('pb-drop');if(e.dataTransfer?.files.length){e.preventDefault();const files=Array.from(e.dataTransfer.files);void this.run(async()=>{for(const f of files)await this.importFile(f);});}});
    this.resizeObserver=new ResizeObserver(()=>{if(this.zoom<=0)this.fit();this.updateToolbarEdges();});this.resizeObserver.observe(this.contentEl);
    this.register(()=>this.resizeObserver?.disconnect());
  }
  async onClose(){rememberAnchor(null);if(this.laserFrame!==undefined)cancelAnimationFrame(this.laserFrame);this.laserFrame=undefined;this.laserTrail=undefined;await this.savePendingEdits();this.releaseSurfaces();this.thumbsController?.abort();this.undoStack=[];this.redoStack=[];this.snapshots.clear();this.thumbPainters.clear();this.pageCards.clear();this.sidebarItems.clear();this.pendingThumbs.clear();this.uiTheme=undefined;this.backgroundEraser.stop();this.closed=true;this.renderEpoch++;this.thumbEpoch++;this.pageObservers.forEach(o=>o.disconnect());this.thumbObservers.forEach(o=>o.disconnect());await this.pdfs.clear();this.renderer.clear();}
  async onUnloadFile(file:TFile){await this.savePendingEdits();await super.onUnloadFile(file);}
  private async savePendingEdits(){this.inlineEditor?.finish(true);await this.finishGesture(true);await this.flush();}
  private async run(fn:()=>void|Promise<void>){try{await fn();}catch(error){if(error instanceof Error&&['AbortError','RenderingCancelledException'].includes(error.name))return;console.error('Penbook',error);new Notice(`Penbook：${error instanceof Error?error.message:String(error)}`);}}
  private snapshot():Snapshot{return this.snapshots.capture(this.book);}
  private trimHistory(){while(this.undoStack.length>1&&(this.undoStack.length+this.redoStack.length>50||historyWeight([...this.undoStack,...this.redoStack])>64*1024*1024))this.undoStack.shift();while(this.redoStack.length>1&&(this.undoStack.length+this.redoStack.length>50||historyWeight([...this.undoStack,...this.redoStack])>64*1024*1024))this.redoStack.shift();}
  private push(before:Snapshot){this.undoStack.push(before);this.redoStack=[];this.trimHistory();}
  private changed(before?:Snapshot){if(before)this.push(before);this.updateHistory();this.book.modified=new Date().toISOString();this.dirty=true;if(this.saveTimer)window.clearTimeout(this.saveTimer);this.saveTimer=window.setTimeout(()=>void this.flush(),650);this.updateSelectionBar();}
  private async flush(){if(!this.valid||!this.dirty||!this.file){await this.saving;return;}if(this.saveTimer)window.clearTimeout(this.saveTimer);this.saveTimer=undefined;
    if(this.gesture){this.saveTimer=window.setTimeout(()=>void this.flush(),650);return;}
    const file=this.file, data=this.getViewData();this.lastWritten=data;this.raw=data;this.dirty=false;
    this.saving=this.saving.catch(()=>{}).then(async()=>{await this.app.vault.modify(file,data);});
    try{await this.saving;}catch(error){this.dirty=true;new Notice('保存失败，请保持笔记本打开并检查存储空间。');console.error(error);}
  }
  get page(){return this.book.pages[this.index];}
  async undo(){await this.finishGesture(true);const b=this.undoStack.pop();if(!b)return;this.redoStack.push(this.snapshot());this.trimHistory();Object.assign(this.book,clone(b));this.index=Math.min(this.index,this.book.pages.length-1);this.selection.clear();this.changed();this.render(true);}
  async redo(){await this.finishGesture(true);const b=this.redoStack.pop();if(!b)return;this.undoStack.push(this.snapshot());this.trimHistory();Object.assign(this.book,clone(b));this.index=Math.min(this.index,this.book.pages.length-1);this.selection.clear();this.changed();this.render(true);}
  navigate(delta:number){this.goTo(Math.max(0,Math.min(this.book.pages.length-1,this.index+delta)));}
  goToId(id:string){const i=this.book.pages.findIndex(p=>p.id===id);if(i>=0)this.goTo(i);}
  private goTo(i:number){this.finishGesture(true);this.index=i;this.selection.clear();if(this.layout==='continuous'){this.surfaces.forEach(s=>s.sheet.toggleClass('is-active',s.page.id===this.page.id));this.surfaces.find(s=>s.page.id===this.page.id)?.sheet.scrollIntoView({block:'start',behavior:'smooth'});this.drawSidebar();this.drawFooter();this.updateSelectionBar();}else this.render();}
  render(preserveScroll=false){if(!this.valid||this.closed)return;const scroll=preserveScroll&&this.stage?{left:this.stage.scrollLeft,top:this.stage.scrollTop}:undefined,hidden=this.root?.hasClass('pb-sidebar-hidden')??false,immersive=this.root?.hasClass('pb-immersive')??false;this.releaseSurfaces();this.renderEpoch++;this.contentEl.empty();this.surfaces=[];this.root=this.contentEl.createDiv('pb-root');this.root.toggleClass('pb-sidebar-hidden',hidden);this.root.toggleClass('pb-immersive',immersive);this.root.toggleClass('pb-left',this.plugin.settings.leftHanded);this.root.toggleClass('pb-bottom',this.plugin.settings.toolbarBottom);this.root.tabIndex=0;
    this.toolbarWrap=this.root.createDiv('pb-toolbar-row');this.toolbarWrap.setAttribute('role','toolbar');this.toolbarWrap.setAttribute('aria-label','笔记本工具栏');
    this.toolbarLeft=this.toolbarWrap.createDiv('pb-toolbar pb-toolbar-fixed');
    this.toolbarScrollWrap=this.toolbarWrap.createDiv('pb-toolbar-wrap pb-toolbar-center');this.toolbar=this.toolbarScrollWrap.createDiv('pb-toolbar');this.toolbar.setAttribute('role','toolbar');this.toolbar.setAttribute('aria-label','书写工具，左右滑动查看更多');
    this.toolbarRight=this.toolbarWrap.createDiv('pb-toolbar pb-toolbar-fixed');
    this.toolbar.addEventListener('scroll',()=>this.updateToolbarEdges(),{passive:true});
    this.toolbar.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&this.toolbar.scrollWidth>this.toolbar.clientWidth){e.preventDefault();this.toolbar.scrollLeft+=e.deltaY;}},{passive:false});
    this.contextRow=this.root.createDiv('pb-context-row');this.historyEl=this.contextRow.createDiv('pb-history pb-tool-context');
    this.contextWrap=this.contextRow.createDiv('pb-toolbar-wrap pb-context-wrap');this.contextEl=this.contextWrap.createDiv('pb-tool-context');this.contextEl.setAttribute('role','toolbar');this.contextEl.setAttribute('aria-label','当前工具设置');
    this.contextEl.addEventListener('scroll',()=>this.updateToolbarEdges(),{passive:true});this.contextEl.addEventListener('wheel',e=>{if(Math.abs(e.deltaY)>Math.abs(e.deltaX)&&this.contextEl.scrollWidth>this.contextEl.clientWidth){e.preventDefault();this.contextEl.scrollLeft+=e.deltaY;}},{passive:false});
    this.drawToolbar();
    const workspace=this.root.createDiv('pb-workspace');this.sidebar=workspace.createDiv('pb-sidebar');this.stage=workspace.createDiv('pb-stage');this.pagesEl=this.stage.createDiv('pb-pages');this.footer=this.root.createDiv('pb-footer');
    this.stage.addEventListener('scroll',()=>{this.queuePageTracking();const s=this.surfaces.find(s=>s.page===this.page);if(s&&this.selection.size)this.paintUI(s,undefined,this.gesture?.tool==='lasso'&&!this.gesture.mode?this.gesture.points:undefined);},{passive:true});
    this.drawSidebar();this.drawPages();this.drawFooter();this.updateSelectionBar();
    this.stage.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();this.setZoom(this.zoom*(e.deltaY>0?.9:1.1));}},{passive:false});if(scroll)requestAnimationFrame(()=>{if(this.stage?.isConnected){this.stage.scrollLeft=scroll.left;this.stage.scrollTop=scroll.top;}});
  }
  private button(parent:HTMLElement,label:string,title:string,fn:()=>void|Promise<void>,active=false){const action=SHORTCUTS.find(([,name])=>name===title||name===`${title}工具`),hint=action&&shortcutHint(action[0]);const b=parent.createEl('button',{cls:'pb-button',attr:{title:hint?`${title}（${hint}）`:title,'aria-label':title}});if(label)icon(b,actionIcon(title));b.toggleClass('is-active',active);b.setAttribute('aria-pressed',String(active));b.onclick=()=>{if(dismissPopoverFor(b))return;b.focus({preventScroll:true});rememberAnchor(b);void this.run(fn);};return b;}
  private select<T extends string>(parent:HTMLElement,values:Record<T,string>,value:T,fn:(v:T)=>void){const s=parent.createEl('select');for(const [v,text]of Object.entries(values))s.createEl('option',{text:String(text),value:v});s.value=value;s.onchange=()=>fn(s.value as T);return s;}
  private drawToolbar(){
    const scroll=this.toolbar.scrollLeft;this.toolbar.empty();this.toolbarLeft.empty();this.toolbarRight.empty();this.historyEl.empty();this.penButtons.clear();
    this.button(this.toolbarLeft,'☰','显示或隐藏页面列表',()=>{this.root.toggleClass('pb-sidebar-hidden',!this.root.hasClass('pb-sidebar-hidden'));this.drawSidebar();this.drawToolbar();},!this.root.hasClass('pb-sidebar-hidden')&&!this.root.hasClass('pb-immersive'));
    this.button(this.toolbarLeft,'搜索','搜索页面与内容',()=>{this.root.removeClass('pb-sidebar-hidden');this.root.removeClass('pb-immersive');this.drawSidebar();this.drawToolbar();this.sidebar.querySelector('input')?.focus();});
    this.button(this.toolbarLeft,'⛶','沉浸模式',()=>{this.root.toggleClass('pb-immersive',!this.root.hasClass('pb-immersive'));this.drawSidebar();this.drawToolbar();},this.root.hasClass('pb-immersive'));
    for(const [t,name]of [['lasso','套索选择'],['pen','钢笔'],['eraser','橡皮擦'],['text','文本框']] as [Tool,string][]){const b=this.button(this.toolbar,name,name,()=>{if(this.tool===t&&t==='pen')this.penPanel(b);else if(this.tool===t&&t==='eraser')this.eraserPanel(b);else this.setTool(t);},this.tool===t);this.penButtons.set(t,b);if(t==='lasso')this.toolbar.createDiv('pb-separator');}
    const imageButton=this.button(this.toolbar,'图像','插入图片',async()=>{const f=await localFile('image/png,image/jpeg,image/webp,image/gif');if(f)await this.importFile(f);});imageButton.empty();icon(imageButton,'image');
    for(const [t,name]of [['shape','形状'],['sticky','便签'],['laser','激光笔']] as [Tool,string][]){const b=this.button(this.toolbar,t==='laser'?'':name,name,()=>{if(this.tool===t&&t==='laser')this.laserPanel(b);else if(this.tool===t&&t==='shape')this.shapePanel(b);else this.setTool(t);},this.tool===t);if(t==='laser')pathIcon(b,LASER_ICON,22);this.penButtons.set(t,b);}
    for(const[t,name]of[['tape','胶带'],['link','链接'],['table','表格'],['hand','平移']]as[Tool,string][]){const b=this.button(this.toolbar,t==='tape'?'':name,name,()=>{if(t==='tape'&&this.tool===t)this.tapePanel(b);else this.setTool(t);},this.tool===t);if(t==='tape')pathIcon(b,UI_ICONS.tape,22);this.penButtons.set(t,b);}
    this.button(this.toolbar,'阅读','阅读模式',()=>{this.finishGesture(true);this.reading=!this.reading;this.drawPages();this.drawToolbar();},this.reading);
    this.button(this.historyEl,'↶','撤销（Ctrl/Cmd+Z）',()=>this.undo());this.button(this.historyEl,'↷','重做（Ctrl/Cmd+Shift+Z）',()=>this.redo());this.updateHistory();
    this.button(this.toolbarRight,'＋','插入页面',()=>this.addPage());this.button(this.toolbarRight,'导出','导出 PDF、PNG、SVG 或 Markdown 索引',()=>this.exportMenu());
    this.button(this.toolbarRight,'⋯','笔记本与页面选项',()=>this.moreMenu());
    this.drawContext();
    requestAnimationFrame(()=>{if(!this.toolbar.isConnected)return;this.toolbar.scrollLeft=scroll;this.updateToolbarEdges();});
  }
  private updateToolbarEdges(){for(const[strip,wrap]of[[this.toolbar,this.toolbarScrollWrap],[this.contextEl,this.contextWrap]]){if(!strip?.isConnected||!wrap)continue;const max=strip.scrollWidth-strip.clientWidth;wrap.toggleClass('pb-overflow-left',strip.scrollLeft>1);wrap.toggleClass('pb-overflow-right',max-strip.scrollLeft>1);}}
  private updateHistory(){const buttons=this.historyEl?.querySelectorAll('button');if(buttons?.length===2){buttons[0].disabled=!this.undoStack.length;buttons[1].disabled=!this.redoStack.length;}}
  private showMenu(menu:Menu){const anchor=toolAnchor()??this.toolbarRight;const r=anchor.getBoundingClientRect();menu.showAtPosition({x:r.left,y:this.plugin.settings.toolbarBottom?r.top:r.bottom});}
  private drawContext(){
    this.root?.toggleClass('pb-lasso',this.tool==='lasso');
    if(!this.contextEl)return;const scroll=this.contextEl.scrollLeft;this.contextEl.empty();this.contextRow.toggleClass('pb-context-row-hidden',this.tool==='laser');this.contextWrap.toggleClass('pb-context-hidden',this.reading||this.tool==='hand'||this.tool==='laser');
    const separator=()=>this.contextEl.createDiv('pb-separator');
    const control=(title:string,path:string,active:boolean,fn:(button:HTMLButtonElement)=>void)=>{const b=this.button(this.contextEl,'',title,()=>fn(b),active);pathIcon(b,path,24);return b;};
    if(this.tool==='pen'||this.tool==='tape'){
      for(const[p,name]of[['fountain','笔'],['pencil','标准型铅笔'],['highlighter','荧光笔']]as[Pen,string][]){const active=this.tool==='pen'&&(p==='fountain'?['fountain','ballpoint','brush'].includes(this.pen):this.pen===p);control(name,PEN_ICONS[p],active,b=>{if(active)this.penPanel(b);else{this.pen=p;this.setTool('pen');}});}
      control('胶带',UI_ICONS.tape,this.tool==='tape',b=>{if(this.tool==='tape')this.tapePanel(b);else this.setTool('tape');});control('绘制并对齐 · Auto Shape',SHAPE_ICONS.auto,false,()=>{this.automaticShape=true;this.setTool('shape');});separator();
    }else if(this.tool==='shape'){
      control('Auto Shape · 自动识别手绘图形',SHAPE_ICONS.auto,this.automaticShape,()=>{this.automaticShape=true;this.drawContext();});separator();
      control('图形设置',UI_ICONS.tune,false,b=>this.shapePanel(b));
      for(const[s,name]of[['line','直线'],['arrow','箭头'],['rectangle','矩形'],['ellipse','椭圆'],['triangle','三角形'],['diamond','菱形'],['rounded','圆角矩形']]as const)control(name,SHAPE_ICONS[s],!this.automaticShape&&this.shape===s,()=>{this.automaticShape=false;this.shape=s;this.drawContext();});separator();
    }else if(this.tool==='eraser'){
      const type=control('橡皮擦类型',ERASER_ICONS[this.plugin.settings.eraser],false,b=>this.eraserTypes(b));dropdownIcon(type);
      for(const radius of[8,22,45]){const b=this.button(this.contextEl,'',`橡皮擦半径 ${radius}`,()=>{this.eraserSize=radius;this.drawContext();},this.eraserSize===radius);b.addClass('pb-eraser-size');const circle=b.createDiv('pb-eraser-disc');circle.style.width=circle.style.height=`${Math.min(36,radius*.75+8)}px`;}
      sizeControl(this.contextEl,'橡皮擦半径',this.eraserSize,2,70,1,'circle',n=>this.eraserSize=n);separator();control('橡皮擦设置',UI_ICONS.tune,false,b=>this.eraserPanel(b));
    }else if(this.tool==='lasso'){
      control('选择所有未锁定对象（Ctrl/Cmd+A）',SELECT_ALL_ICON,false,()=>this.executeShortcut('select-all'));
      if(!this.selection.size){this.button(this.contextEl,'复制','复制选区',()=>this.copySelection());this.button(this.contextEl,'粘贴','粘贴选区',()=>this.pasteSelection());this.button(this.contextEl,'变换','旋转、缩放与透明度',()=>this.transform());}
    }
    else if(this.tool==='text')this.textContext(control,separator);
    if(this.tool==='pen'||this.tool==='shape'){
      for(const w of[1.5,3,6]){const b=this.button(this.contextEl,'',`笔宽 ${w}`,()=>{this.width=w;this.drawContext();},Math.abs(this.width-w)<.1);b.addClass('pb-width-sample');const sample=b.createSpan();sample.style.height=`${w}px`;}
      control('笔宽与笔画类型',UI_ICONS.tune,false,b=>this.widthPanel(b));separator();
    }
    if(this.tool==='sticky'){
      for(const color of['#ffa9b4','#ffd0a0','#fff2a8','#b1ef92','#a6e9e7','#cbe1ff','#e7cef4','#f4c7e4','#e2e0d8','#ffffff']){const b=this.button(this.contextEl,'',`便签颜色 ${color}`,()=>{this.stickyColor=color;this.drawContext();});b.addClass('pb-sticky-swatch');b.style.background=color;b.toggleClass('is-active',this.stickyColor===color);}
    }else if(['pen','shape','text','link','table','tape'].includes(this.tool)){
      const selected=this.tool==='tape'?this.tapeColor:this.color;
      const current=this.button(this.contextEl,'',this.tool==='link'?'链接文字颜色':'笔颜色',()=>this.colorPanel(current));current.addClass('pb-current-color');current.style.background=selected;current.style.color=this.contrast(selected);dropdownIcon(current);
      for(const color of this.plugin.settings.presetColors.slice(0,8)){const b=this.button(this.contextEl,'',`墨水颜色 ${color}`,()=>{this.chooseColor(color);this.drawContext();});b.addClass('pb-color-swatch');b.style.background=color;b.toggleClass('pb-color-selected',color.toLowerCase()===selected.toLowerCase());}
      const add=this.button(this.contextEl,'','添加常用墨水颜色',()=>this.colorPanel(add));icon(add,'plus');add.addClass('pb-add-color');
    }
    this.selectionBar=this.contextEl.createDiv('pb-selection-actions');this.drawSelectionActions();
    requestAnimationFrame(()=>{if(!this.contextEl.isConnected)return;this.contextEl.scrollLeft=scroll;this.updateToolbarEdges();});
  }
  private get ink():InkProfile{return this.plugin.settings.inkProfiles[this.pen]??(this.plugin.settings.inkProfiles[this.pen]={...DEFAULT_INK});}
  private chooseColor(color:string){if(this.tool==='tape')this.tapeColor=color;else this.color=color;this.plugin.settings.colorHistory=[color,...this.plugin.settings.colorHistory.filter(c=>c!==color)].slice(0,24);void this.plugin.saveSettings();if(this.tool==='text')this.applyTextStyle();}
  private colorPanel(anchor:HTMLElement){inkPalette(anchor,{value:this.tool==='tape'?this.tapeColor:this.color,presets:this.plugin.settings.presetColors,history:this.plugin.settings.colorHistory,choose:c=>{this.chooseColor(c);this.drawContext();},save:()=>void this.plugin.saveSettings(),eyedropper:()=>{this.sampleColor=true;new Notice('点击纸张上的颜色进行吸取');}});}
  private inkStroke(points:Point[]){return{...stroke(points,this.color,this.width,this.pen),ink:clone(this.ink),strokeStyle:this.ink.style};}
  private penPanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{panel.addClass('pb-tool-panel');const draw=()=>{
    panel.empty();panelHeader(panel,this.pen==='pencil'?'标准型铅笔':this.pen==='highlighter'?'荧光笔':this.pen==='brush'?'画笔':this.pen==='ballpoint'?'圆珠笔':'钢笔',()=>{close();this.drawContext();});
    const canvas=panel.createEl('canvas',{cls:'pb-pen-preview'});canvas.width=560;canvas.height=180;const sample=()=>{const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,560,180);const points:Point[]=Array.from({length:80},(_,i)=>[35+i*6,90+Math.sin(i/13)*36,.18+.75*Math.sin(i/79*Math.PI)]);const o=this.inkStroke(points);o.width=Math.max(5,this.width*2);o.color=getComputedStyle(panel).getPropertyValue('--text-normal').trim();this.renderer.draw(ctx,o);};sample();
    if(!['pencil','highlighter'].includes(this.pen))cards(panel,(['fountain','ballpoint','brush']as Pen[]).map(p=>({value:p,label:p==='fountain'?'钢笔':p==='ballpoint'?'圆珠笔':'画笔',path:PEN_ICONS[p]})),this.pen,p=>{this.pen=p;draw();});
    const group=section(panel);const update=(key:keyof InkProfile,n:number)=>{Object.assign(this.ink,{[key]:n});void this.plugin.saveSettings();sample();};
    if(!['pencil','highlighter'].includes(this.pen)){slider(group,'压力灵敏度',this.ink.sensitivity,0,100,1,n=>update('sensitivity',n));slider(group,'笔尖扁平度',this.ink.flatness,0,100,1,n=>update('flatness',n),n=>n===0?'圆头':`${Math.round(n)}%`);}
    if(this.pen!=='pencil')slider(group,'画笔稳定性',this.ink.stability,0,100,1,n=>update('stability',n));
    const settings=section(panel,'设置');const options=()=>{panel.empty();panelHeader(panel,'笔设置',close,draw);const g=section(panel);toggle(g,'减少滞后',this.ink.reduceLatency,v=>{this.ink.reduceLatency=v;void this.plugin.saveSettings();});toggle(g,'直线绘制',this.ink.straight,v=>{this.ink.straight=v;void this.plugin.saveSettings();});toggle(g,'Auto Shape（停笔识别）',this.ink.autoShape!==false,v=>{this.ink.autoShape=v;void this.plugin.saveSettings();});toggle(g,'启用 S Pen',this.plugin.settings.penEnabled,v=>{this.plugin.settings.penEnabled=v;void this.plugin.saveSettings();});};
    if(['pencil','highlighter'].includes(this.pen)){toggle(settings,'减少滞后',this.ink.reduceLatency,v=>{this.ink.reduceLatency=v;void this.plugin.saveSettings();});toggle(settings,'直线绘制',this.ink.straight,v=>{this.ink.straight=v;void this.plugin.saveSettings();});row(settings,'绘制并对齐',options);}
    else{row(settings,'笔设置',options);row(settings,'写作辅助',()=>{panel.empty();panelHeader(panel,'写作辅助',close,draw);const g=section(panel);toggle(g,'Auto Shape（停笔识别）',this.ink.autoShape!==false,v=>{this.ink.autoShape=v;void this.plugin.saveSettings();});toggle(g,'与其他形状对齐',this.ink.alignShapes,v=>{this.ink.alignShapes=v;void this.plugin.saveSettings();});});row(settings,'数学助手',()=>{panel.empty();panelHeader(panel,'数学助手',close,draw);panel.createEl('p',{text:'本地四则运算。输入表达式即可计算，手写识别暂未加入。'});const input=panel.createEl('input',{attr:{placeholder:'例如 (12 + 8) / 4','aria-label':'数学表达式'}}),output=panel.createEl('output');input.oninput=()=>{try{output.setText(String(calculate(input.value)));}catch{output.setText('');}};});}
  };draw();});}
  private widthPanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{const draw=()=>{panel.empty();panelHeader(panel,'笔宽',()=>{close();this.drawContext();});const preview=panel.createDiv('pb-width-preview');const sample=preview.createDiv();sample.style.height=`${this.width}px`;sample.style.background=this.color;slider(section(panel),'笔宽',this.width,.5,30,.1,n=>{this.width=n;sample.style.height=`${n}px`;},n=>`${(n/3.78).toFixed(1)} mm`);row(section(panel),'笔画类型',()=>{panel.empty();panelHeader(panel,'笔画类型',close,draw);const g=section(panel);for(const[value,label]of[['solid','纯色'],['dashed','虚线'],['dotted','点线']]as const){const b=row(g,label,()=>{this.ink.style=value;void this.plugin.saveSettings();draw();},this.ink.style===value?'✓':'');const line=b.createDiv('pb-stroke-style');line.dataset.style=value;}},this.ink.style==='solid'?'纯色':this.ink.style==='dashed'?'虚线':'点线');};draw();});}
  private eraserTypes(anchor:HTMLElement){popover(anchor,(panel,close)=>{const draw=()=>{panel.empty();panelHeader(panel,'橡皮擦类型',close);const current=this.plugin.settings.eraser==='stroke'?'stroke':this.plugin.settings.eraserPrecision==='fine'?'fine':'standard';cards(panel,[{value:'fine',label:'精细橡皮擦',path:ERASER_ICONS.pixel},{value:'standard',label:'标准橡皮擦',path:ERASER_ICONS.pixel},{value:'stroke',label:'笔画橡皮擦',path:ERASER_ICONS.stroke}],current,value=>{this.plugin.settings.eraser=value==='stroke'?'stroke':'pixel';this.plugin.settings.eraserPrecision=value==='fine'?'fine':'standard';void this.plugin.saveSettings();this.drawContext();draw();});panel.createEl('p',{cls:'pb-panel-note',text:current==='fine'?'精细橡皮擦：保持当前尺寸，精确擦除接触区域。':current==='standard'?'标准橡皮擦：按 3 像素短段擦除笔迹。':'笔画橡皮擦：触碰后移除整条笔迹。'});};draw();});}
  private eraserPanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{const draw=()=>{panel.empty();panelHeader(panel,'橡皮擦设置',close);const g=section(panel);toggle(g,'仅擦除荧光笔痕迹',this.plugin.settings.eraserOnly==='highlighter',v=>{this.plugin.settings.eraserOnly=v?'highlighter':'all';void this.plugin.saveSettings();draw();});toggle(g,'只擦除胶带',this.plugin.settings.eraserOnly==='tape',v=>{this.plugin.settings.eraserOnly=v?'tape':'all';void this.plugin.saveSettings();draw();});row(g,'清除页面',()=>{close();void this.clearPage();},'',undefined,true);const settings=section(panel,'设置');toggle(settings,'自动取消选择',this.plugin.settings.eraserAutoPrevious,v=>{this.plugin.settings.eraserAutoPrevious=v;void this.plugin.saveSettings();});toggle(settings,'启用 S Pen',this.plugin.settings.penEnabled,v=>{this.plugin.settings.penEnabled=v;void this.plugin.saveSettings();});};draw();});}
  private tapePanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{panelHeader(panel,'胶带',close);const preview=panel.createDiv('pb-tape-preview');preview.createSpan({text:'hide content'});const sample=preview.createDiv();sample.style.background=this.tapeColor;const g=section(panel,'设置');toggle(g,'直条胶布',this.tapeStraight,v=>this.tapeStraight=v);row(g,'移除所有胶带',async()=>{close();if(!await confirmAction(this.app,'移除所有胶带','移除此页的所有未锁定胶带？可通过撤销恢复。','移除'))return;const before=this.snapshot();this.page.items=this.page.items.filter(o=>o.kind!=='tape'||o.locked);this.changed(before);this.repaint();},'',undefined,true);});}
  private shapePanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{panelHeader(panel,'Auto Shape',close);const g=section(panel,'设置');toggle(g,'书写时停笔识别图形',this.ink.autoShape!==false,v=>{this.ink.autoShape=v;void this.plugin.saveSettings();});panel.createEl('p',{cls:'pb-panel-note',text:'图形工具：画完松开立即识别。笔工具：画完按住约半秒才识别，继续移动可恢复手绘。无法确定的笔迹保持原样，转换后可撤销。'});const advanced=section(panel,'高级选项');toggle(advanced,'与其他形状对齐',this.ink.alignShapes,v=>{this.ink.alignShapes=v;void this.plugin.saveSettings();});toggle(advanced,'填充颜色',this.ink.fill,v=>{this.ink.fill=v;void this.plugin.saveSettings();});});}
  private laserPanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{const draw=()=>{panel.empty();panelHeader(panel,'激光笔',close);cards(panel,[{value:'dot',label:'点',path:UI_ICONS.dot},{value:'line',label:'线',path:SHAPE_ICONS.line}],this.laserMode,value=>{this.laserMode=value as 'dot'|'line';draw();});};draw();});}
  private applyTextStyle(){this.inlineEditor?.refresh();const selected=this.page.items.filter(o=>this.selection.has(o.id)&&['text','sticky','link'].includes(o.kind)&&!o.locked);if(!selected.length||this.page.locked)return;const before=this.snapshot(),{pinned,...style}=this.textStyle;selected.forEach(o=>Object.assign(o,style,{color:this.color}));this.changed(before);this.repaint();}
  private textContext(control:(title:string,path:string,active:boolean,fn:(b:HTMLButtonElement)=>void)=>HTMLButtonElement,separator:()=>void){
    const size=this.button(this.contextEl,'',`字号 ${this.textStyle.fontSize}`,()=>popover(size,(panel,close)=>{panelHeader(panel,'字号',close);slider(panel,'字号',this.textStyle.fontSize,8,120,1,n=>{this.textStyle.fontSize=n;this.applyTextStyle();size.setText(String(n));},n=>String(n));}));size.setText(String(this.textStyle.fontSize));
    fontSelect(this.contextEl,this.textStyle.font,font=>{this.textStyle.font=font;this.applyTextStyle();});
    control('粗体',UI_ICONS.bold,this.textStyle.bold,()=>{this.textStyle.bold=!this.textStyle.bold;this.applyTextStyle();this.drawContext();});control('斜体',UI_ICONS.italic,this.textStyle.italic,()=>{this.textStyle.italic=!this.textStyle.italic;this.applyTextStyle();this.drawContext();});
    control('文字对齐',this.textStyle.align==='center'?UI_ICONS.alignCenter:this.textStyle.align==='right'?UI_ICONS.alignRight:UI_ICONS.alignLeft,false,b=>popover(b,(panel,close)=>{panelHeader(panel,'对齐',close);cards(panel,[{value:'left',label:'左对齐',path:UI_ICONS.alignLeft},{value:'center',label:'居中',path:UI_ICONS.alignCenter},{value:'right',label:'右对齐',path:UI_ICONS.alignRight}],this.textStyle.align,align=>{this.textStyle.align=align as CanvasTextAlign;this.applyTextStyle();this.drawContext();});}));
    control('行距',UI_ICONS.lineHeight,false,b=>popover(b,(panel,close)=>{panelHeader(panel,'行距',close);slider(panel,'行距',this.textStyle.lineHeight,1,3,.1,n=>{this.textStyle.lineHeight=n;this.applyTextStyle();},n=>n.toFixed(1));}));control('固定文本工具',UI_ICONS.pin,this.textStyle.pinned,()=>{this.textStyle.pinned=!this.textStyle.pinned;this.drawContext();});separator();
  }
  private contrast(hex:string){const n=parseInt(hex.replace('#',''),16);return(((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114)>150?'#000000':'#ffffff';}
  private setTool(tool:Tool){this.finishGesture(true);if(tool==='eraser'&&this.tool!=='eraser')this.previousTool=this.tool;if(tool!=='lasso'&&tool!=='text')this.selection.clear();this.tool=tool;this.reading=false;for(const[t,b]of this.penButtons){b.toggleClass('is-active',t===tool);b.setAttribute('aria-pressed',String(t===tool));}for(const s of this.surfaces)s.sheet.toggleClass('is-reading',tool==='hand');this.drawContext();this.drawFooter();this.updateSelectionBar();this.repaint();}
  private drawSidebar(){
    const structure=JSON.stringify([this.sidebarQuery,this.book.pages.map(p=>[p.id,p.title,p.locked,p.bookmark,p.width,p.height,p.tags,p.paper,p.color,p.spacing,p.background,p.backgroundRotation])]);
    if(!this.sidebarQuery&&this.sidebar===this.sidebarElement&&structure===this.sidebarStructure){for(const[id,card]of this.pageCards)card.toggleClass('is-active',id===this.page.id);this.pendingThumbs.add(this.page.id);for(const p of this.book.pages){const old=this.sidebarItems.get(p.id);if(!old||old.items!==p.items||old.length!==p.items.length){this.pendingThumbs.add(p.id);this.sidebarItems.set(p.id,{items:p.items,length:p.items.length});}}if(this.thumbFrame===undefined)this.thumbFrame=requestAnimationFrame(()=>{this.thumbFrame=undefined;for(const id of this.pendingThumbs)this.thumbPainters.get(id)?.();this.pendingThumbs.clear();});return;}
    this.sidebarStructure=structure;this.sidebarElement=this.sidebar;this.thumbPainters.clear();this.pageCards.clear();this.sidebarItems.clear();this.pendingThumbs.clear();if(this.thumbFrame!==undefined)cancelAnimationFrame(this.thumbFrame);this.thumbFrame=undefined;
    this.thumbsController?.abort();this.thumbsController=new AbortController();const signal=this.thumbsController.signal;
    this.thumbObservers.forEach(o=>o.disconnect());this.thumbObservers=[];
    this.thumbEpoch++;const epoch=this.thumbEpoch;this.sidebar.empty();
    const search=this.sidebar.createEl('input',{attr:{type:'search',placeholder:'搜索页面与内容',value:this.sidebarQuery}});search.oninput=()=>{this.sidebarQuery=search.value;this.drawSidebar();const next=this.sidebar.querySelector('input');next?.focus();};
    const cards=this.sidebar.createDiv();const query=this.sidebarQuery.toLowerCase();
    const thumbnails=new Map<Element,()=>void>(),thumbnailObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){thumbnailObserver.unobserve(entry.target);thumbnails.get(entry.target)?.();thumbnails.delete(entry.target);}},{root:this.sidebar});this.thumbObservers.push(thumbnailObserver);
    this.book.pages.forEach((p,i)=>{
      if(query){const haystack=[p.title,...p.tags,p.pdfText,p.ocr,...p.items.map(o=>o.text??'')].join(' ').toLowerCase();if(!haystack.includes(query)&&String(i+1)!==query)return;}
      const card=cards.createDiv('pb-page-card');card.toggleClass('is-active',i===this.index);card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',p.title||`第 ${i+1} 页`);
      this.pageCards.set(p.id,card);
      this.sidebarItems.set(p.id,{items:p.items,length:p.items.length});
      const thumbScale=Math.min(96/p.width,512/p.height),thumb=card.createEl('canvas');thumb.width=Math.max(1,Math.round(p.width*thumbScale));thumb.height=Math.max(1,Math.round(p.height*thumbScale));const ctx=thumb.getContext('2d')!;ctx.save();ctx.scale(thumbScale,thumbScale);this.renderer.paper(ctx,p);ctx.restore();
      card.createEl('span',{text:`${i+1}. ${p.title||'未命名页面'}`});if(p.bookmark)icon(card.createSpan({cls:'pb-page-star'}),'bookmark',18);if(p.locked){card.setAttribute('aria-label',`${p.title||`第 ${i+1} 页`} · 已锁定`);const badge=card.createSpan({cls:'pb-page-lock',attr:{title:'页面已锁定','aria-label':'页面已锁定'}});icon(badge,'lock',16);}
      card.onclick=()=>this.goTo(i);card.oncontextmenu=e=>{e.preventDefault();this.goTo(i);this.pageMenu(e);};card.onkeydown=e=>{if(e.key==='Enter')this.goTo(i);};
      card.draggable=true;card.ondragstart=e=>e.dataTransfer?.setData('application/penbook-page',p.id);card.ondragover=e=>{if(e.dataTransfer?.types.includes('application/penbook-page'))e.preventDefault();};card.ondrop=e=>{e.preventDefault();const id=e.dataTransfer?.getData('application/penbook-page'),from=this.book.pages.findIndex(p=>p.id===id);if(from>=0&&from!==i){const before=this.snapshot();const [moved]=this.book.pages.splice(from,1);this.book.pages.splice(i,0,moved);this.index=i;this.changed(before);this.render();}};
      const paint=()=>void this.run(async()=>{if(signal.aborted||this.root.hasClass('pb-sidebar-hidden')||this.root.hasClass('pb-immersive'))return;const surface=this.surfaces.find(s=>s.page===p&&s.bg.width>1&&s.visible&&s.backgroundReady);const canvas=document.createElement('canvas');canvas.width=thumb.width;canvas.height=thumb.height;try{if(surface){canvas.getContext('2d')!.drawImage(surface.bg,0,0,canvas.width,canvas.height);}else await this.pdfs.background(canvas,p,this.book,this.renderer,thumbScale,signal);if(signal.aborted||epoch!==this.thumbEpoch||!card.isConnected)return;const ctx=canvas.getContext('2d')!;ctx.save();ctx.scale(thumbScale,thumbScale);await this.renderer.objects(ctx,p,this.book);ctx.restore();if(signal.aborted||epoch!==this.thumbEpoch||!card.isConnected)return;const c=thumb.getContext('2d')!;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,thumb.width,thumb.height);c.drawImage(canvas,0,0,thumb.width,thumb.height);}finally{canvas.width=canvas.height=1;}});
      this.thumbPainters.set(p.id,paint);if(i===this.index)paint();else{thumbnails.set(card,paint);thumbnailObserver.observe(card);}
    });
    this.button(this.sidebar,'＋ 添加页面','添加页面',()=>this.addPage()).addClass('pb-sidebar-add');
  }
  private drawFooter(){
    if(!this.footer)return;this.footer.empty();this.button(this.footer,'‹','上一页',()=>this.navigate(-1));
    const page=this.footer.createEl('input',{attr:{type:'number',min:'1',max:String(this.book.pages.length),value:String(this.index+1),title:'跳转到页码'}});page.onchange=()=>this.goTo(Math.max(0,Math.min(this.book.pages.length-1,Number(page.value)-1||0)));
    this.footer.createSpan({text:`/ ${this.book.pages.length}`});this.button(this.footer,'›','下一页',()=>this.navigate(1));
    this.select(this.footer,{single:'单页',continuous:'连续滚动',spread:'双页'},this.layout,v=>{this.layout=v;this.drawPages();});
    this.button(this.footer,'−','缩小',()=>this.setZoom(this.zoom/1.2));this.footer.createSpan({text:`${Math.round(this.zoom*100)}%`});this.button(this.footer,'＋','放大',()=>this.setZoom(this.zoom*1.2));this.button(this.footer,'适宽','适合宽度',()=>this.fit());
  }
  private fit(){if(!this.stage)return;this.setZoom(Math.max(.1,(this.stage.clientWidth-48)/(this.layout==='spread'?this.page.width*2+24:this.page.width)));}
  private setZoom(value:number){this.finishGesture(true);const old=this.zoom;this.zoom=Math.max(.15,Math.min(4,value));if(Math.abs(this.zoom-old)<.001)return;
    const cx=(this.stage.scrollLeft+this.stage.clientWidth/2)/old,cy=(this.stage.scrollTop+this.stage.clientHeight/2)/old;this.drawPages();this.stage.scrollLeft=cx*this.zoom-this.stage.clientWidth/2;this.stage.scrollTop=cy*this.zoom-this.stage.clientHeight/2;this.drawFooter();}
  private drawPages(){
    this.releaseSurfaces();
    this.pageObservers.forEach(o=>o.disconnect());this.pageObservers=[];
    for(const s of this.surfaces)if(s.ui.parentElement===this.stage)s.ui.remove();
    this.renderEpoch++;const epoch=this.renderEpoch;this.pagesEl.empty();this.pagesEl.toggleClass('pb-spread',this.layout==='spread');this.pagesEl.toggleClass('pb-horizontal',this.layout==='continuous'&&this.plugin.settings.scrollDirection==='horizontal');this.surfaces=[];
    const pages=this.layout==='continuous'?this.book.pages:this.layout==='spread'?this.book.pages.slice(Math.floor(this.index/2)*2,Math.floor(this.index/2)*2+2):[this.page];
    const loaders=new Map<Element,{surface:Surface;paint:()=>void}>(),observer=this.layout==='continuous'?new IntersectionObserver(entries=>{for(const entry of entries){const loader=loaders.get(entry.target);if(!loader)continue;const s=loader.surface,p=s.page;if(entry.isIntersecting)loader.paint();else if(this.gesture?.surface!==s&&!(this.inlineEditingId&&p.items.some(o=>o.id===this.inlineEditingId))&&!(p===this.page&&this.selection.size))this.releaseSurface(s);}},{root:this.stage,rootMargin:'400px'}):undefined;if(observer)this.pageObservers.push(observer);
    for(const p of pages){
      const sheet=this.pagesEl.createDiv('pb-sheet');sheet.toggleClass('is-active',p.id===this.page.id);sheet.toggleClass('is-reading',this.reading||this.tool==='hand');sheet.style.width=`${p.width*this.zoom}px`;sheet.style.height=`${p.height*this.zoom}px`;
      const bg=sheet.createEl('canvas',{cls:'pb-bg'}),ink=sheet.createEl('canvas',{cls:'pb-ink'}),text=sheet.createDiv('pb-text-layer'),ui=sheet.createEl('canvas',{cls:'pb-interaction'});
      const scale=Math.min(2,Math.max(.25,window.devicePixelRatio*this.zoom),Math.sqrt(4_000_000/(p.width*p.height)));for(const c of[bg,ink,ui]){c.width=1;c.height=1;}
      const s:Surface={page:p,sheet,bg,ink,ui,text,epoch};this.surfaces.push(s);
      const paint=()=>void this.run(async()=>{if(epoch!==this.renderEpoch||s.visible)return;s.visible=true;const controller=new AbortController();s.controller=controller;for(const c of[bg,ink,ui]){c.width=Math.max(1,Math.round(p.width*scale));c.height=Math.max(1,Math.round(p.height*scale));}await this.pdfs.background(bg,p,this.book,this.renderer,scale,controller.signal);if(epoch!==this.renderEpoch||controller.signal.aborted)return;s.backgroundReady=true;await this.paint(s);if(this.reading&&p.background&&this.book.resources[p.background.resource]?.type==='pdf')await this.pdfTextLayer(s);});
      if(p.id===this.page.id||this.layout!=='continuous')paint();
      if(observer){loaders.set(sheet,{surface:s,paint});observer.observe(sheet);}
      ui.addEventListener('pointerdown',e=>this.pointerDown(e,s));ui.addEventListener('pointermove',e=>this.pointerMove(e,s));ui.addEventListener('pointerup',e=>this.pointerUp(e));ui.addEventListener('pointercancel',e=>this.pointerCancel(e));ui.addEventListener('pointerleave',()=>{if(!this.gesture){this.hover=undefined;this.paintUI(s);}});ui.addEventListener('lostpointercapture',e=>{if(this.gesture?.pointer===e.pointerId&&!this.gesture.ending)this.finishGesture(false);});
      ui.addEventListener('contextmenu',e=>{e.preventDefault();this.pageMenu(e);});ui.addEventListener('dblclick',e=>{if(this.reading)return;const pt=this.point(e,s),o=[...p.items].reverse().find(o=>contains(o,pt[0],pt[1]));if(o)void this.run(()=>this.editItem(o,pt));});
      let press:{x:number;y:number}|undefined;
      ui.addEventListener('pointerdown',e=>press={x:e.clientX,y:e.clientY});
      ui.addEventListener('click',e=>{if(this.inlineEditor){e.stopPropagation();queueMicrotask(()=>document.querySelector<HTMLElement>('.pb-inline-text')?.focus({preventScroll:true}));return;}if(press&&(this.reading||this.tool==='hand')&&Math.hypot(e.clientX-press.x,e.clientY-press.y)<6){const point=this.point(e,s),link=p.pdfLinks?.find(l=>point[0]>=l.x&&point[0]<=l.x+l.w&&point[1]>=l.y&&point[1]<=l.y+l.h);if(link)void this.run(()=>link.page?Promise.resolve(this.goToId(link.page)):this.openLink(link.url??''));}});
      text.addEventListener('pointerdown',()=>{this.index=this.book.pages.indexOf(p);});
    }
    this.queuePageTracking();
  }
  private queuePageTracking(){if(this.pageScrollFrame!==undefined||this.layout!=='continuous')return;this.pageScrollFrame=requestAnimationFrame(()=>{this.pageScrollFrame=undefined;this.syncVisiblePage();});}
  private syncVisiblePage(){
    if(this.closed||!this.valid||this.layout!=='continuous'||!this.stage?.isConnected||this.inlineEditor||this.gesture&&this.gesture.tool!=='hand')return;
    const bounds=this.stage.getBoundingClientRect(),horizontal=this.plugin.settings.scrollDirection==='horizontal';
    let leading=horizontal?bounds.left:bounds.top;
    // The floating tool row hides the strip above the readable page area.
    if(!horizontal&&this.contextRow?.parentElement===this.stage)leading=Math.max(leading,Math.min(bounds.bottom,this.contextRow.getBoundingClientRect().bottom));
    const index=pageAtOffset(this.surfaces.length,leading,i=>{const r=this.surfaces[i].sheet.getBoundingClientRect();return horizontal?r.right:r.bottom;});
    if(index>=0)this.activate(this.surfaces[index]);
  }
  private releaseSurface(s:Surface){s.controller?.abort();s.controller=undefined;s.visible=false;s.backgroundReady=false;s.images?.clear();s.paintVersion=(s.paintVersion??0)+1;for(const c of[s.bg,s.ink,s.ui])c.width=c.height=1;s.text.empty();this.eraserCursorRects.delete(s);}
  private releaseSurfaces(){for(const s of this.surfaces)this.releaseSurface(s);if(this.pageScrollFrame!==undefined)cancelAnimationFrame(this.pageScrollFrame);this.pageScrollFrame=undefined;if(this.repaintFrame!==undefined)cancelAnimationFrame(this.repaintFrame);this.repaintFrame=undefined;if(this.previewFrame!==undefined)cancelAnimationFrame(this.previewFrame);this.previewFrame=undefined;this.previewWork=undefined;if(this.thumbFrame!==undefined)cancelAnimationFrame(this.thumbFrame);this.thumbFrame=undefined;}
  private async pdfTextLayer(s:Surface){
    const bg=s.page.background!;await this.pdfs.withDocument(bg.resource,this.book,async pdf=>{const page=await pdf.getPage((bg.page??0)+1),vp=page.getViewport({scale:1,rotation:(page.rotate+(s.page.backgroundRotation??0))%360}),content=await page.getTextContent();if(s.epoch!==this.renderEpoch||!s.visible||s.controller?.signal.aborted)return;
    s.text.empty();
    const measure=document.createElement('canvas').getContext('2d')!;
    const crop=s.page.backgroundCrop??{x:0,y:0,w:1,h:1},scaleX=s.page.width/(vp.width*crop.w),scaleY=s.page.height/(vp.height*crop.h);
    for(const t of content.items){if(!('str'in t)||!t.str)continue;const m=vp.transform,a=t.transform;
      const tx=m[0]*a[4]+m[2]*a[5]+m[4],ty=m[1]*a[4]+m[3]*a[5]+m[5];const height=Math.hypot(a[2],a[3]);
      const span=s.text.createEl('span',{text:t.str});span.style.left=`${(tx-crop.x*vp.width)*scaleX*this.zoom}px`;span.style.top=`${(ty-height-crop.y*vp.height)*scaleY*this.zoom}px`;span.style.fontSize=`${height*this.zoom*scaleY}px`;
      span.style.fontFamily=content.styles[t.fontName]?.fontFamily??'sans-serif';measure.font=`${height}px ${span.style.fontFamily}`;const width=measure.measureText(t.str).width;if(width)span.style.transform=`scaleX(${t.width/width*scaleX/scaleY})`;
    }
    for(const link of s.page.pdfLinks??[]){const a=s.text.createEl('a',{attr:{href:link.url??'#','aria-label':link.page?'跳转到 PDF 页面':link.url??'PDF 链接'}});a.style.left=`${link.x*this.zoom}px`;a.style.top=`${link.y*this.zoom}px`;a.style.width=`${link.w*this.zoom}px`;a.style.height=`${link.h*this.zoom}px`;a.onclick=e=>{e.preventDefault();e.stopPropagation();this.activate(s);void this.run(()=>link.page?Promise.resolve(this.goToId(link.page)):this.openLink(link.url??''));};}
    // Put selectable text above the pointer canvas only in reading mode.
    s.text.style.zIndex='5';
    });
  }
  private async paint(s:Surface){
    if(!s.visible||s.ink.width<=1)return;const version=s.paintVersion=(s.paintVersion??0)+1,items=[...s.page.items],ctx=s.ink.getContext('2d')!,epoch=s.epoch;const images=await Promise.all(items.map(o=>o.resource?(s.images?.get(o.resource)??this.renderer.image(o.resource,this.book).catch(()=>undefined)):undefined));if(epoch!==this.renderEpoch||version!==s.paintVersion||!s.visible||!s.sheet.isConnected)return;s.images=new Map(items.flatMap((o,i)=>o.resource&&images[i]?[[o.resource,images[i]!] as [string,HTMLImageElement]]:[]));
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,s.ink.width,s.ink.height);ctx.scale(s.ink.width/s.page.width,s.ink.height/s.page.height);items.forEach((o,i)=>{if(o.id!==this.inlineEditingId&&(!o.resolved||this.plugin.settings.showResolved))this.renderer.draw(ctx,o,images[i]);});this.paintUI(s);
  }
  private repaint(){if(this.repaintFrame!==undefined)return;this.repaintFrame=requestAnimationFrame(()=>{this.repaintFrame=undefined;const s=this.surfaces.find(s=>s.page.id===this.page.id);if(s)void this.paint(s);});}
  private queuePreview(work:()=>void){this.previewWork=work;if(this.previewFrame!==undefined)return;this.previewFrame=requestAnimationFrame(()=>{this.previewFrame=undefined;const latest=this.previewWork;this.previewWork=undefined;latest?.();});}
  private repaintEraserRegion(s:Surface,x:number,y:number,w:number,h:number){
    const epoch=s.epoch,scale=s.ink.width/s.page.width;
    if(epoch!==this.renderEpoch||!s.sheet.isConnected)return;
    const ctx=s.ink.getContext('2d')!;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(x*scale,y*scale,w*scale,h*scale);
    ctx.save();ctx.setTransform(scale,0,0,scale,0,0);ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    s.page.items.forEach(o=>{const a=o.rotation*Math.PI/180,rw=(Math.abs(o.w*Math.cos(a))+Math.abs(o.h*Math.sin(a)))/2,rh=(Math.abs(o.w*Math.sin(a))+Math.abs(o.h*Math.cos(a)))/2,cx=o.x+o.w/2,cy=o.y+o.h/2,pad=(o.width??2)*8;if(cx+rw+pad<x||cx-rw-pad>x+w||cy+rh+pad<y||cy-rh-pad>y+h)return;if(o.id!==this.inlineEditingId&&(!o.resolved||this.plugin.settings.showResolved))this.renderer.draw(ctx,o,o.resource?s.images?.get(o.resource)??this.renderer.cachedImage(o.resource):undefined);});ctx.restore();
  }
  private bounds(objects=this.page.items.filter(o=>this.selection.has(o.id))){if(!objects.length)return null;const x=Math.min(...objects.map(o=>o.x)),y=Math.min(...objects.map(o=>o.y)),right=Math.max(...objects.map(o=>o.x+o.w)),bottom=Math.max(...objects.map(o=>o.y+o.h));return{x,y,w:right-x,h:bottom-y};}
  private selectionFrame():SelectionFrame|null{
    const objects=this.page.items.filter(o=>this.selection.has(o.id));if(!objects.length)return null;
    const key=this.page.id+':'+objects.map(o=>o.id).sort().join(',');if(key!==this.selectionKey){this.selectionKey=key;this.selectionAngle=objects.length===1?objects[0].rotation*Math.PI/180:0;}
    const angle=this.selectionAngle,c=Math.cos(angle),s=Math.sin(angle),points:number[][]=[];
    for(const o of objects){const a=o.rotation*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a);for(const x of[-o.w/2,o.w/2])for(const y of[-o.h/2,o.h/2]){const px=o.x+o.w/2+x*ca-y*sa,py=o.y+o.h/2+x*sa+y*ca;points.push([px*c+py*s,-px*s+py*c]);}}
    const left=Math.min(...points.map(p=>p[0])),right=Math.max(...points.map(p=>p[0])),top=Math.min(...points.map(p=>p[1])),bottom=Math.max(...points.map(p=>p[1])),x=(left+right)/2,y=(top+bottom)/2;
    return{cx:x*c-y*s,cy:x*s+y*c,w:right-left,h:bottom-top,angle};
  }
  private framePoint(pt:Point,f:SelectionFrame){const x=pt[0]-f.cx,y=pt[1]-f.cy;return{x:x*Math.cos(f.angle)+y*Math.sin(f.angle),y:-x*Math.sin(f.angle)+y*Math.cos(f.angle)};}
  private selectionHit(pt:Point,f:SelectionFrame):'resize'|'rotate'|'move'|undefined{
    const p=this.framePoint(pt,f),r=14/this.zoom;
    if(Math.hypot(p.x-f.w/2,p.y-f.h/2)<r)return'resize';
    if(Math.hypot(p.x,p.y+f.h/2+28/this.zoom)<r)return'rotate';
    if(Math.abs(p.x)<=f.w/2&&Math.abs(p.y)<=f.h/2)return'move';
  }
  private paintUI(s:Surface,preview?:Item,polygon?:Point[],cursor?:Point){
    if(this.uiTheme?.root!==this.root){const theme=getComputedStyle(this.root);this.uiTheme={root:this.root,accent:theme.getPropertyValue('--interactive-accent').trim(),background:theme.getPropertyValue('--background-primary').trim(),muted:theme.getPropertyValue('--text-muted').trim()};}const {accent,background,muted}=this.uiTheme;
    if(!s.visible||s.ink.width<=1)return;const overlay=s.page===this.page&&this.selection.size>0,ratio=(s.ink.width/s.page.width)/this.zoom;
    let offsetX=0,offsetY=0;
    if(overlay){
      if(s.ui.parentElement!==this.stage)this.stage.appendChild(s.ui);
      const sheet=s.sheet.getBoundingClientRect(),stage=this.stage.getBoundingClientRect();offsetX=sheet.left-stage.left-this.stage.clientLeft;offsetY=sheet.top-stage.top-this.stage.clientTop;
      Object.assign(s.ui.style,{position:'absolute',left:`${this.stage.scrollLeft}px`,top:`${this.stage.scrollTop}px`,right:'auto',bottom:'auto',width:`${this.stage.clientWidth}px`,height:`${this.stage.clientHeight}px`,zIndex:'5'});
      const w=Math.round(this.stage.clientWidth*ratio),h=Math.round(this.stage.clientHeight*ratio);if(s.ui.width!==w)s.ui.width=w;if(s.ui.height!==h)s.ui.height=h;
    }else{
      if(s.ui.parentElement!==s.sheet)s.sheet.appendChild(s.ui);
      Object.assign(s.ui.style,{position:'absolute',left:'0',top:'0',right:'',bottom:'',width:'100%',height:'100%',zIndex:''});
      if(s.ui.width!==s.ink.width)s.ui.width=s.ink.width;if(s.ui.height!==s.ink.height)s.ui.height=s.ink.height;
    }
    const ctx=s.ui.getContext('2d')!;
    if(!this.reading&&(this.gesture?.tool==='eraser'||!this.gesture&&['pen','eraser'].includes(this.tool))&&!overlay&&!preview&&!polygon&&!this.laserTrail){
      cursor??=this.hover?.surface===s?this.hover.point:undefined;
      const old=this.eraserCursorRects.get(s),pixelScale=ratio*this.zoom,visualRadius=(this.gesture?.tool??this.tool)==='eraser'?this.eraserSize:Math.max(this.width/2,2/this.zoom),pad=(visualRadius+4/this.zoom)*pixelScale;
      const current=cursor?{x:cursor[0]*pixelScale-pad,y:cursor[1]*pixelScale-pad,w:pad*2,h:pad*2}:undefined;
      ctx.setTransform(1,0,0,1,0,0);
      if(!old)ctx.clearRect(0,0,s.ui.width,s.ui.height);
      else{if(old)ctx.clearRect(old.x,old.y,old.w,old.h);if(current)ctx.clearRect(current.x,current.y,current.w,current.h);}
      this.eraserCursorRects.set(s,current??{x:0,y:0,w:0,h:0});
      if(current&&cursor){ctx.setTransform(ratio,0,0,ratio,0,0);ctx.scale(this.zoom,this.zoom);ctx.strokeStyle=muted;ctx.lineWidth=1/this.zoom;ctx.beginPath();ctx.arc(cursor[0],cursor[1],visualRadius,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=background;ctx.lineWidth=.5/this.zoom;ctx.stroke();}
      return;
    }
    this.eraserCursorRects.delete(s);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,s.ui.width,s.ui.height);ctx.scale(ratio,ratio);ctx.translate(offsetX,offsetY);ctx.scale(this.zoom,this.zoom);
    if(preview)this.renderer.draw(ctx,preview);
    if(s.page.id===this.page.id&&this.selection.size){const f=this.selectionFrame();if(f){ctx.save();ctx.translate(f.cx,f.cy);ctx.rotate(f.angle);ctx.strokeStyle=accent;ctx.lineWidth=1.5/this.zoom;ctx.setLineDash([5/this.zoom,4/this.zoom]);ctx.strokeRect(-f.w/2,-f.h/2,f.w,f.h);ctx.setLineDash([]);ctx.fillStyle=background;ctx.fillRect(f.w/2-5/this.zoom,f.h/2-5/this.zoom,10/this.zoom,10/this.zoom);ctx.strokeRect(f.w/2-5/this.zoom,f.h/2-5/this.zoom,10/this.zoom,10/this.zoom);const y=-f.h/2-28/this.zoom;ctx.beginPath();ctx.moveTo(0,-f.h/2);ctx.lineTo(0,y+11/this.zoom);ctx.stroke();ctx.beginPath();ctx.arc(0,y,11/this.zoom,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.translate(-8/this.zoom,y-8/this.zoom);ctx.scale(16/256/this.zoom,16/256/this.zoom);ctx.fillStyle=accent;ctx.fill(new Path2D(ICONS.rotate));ctx.restore();}}
    if(polygon?.length){ctx.beginPath();ctx.moveTo(polygon[0][0],polygon[0][1]);for(const p of polygon)ctx.lineTo(p[0],p[1]);ctx.strokeStyle=accent;ctx.lineWidth=1.5/this.zoom;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);}
    cursor??=this.hover?.surface===s?this.hover.point:undefined;
    if(cursor&&!this.reading&&this.tool!=='hand'){
      const tool=this.gesture?.tool??this.tool,x=cursor[0],y=cursor[1];ctx.save();ctx.strokeStyle=muted;ctx.lineWidth=1/this.zoom;
      if(tool==='eraser'||tool==='pen'){const radius=tool==='eraser'?this.eraserSize:Math.max(this.width/2,2/this.zoom);ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=background;ctx.lineWidth=.5/this.zoom;ctx.stroke();}
      else if(tool==='tape'&&!this.gesture){ctx.globalAlpha=.45;ctx.fillStyle=this.tapeColor;ctx.fillRect(x,y-12,80,24);ctx.globalAlpha=1;ctx.setLineDash([3/this.zoom,3/this.zoom]);ctx.strokeRect(x,y-12,80,24);}
      else if(tool==='sticky'){this.renderer.draw(ctx,{...item('sticky',x,y,220,140,'#292929'),backgroundColor:this.stickyColor,text:'输入便签文字',fontSize:18,opacity:.6});}
      else if(tool==='laser'&&!this.gesture){ctx.fillStyle=accent;ctx.beginPath();ctx.arc(x,y,5/this.zoom,0,Math.PI*2);ctx.fill();}
      else if(!this.gesture&&tool!=='lasso'){const path=tool==='shape'?(this.automaticShape?SHAPE_ICONS.auto:SHAPE_ICONS[this.shape==='polygon'?'triangle':this.shape==='polyline'?'line':this.shape]):ICONS[tool as keyof typeof ICONS];if(path){ctx.translate(x+5/this.zoom,y+5/this.zoom);ctx.scale(24/256/this.zoom,24/256/this.zoom);ctx.fillStyle=muted;ctx.fill(new Path2D(path));}}
      ctx.restore();
    }
    if(this.laserTrail?.surface===s){const trail=this.laserTrail,points=trail.points;ctx.save();ctx.globalAlpha=trail.releasedAt===undefined?1:Math.max(0,1-(performance.now()-trail.releasedAt)/1000);ctx.strokeStyle=accent;ctx.fillStyle=accent;ctx.lineWidth=3/this.zoom;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor=accent;ctx.shadowBlur=10/this.zoom;if(this.laserMode==='line'){ctx.beginPath();for(const p of points){if(p.start)ctx.moveTo(p.point[0],p.point[1]);else ctx.lineTo(p.point[0],p.point[1]);}ctx.stroke();}const dots=this.laserMode==='dot'?points:points.filter((p,i)=>i===points.length-1||points[i+1].start);for(const p of dots){ctx.beginPath();ctx.arc(p.point[0],p.point[1],5/this.zoom,0,Math.PI*2);ctx.fill();}ctx.restore();}
  }
  private laserPoint(surface:Surface,point:Point,start=false){
    this.laserTrail=extendLaserTrail(this.laserTrail,surface,point,start,this.laserMode==='dot',performance.now());
    this.animateLaser();
  }
  private animateLaser(){
    if(this.laserFrame!==undefined)return;
    const tick=()=>{const trail=this.laserTrail;if(!trail||!trail.surface.ui.isConnected||this.closed){this.laserTrail=undefined;this.laserFrame=undefined;return;}if(trail.releasedAt!==undefined&&performance.now()-trail.releasedAt>=1000){this.laserTrail=undefined;this.laserFrame=undefined;this.paintUI(trail.surface);return;}this.paintUI(trail.surface);this.laserFrame=trail.releasedAt!==undefined?requestAnimationFrame(tick):undefined;};
    this.laserFrame=requestAnimationFrame(tick);
  }
  private point(e:{clientX:number;clientY:number;pressure?:number},s:Surface):Point{const r=s.sheet.getBoundingClientRect();return[(e.clientX-r.left)*s.page.width/r.width,(e.clientY-r.top)*s.page.height/r.height,Math.pow(Math.max(.05,e.pressure||.5),this.plugin.settings.pressure)];}
  private activate(s:Surface){if(s.page.id===this.page.id)return;const previous=this.surfaces.find(v=>v.page===this.page),hadSelection=this.selection.size>0;this.index=this.book.pages.indexOf(s.page);this.selection.clear();if(hadSelection&&previous?.visible)this.paintUI(previous);this.drawSidebar();this.drawFooter();this.updateSelectionBar();this.surfaces.forEach(v=>v.sheet.toggleClass('is-active',v===s));}
  private pointerDown(e:PointerEvent,s:Surface){
    if(!this.valid||e.pointerType==='pen'&&!this.plugin.settings.penEnabled)return;
    rememberAnchor(null);
    if(e.pointerType==='pen'){this.lastPen=Date.now();this.touches.clear();this.pinch=undefined;}
    if(e.pointerType==='touch'&&(Date.now()-this.lastPen<700||this.gesture?.pointer!==undefined&&this.gesture.tool!=='hand'))return;
    const textPlacement=!this.reading&&(this.tool==='sticky'||this.tool==='text');
    if(!textPlacement)e.preventDefault();s.ui.setPointerCapture(e.pointerId);this.activate(s);if(!textPlacement)this.root.focus({preventScroll:true});
    if(e.pointerType==='touch'&&(!this.fingerInk||this.reading||this.tool==='hand')){this.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(this.touches.size===2){const[a,b]=[...this.touches.values()];this.pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2};}return;}
    if(this.gesture)return;const pt=this.point(e,s);let tool=this.reading?'hand':this.tool;if(e.pointerType==='pen'&&(e.button===5||(e.buttons&32)!==0||e.button===2))tool='eraser';
    if(this.sampleColor){this.sampleColor=false;const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;for(const layer of[s.bg,s.ink])ctx.drawImage(layer,pt[0]*layer.width/s.page.width,pt[1]*layer.height/s.page.height,1,1,0,0,1,1);const c=ctx.getImageData(0,0,1,1).data;this.chooseColor('#'+[c[0],c[1],c[2]].map(n=>n.toString(16).padStart(2,'0')).join(''));this.drawContext();return;}
    const frame=tool==='lasso'?this.selectionFrame():null,selectionHit=frame?this.selectionHit(pt,frame):undefined;
    const tape=[...s.page.items].reverse().find(o=>o.kind==='tape'&&contains(o,pt[0],pt[1]));if(tape&&['hand','lasso'].includes(tool)&&!selectionHit){const before=this.snapshot();tape.revealed=!tape.revealed;this.changed(before);this.repaint();return;}
    if(s.page.locked&&!['hand','laser'].includes(tool)){new Notice('页面已锁定，请在更多中解锁');return;}
    if(this.reading){const o=[...s.page.items].reverse().find(o=>o.kind==='link'&&contains(o,pt[0],pt[1]));if(o){void this.run(()=>this.openLink(o.target??''));return;}}
    if(['text','link','table'].includes(tool)){void this.run(()=>this.insertObject(tool as 'text'|'link'|'table',pt));return;}
    const before=['hand','laser','sticky'].includes(tool)?undefined:this.snapshot();this.gesture={pointer:e.pointerId,surface:s,tool,points:[pt],start:pt,last:pt,lastMoved:performance.now(),before,eraseSession:tool==='eraser'?uid():undefined,erasedStrokes:tool==='eraser'?new Set():undefined,eraseOutlines:tool==='eraser'?new Map():undefined};
    if(tool==='lasso'){
      if(frame&&selectionHit){this.gesture.mode=selectionHit;this.gesture.frame=frame;this.gesture.original=clone(this.page.items.filter(o=>this.selection.has(o.id)&&!o.locked));}
      else this.paintUI(s);
    }
    if(tool==='eraser'){this.queueErase(this.gesture,pt,pt);this.paintUI(s,undefined,undefined,pt);}
    if(tool==='laser')this.laserPoint(s,pt,true);
  }
  private pointerMove(e:PointerEvent,s:Surface){
    if(e.pointerType==='pen')this.lastPen=Date.now();
    if(e.pointerType!=='touch'){this.hover={surface:s,point:this.point(e,s)};const f=this.tool==='lasso'&&s.page===this.page?this.selectionFrame():null,hit=f?this.selectionHit(this.hover.point,f):undefined;s.ui.style.cursor=this.tool==='lasso'?(hit==='resize'?'nwse-resize':hit==='rotate'?'grab':hit==='move'?'move':'default'):'';if(!this.gesture)this.queuePreview(()=>{if(!this.gesture&&this.hover?.surface===s)this.paintUI(s,undefined,undefined,this.hover.point);});}
    if(this.touches.has(e.pointerId)){
      e.preventDefault();const old=this.touches.get(e.pointerId)!;this.touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.touches.size===1){this.stage.scrollLeft-=e.clientX-old.x;this.stage.scrollTop-=e.clientY-old.y;}
      else if(this.pinch){const[a,b]=[...this.touches.values()];const next=Math.max(.15,Math.min(4,this.pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,this.pinch.distance)));const ratio=next/this.zoom;this.zoom=next;for(const surface of this.surfaces){surface.sheet.style.width=`${surface.page.width*next}px`;surface.sheet.style.height=`${surface.page.height*next}px`;}this.stage.scrollLeft=(this.stage.scrollLeft+this.stage.clientWidth/2)*ratio-this.stage.clientWidth/2;this.stage.scrollTop=(this.stage.scrollTop+this.stage.clientHeight/2)*ratio-this.stage.clientHeight/2;}
      return;
    }
    const g=this.gesture;if(!g||g.ending||g.pointer!==e.pointerId)return;e.preventDefault();const pt=this.point(e,g.surface),last=g.last;
    if(g.tool==='hand'){this.stage.scrollLeft-=(pt[0]-last[0])*this.zoom;this.stage.scrollTop-=(pt[1]-last[1])*this.zoom;g.last=this.point(e,g.surface);return;}
    if(g.mode&&g.original&&g.frame){const dx=pt[0]-g.start[0],dy=pt[1]-g.start[1],f=g.frame,c=Math.cos(f.angle),s=Math.sin(f.angle),start=this.framePoint(g.start,f),p=this.framePoint(pt,f);
      const scaleX=Math.max(.05,Math.min(20,1+(p.x-start.x)/Math.max(1,f.w))),scaleY=Math.max(.05,Math.min(20,1+(p.y-start.y)/Math.max(1,f.h))),a=Math.atan2(pt[1]-f.cy,pt[0]-f.cx)-Math.atan2(g.start[1]-f.cy,g.start[0]-f.cx),anchorX=f.cx-f.w/2*c+f.h/2*s,anchorY=f.cy-f.w/2*s-f.h/2*c;
      if(g.mode==='rotate')this.selectionAngle=f.angle+a;
      for(const original of g.original){const o=this.page.items.find(o=>o.id===original.id)!;if(g.mode==='move'){o.x=original.x+dx;o.y=original.y+dy;}else if(g.mode==='rotate'){const x=original.x+original.w/2-f.cx,y=original.y+original.h/2-f.cy;o.x=f.cx+x*Math.cos(a)-y*Math.sin(a)-original.w/2;o.y=f.cy+x*Math.sin(a)+y*Math.cos(a)-original.h/2;o.rotation=original.rotation+a*180/Math.PI;}else{const centerX=original.x+original.w/2-anchorX,centerY=original.y+original.h/2-anchorY,localX=centerX*c+centerY*s,localY=-centerX*s+centerY*c,oW=original.w*scaleX,oH=original.h*scaleY,scaledX=localX*scaleX,scaledY=localY*scaleY;o.w=oW;o.h=oH;o.x=anchorX+scaledX*c-scaledY*s-o.w/2;o.y=anchorY+scaledX*s+scaledY*c-o.h/2;if(original.kind==='shape'){o.points=original.points?.map(([x,y,p])=>[x*scaleX,y*scaleY,p]);o.bw=o.w;o.bh=o.h;}else if(original.kind==='stroke'){o.points=original.points?.map(([x,y,p])=>[x*scaleX,y*scaleY,p]);o.frozenInk=original.frozenInk?.map(ring=>ring.map(([x,y])=>[x*scaleX,y*scaleY]));o.eraseMasks=original.eraseMasks?.map(poly=>poly.map(ring=>ring.map(([x,y])=>[x*scaleX,y*scaleY])));o.bw=o.w;o.bh=o.h;}else if(original.kind==='sticky'||original.kind==='text'){o.bw=o.w;o.bh=o.h;}}}
      g.last=pt;this.repaint();return;
    }
    if(g.tool==='laser'){this.laserPoint(g.surface,pt);}
    else if(g.tool==='pen'){
      const events=[...(e.getCoalescedEvents?.()??[]),e];for(const sample of events){const p=this.point(sample,g.surface);if(Math.hypot(p[0]-g.points[g.points.length-1][0],p[1]-g.points[g.points.length-1][1])>.2)g.points.push(p);}
      if(Math.hypot(pt[0]-last[0],pt[1]-last[1])>1)g.lastMoved=performance.now();this.scheduleShape(g,pt);this.queuePreview(()=>{if(this.gesture===g)this.paintUI(g.surface,g.snapped??this.inkStroke(g.points));});
    }else if(g.tool==='shape'){if(Math.hypot(pt[0]-last[0],pt[1]-last[1])>1)g.lastMoved=performance.now();g.last=pt;if(this.automaticShape){if(Math.hypot(pt[0]-g.points.at(-1)![0],pt[1]-g.points.at(-1)![1])>.2)g.points.push(pt);this.scheduleShape(g,pt);}this.queuePreview(()=>{if(this.gesture===g)this.paintUI(g.surface,this.automaticShape?g.snapped??this.inkStroke(g.points):this.makeShape(g.start,g.last));});}
    else if(g.tool==='tape'){g.points.push(pt);g.last=pt;this.queuePreview(()=>{if(this.gesture===g)this.paintUI(g.surface,this.makeTape(g));});}
    else if(g.tool==='sticky'){g.last=pt;this.hover={surface:g.surface,point:pt};this.queuePreview(()=>{if(this.gesture===g)this.paintUI(g.surface);});}
    else if(g.tool==='lasso'){g.points.push(pt);this.queuePreview(()=>{if(this.gesture===g)this.paintUI(g.surface,undefined,g.points);});}
    else if(g.tool==='eraser'){this.queueErase(g,last,pt);this.queuePreview(()=>{if(this.gesture===g)this.paintUI(g.surface,undefined,undefined,g.last);});}
    g.last=pt;
  }
  private pointerUp(e:PointerEvent){
    if(this.touches.has(e.pointerId)){this.touches.delete(e.pointerId);if(this.touches.size<2)this.pinch=undefined;if(!this.touches.size){this.drawPages();this.drawFooter();}return;}
    if(this.gesture?.pointer===e.pointerId){const g=this.gesture;const end=this.point(e,g.surface);if(g.tool==='eraser'&&!g.ending)this.queueErase(g,g.last,end);g.last=end;if(g.tool==='pen'&&Math.hypot(end[0]-g.points.at(-1)![0],end[1]-g.points.at(-1)![1])>.2)g.points.push(end);this.finishGesture(true);}
  }
  private pointerCancel(e:PointerEvent){this.touches.delete(e.pointerId);this.pinch=undefined;if(this.gesture?.pointer===e.pointerId)this.finishGesture(false);}
  private finishGesture(commit:boolean):void|Promise<void>{
    const current=this.gesture;
    if(current?.tool==='eraser'&&!current.finalized&&commit){return current.ending??(current.ending=this.finishEraser(current));}
    if(current?.tool==='eraser'&&!commit)this.backgroundEraser.stop();
    if(this.shapeTimer!==undefined)window.clearTimeout(this.shapeTimer);this.shapeTimer=undefined;const g=this.gesture;if(!g)return;this.gesture=undefined;
    if(g.tool==='laser'){if(this.laserTrail){if(commit){this.laserTrail.releasedAt=performance.now();this.animateLaser();}else this.laserTrail=undefined;}this.paintUI(g.surface);return;}
    if(!commit){if(!g.before){this.paintUI(g.surface);return;}Object.assign(this.book,clone(g.before));this.index=Math.min(this.index,this.book.pages.length-1);this.selection.clear();if(this.valid&&this.root)this.render();return;}
    let edited=false;
    if(g.tool==='pen'){if(this.ink.straight){const first=g.points[0],last=g.points.at(-1)!;g.points=[first,[last[0],this.pen==='highlighter'?first[1]:last[1],last[2]]];}g.surface.page.items.push(g.snapped??this.inkStroke(g.points));edited=true;}
    else if(g.tool==='tape'&&g.points.some(p=>Math.hypot(p[0]-g.start[0],p[1]-g.start[1])>3/this.zoom)){g.surface.page.items.push(this.makeTape(g));edited=true;}
    else if(g.tool==='sticky'){this.hover=undefined;this.paintUI(g.surface);void this.run(()=>this.insertObject('sticky',g.last));return;}
    else if(g.tool==='shape'&&g.points.length>1&&this.automaticShape){g.surface.page.items.push(g.snapped??this.autoShape(g)??this.inkStroke(g.points));edited=true;}
    else if(g.tool==='shape'&&!this.automaticShape&&Math.hypot(g.last[0]-g.start[0],g.last[1]-g.start[1])>2){g.surface.page.items.push(this.makeShape(g.start,g.last,g.lastMoved));edited=true;}
    else if(g.mode){edited=Math.hypot(g.last[0]-g.start[0],g.last[1]-g.start[1])>.1;}
    else if(g.tool==='eraser'){edited=Boolean(g.edited);}
    else if(g.tool==='lasso'){
      this.selection=new Set();
      if(g.points.length<4){const o=[...g.surface.page.items].reverse().find(o=>contains(o,g.start[0],g.start[1],5));if(o)this.selection.add(o.id);}
      else for(const o of g.surface.page.items){if(inPolygon(o.x+o.w/2,o.y+o.h/2,g.points)||inPolygon(o.x,o.y,g.points)||inPolygon(o.x+o.w,o.y+o.h,g.points))this.selection.add(o.id);}
      const groups=new Set(g.surface.page.items.filter(o=>this.selection.has(o.id)).map(o=>o.group).filter(Boolean));for(const o of g.surface.page.items)if(o.group&&groups.has(o.group))this.selection.add(o.id);
    }
    if(edited){this.changed(g.before);this.drawSidebar();}this.repaint();this.updateSelectionBar();if(g.tool==='eraser'&&this.plugin.settings.eraserAutoPrevious)this.setTool(this.previousTool);
  }
  private autoShape(g:Gesture){const o=recognizeShape(g.points,this.color,this.width);if(!o)return null;o.fill=this.ink.fill;o.strokeStyle=this.ink.style;o.opacity=this.pen==='highlighter'?.3:1;if(this.ink.alignShapes){for(const existing of g.surface.page.items.filter(o=>o.kind==='shape')){for(const x of[existing.x,existing.x+existing.w])if(Math.abs(o.x-x)<6/this.zoom)o.x=x;for(const y of[existing.y,existing.y+existing.h])if(Math.abs(o.y-y)<6/this.zoom)o.y=y;}}return o;}
  private scheduleShape(g:Gesture,pt:Point){
    if(g.tool==='pen'&&(this.ink.autoShape===false||this.ink.straight))return;
    const held=g.holdPoint;if(held&&Math.hypot(pt[0]-held[0],pt[1]-held[1])<AUTO_SHAPE_MOVE_THRESHOLD/this.zoom)return;
    if(this.shapeTimer!==undefined)window.clearTimeout(this.shapeTimer);
    g.holdPoint=[...pt];g.snapped=undefined;
    this.shapeTimer=window.setTimeout(()=>{this.shapeTimer=undefined;if(this.gesture!==g)return;g.snapped=this.autoShape(g)??undefined;if(g.snapped)this.paintUI(g.surface,g.snapped);},550);
  }
  private makeShape(a:Point,b:Point,lastMoved=this.gesture?.lastMoved??performance.now()):Item{b=[...b];if(this.ink.alignShapes&&(!this.ink.holdToSnap||performance.now()-lastMoved>350)){for(const o of this.page.items.filter(o=>o.kind==='shape')){for(const x of[o.x,o.x+o.w])if(Math.abs(b[0]-x)<8/this.zoom)b[0]=x;for(const y of[o.y,o.y+o.h])if(Math.abs(b[1]-y)<8/this.zoom)b[1]=y;}}const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.max(1,Math.abs(a[0]-b[0])),h=Math.max(1,Math.abs(a[1]-b[1]));return{...item('shape',x,y,w,h,this.color),shape:this.shape,width:this.width,fill:this.ink.fill,strokeStyle:this.ink.style,points:[[a[0]-x,a[1]-y,.5],[b[0]-x,b[1]-y,.5]]};}
  private makeTape(g:Gesture):Item{if(!this.tapeStraight){const o=stroke(g.points,this.tapeColor,24,'ballpoint');return{...o,kind:'tape',opacity:1};}const x=Math.min(g.start[0],g.last[0]),y=Math.min(g.start[1],g.last[1]),w=Math.max(20,Math.abs(g.start[0]-g.last[0])),h=Math.max(24,Math.abs(g.start[1]-g.last[1]));return item('tape',x,y,w,h,this.tapeColor);}
  private queueErase(g:Gesture,from:Point,to:Point){
    (g.eraseQueue??=[]).push({from,to});
    if(g.erasePending)return;
    g.erasePending=this.drainErase(g).catch(error=>{if(this.gesture===g){g.eraseQueue=[];console.error('Penbook',error);new Notice(String(error));}}).finally(()=>{g.erasePending=undefined;});
  }
  private async drainErase(g:Gesture){
    while(this.gesture===g&&g.eraseQueue?.length){
      // Combine pointer events once per frame; only one geometry job is in flight.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(this.gesture!==g)return;
      const segments=g.eraseQueue.splice(0,32),page=g.surface.page,radius=this.eraserSize;
      let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
      for(const segment of segments)for(const p of[segment.from,segment.to]){x=Math.min(x,p[0]-radius);y=Math.min(y,p[1]-radius);right=Math.max(right,p[0]+radius);bottom=Math.max(bottom,p[1]+radius);}
      const intersects=(o:Item)=>{const a=o.rotation*Math.PI/180,rw=(Math.abs(o.w*Math.cos(a))+Math.abs(o.h*Math.sin(a)))/2,rh=(Math.abs(o.w*Math.sin(a))+Math.abs(o.h*Math.cos(a)))/2,cx=o.x+o.w/2,cy=o.y+o.h/2,pad=(o.width??3)*8;return cx+rw+pad>=x&&cx-rw-pad<=right&&cy+rh+pad>=y&&cy-rh-pad<=bottom;};
      if(this.plugin.settings.eraserOnly==='tape'){
        const next=page.items.filter(o=>o.locked||o.kind!=='tape'||!intersects(o)||!segments.some(({from,to})=>{const steps=Math.max(1,Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/Math.max(2,radius/2)));for(let i=1;i<=steps;i++)if(contains(o,from[0]+(to[0]-from[0])*i/steps,from[1]+(to[1]-from[1])*i/steps,radius))return true;return false;}));
        if(next.length!==page.items.length){page.items=next;g.edited=true;this.repaintEraserRegion(g.surface,x,y,right-x,bottom-y);}continue;
      }
      const items=page.items.filter(o=>!o.locked&&o.kind==='stroke'&&(this.plugin.settings.eraserOnly!=='highlighter'||o.pen==='highlighter')&&intersects(o)).map(item=>{
        let outline=g.eraseOutlines!.get(item.id);if(!outline){outline=this.renderer.strokeOutline(item);g.eraseOutlines!.set(item.id,outline);}return{item,outline};
      });
      if(!items.length)continue;
      const result=await this.backgroundEraser.execute({session:g.eraseSession,items,segments,radius,standard:this.plugin.settings.eraserPrecision==='standard',whole:this.plugin.settings.eraser==='stroke'});
      if(this.gesture!==g||!this.book.pages.includes(page))return;
      if(result.changes.length){
        const changes=new Map(result.changes.map(change=>[change.id,change.items]));
        page.items=page.items.flatMap(o=>{const replacement=changes.get(o.id);if(!replacement)return[o];g.erasedStrokes!.add(o.id);if(!replacement.length){const a=o.rotation*Math.PI/180,rw=(Math.abs(o.w*Math.cos(a))+Math.abs(o.h*Math.sin(a)))/2,rh=(Math.abs(o.w*Math.sin(a))+Math.abs(o.h*Math.cos(a)))/2,pad=(o.width??3)*8;x=Math.min(x,o.x+o.w/2-rw-pad);y=Math.min(y,o.y+o.h/2-rh-pad);right=Math.max(right,o.x+o.w/2+rw+pad);bottom=Math.max(bottom,o.y+o.h/2+rh+pad);}return replacement.map(({item,clip})=>{this.renderer.cacheClip(item,clip);const outline=g.eraseOutlines!.get(o.id);if(outline)this.renderer.cacheOutline(item,outline);return item;});});
        g.edited=true;this.repaintEraserRegion(g.surface,x,y,right-x,bottom-y);
      }
    }
  }
  private async finishEraser(g:Gesture){
    await g.erasePending;
    if(this.gesture!==g)return;
    try{
      const page=g.surface.page,items=page.items.filter(o=>o.kind==='stroke'&&g.erasedStrokes?.has(o.id)).map(item=>({item,outline:g.eraseOutlines!.get(item.id)??this.renderer.strokeOutline(item)}));
      if(items.length){
        const result=await this.backgroundEraser.execute({session:g.eraseSession,items,segments:[],radius:this.eraserSize,standard:false,whole:false,split:true});
        if(this.gesture!==g||!this.book.pages.includes(page))return;
        const changes=new Map(result.changes.map(change=>[change.id,change.items]));
        page.items=page.items.flatMap(o=>(changes.get(o.id)??[{item:o,clip:undefined}]).map(({item,clip})=>{if(clip!==undefined)this.renderer.cacheClip(item,clip);return item;}));
      }
    }catch(error){if(this.gesture===g){console.error('Penbook',error);new Notice(String(error));}}
    if(this.gesture===g){g.finalized=true;this.finishGesture(true);}
  }
  private updateSelectionBar(){
    if(this.contextEl?.isConnected)this.drawContext();
  }
  private drawSelectionActions(){
    if(!this.selectionBar)return;this.selectionBar.empty();const objects=this.page?.items.filter(o=>this.selection.has(o.id))??[];if(!objects.length)return;this.selectionBar.createSpan({text:`${objects.length} 个对象`});
    const mutate=(fn:()=>void)=>{if(this.page.locked){new Notice('请先解锁页面');return;}const before=this.snapshot();fn();this.changed(before);this.repaint();this.drawSidebar();};
    this.button(this.selectionBar,'复制','复制选区',()=>this.copySelection());this.button(this.selectionBar,'粘贴','粘贴选区',()=>this.pasteSelection());this.button(this.selectionBar,'删除','删除选区（可撤销）',()=>mutate(()=>{this.page.items=this.page.items.filter(o=>!this.selection.has(o.id)||o.locked);this.selection.clear();}));
    const colorable=objects.filter(o=>o.kind!=='image');if(colorable.length){const colorButton=this.button(this.selectionBar,'颜色','修改选区颜色',()=>inkPalette(colorButton,{title:'选区颜色',value:colorable[0]?.color??this.color,presets:this.plugin.settings.presetColors,history:this.plugin.settings.colorHistory,choose:color=>mutate(()=>colorable.filter(o=>!o.locked).forEach(o=>o.color=color)),save:()=>void this.plugin.saveSettings()}));}
    this.button(this.selectionBar,'变换','旋转、缩放与透明度',()=>this.transform());
    this.button(this.selectionBar,'置顶','移到顶层',()=>mutate(()=>{this.page.items=[...this.page.items.filter(o=>!this.selection.has(o.id)),...objects];}));
    this.button(this.selectionBar,'置底','移到底层',()=>mutate(()=>{this.page.items=[...objects,...this.page.items.filter(o=>!this.selection.has(o.id))];}));
    this.button(this.selectionBar,objects.every(o=>o.locked)?'解锁':'锁定','锁定或解锁选区',()=>mutate(()=>{const locked=!objects.every(o=>o.locked);objects.forEach(o=>o.locked=locked);}));
    this.button(this.selectionBar,'组合','组合选区',()=>mutate(()=>{const group=uid();objects.forEach(o=>o.group=group);}));this.button(this.selectionBar,'解组','取消组合',()=>mutate(()=>objects.forEach(o=>delete o.group)));
    if(objects.length===1){this.button(this.selectionBar,'编辑','编辑内容与样式',()=>this.editItem(objects[0]));if(objects[0].kind==='image'&&!objects[0].pdfNative)this.button(this.selectionBar,'裁剪','裁剪图片',()=>this.cropImage(objects[0]));}
    this.button(this.selectionBar,'移至页面','移动或复制选区到其他页',()=>this.transferObjects());
    if(objects.every(o=>o.kind==='sticky'))this.button(this.selectionBar,'解决便签','标记或取消已解决',()=>mutate(()=>objects.forEach(o=>o.resolved=!o.resolved)));
  }
  private copySelection(objects=this.page.items.filter(o=>this.selection.has(o.id)),notify=true){if(!objects.length)return;this.clipboard=selectionClipboard(objects,this.book);if(notify)new Notice('选区已复制，可切换到其他 Penbook 笔记本粘贴。');}
  private pasteSelection(){if(!this.clipboard)return;const before=this.snapshot(),copied=pasteItems(this.clipboard,this.book);this.page.items.push(...copied);this.selection=new Set(copied.map(o=>o.id));this.tool='lasso';this.changed(before);this.repaint();this.drawSidebar();this.drawToolbar();}
  private async transform(){const objects=this.page.items.filter(o=>this.selection.has(o.id)&&!o.locked);if(!objects.length)return;
    const v=await form(this.app,'变换选区',[{key:'rotate',name:'旋转角度（增量）',value:'0',type:'number'},{key:'scale',name:'缩放比例 %',value:'100',type:'number'},{key:'opacity',name:'透明度 %',value:String(Math.round(objects[0].opacity*100)),type:'number'}]);if(!v)return;
    const rotation=Number(v.rotate),scale=Number(v.scale)/100,opacity=Number(v.opacity)/100;if(!Number.isFinite(rotation)||!Number.isFinite(scale)||scale<.05||scale>20||!Number.isFinite(opacity)){new Notice('请输入有效的变换参数');return;}
    const before=this.snapshot(),b=this.bounds(objects)!;const cx=b.x+b.w/2,cy=b.y+b.h/2,a=rotation*Math.PI/180;
    for(const o of objects){const dx=(o.x+o.w/2-cx)*scale,dy=(o.y+o.h/2-cy)*scale;o.w*=scale;o.h*=scale;o.x=cx+dx*Math.cos(a)-dy*Math.sin(a)-o.w/2;o.y=cy+dx*Math.sin(a)+dy*Math.cos(a)-o.h/2;o.rotation+=rotation;o.opacity=Math.max(0,Math.min(1,opacity));}
    this.changed(before);this.repaint();this.drawSidebar();
  }
  private async insertObject(kind:'text'|'sticky'|'link'|'table',p:Point){
    if(this.page.locked)return;rememberAnchor(this.penButtons.get(kind==='sticky'?'sticky':'text')??null);
    if(kind==='text'||kind==='sticky'){
      const {pinned,...style}=this.textStyle,w=Math.min(kind==='sticky'?220:320,this.page.width-16),x=Math.max(0,Math.min(p[0],this.page.width-w)),y=Math.max(0,Math.min(p[1],this.page.height-140));
      const object:Item={...item(kind,x,y,w,kind==='sticky'?140:100,kind==='sticky'?this.contrast(this.stickyColor):this.color),...style,text:'',backgroundColor:kind==='sticky'?this.stickyColor:undefined};
      const page=this.page;this.inlineText(object,text=>{if(!text.trim())return;const before=this.snapshot(),{pinned,...style}=this.textStyle;Object.assign(object,style,{text,color:kind==='sticky'?this.contrast(this.stickyColor):this.color});object.h=object.bh=Math.max(object.h,kind==='sticky'?140:60,text.split('\n').length*style.fontSize*style.lineHeight+20);page.items.push(object);this.selection=new Set([object.id]);this.changed(before);if(kind!=='text'||!pinned)this.setTool('lasso');this.repaint();this.drawSidebar();});return;
    }
    let o:Item;
    if(kind==='table'){const v=await form(this.app,'插入表格',[{key:'rows',name:'行数',value:'4',type:'number'},{key:'columns',name:'列数',value:'3',type:'number'}]);if(!v)return;const rows=Math.max(1,Math.min(50,Number(v.rows)||4)),columns=Math.max(1,Math.min(30,Number(v.columns)||3));o={...item('table',p[0],p[1],Math.min(360,this.page.width-p[0]),200,this.color),rows,columns,width:1.5};}
    else{const v=await form(this.app,'插入链接',[{key:'text',name:'内容',value:''},{key:'target',name:'笔记路径、页面链接或 URL',value:''}]);if(!v||!v.text.trim())return;const{pinned,...style}=this.textStyle;o={...item('link',p[0],p[1],Math.min(320,Math.max(100,this.page.width-p[0]-20)),60,this.color),...style,text:v.text,target:v.target};}
    const before=this.snapshot();this.page.items.push(o);this.selection=new Set([o.id]);this.changed(before);this.setTool('lasso');this.repaint();this.drawSidebar();
  }
  private async editItem(o:Item,point?:Point){
    if(o.pdfNative||o.pdfMarkup&&!['text','sticky'].includes(o.kind)){
      if(o.locked||this.page.locked){new Notice('请先解锁对象或页面');return;}
      const metadata=o.pdfNative??o.pdfMarkup!,book=this.book,page=this.page,value=await form(this.app,`PDF 批注 · ${metadata.subtype}`,[{key:'contents',name:'批注备注',value:o.text??o.pdfMarkup?.contents??'',type:'textarea'},{key:'author',name:'作者',value:metadata.author??''},{key:'subject',name:'主题',value:metadata.subject??''}]);
      if(!value||this.book!==book||!page.items.includes(o))return;const before=this.snapshot();if(o.pdfNative)o.text=value.contents;else o.pdfMarkup!.contents=value.contents;metadata.author=value.author;if(value.subject||metadata.subject!==undefined)metadata.subject=value.subject;this.changed(before);this.repaint();this.drawSidebar();return;
    }
    if(o.kind==='table'){
      if(o.locked||this.page.locked){new Notice('请先解锁对象或页面');return;}
      const p=point&&localPoint(o,point[0],point[1]),cell=p?[Math.min((o.rows??4)-1,Math.max(0,Math.floor(p[1]/o.bh*(o.rows??4)))),Math.min((o.columns??3)-1,Math.max(0,Math.floor(p[0]/o.bw*(o.columns??3))))]as[number,number]:undefined;
      const value=await editTable(this.app,o,cell);if(value){const before=this.snapshot();Object.assign(o,value);this.changed(before);this.repaint();this.drawSidebar();}return;
    }
    if(o.locked||this.page.locked){new Notice('请先解锁对象或页面');return;}if(!['text','sticky','link'].includes(o.kind))return this.transform();
    this.selection=new Set([o.id]);this.textStyle={...this.textStyle,fontSize:o.fontSize??22,font:o.font??'sans-serif',bold:o.bold??false,italic:o.italic??false,align:o.align??'left',lineHeight:o.lineHeight??1.4};this.setTool('text');rememberAnchor(this.penButtons.get('text')??null);
    this.inlineText(o,text=>{const before=this.snapshot();o.text=text;this.changed(before);this.repaint();this.drawSidebar();});
  }
  private inlineText(object:Item,commit:(text:string)=>void){
    this.inlineEditor?.finish(true);const surface=this.surfaces.find(s=>s.page.id===this.page.id);if(!surface)return;
    const textarea=document.body.createDiv({cls:'pb-inline-text',attr:{contenteditable:'true',role:'textbox','aria-multiline':'true','aria-label':object.kind==='sticky'?'便签文字':'文本框文字','data-placeholder':'输入文字'}});textarea.tabIndex=0;textarea.textContent=object.text??'';
    const position=()=>{const bounds=surface.sheet.getBoundingClientRect();textarea.style.left=`${bounds.left+object.x*this.zoom}px`;textarea.style.top=`${bounds.top+object.y*this.zoom}px`;textarea.style.width=`${object.w*this.zoom}px`;textarea.style.minHeight=`${object.h*this.zoom}px`;};position();textarea.style.transform=`rotate(${object.rotation}deg)`;
    textarea.style.background=object.kind==='sticky'?object.backgroundColor??this.stickyColor:'transparent';
    const refresh=()=>{textarea.style.fontFamily=this.textStyle.font;textarea.style.fontSize=`${this.textStyle.fontSize*this.zoom}px`;textarea.style.fontWeight=this.textStyle.bold?'bold':'normal';textarea.style.fontStyle=this.textStyle.italic?'italic':'normal';textarea.style.lineHeight=String(this.textStyle.lineHeight);textarea.style.textAlign=this.textStyle.align;textarea.style.color=object.kind==='sticky'?this.contrast(object.backgroundColor??this.stickyColor):this.color;};
    const events=new AbortController(),inputScope=new Scope();this.app.keymap.pushScope(inputScope);let finished=false,composing=false;
    const finish=(save:boolean)=>{if(finished)return;finished=true;const text=textarea.innerText.replace(/\n$/,'');if(save)object.h=object.bh=Math.max(object.h,textarea.scrollHeight/this.zoom);events.abort();this.app.keymap.popScope(inputScope);textarea.remove();this.inlineEditor=undefined;this.inlineEditingId=undefined;if(save)commit(text);this.repaint();};
    this.inlineEditor={finish,refresh};this.inlineEditingId=object.id;refresh();this.repaint();
    textarea.oninput=()=>{textarea.style.height='auto';textarea.style.height=`${Math.max(object.h*this.zoom,textarea.scrollHeight)}px`;};
    document.addEventListener('scroll',position,{capture:true,signal:events.signal});window.addEventListener('resize',position,{signal:events.signal});
    textarea.addEventListener('paste',e=>{e.preventDefault();e.stopPropagation();document.execCommand('insertText',false,e.clipboardData?.getData('text/plain')??'');},{signal:events.signal});
    textarea.addEventListener('compositionstart',()=>{composing=true;},{signal:events.signal});
    textarea.addEventListener('compositionend',()=>{composing=false;textarea.oninput?.(new Event('input') as InputEvent);},{signal:events.signal});
    // Keep Obsidian's leaf activation and canvas handlers from stealing the native caret.
    for(const type of ['pointerdown','pointerup','click','dblclick'])textarea.addEventListener(type,e=>e.stopPropagation(),{signal:events.signal});
    textarea.addEventListener('keydown',e=>{e.stopPropagation();if(composing||e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();finish(false);}else if((e.key==='Enter'||e.key.toLowerCase()==='s')&&(e.metaKey||e.ctrlKey)){e.preventDefault();finish(true);void this.flush();}},{signal:events.signal});
    document.addEventListener('pointerdown',e=>{const target=e.target as HTMLElement;if(!composing&&!textarea.contains(target)&&!target.closest('.pb-tool-context,.pb-popover'))finish(true);},{capture:true,signal:events.signal});
    textarea.focus({preventScroll:true});const range=document.createRange();range.selectNodeContents(textarea);range.collapse(false);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
    // Creation runs during canvas pointerup; focus again after its follow-up click has settled.
    requestAnimationFrame(()=>{if(!finished&&textarea.isConnected)textarea.focus({preventScroll:true});});
    const restoreFocus=()=>{if(!finished&&!composing&&textarea.isConnected&&document.hasFocus()&&document.activeElement!==textarea)textarea.focus({preventScroll:true});};
    // Obsidian activates a canvas leaf after the pointer sequence and can focus its root later.
    document.addEventListener('focusin',e=>{const target=e.target as HTMLElement;if(target===this.root||target===surface.ui)queueMicrotask(restoreFocus);},{signal:events.signal});
    window.addEventListener('focus',()=>requestAnimationFrame(restoreFocus),{signal:events.signal});
    textarea.addEventListener('click',restoreFocus,{signal:events.signal});
    window.setTimeout(restoreFocus,80);
  }
  private async cropImage(o:Item){const v=await form(this.app,'裁剪图片（百分比）',[{key:'x',name:'左边起点 %',value:String((o.crop?.x??0)*100),type:'number'},{key:'y',name:'上边起点 %',value:String((o.crop?.y??0)*100),type:'number'},{key:'w',name:'保留宽度 %',value:String((o.crop?.w??1)*100),type:'number'},{key:'h',name:'保留高度 %',value:String((o.crop?.h??1)*100),type:'number'}]);if(!v)return;const x=Number(v.x)/100,y=Number(v.y)/100,w=Number(v.w)/100,h=Number(v.h)/100;if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<=0||h<=0||x+w>1||y+h>1){new Notice('裁剪区域必须在图片范围内');return;}const before=this.snapshot();o.crop={x,y,w,h};this.changed(before);this.repaint();}
  private async openLink(target:string){
    if(target.startsWith('obsidian://')){window.open(target);return;}if(target.startsWith('#')){this.goToId(target.slice(1));return;}
    if(/^https?:\/\//.test(target)){window.open(target,'_blank','noopener');return;}
    await this.app.workspace.openLinkText(target,this.file?.path??'',false);
  }
  canShortcut(action:ShortcutAction,target:Element|null=document.activeElement){
    if(!this.valid||this.closed||this.inlineEditor||target?.closest('input,textarea,select,[contenteditable]:not([contenteditable=false]),.modal,.pb-popover'))return false;
    if(this.page.locked&&EDIT_ACTIONS.has(action))return false;
    if(SELECTION_ACTIONS.has(action)&&!this.selection.size)return false;
    if(action==='paste'&&!this.clipboard)return false;
    return true;
  }
  private key(e:KeyboardEvent){
    if(e.defaultPrevented||e.isComposing||e.keyCode===229)return false;
    const action=shortcutAction(e),target=e.target instanceof Element?e.target:null;
    if(!action||!this.canShortcut(action,target))return false;
    e.preventDefault();e.stopPropagation();
    if(!e.repeat||['left','right','up','down','zoom-in','zoom-out','thinner','thicker','next-page','previous-page'].includes(action))void this.run(()=>this.executeShortcut(action,e.shiftKey));
    return true;
  }
  async executeShortcut(action:ShortcutAction,shift=false,target:Element|null=document.activeElement){
    if(!this.canShortcut(action,target))return;
    if(action==='deselect'){this.finishGesture(false);this.selection.clear();this.repaint();this.updateSelectionBar();return;}
    await this.finishGesture(true);
    if(!this.valid||this.closed||this.page.locked&&EDIT_ACTIONS.has(action))return;
    const tools:Partial<Record<ShortcutAction,Tool>>={pen:'pen',eraser:'eraser',lasso:'lasso',hand:'hand',text:'text',shape:'shape',sticky:'sticky',link:'link',table:'table',laser:'laser',tape:'tape'};
    const tool=tools[action];if(tool){this.setTool(tool);return;}
    const objects=this.page.items.filter(o=>this.selection.has(o.id)),editable=objects.filter(o=>!o.locked);
    const mutate=(fn:()=>void)=>{const before=this.snapshot();fn();this.changed(before);this.repaint();this.drawSidebar();};
    switch(action){
      case 'select-all':this.setTool('lasso');this.selection=new Set(this.page.items.filter(o=>!o.locked).map(o=>o.id));this.repaint();this.updateSelectionBar();break;
      case 'undo':await this.undo();break;case 'redo':await this.redo();break;case 'save':await this.flush();break;
      case 'copy':this.copySelection();break;
      case 'cut':if(editable.length){this.copySelection(editable,false);mutate(()=>{this.page.items=this.page.items.filter(o=>!editable.includes(o));this.selection.clear();});}break;
      case 'delete':if(editable.length)mutate(()=>{this.page.items=this.page.items.filter(o=>!editable.includes(o));this.selection.clear();});break;
      case 'paste':this.pasteSelection();break;
      case 'duplicate':if(objects.length){const previous=this.clipboard;try{this.copySelection(objects,false);this.pasteSelection();}finally{this.clipboard=previous;}}break;
      case 'lock':if(objects.length)mutate(()=>{const locked=!objects.every(o=>o.locked);objects.forEach(o=>o.locked=locked);});break;
      case 'group':if(editable.length>1)mutate(()=>{const group=uid();editable.forEach(o=>o.group=group);});break;
      case 'ungroup':if(editable.some(o=>o.group))mutate(()=>editable.forEach(o=>delete o.group));break;
      case 'front':case 'back':if(editable.length)mutate(()=>{const rest=this.page.items.filter(o=>!editable.includes(o));this.page.items=action==='front'?[...rest,...editable]:[...editable,...rest];});break;
      case 'raise':case 'lower':if(editable.length)mutate(()=>{const items=this.page.items,selected=new Set(editable);if(action==='raise'){for(let i=items.length-2;i>=0;i--)if(selected.has(items[i])&&!selected.has(items[i+1]))[items[i],items[i+1]]=[items[i+1],items[i]];}else for(let i=1;i<items.length;i++)if(selected.has(items[i])&&!selected.has(items[i-1]))[items[i],items[i-1]]=[items[i-1],items[i]];});break;
      case 'left':case 'right':case 'up':case 'down':if(editable.length)mutate(()=>{const step=shift?10:1;for(const o of editable){o.x+=action==='left'?-step:action==='right'?step:0;o.y+=action==='up'?-step:action==='down'?step:0;}});break;
      case 'edit':if(editable.length===1)await this.editItem(editable[0]);break;case 'transform':await this.transform();break;
      case 'previous-page':this.navigate(-1);break;case 'next-page':this.navigate(1);break;case 'first-page':this.goTo(0);break;case 'last-page':this.goTo(this.book.pages.length-1);break;
      case 'zoom-in':this.setZoom(this.zoom*1.2);break;case 'zoom-out':this.setZoom(this.zoom/1.2);break;case 'zoom-reset':this.setZoom(1);break;case 'fit':this.fit();break;
      case 'thinner':case 'thicker':{const delta=action==='thinner'?-1:1;if(this.tool==='eraser')this.eraserSize=Math.max(2,Math.min(70,this.eraserSize+delta));else this.width=Math.max(.5,Math.min(20,this.width+delta*.5));this.drawContext();break;}
      case 'search':this.root.removeClass('pb-sidebar-hidden');this.root.removeClass('pb-immersive');this.drawSidebar();this.drawToolbar();this.sidebar.querySelector('input')?.focus();break;
      case 'sidebar':this.root.toggleClass('pb-sidebar-hidden',!this.root.hasClass('pb-sidebar-hidden'));this.drawSidebar();this.drawToolbar();break;
      case 'immersive':this.root.toggleClass('pb-immersive',!this.root.hasClass('pb-immersive'));this.drawSidebar();this.drawToolbar();break;
      case 'reading':this.reading=!this.reading;this.drawPages();this.drawToolbar();break;
      case 'new-page':this.addPage();break;case 'export-pdf':await this.exportDialog();break;case 'page-link':await this.copyLink();break;
    }
  }
  private async pasteEvent(e:ClipboardEvent){if(this.page.locked||(e.target as HTMLElement).closest('input,textarea,[contenteditable=true]'))return;const image=Array.from(e.clipboardData?.items??[]).find(i=>i.type.startsWith('image/'))?.getAsFile();if(image){e.preventDefault();await this.run(()=>this.importFile(image));return;}const text=e.clipboardData?.getData('text/plain');if(text&&!this.clipboard){e.preventDefault();const before=this.snapshot();this.page.items.push({...item('text',60,60,400,240,this.color),text,fontSize:22});this.changed(before);this.repaint();}}
  private addPage(){const before=this.snapshot();const p=newPage(this.page.paper);p.width=this.page.width;p.height=this.page.height;p.color=this.page.color;p.spacing=this.page.spacing;this.book.pages.splice(this.index+1,0,p);this.index++;this.selection.clear();this.changed(before);this.render();}
  private pageMenu(e?:MouseEvent){const menu=new Menu();const add=(title:string,fn:()=>void|Promise<void>)=>menu.addItem(i=>i.setTitle(title).setIcon(`pb-${actionIcon(title)}`).onClick(()=>void this.run(fn)));
    add('页面设置、标题与标签',()=>this.pageProperties());add(this.page.bookmark?'取消书签':'添加书签',()=>{const before=this.snapshot();this.page.bookmark=!this.page.bookmark;this.changed(before);this.drawSidebar();});
    add('复制页面',()=>this.copyPage());
    add('插入空白页面',()=>this.addPage());add('移动至页码…',()=>this.movePage());add('复制到其他笔记本…',()=>this.transferPage(false));add('移动到其他笔记本…',()=>this.transferPage(true));
    add('复制页面链接',()=>this.copyLink());add('将此页设为纸张模板',()=>this.saveTemplate());add('更换图片背景',()=>this.importImageBackground());
    if(this.page.background)add('移除背景（可撤销）',()=>{const before=this.snapshot();delete this.page.background;this.changed(before);this.drawPages();this.drawSidebar();});
    if(this.page.background&&this.book.resources[this.page.background.resource]?.type==='pdf')add('裁切 PDF 页面…',()=>this.cropPdfPage());
    add('清空页面内容…',()=>this.clearPage());add('删除页面…',()=>this.deletePage());if(e)menu.showAtMouseEvent(e);else this.showMenu(menu);
  }
  private moreMenu(){const anchor=toolAnchor()??this.toolbarRight;popover(anchor,(panel,close)=>{panel.addClass('pb-more-panel');panelHeader(panel,'更多',close);const g=section(panel),pageRow=g.createDiv('pb-page-summary');pageRow.createEl('strong',{text:`页面 ${this.index+1}`});const thumb=pageRow.createEl('canvas');thumb.width=36;thumb.height=48;const ctx=thumb.getContext('2d')!;ctx.scale(36/this.page.width,48/this.page.height);this.renderer.paper(ctx,this.page);
    const act=(fn:()=>void|Promise<void>)=>()=>{close();void this.run(fn);};
    row(g,this.page.bookmark?'取消收藏':'添加到收藏夹',()=>{const before=this.snapshot();this.page.bookmark=!this.page.bookmark;this.changed(before);this.drawSidebar();close();},'','bookmark');
    row(g,'拷贝页面',act(()=>this.copyPage()),'','copy');row(g,'旋转页面',act(()=>this.rotatePage()),'','rotate');row(g,'将页面添加到大纲',act(async()=>{const v=await form(this.app,'大纲标题',[{key:'title',name:'标题',value:this.page.outline??this.page.title}]);if(v){const before=this.snapshot();this.page.outline=v.title;this.changed(before);this.drawSidebar();}}),'','file');
    row(g,'更改模板',()=>templatePicker(anchor,this.page,draft=>{const before=this.snapshot();this.page.paper=draft.paper;this.page.color=draft.color;this.page.width=draft.width;this.page.height=draft.height;this.changed(before);this.render();}),'','palette');row(g,'前往页面',act(()=>this.contents()),`1–${this.book.pages.length}`,'next');
    const remove=section(panel,'清空页面或删除页面');row(remove,'删除特定项目',act(()=>this.removeItems(anchor)),'','delete');row(remove,'清除页面',act(()=>this.clearPage()),'',undefined,true);row(remove,'删除当前页',act(()=>this.deletePage()),'','delete',true);
    const settings=section(panel,'设置');row(settings,this.page.locked?'解锁页面':'锁定页面',()=>{const before=this.snapshot();this.page.locked=!this.page.locked;this.changed(before);this.drawSidebar();this.drawPages();close();},'',this.page.locked?'unlock':'lock');toggle(settings,'显示已解决的便签',this.plugin.settings.showResolved,v=>{this.plugin.settings.showResolved=v;void this.plugin.saveSettings();this.repaint();});
    new Setting(settings).setName('滚动方向').addDropdown(d=>d.addOptions({vertical:'垂直',horizontal:'水平'}).setValue(this.plugin.settings.scrollDirection).onChange(v=>{this.plugin.settings.scrollDirection=v as 'vertical'|'horizontal';void this.plugin.saveSettings();this.layout='continuous';this.drawPages();this.drawFooter();}));new Setting(settings).setName('边栏').addDropdown(d=>d.addOptions({left:'左边',right:'右边'}).setValue(this.plugin.settings.leftHanded?'right':'left').onChange(v=>{this.plugin.settings.leftHanded=v==='right';this.root.toggleClass('pb-left',v==='right');void this.plugin.saveSettings();}));row(settings,'触控笔和防误触',()=>this.inputPanel(anchor),'','pen');
    const extra=section(panel,'笔记本');row(extra,'笔记本属性',act(()=>this.bookProperties()),'','notebook');row(extra,'页面设置',act(()=>this.pageProperties()),'','settings');row(extra,'导入 PDF、图片或模板',act(()=>this.importMenu()),'','import');row(extra,'更多页面操作',act(()=>this.pageMenu()));row(extra,'将文本笔记插入页面',act(()=>this.insertMarkdown()),'','text');row(extra,'保存 Markdown 索引',act(()=>this.exportIndex()),'','file');
  });}
  private copyPage(){const before=this.snapshot(),[p]=copyPages([this.page],this.book,this.book);this.book.pages.splice(this.index+1,0,p);this.index++;this.changed(before);this.render();}
  private rotatePage(){if(this.page.locked)return;const before=this.snapshot(),p=this.page,oldHeight=p.height;rotateCrop(p);for(const o of p.items){const x=o.x+o.w/2,y=o.y+o.h/2;o.x=oldHeight-y-o.w/2;o.y=x-o.h/2;o.rotation=(o.rotation+90)%360;}[p.width,p.height]=[p.height,p.width];p.backgroundRotation=((p.backgroundRotation??0)+90)%360;this.changed(before);this.render();}
  private async cropPdfPage(){
    if(this.page.locked){new Notice('请先解锁页面');return;}
    const p=this.page,value=await form(this.app,'裁切 PDF 页面',[{key:'left',name:'左侧裁去（px）',value:'0',type:'number'},{key:'top',name:'上方裁去（px）',value:'0',type:'number'},{key:'right',name:'右侧裁去（px）',value:'0',type:'number'},{key:'bottom',name:'下方裁去（px）',value:'0',type:'number'}]);if(!value)return;
    const left=Number(value.left),top=Number(value.top),right=Number(value.right),bottom=Number(value.bottom);if(right<0||bottom<0)throw new Error('裁切边距不能为负数');const before=this.snapshot();cropPage(p,left,top,p.width-left-right,p.height-top-bottom);this.selection.clear();this.changed(before);this.render();
  }
  private removeItems(anchor:HTMLElement){popover(anchor,(panel,close)=>{panelHeader(panel,'删除特定项目',close);const kinds=new Set<Item['kind']>();const g=section(panel);for(const[kind,name]of[['stroke','笔迹'],['text','文本'],['shape','图形'],['image','图片'],['sticky','便签'],['tape','胶带'],['link','链接'],['table','表格']]as[Item['kind'],string][])toggle(g,name,false,v=>v?kinds.add(kind):kinds.delete(kind));new Setting(panel).addButton(b=>b.setButtonText('删除选定类型').setWarning().onClick(async()=>{close();if(!kinds.size||this.page.locked||!await confirmAction(this.app,'删除特定项目','删除选定类型的未锁定对象？可撤销。','删除'))return;const before=this.snapshot();this.page.items=this.page.items.filter(o=>o.locked||!kinds.has(o.kind));this.changed(before);this.repaint();this.drawSidebar();}));});}
  private inputPanel(anchor:HTMLElement){popover(anchor,(panel,close)=>{panelHeader(panel,'触控笔和防误触',close);const g=section(panel);toggle(g,'启用 S Pen',this.plugin.settings.penEnabled,v=>{this.plugin.settings.penEnabled=v;void this.plugin.saveSettings();});toggle(g,'允许手指书写',this.fingerInk,v=>{this.fingerInk=v;this.plugin.settings.fingerInk=v;void this.plugin.saveSettings();});toggle(g,'左手布局',this.plugin.settings.leftHanded,v=>{this.plugin.settings.leftHanded=v;this.root.toggleClass('pb-left',v);void this.plugin.saveSettings();});panel.createEl('p',{cls:'pb-panel-note',text:'关闭手指书写时，手指负责平移和双指缩放。笔输入后短时间内忽略触摸，以减少掌心误触。'});});}
  private async bookProperties(){const v=await form(this.app,'笔记本属性',[{key:'title',name:'标题',value:this.book.title},{key:'tags',name:'标签（逗号分隔）',value:this.book.tags.join(', ')},{key:'cover',name:'封面颜色',value:this.book.cover,type:'color'}]);if(!v)return;const before=this.snapshot();this.book.title=v.title.trim()||this.book.title;this.book.tags=v.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean);this.book.cover=v.cover;this.changed(before);this.drawToolbar();}
  private async pageProperties(){
    const p=this.page;const v=await form(this.app,'页面设置',[{key:'title',name:'标题',value:p.title},{key:'tags',name:'标签（逗号分隔）',value:p.tags.join(', ')},{key:'paper',name:'纸张',value:p.paper,options:PAPERS},{key:'color',name:'纸张颜色',value:p.color,type:'color'},{key:'width',name:'宽度',value:String(p.width),type:'number'},{key:'height',name:'高度',value:String(p.height),type:'number'},{key:'spacing',name:'格线间距',value:String(p.spacing),type:'number'},{key:'apply',name:'应用纸张样式',value:'page',options:{page:'仅当前页',all:'所有非 PDF 页面'}}]);if(!v)return;
    const w=Number(v.width),h=Number(v.height);if(![w,h].every(n=>Number.isFinite(n)&&n>=100&&n<=4000)){new Notice('页面宽高应在 100 至 4000 之间');return;}
    const before=this.snapshot();p.title=v.title;p.tags=v.tags.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
    const targets=v.apply==='all'?this.book.pages.filter(p=>!p.background):[p];for(const target of targets){for(const link of target.pdfLinks??[]){link.x*=w/target.width;link.w*=w/target.width;link.y*=h/target.height;link.h*=h/target.height;}target.paper=v.paper as Paper;target.color=v.color;target.width=w;target.height=h;target.spacing=Math.max(8,Math.min(200,Number(v.spacing)||28));}this.changed(before);this.render();
  }
  private async contents(){const options:Record<string,string>={};this.book.pages.forEach((p,i)=>{options[p.id]=`${p.bookmark?'书签 · ':''}${i+1}. ${p.title||'未命名页面'}`;p.pdfBookmarks?.forEach((b,j)=>options[`${p.id}#${j}`]=`${'　'.repeat(Math.min(b.level,8))}${b.title} · 第 ${i+1} 页`);});const v=await form(this.app,'目录与书签',[{key:'page',name:'跳转页面',value:this.page.id,options}]);if(v)this.goToId(v.page.split('#')[0]);}
  private async movePage(){const v=await form(this.app,'移动页面',[{key:'position',name:`目标页码（1–${this.book.pages.length}）`,value:String(this.index+1),type:'number'}]);if(!v)return;const to=Math.max(0,Math.min(this.book.pages.length-1,Number(v.position)-1));if(!Number.isInteger(to))return;const before=this.snapshot();const[p]=this.book.pages.splice(this.index,1);this.book.pages.splice(to,0,p);this.index=to;this.changed(before);this.render();}
  private async clearPage(){if(this.page.locked||!await confirmAction(this.app,'清空当前页（可撤销）','移除此页的所有未锁定笔迹和对象？','清空'))return;const before=this.snapshot();this.page.items=this.page.items.filter(o=>o.locked);this.selection.clear();this.changed(before);this.repaint();this.drawSidebar();}
  private async deletePage(){if(!await confirmAction(this.app,'删除当前页（可撤销）','确认删除此页及其笔迹？','删除'))return;const before=this.snapshot();this.book.pages.splice(this.index,1);if(!this.book.pages.length)this.book.pages.push(newPage(this.plugin.settings.paper));this.index=Math.min(this.index,this.book.pages.length-1);this.selection.clear();this.changed(before);this.render();}
  async copyLink(){if(!this.file)return;const link=`obsidian://penbook?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(this.file.path)}&page=${this.page.id}`;await navigator.clipboard.writeText(`[${this.book.title} · ${this.page.title||'第 '+(this.index+1)+' 页'}](${link})`);new Notice('页面链接已复制');}
  private async transferObjects(){const selected=this.page.items.filter(o=>this.selection.has(o.id));if(!selected.length)return;const options:Record<string,string>={};this.book.pages.forEach((p,i)=>{if(i!==this.index)options[p.id]=`${i+1}. ${p.title||'未命名页面'}`;});if(!Object.keys(options).length){new Notice('请先添加另一页');return;}const v=await form(this.app,'选区转移',[{key:'page',name:'目标页面',value:Object.keys(options)[0],options},{key:'mode',name:'操作',value:'copy',options:{copy:'复制',move:'移动'}}]);if(!v)return;const before=this.snapshot(),target=this.book.pages.find(p=>p.id===v.page)!;const copies=clone(selected);copies.forEach(o=>o.id=uid());target.items.push(...copies);if(v.mode==='move')this.page.items=this.page.items.filter(o=>!this.selection.has(o.id)||o.locked);this.selection.clear();this.changed(before);this.repaint();this.drawSidebar();}
  private pageUrl(path:string,id:string){return `obsidian://penbook?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(path)}&page=${id}`;}
  private async transferPage(move:boolean){const book=this.book,page=this.page,sourcePath=this.file?.path??'',destination=await pickFile(this.app,f=>f.extension==='penbook'&&f.path!==sourcePath,'选择目标笔记本');if(!destination||this.book!==book||!book.pages.includes(page))return;let copiedId='';
    await this.app.vault.process(destination,data=>{const target=parseBook(data),[copied]=copyPages([page],book,target,id=>this.pageUrl(sourcePath,id));copiedId=copied.id;target.pages.push(copied);target.modified=new Date().toISOString();return JSON.stringify(target);});
    if(move&&this.book===book){const before=this.snapshot();book.pages.splice(book.pages.indexOf(page),1);for(const p of book.pages)for(const link of p.pdfLinks??[])if(link.page===page.id){link.url=this.pageUrl(destination.path,copiedId);delete link.page;}if(!book.pages.length)book.pages.push(newPage());this.index=Math.min(this.index,book.pages.length-1);this.changed(before);this.render();}new Notice(move?'页面已移动':'页面已复制');
  }
  private importMenu(){const menu=new Menu();const add=(title:string,fn:()=>void|Promise<void>)=>menu.addItem(i=>i.setTitle(title).setIcon(`pb-${actionIcon(title)}`).onClick(()=>void this.run(fn)));
    add('导入 PDF 为 Penbook',()=>this.plugin.fromPdf());
    add('库中的 PDF 或图片',async()=>{const f=await pickFile(this.app,f=>['pdf','png','jpg','jpeg','webp','gif'].includes(f.extension),'选择 PDF 或图片');if(f)await this.importVaultFile(f);});
    add('设备上的 PDF 或图片',async()=>{const f=await localFile('.pdf,image/png,image/jpeg,image/webp,image/gif');if(f)await this.importFile(f);});
    add('从另一个 Penbook 合并页面',()=>this.mergeNotebook());add('从模板文件添加页面',()=>this.loadTemplate());add('图片作为纸张背景',()=>this.importImageBackground());
    this.showMenu(menu);
  }
  async importVaultFile(file:TFile,replaceEmpty=false){const book=this.book,bytes=new Uint8Array(await this.app.vault.readBinary(file));if(this.closed||this.book!==book)throw new Error('笔记本已切换，导入已取消');await this.importBytes(bytes,file.name,file.extension==='pdf'?'application/pdf':file.extension==='jpg'||file.extension==='jpeg'?'image/jpeg':`image/${file.extension}`,replaceEmpty);}
  private async importFile(file:File){const book=this.book,bytes=new Uint8Array(await file.arrayBuffer());if(this.closed||this.book!==book)throw new Error('笔记本已切换，导入已取消');await this.importBytes(bytes,file.name,file.type||(/\.pdf$/i.test(file.name)?'application/pdf':'image/png'));}
  private async importBytes(bytes:Uint8Array,name:string,mime:string,replaceEmpty=false){
    const isPdf=mime==='application/pdf'||/\.pdf$/i.test(name);if(!isPdf&&!mime.startsWith('image/'))throw new Error('仅支持 PDF 和图片');
    await this.importResource({type:isPdf?'pdf':'image',name,mime:isPdf?'application/pdf':mime,data:encode(bytes),size:bytes.length},replaceEmpty);
  }
  private async importResource(resource:Resource,replaceEmpty=false){
    const key=uid(),book=this.book,before=this.snapshot(),isPdf=resource.type==='pdf';book.resources[key]=resource;
    try{
      if(isPdf){new Notice('正在导入 PDF…');const pages=await this.pdfs.withDocument(key,book,pdf=>importPdfPages(pdf,key,resource.name,book));if(this.closed||this.book!==book)throw new Error('笔记本已切换，导入已取消');if(replaceEmpty&&book.pages.length===1&&!this.page.items.length&&!this.page.background){book.pages=pages;this.index=0;}else{book.pages.splice(this.index+1,0,...pages);this.index++;}
      }else{const img=await this.renderer.image(key,this.book);const w=Math.min(img.width,this.page.width*.75),h=w*img.height/img.width;this.page.items.push({...item('image',40,40,w,h,this.color),resource:key});}
      this.changed(before);this.render();
    }catch(error){delete book.resources[key];throw error;}
  }
  private async importImageBackground(){const f=await localFile('image/png,image/jpeg,image/webp');if(!f)return;const bytes=new Uint8Array(await f.arrayBuffer()),key=uid(),before=this.snapshot();this.book.resources[key]={type:'image',name:f.name,mime:f.type,data:encode(bytes)};await this.renderer.image(key,this.book);this.page.background={resource:key};this.changed(before);this.drawPages();this.drawSidebar();}
  private async mergeNotebook(){const target=this.book,file=await pickFile(this.app,f=>f.extension==='penbook'&&f.path!==this.file?.path,'选择要合并的笔记本');if(!file)return;const book=parseBook(await this.app.vault.read(file));if(this.book!==target)return;const before=this.snapshot(),pages=copyPages(book.pages,book,target,id=>this.pageUrl(file.path,id));target.pages.splice(this.index+1,0,...pages);this.index++;this.changed(before);this.render();}
  private async saveTemplate(){const v=await form(this.app,'保存纸张模板',[{key:'name',name:'模板名称',value:this.page.title||'自定义模板'}]);if(!v)return;const book=newBook(v.name);book.pages=[clone(this.page)];book.resources=clone(this.book.resources);const folder=await this.plugin.folder(`${this.plugin.settings.folder}/模板`),name=v.name.replace(/[\\/:*?"<>|]/g,'-'),path=await this.plugin.unique(`${folder}/${name}.penbook`);await this.app.vault.create(path,JSON.stringify(book));new Notice(`模板已保存：${path}`);}
  private async loadTemplate(){const target=this.book,file=await pickFile(this.app,f=>f.extension==='penbook','选择模板笔记本（将插入第一页）');if(!file)return;const book=parseBook(await this.app.vault.read(file));if(this.book!==target)return;const before=this.snapshot(),[p]=copyPages([book.pages[0]],book,target,id=>this.pageUrl(file.path,id));target.pages.splice(this.index+1,0,p);this.index++;this.changed(before);this.render();}
  private async insertMarkdown(){const f=await pickFile(this.app,f=>f.extension==='md','选择文本笔记');if(!f)return;const text=await this.app.vault.read(f),before=this.snapshot();this.page.items.push({...item('text',50,50,this.page.width-100,Math.min(this.page.height-100,500),this.color),text,fontSize:18});this.changed(before);this.repaint();this.drawSidebar();}
  private exportMenu(){const menu=new Menu();const add=(title:string,fn:()=>void|Promise<void>)=>menu.addItem(i=>i.setTitle(title).setIcon(`pb-${actionIcon(title)}`).onClick(()=>void this.run(fn)));
    add('导出 PDF…',()=>this.exportDialog());add('当前页 PNG',()=>this.exportPng());add('当前页 SVG（笔迹为矢量）',()=>this.exportSvg());add('Markdown 页面索引',()=>this.exportIndex());add('笔记本原始文件副本',async()=>{await this.flush();await this.plugin.writeBinary(`${this.book.title}.penbook`,new TextEncoder().encode(this.getViewData()));});add('导出当前页预览供 Markdown 嵌入',()=>this.preview());this.showMenu(menu);
  }
  async exportDialog(){const v=await form(this.app,'导出 PDF',[{key:'range',name:'页面范围',value:'all',options:{all:'整本笔记本',current:'当前页',custom:'指定页码'}},{key:'pages',name:'指定页码（例如 1,3-5）',value:''},{key:'mode',name:'内容',value:'all',options:{all:'背景与批注',ink:'仅笔迹与对象',background:'仅背景'}}]);if(!v)return;let pages=this.book.pages;if(v.range==='current')pages=[this.page];if(v.range==='custom'){const indices=new Set<number>();for(const part of v.pages.split(/[,，]/)){const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error('页码格式不正确');const start=Number(m[1]),end=Number(m[2]??m[1]);if(start<1||end>this.book.pages.length||end<start)throw new Error('页码超出范围');for(let i=start;i<=end;i++)indices.add(i-1);}pages=[...indices].sort((a,b)=>a-b).map(i=>this.book.pages[i]);}if(!pages.length)throw new Error('未选择页面');await this.exportPdf(v.mode as 'all'|'ink'|'background',pages);}
  private async exportPdf(mode:'all'|'ink'|'background',pages:Page[]){new Notice('正在生成 PDF…');await this.flush();const exportPages=clone(pages),book={...this.book,pages:exportPages,resources:{...this.book.resources}},name=`${this.safeName()}${pages.length===1?`-第${this.book.pages.indexOf(pages[0])+1}页`:''}${mode==='all'?'':'-'+mode}.pdf`,bytes=await this.pdfs.export(book,exportPages,this.renderer,mode);return this.plugin.writeBinary(name,bytes);}
  private safeName(){return this.book.title.replace(/[\\/:*?"<>|]/g,'-');}
  private async exportPng(){const c=await this.pdfs.canvas(this.page,this.book,this.renderer,this.plugin.settings.exportScale);await this.plugin.writeBinary(`${this.safeName()}-第${this.index+1}页.png`,decode(c.toDataURL('image/png').split(',')[1]));}
  private async exportIndex(){const title=this.book.title.replace(/[\r\n]/g,' ');const text=[`# ${title}`,'',`笔记本：[[${this.file?.path}]]`,'',...this.book.pages.flatMap((p,i)=>[`## ${i+1}. ${p.title||'未命名页面'}`,'',`[打开此页](obsidian://penbook?vault=${encodeURIComponent(this.app.vault.getName())}&file=${encodeURIComponent(this.file?.path??'')}&page=${p.id})`,p.tags.length?'标签：'+p.tags.map(t=>'#'+t.replace(/\s/g,'-')).join(' '):'',...p.items.filter(o=>o.text).map(o=>o.text!),p.pdfText,''])].join('\n');const folder=await this.plugin.folder(this.plugin.settings.folder),path=await this.plugin.unique(`${folder}/${this.safeName()}-索引.md`),file=await this.app.vault.create(path,text);await this.app.workspace.getLeaf('tab').openFile(file);new Notice('页面索引已保存');}
  private async preview(){if(!this.file)return;const c=await this.pdfs.canvas(this.page,this.book,this.renderer,.6),path=normalizePath(`${this.file.parent?.path??''}/${this.file.basename}.preview.png`),data=decode(c.toDataURL().split(',')[1]);const f=this.app.vault.getAbstractFileByPath(path);if(f instanceof TFile)await this.app.vault.modifyBinary(f,new Uint8Array(data).buffer);else await this.app.vault.createBinary(path,new Uint8Array(data).buffer);new Notice('预览已保存。可使用 penbook 代码块嵌入笔记本。');}
  private async exportSvg(){
    const p=this.page;const bg=await this.pdfs.canvas(p,this.book,this.renderer,1,'background'),ctx=document.createElement('canvas').getContext('2d')!;
    const nodes=[`<image width="${p.width}" height="${p.height}" href="${bg.toDataURL()}"/>`];
    p.items.forEach((o,i)=>nodes.push(itemSvg(o,this.book,this.renderer,ctx,`item-${i}`)));bg.width=bg.height=1;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}">${nodes.join('')}</svg>`;await this.plugin.writeBinary(`${this.safeName()}-第${this.index+1}页.svg`,new TextEncoder().encode(svg));
  }
}
