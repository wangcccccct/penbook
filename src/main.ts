import { Plugin, PluginSettingTab, Setting, Notice, TFile, normalizePath, Menu, Modal } from 'obsidian';
import { newBook, newPage, Notebook, Paper, Pen, InkProfile, clone, parseBook } from './model';
import { notebookWizard, PAPER_NAMES, coverPreview } from './templates';
import { PRESET_COLORS } from './palette';
import { form, pickFile } from './dialogs';
import { PenbookView, VIEW_TYPE } from './view';
import { icon, registerIcons } from './icons';
import { installTooltips } from './tooltips';
import { SHORTCUTS, shortcutHint } from './shortcuts';

export interface Preferences {
  folder:string; paper:Paper; penColor:string; penWidth:number; pressure:number; fingerInk:boolean;
  leftHanded:boolean; toolbarBottom:boolean; language:'zh'; exportScale:number; eraser:'stroke'|'pixel';
  customColors:string[];presetColors:string[];
  colorHistory:string[]; inkProfiles:Partial<Record<Pen,InkProfile>>; eraserPrecision:'fine'|'standard'; eraserOnly:'all'|'highlighter'|'tape'; eraserAutoPrevious:boolean;
  penEnabled:boolean; scrollDirection:'vertical'|'horizontal'; showResolved:boolean;
}
export const DEFAULTS:Preferences={folder:'手写笔记',paper:'ruled',penColor:'#000000',penWidth:3,pressure:1,fingerInk:false,leftHanded:false,toolbarBottom:false,language:'zh',exportScale:1.5,eraser:'stroke',customColors:[],presetColors:PRESET_COLORS,colorHistory:[],inkProfiles:{},eraserPrecision:'standard',eraserOnly:'all',eraserAutoPrevious:false,penEnabled:true,scrollDirection:'vertical',showResolved:false};

