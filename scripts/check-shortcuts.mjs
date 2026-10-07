import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
// Exercise the actual view methods with only the desktop UI dependencies stubbed.
const source=(await readFile('src/view.ts','utf8')).replace(/^import .*;\n/gm,'');
const built=await build({stdin:{contents:`import {SHORTCUTS,EDIT_ACTIONS,SELECTION_ACTIONS,shortcutAction,shortcutHint} from './src/shortcuts';import {pageAtOffset} from './src/page-navigation';import {newBook,newPage,item,clone,uid} from './src/model';import {selectionClipboard,pasteItems} from './src/selection-clipboard';const TextFileView=class{},Notice=class{};${source}\nexport {SHORTCUTS,shortcutAction,pageAtOffset};`,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const {PenbookView,SHORTCUTS,shortcutAction,pageAtOffset}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
globalThis.document={activeElement:null};
globalThis.Element=class{constructor(editing=false){this.editing=editing;}closest(){return this.editing?this:null;}};
const root=new Element();document.activeElement=root;
const make=()=>{const v=Object.create(PenbookView.prototype);Object.assign(v,{plugin:{selectionClipboard:null},valid:true,closed:false,index:0,book:{pages:[{id:'page',items:[{id:'a',x:0,y:0},{id:'b',x:20,y:20},{id:'locked',x:40,y:40,locked:true}]}],resources:{}},selection:new Set(),changes:[],finishGesture:async()=>{},snapshot(){return structuredClone(this.book);},changed(before){this.changes.push(before);},repaint(){},drawSidebar(){},drawToolbar(){},updateSelectionBar(){},setTool(tool){this.tool=tool;this.selection.clear();}});return v;};
for(const metaKey of[true,false]){
  const v=make(),pending=[];v.run=async fn=>{const job=fn();pending.push(job);await job;};
  const dispatch=async(key,extra={})=>{const e={key,code:'',metaKey,ctrlKey:!metaKey,shiftKey:false,altKey:false,isComposing:false,target:root,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};const handled=v.key(e);await Promise.all(pending.splice(0));return{handled,e};};
  const all=await dispatch('a');assert(all.handled&&all.e.defaultPrevented&&all.e.stopped);assert.equal(v.tool,'lasso');assert.deepEqual([...v.selection],['a','b']);
  await dispatch('g');assert(v.page.items[0].group);assert.equal(v.page.items[0].group,v.page.items[1].group);
  await dispatch('g',{shiftKey:true});assert.equal(v.page.items[0].group,undefined);
  await dispatch('ArrowRight',{metaKey:false,ctrlKey:false,shiftKey:true});assert.equal(v.page.items[0].x,10);assert.equal(v.page.items[2].x,40);
  await dispatch('c');const clipboard=structuredClone(v.clipboard);await dispatch('d');assert.equal(v.page.items.length,5);assert.deepEqual(v.clipboard,clipboard);assert.equal(new Set(v.page.items.map(o=>o.id)).size,5);
  await dispatch('x');assert.equal(v.page.items.length,3);assert.equal(v.clipboard.items.length,2);await dispatch('v');assert.equal(v.page.items.length,5);
  await dispatch('l');assert(v.page.items.filter(o=>v.selection.has(o.id)).every(o=>o.locked));await dispatch('l');assert(v.page.items.filter(o=>v.selection.has(o.id)).every(o=>!o.locked));
  const before=structuredClone(v.book);v.page.locked=true;assert.equal((await dispatch('x')).handled,false);assert.deepEqual(v.page.items,before.pages[0].items);v.page.locked=false;
  document.activeElement=new Element(true);assert.equal((await dispatch('a',{target:document.activeElement})).handled,false);document.activeElement=root;
  assert.equal((await dispatch('a',{isComposing:true})).handled,false);assert.equal((await dispatch('a',{altKey:true})).handled,false);
  assert.equal((await dispatch('Delete',{metaKey:false,ctrlKey:false,repeat:true})).handled,true);assert.equal(v.page.items.length,5);
  await dispatch('Delete',{metaKey:false,ctrlKey:false});assert.equal(v.page.items.length,3);assert(v.page.items.some(o=>o.id==='locked'));
}
const bindings=new Set();for(const [action,,keys]of SHORTCUTS)for(const chord of keys){assert(!bindings.has(chord),`duplicate ${chord}`);bindings.add(chord);const chunks=chord.split('+'),key=chord.endsWith('++')?'+':chunks.at(-1);assert.equal(shortcutAction({key,code:'',metaKey:chunks.includes('Mod'),ctrlKey:false,shiftKey:chunks.includes('Shift'),altKey:false,isComposing:false}),action,chord);}
const layers=make();layers.selection=new Set(['a']);await layers.executeShortcut('front');assert.deepEqual(layers.page.items.map(o=>o.id),['b','locked','a']);await layers.executeShortcut('lower');assert.deepEqual(layers.page.items.map(o=>o.id),['b','a','locked']);await layers.executeShortcut('back');assert.deepEqual(layers.page.items.map(o=>o.id),['a','b','locked']);layers.selection=new Set(['a','b']);await layers.executeShortcut('raise');assert.deepEqual(layers.page.items.map(o=>o.id),['locked','a','b']);
const grouped=make();grouped.page.items[0].group=grouped.page.items[1].group='original';grouped.selection=new Set(['a','b']);await grouped.executeShortcut('duplicate');const copies=grouped.page.items.slice(3);assert.equal(copies[0].group,copies[1].group);assert.notEqual(copies[0].group,'original');
assert.equal(shortcutAction({key:'}',code:'BracketRight',metaKey:true,ctrlKey:false,shiftKey:true,altKey:false,isComposing:false}),'front');
assert.equal(shortcutAction({key:'+',code:'Equal',metaKey:true,ctrlKey:false,shiftKey:true,altKey:false,isComposing:false}),'zoom-in');
// Viewport tracking: unequal page sizes, gap, floating controls, reverse and horizontal scrolling.
assert.equal(pageAtOffset(0,0,()=>0),-1);const ends=[100,224,348];for(const[offset,expected]of[[-10,0],[99,0],[100,1],[110,1],[223,1],[224,2],[1000,2]])assert.equal(pageAtOffset(3,offset,i=>ends[i]),expected);
let reads=0;assert.equal(pageAtOffset(10000,987600,i=>{reads++;return(i+1)*100;}),9876);assert(reads<=15);
const navigation=make();navigation.book.pages=[{id:'p1',items:[]},{id:'p2',items:[]},{id:'p3',items:[]}];let scroll=0;navigation.stage={isConnected:true,getBoundingClientRect:()=>({top:100,left:50,bottom:600})};navigation.plugin={settings:{scrollDirection:'vertical'}};let sidebarUpdates=0,footerUpdates=0;navigation.drawSidebar=()=>sidebarUpdates++;navigation.drawFooter=()=>footerUpdates++;navigation.contextRow={parentElement:navigation.stage,getBoundingClientRect:()=>({bottom:150})};navigation.surfaces=navigation.book.pages.map((page,i)=>({page,sheet:{active:i===0,toggleClass(_,active){this.active=active;},getBoundingClientRect:()=>({bottom:100+ends[i]-scroll,right:50+ends[i]-scroll})}}));
navigation.layout='continuous';navigation.syncVisiblePage();assert.equal(navigation.index,0);scroll=50;navigation.syncVisiblePage();assert.equal(navigation.index,1);assert.equal(sidebarUpdates,1);assert.equal(footerUpdates,1);assert(navigation.surfaces[1].sheet.active);navigation.syncVisiblePage();assert.equal(sidebarUpdates,1);
scroll=174;navigation.syncVisiblePage();assert.equal(navigation.index,2);scroll=0;navigation.syncVisiblePage();assert.equal(navigation.index,0);
navigation.gesture={tool:'pen'};scroll=200;navigation.syncVisiblePage();assert.equal(navigation.index,0);navigation.gesture=undefined;navigation.inlineEditor={};navigation.syncVisiblePage();assert.equal(navigation.index,0);navigation.inlineEditor=undefined;navigation.plugin.settings.scrollDirection='horizontal';scroll=100;navigation.syncVisiblePage();assert.equal(navigation.index,1);
console.log(JSON.stringify({actions:SHORTCUTS.length,bindings:bindings.size,platforms:2,selectionClipboardLocks:true,inputAndComposition:true,scrollPageTracking:true,largeBookLookupReads:reads}));
// Simulate lifecycle events without closing Obsidian or touching user files.
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
const timers=[];globalThis.window={clearTimeout:id=>timers.push(id),setTimeout:()=>999};
const lifecycle=make(),events=new Map(),domEvents=new Map(),writes=[];let endGesture,finishWrite;
const gestureDone=new Promise(resolve=>endGesture=resolve),writeDone=new Promise(resolve=>finishWrite=resolve);
lifecycle.saving=Promise.resolve();lifecycle.dirty=true;lifecycle.file={path:'test.penbook'};lifecycle.saveTimer=123;lifecycle.raw='old';lifecycle.gesture={tool:'pen'};
lifecycle.inlineEditor={finish(commit){assert(commit);lifecycle.book.pages[0].items.push({id:'pending-text'});lifecycle.inlineEditor=undefined;}};
lifecycle.finishGesture=async commit=>{assert(commit);await gestureDone;if(lifecycle.gesture){lifecycle.book.pages[0].items.push({id:'pending-stroke'});lifecycle.gesture=undefined;}};
const doc={defaultView:{},hidden:false};lifecycle.contentEl={style:{},ownerDocument:doc};lifecycle.registerEvent=()=>{};lifecycle.register=()=>{};lifecycle.registerDomEvent=(target,event,callback)=>domEvents.set(`${target===doc?'document':'window'}:${event}`,callback);
lifecycle.app={workspace:{getActiveViewOfType:()=>lifecycle,on:(name,callback)=>{events.set(name,callback);return{};}},vault:{modify:async(file,data)=>{writes.push({file,data});await writeDone;}}};
await lifecycle.onOpen();const tasks=[];events.get('quit')({add:task=>tasks.push(task)});assert.equal(tasks.length,1);
let quitFinished=false;const quitting=tasks[0]().then(()=>quitFinished=true);assert.equal(writes.length,0);endGesture();await new Promise(setImmediate);assert.equal(writes.length,1);assert(!quitFinished);assert(timers.includes(123));assert(JSON.parse(writes[0].data).pages[0].items.some(o=>o.id==='pending-text'));assert(JSON.parse(writes[0].data).pages[0].items.some(o=>o.id==='pending-stroke'));finishWrite();await quitting;assert(quitFinished);
lifecycle.dirty=true;events.get('active-leaf-change')({view:{}});await new Promise(setImmediate);assert.equal(writes.length,2);
events.get('active-leaf-change')({view:{}});await new Promise(setImmediate);assert.equal(writes.length,2);
lifecycle.dirty=true;domEvents.get('window:blur')();await new Promise(setImmediate);assert.equal(writes.length,3);
lifecycle.dirty=true;domEvents.get('document:visibilitychange')();await new Promise(setImmediate);assert.equal(writes.length,3);doc.hidden=true;domEvents.get('document:visibilitychange')();await new Promise(setImmediate);assert.equal(writes.length,4);
console.log(JSON.stringify({quitWaitsForGestureAndWrite:true,tabSwitchImmediateSave:true,windowBlurAndHiddenSave:true,userFilesTouched:false}));
