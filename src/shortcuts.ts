export const SHORTCUTS = [
  ['select-all','全选未锁定对象',['Mod+A']],['deselect','取消选择',['Escape','Mod+Shift+A']],
  ['undo','撤销',['Mod+Z']],['redo','重做',['Mod+Shift+Z','Mod+Y']],['save','保存',['Mod+S']],
  ['copy','复制选区',['Mod+C']],['cut','剪切选区',['Mod+X']],['paste','粘贴选区',['Mod+V']],['duplicate','复制选区副本',['Mod+D']],['delete','删除选区（可撤销）',['Delete','Backspace']],
  ['group','组合选区',['Mod+G']],['ungroup','取消组合',['Mod+Shift+G']],['lock','锁定或解锁选区',['Mod+L']],
  ['raise','上移一层',['Mod+]']],['lower','下移一层',['Mod+[']],['front','移到顶层',['Mod+Shift+]']],['back','移到底层',['Mod+Shift+[']],
  ['left','向左移动选区',['ArrowLeft','Shift+ArrowLeft']],['right','向右移动选区',['ArrowRight','Shift+ArrowRight']],['up','向上移动选区',['ArrowUp','Shift+ArrowUp']],['down','向下移动选区',['ArrowDown','Shift+ArrowDown']],
  ['edit','编辑选区内容与样式',['Enter']],['transform','旋转、缩放与透明度',['Mod+Shift+T']],
  ['pen','钢笔工具',['P']],['eraser','橡皮擦工具',['E']],['lasso','套索工具',['L','V']],['hand','平移工具',['H']],
  ['text','文本框工具',['T']],['shape','形状工具',['S']],['sticky','便签工具',['N']],['link','链接工具',['K']],['table','表格工具',['B']],['laser','激光笔工具',['I']],['tape','胶带工具',['M']],
  ['thinner','减小笔宽或橡皮擦半径',['[']],['thicker','增大笔宽或橡皮擦半径',[']']],
  ['previous-page','上一页',['PageUp']],['next-page','下一页',['PageDown']],['first-page','第一页',['Home']],['last-page','最后一页',['End']],
  ['zoom-in','放大',['Mod+=','Mod++']],['zoom-out','缩小',['Mod+-']],['zoom-reset','缩放至 100%',['Mod+0']],['fit','适合宽度',['Mod+Shift+0']],
  ['search','搜索页面与内容',['Mod+F']],['sidebar','显示或隐藏页面列表',['F9']],['immersive','沉浸模式',['Mod+Shift+F']],['reading','阅读模式',['R']],
  ['new-page','插入页面',['Mod+Shift+N']],['export-pdf','导出 PDF',['Mod+Shift+E']],['page-link','复制当前页链接',[]],
] as const;
export type ShortcutAction=typeof SHORTCUTS[number][0];
export const EDIT_ACTIONS=new Set<ShortcutAction>(['cut','paste','duplicate','delete','group','ungroup','lock','raise','lower','front','back','left','right','up','down','edit','transform','new-page']);
export const SELECTION_ACTIONS=new Set<ShortcutAction>(['copy','cut','duplicate','delete','group','ungroup','lock','raise','lower','front','back','left','right','up','down','edit','transform']);
export const shortcutHint=(action:ShortcutAction)=>SHORTCUTS.find(([id])=>id===action)?.[2][0]?.replace('Mod','Ctrl/Cmd');
export function shortcutAction(e:Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'|'isComposing'>):ShortcutAction|undefined{
  if(e.isComposing||e.altKey)return;
  const mod=e.ctrlKey||e.metaKey;
  // Physical punctuation codes keep shifted brackets and +/- usable on keyboards
  // where KeyboardEvent.key becomes a brace or plus sign.
  let key=e.key.length===1?e.key.toUpperCase():e.key;
  if(e.code==='BracketLeft')key='[';else if(e.code==='BracketRight')key=']';else if(e.code==='Equal')key='=';else if(e.code==='Minus')key='-';
  const chord=`${mod?'Mod+':''}${e.shiftKey?'Shift+':''}${key}`;
  for(const [id,,keys] of SHORTCUTS)if((keys as readonly string[]).includes(chord))return id;
  if(mod&&(key==='+'||key==='=')&&(e.shiftKey||key==='+'))return 'zoom-in';
}