export default class PenbookPlugin extends Plugin {
  settings:Preferences={...DEFAULTS};
  async onload(){
    registerIcons();
    this.register(installTooltips());
    this.settings={...DEFAULTS,...await this.loadData()};
    this.settings.presetColors=[...new Set([...this.settings.presetColors,...this.settings.customColors])];this.settings.inkProfiles={...this.settings.inkProfiles};this.settings.colorHistory=[...this.settings.colorHistory];
    this.registerView(VIEW_TYPE,leaf=>new PenbookView(leaf,this));this.registerExtensions(['penbook'],VIEW_TYPE);
    this.addRibbonIcon('pb-pen','新建手写笔记本',()=>void this.createNotebook());
    this.addCommand({id:'new-notebook',name:'新建手写笔记本',callback:()=>void this.createNotebook()});
    this.addCommand({id:'library',name:'笔记本列表',callback:()=>new Library(this).open()});
    this.addCommand({id:'import-pdf',name:'从 PDF 创建手写笔记本',callback:()=>void this.fromPdf()});
    for(const [id,label] of SHORTCUTS){
      const hint=shortcutHint(id),name=hint?`${label}（${hint}）`:label;
      this.addCommand({id,name,checkCallback:checking=>{const v=this.app.workspace.getActiveViewOfType(PenbookView),target=document.activeElement?.closest('.prompt')?null:document.activeElement;if(!v||!v.canShortcut(id,target))return false;if(!checking)void v.executeShortcut(id,false,target).catch(error=>{console.error('Penbook',error);new Notice(String(error));});return true;}});
    }
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{
      if(file instanceof TFile && file.extension==='pdf')menu.addItem(i=>i.setTitle('用 Penbook 批注 PDF').setIcon('pb-pen').onClick(()=>void this.fromPdf(file)));
      if(file instanceof TFile && file.extension==='penbook')menu.addItem(i=>i.setTitle('复制笔记本').setIcon('pb-copy').onClick(()=>void this.duplicate(file)));
    }));
    this.registerObsidianProtocolHandler('penbook',async params=>{
      if(params.vault&&params.vault!==this.app.vault.getName())return;
      const file=this.app.vault.getAbstractFileByPath(normalizePath(params.file??''));if(!(file instanceof TFile)||file.extension!=='penbook')return;
      const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);
      if(leaf.view instanceof PenbookView)leaf.view.goToId(params.page??'');
    });
    this.registerMarkdownCodeBlockProcessor('penbook',async(source,el,ctx)=>{
      const [path,pageId]=source.trim().split('#');const file=this.app.metadataCache.getFirstLinkpathDest(path,ctx.sourcePath);
      if(!file||file.extension!=='penbook'){el.setText('找不到 Penbook 笔记本');return;}
      try{const book=parseBook(await this.app.vault.read(file)),page=book.pages.find(p=>p.id===pageId)??book.pages[0];
        const button=el.createEl('button',{text:`${book.title} · ${page.title||'第 '+(book.pages.indexOf(page)+1)+' 页'}`});icon(button,'notebook');
        button.onclick=async()=>{const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);if(leaf.view instanceof PenbookView)leaf.view.goToId(page.id);};
        const cached=this.app.vault.getAbstractFileByPath(`${file.parent?.path??''}/${file.basename}.preview.png`);if(cached instanceof TFile)el.createEl('img',{attr:{src:this.app.vault.getResourcePath(cached),alt:book.title}});
      }catch{el.setText('无法读取 Penbook 文件');}
    });
    this.addSettingTab(new PenbookSettings(this));
  }
  asset(path:string){const url=this.app.vault.adapter.getResourcePath(normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/${path}`));return path.endsWith('/')?url.split('?')[0].replace(/\/?$/,'/'):url;}
  async saveSettings(){await this.saveData(this.settings);}
  async folder(path:string){const p=normalizePath(path);if(p&&p!== '/'&&!await this.app.vault.adapter.exists(p))await this.app.vault.createFolder(p);return p==='/'?'':p;}
  async unique(path:string){let p=normalizePath(path),i=1;const dot=p.lastIndexOf('.');while(await this.app.vault.adapter.exists(p)){p=`${path.slice(0,dot)} ${i++}${path.slice(dot)}`;}return p;}
  async writeBinary(name:string,bytes:Uint8Array){
    const base=await this.folder(`${this.settings.folder}/导出`),path=await this.unique(`${base}/${name}`);
    const data=new Uint8Array(bytes).buffer;await this.app.vault.createBinary(path,data);new Notice(`已保存：${path}`);return path;
  }
  async createNotebook(title?:string,book?:Notebook){
    if(!title){const draft=await notebookWizard(this.app,this.settings.paper);if(!draft)return;book=draft;title=draft.title;}
    const safe=title.replace(/[\\/:*?"<>|#\[\]]/g,'-'),folder=await this.folder(this.settings.folder);
    const path=await this.unique(`${folder?folder+'/':''}${safe}.penbook`);const file=await this.app.vault.create(path,JSON.stringify(book??newBook(title,this.settings.paper)));
    const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);return leaf.view instanceof PenbookView?leaf.view:undefined;
  }
  async duplicate(file:TFile){const b=parseBook(await this.app.vault.read(file));b.title+=' 副本';b.created=new Date().toISOString();await this.createNotebook(b.title,b);}
  async fromPdf(file?:TFile){const pdf=file??await pickFile(this.app,f=>f.extension==='pdf','选择库中的 PDF');if(!pdf)return;const view=await this.createNotebook(pdf.basename);if(view)await view.importVaultFile(pdf,true);}
}
export const PAPERS=PAPER_NAMES;

class Library extends Modal {
  constructor(private plugin:PenbookPlugin){super(plugin.app);}
  async onOpen(){
    this.titleEl.setText('Penbook · 笔记本');const search=this.contentEl.createEl('input',{attr:{placeholder:'搜索名称、标签、页面内容…',type:'search'}});search.addClass('pb-library-search');
    const list=this.contentEl.createDiv('pb-library');const entries: {file:TFile;book:Notebook}[]=[];
    for(const file of this.app.vault.getFiles().filter(f=>f.extension==='penbook').sort((a,b)=>b.stat.mtime-a.stat.mtime)){try{entries.push({file,book:parseBook(await this.app.vault.read(file))});}catch{/* Invalid files remain available in the vault. */}}
    const draw=()=>{list.empty();const query=search.value.toLowerCase();for(const {file,book} of entries){if(query&&!`${book.title} ${book.tags.join(' ')} ${book.pages.map(p=>p.title+' '+p.tags.join(' ')+' '+p.pdfText+' '+p.ocr+' '+p.items.map(o=>o.text??'').join(' ')).join(' ')}`.toLowerCase().includes(query))continue;
      const card=list.createEl('button',{cls:'pb-library-card'});const cover=card.createDiv({cls:'pb-book-cover'});if(book.hasCover!==false)coverPreview(cover,book);else cover.style.background=book.pages[0].color;card.createEl('strong',{text:book.title});card.createEl('small',{text:`${book.pages.length} 页 · ${file.path}`});card.onclick=async()=>{this.close();await this.app.workspace.getLeaf(false).openFile(file);};}
      if(!list.children.length)list.createEl('p',{text:'没有匹配的笔记本。使用左侧钢笔按钮新建。'});
    };search.oninput=draw;draw();
  }
}
class PenbookSettings extends PluginSettingTab {
  constructor(private plugin:PenbookPlugin){super(plugin.app,plugin);}
  display(){const el=this.containerEl;el.empty();el.createEl('h2',{text:'Penbook 手写笔记'});
    new Setting(el).setName('新笔记本文件夹').addText(t=>t.setValue(this.plugin.settings.folder).onChange(async v=>{this.plugin.settings.folder=normalizePath(v||'手写笔记');await this.plugin.saveSettings();}));
    new Setting(el).setName('默认纸张').addDropdown(d=>d.addOptions(PAPERS).setValue(this.plugin.settings.paper).onChange(async v=>{this.plugin.settings.paper=v as Paper;await this.plugin.saveSettings();}));
    new Setting(el).setName('默认墨水颜色').addColorPicker(c=>c.setValue(this.plugin.settings.penColor).onChange(async v=>{this.plugin.settings.penColor=v;await this.plugin.saveSettings();}));
    new Setting(el).setName('默认笔宽').addSlider(s=>s.setLimits(1,20,1).setValue(this.plugin.settings.penWidth).setDynamicTooltip().onChange(async v=>{this.plugin.settings.penWidth=v;await this.plugin.saveSettings();}));
    new Setting(el).setName('压感响应').setDesc('小于 1 时轻触更粗，大于 1 时需要更大压力。').addSlider(s=>s.setLimits(.3,2,.1).setValue(this.plugin.settings.pressure).setDynamicTooltip().onChange(async v=>{this.plugin.settings.pressure=v;await this.plugin.saveSettings();}));
    for(const [key,name,desc] of [['fingerInk','允许手指书写','关闭时手指只负责平移和双指缩放，S Pen 与鼠标负责书写。'],['leftHanded','左手布局','将页面导航放在右侧。'],['toolbarBottom','工具栏放在底部','适合平板横屏书写。']] as const)new Setting(el).setName(name).setDesc(desc).addToggle(t=>t.setValue(this.plugin.settings[key]).onChange(async v=>{this.plugin.settings[key]=v;await this.plugin.saveSettings();}));
    el.createEl('h3',{text:'画布快捷键'});
    el.createEl('p',{text:'快捷键仅在 Penbook 画布中生效；输入文字时保留原生编辑快捷键。Mod 在 macOS 上为 Cmd，其他平台为 Ctrl。可在 Obsidian 的快捷键设置中搜索 Penbook，为以下命令另绑按键。'});
    const shortcuts=el.createEl('table'),head=shortcuts.createEl('thead').createEl('tr');head.createEl('th',{text:'操作'});head.createEl('th',{text:'默认按键'});const body=shortcuts.createEl('tbody');for(const [,name,keys]of SHORTCUTS){const row=body.createEl('tr');row.createEl('td',{text:name});row.createEl('td',{text:keys.join(' / ')||'可在快捷键设置中绑定'});}
    el.createEl('p',{text:'方向键移动 1 像素，Shift + 方向键移动 10 像素。复制、剪切、粘贴使用当前笔记本的对象剪贴板。'});
    el.createEl('p',{text:'运行时完全本地。OCR、手写转文本与识别搜索暂未实现；同步、录音与窗口管理不属于插件范围。'});
  }
}
