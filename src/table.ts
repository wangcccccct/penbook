import { Item } from './model';

export function tableSize(o: Item) {
  const count=(value:number|undefined,fallback:number,max:number)=>Number.isFinite(value)?Math.max(1,Math.min(max,Math.floor(value!))):fallback;
  return { rows:count(o.rows,4,50), columns:count(o.columns,3,30) };
}
export function tableCells(o: Item, rows=tableSize(o).rows, columns=tableSize(o).columns):string[][] {
  return Array.from({length:rows},(_,r)=>Array.from({length:columns},(_,c)=>o.cells?.[r]?.[c]??''));
}
export function wrapText(text:string,width:number,measure:(text:string)=>number):string[] {
  const lines:string[]=[];
  for(const paragraph of text.split('\n')){
    let line='';
    for(const character of paragraph){if(line&&measure(line+character)>width){lines.push(line);line='';}line+=character;}
    lines.push(line);
  }
  return lines;
}
