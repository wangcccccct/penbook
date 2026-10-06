import * as Clipper from 'clipper-lib';
export type Pair=[number,number];
export type MultiPolygon=Pair[][][];
// Integer coordinates avoid unstable floating intersections of overlapping cuts.
const SCALE=1024;
function paths(polygons:MultiPolygon){return polygons.flatMap(polygon=>polygon.map((ring,index)=>{
  const path=ring.map(([x,y])=>({X:Math.round(x*SCALE),Y:Math.round(y*SCALE)}));
  if(Clipper.Clipper.Orientation(path)!==(index===0))path.reverse();return path;
}));}
function operation(type:Clipper.ClipType,subject:MultiPolygon,clips:MultiPolygon[]):MultiPolygon{
  const engine=new Clipper.Clipper(),tree=new Clipper.PolyTree();engine.StrictlySimple=true;
  engine.AddPaths(paths(subject),Clipper.PolyType.ptSubject,true);
  for(const clip of clips)engine.AddPaths(paths(clip),Clipper.PolyType.ptClip,true);
  if(!engine.Execute(type,tree,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero))throw new Error('无法完成笔迹裁剪');
  return Clipper.JS.PolyTreeToExPolygons(tree).map(polygon=>[polygon.outer,...polygon.holes].map(ring=>ring.map(p=>[p.X/SCALE,p.Y/SCALE] as Pair)));
}
export const difference=(subject:MultiPolygon,...clips:MultiPolygon[])=>operation(Clipper.ClipType.ctDifference,subject,clips);
export const intersection=(subject:MultiPolygon,clip:MultiPolygon)=>operation(Clipper.ClipType.ctIntersection,subject,[clip]);
export const union=(polygon:Pair[][])=>operation(Clipper.ClipType.ctUnion,[polygon],[]);
