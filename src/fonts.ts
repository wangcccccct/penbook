import { Platform } from 'obsidian';

const GENERIC:Record<string,string>={'sans-serif':'系统无衬线','serif':'系统衬线','monospace':'系统等宽'};
let fontFamilies:Promise<string[]>|undefined;

/** Read installed families locally; no font files or metadata leave the device. */
function installedFonts():Promise<string[]> {
  if(fontFamilies)return fontFamilies;
  fontFamilies=(async()=>{
    try {
      if(Platform.isDesktopApp){
        const {execFile}=require('child_process') as typeof import('child_process');
        const platform=process.platform;
        const executable=platform==='darwin'?'/usr/sbin/system_profiler':platform==='win32'?'powershell.exe':'fc-list';
        const args=platform==='darwin'?['SPFontsDataType','-json']:platform==='win32'?['-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name']:['--format','%{family}\n'];
        const output=await new Promise<string>((resolve,reject)=>execFile(executable,args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:15000,windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout)));
        if(platform==='darwin'){
          const records=JSON.parse(output).SPFontsDataType as {enabled?:string;typefaces?:{family?:string;enabled?:string}[]}[];
          return records.flatMap(record=>(record.typefaces??[]).filter(face=>face.enabled!=='no').map(face=>face.family??'')).filter(Boolean);
        }
        return output.split(/\r?\n/).flatMap(line=>platform==='linux'?line.split(','):[line]).map(name=>name.trim()).filter(Boolean);
      }
      const query=(window as Window&{queryLocalFonts?:()=>Promise<{family:string}[]>}).queryLocalFonts;
      if(query)return(await query.call(window)).map(font=>font.family);
    }catch{/* Native font access is not available on every Obsidian host. */}
    return ['Arial','Helvetica','Times New Roman','Georgia','Courier New','Verdana','Roboto','Noto Sans','Noto Serif','Noto Sans CJK SC','Noto Sans CJK TC','PingFang SC','PingFang TC','Songti SC','Microsoft YaHei','SimSun'];
  })().then(families=>[...new Set(families)].sort((a,b)=>a.localeCompare(b)));
  return fontFamilies;
}

export async function fontOptions(current:string):Promise<Record<string,string>> {
  const options={...GENERIC};for(const family of await installedFonts())options[JSON.stringify(family)]=family;
  if(!(current in options))options[current]=current.replace(/^"|"$/g,'');return options;
}

export function fontSelect(parent:HTMLElement,current:string,change:(font:string)=>void){
  const select=parent.createEl('select',{cls:'pb-font-select',attr:{'aria-label':'字体',title:'字体'}});
  const fill=(options:Record<string,string>)=>{if(!select.isConnected)return;select.empty();for(const[value,label]of Object.entries(options))select.createEl('option',{value,text:label});select.value=current;};
  fill({...GENERIC,[current]:GENERIC[current]??current.replace(/^"|"$/g,'')});
  select.onchange=()=>{current=select.value;select.style.fontFamily=current;change(current);};
  void fontOptions(current).then(fill);return select;
}
