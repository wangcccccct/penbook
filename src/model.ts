export type Point = [number, number, number];
export type Paper = 'blank' | 'ruled' | 'grid' | 'dots' | 'cornell' | 'music' | 'planner' | 'tasks' | 'swot' | 'kanban' | 'finance';
export type Pen = 'ballpoint' | 'fountain' | 'brush' | 'pencil' | 'highlighter';
export type Shape = 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'rounded';
export type StrokeStyle='solid'|'dashed'|'dotted';
export interface InkProfile { tip:number; sensitivity:number; flatness:number; stability:number; style:StrokeStyle; reduceLatency:boolean; straight:boolean; holdToSnap:boolean; alignShapes:boolean; fill:boolean; autoShape?:boolean }
export const DEFAULT_INK:InkProfile={tip:25,sensitivity:50,flatness:0,stability:0,style:'solid',reduceLatency:true,straight:false,holdToSnap:false,alignShapes:true,fill:false};
export interface Item {
  id: string; kind: 'stroke' | 'shape' | 'text' | 'image' | 'link' | 'table' | 'sticky' | 'tape';
  x: number; y: number; w: number; h: number; rotation: number; bw: number; bh: number;
  color: string; opacity: number; locked?: boolean; group?: string;
  points?: Point[]; pen?: Pen; width?: number; shape?: Shape;
  eraseMasks?: [number,number][][][];
  frozenInk?: [number,number][][];
  text?: string; font?: string; fontSize?: number; bold?: boolean; italic?: boolean;
  align?: CanvasTextAlign; resource?: string; target?: string; rows?: number; columns?: number;
  crop?: { x: number; y: number; w: number; h: number };
  ink?:InkProfile; strokeStyle?:StrokeStyle; fill?:boolean; backgroundColor?:string; lineHeight?:number; resolved?:boolean; revealed?:boolean;
}
export interface Page {
  id: string; title: string; width: number; height: number; paper: Paper;
  color: string; spacing: number; items: Item[]; bookmark: boolean; tags: string[];
  background?: { resource: string; page?: number }; ocr: string; pdfText: string;
  locked?:boolean; outline?:string; backgroundRotation?:number;
}
export interface Resource { type: 'pdf' | 'image'; name: string; mime: string; data: string }
export interface Notebook {
  format: 'penbook'; version: 1; title: string; cover: string; tags: string[];
  created: string; modified: string; pages: Page[]; resources: Record<string, Resource>;
  coverStyle?:string; spineColor?:string; hasCover?:boolean; language?:string;
}
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export function newPage(paper: Paper = 'ruled'): Page {
  return { id: uid(), title: '', width: 794, height: 1123, paper, color: '#ffffff', spacing: 28, items: [], bookmark: false, tags: [], ocr: '', pdfText: '' };
}
export function newBook(title = '未命名笔记本', paper: Paper = 'ruled'): Notebook {
  const now = new Date().toISOString();
  return { format: 'penbook', version: 1, title, cover: '#7f6df2', tags: [], created: now, modified: now, pages: [newPage(paper)], resources: {} };
}
export function parseBook(text: string): Notebook {
  const b = JSON.parse(text);
  if (b.format !== 'penbook' || b.version !== 1 || !Array.isArray(b.pages) || !b.pages.length || typeof b.resources !== 'object' || !b.resources) throw new Error('无法识别笔记本格式或版本，原文件未被修改。');
  if (b.pages.length > 10000) throw new Error('页面数量超出支持范围。');
  for (const p of b.pages) {
    if (!p.id || !Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width < 10 || p.height < 10 || p.width > 10000 || p.height > 10000 || !Array.isArray(p.items)) throw new Error('页面数据不完整，原文件未被修改。');
    p.ocr ??= ''; p.pdfText ??= ''; p.tags ??= []; p.spacing ??= 28;
    for (const o of p.items) {
      if (!['stroke','shape','text','image','link','table','sticky','tape'].includes(o.kind) || ![o.x,o.y,o.w,o.h,o.bw,o.bh,o.rotation].every(Number.isFinite) || o.bw <= 0 || o.bh <= 0) throw new Error('对象数据不完整，原文件未被修改。');
      if (o.points && (!Array.isArray(o.points) || o.points.some((p: unknown) => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)))) throw new Error('笔迹数据不完整。');
      if(o.eraseMasks&&(!Array.isArray(o.eraseMasks)||o.eraseMasks.some((polygon:unknown)=>!Array.isArray(polygon)||polygon.some((ring:unknown)=>!Array.isArray(ring)||ring.some((p:unknown)=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))))))throw new Error('擦除数据不完整。');
      if(o.frozenInk&&(!Array.isArray(o.frozenInk)||o.frozenInk.some((r:unknown)=>!Array.isArray(r)||r.some((p:unknown)=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))))throw new Error('笔迹轮廓数据不完整。');
    }
  }
  return b;
}
export function item(kind: Item['kind'], x: number, y: number, w: number, h: number, color: string): Item {
  return { id: uid(), kind, x, y, w, h, bw: Math.max(w, 1), bh: Math.max(h, 1), rotation: 0, color, opacity: 1 };
}
export function stroke(points: Point[], color: string, width: number, pen: Pen): Item {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y] of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const x = minX - width, y = minY - width;
  const w = maxX - x + width, h = maxY - y + width;
  return { ...item('stroke', x, y, w, h, color), points: points.map(p => [p[0] - x, p[1] - y, p[2]]), width, pen, opacity: pen === 'highlighter' ? 0.3 : pen === 'pencil' ? 0.72 : 1 };
}
export function localPoint(o: Item, x: number, y: number): [number, number] {
  const dx = x - o.x - o.w / 2, dy = y - o.y - o.h / 2;
  const a = -o.rotation * Math.PI / 180;
  return [(dx * Math.cos(a) - dy * Math.sin(a) + o.w / 2) * o.bw / o.w, (dx * Math.sin(a) + dy * Math.cos(a) + o.h / 2) * o.bh / o.h];
}
export function contains(o: Item, x: number, y: number, pad = 0): boolean {
  const [lx, ly] = localPoint(o, x, y);
  return lx >= -pad && ly >= -pad && lx <= o.bw + pad && ly <= o.bh + pad;
}
export function inPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function encode(bytes: Uint8Array): string {
  let out = ''; for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(out);
}
export function decode(s: string): Uint8Array { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export function resourceUrl(r: Resource): string { return `data:${r.mime};base64,${r.data}`; }
