import { Item, Point, item } from './model';

type XY = [number, number];
const distance = (a:XY,b:XY) => Math.hypot(a[0]-b[0],a[1]-b[1]);
function segmentDistance(p:XY,a:XY,b:XY) {
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  return distance(p,[a[0]+t*dx,a[1]+t*dy]);
}
function simplify(points:XY[],epsilon:number):XY[] {
  if(points.length<3)return points;
  let farthest=0,index=0;
  for(let i=1;i<points.length-1;i++){const d=segmentDistance(points[i],points[0],points.at(-1)!);if(d>farthest){farthest=d;index=i;}}
  if(farthest<=epsilon)return [points[0],points.at(-1)!];
  return [...simplify(points.slice(0,index+1),epsilon).slice(0,-1),...simplify(points.slice(index),epsilon)];
}
// Equal-distance samples prevent slow corners and pressure jitter from biasing the fit.
function resample(points:XY[]):XY[] {
  const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)!+distance(points[i-1],points[i]));
  const total=lengths.at(-1)!;if(!total)return [points[0]];
  const result:XY[]=[];let j=1;
  for(let i=0;i<=96;i++){const target=total*i/96;while(j<lengths.length-1&&lengths[j]<target)j++;const t=(target-lengths[j-1])/(lengths[j]-lengths[j-1]||1),a=points[j-1],b=points[j];result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  return result;
}
function box(points:XY[]) {
  const x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1]));
  return {x,y,w:Math.max(1,Math.max(...points.map(p=>p[0]))-x),h:Math.max(1,Math.max(...points.map(p=>p[1]))-y)};
}
function line(a:XY,b:XY,color:string,width:number,arrow=false):Item {
  let angle=Math.atan2(b[1]-a[1],b[0]-a[0]),length=distance(a,b);
  const snapped=Math.round(angle/(Math.PI/4))*Math.PI/4;
  if(Math.abs(angle-snapped)<Math.PI/45)angle=snapped;
  b=[a[0]+length*Math.cos(angle),a[1]+length*Math.sin(angle)];
  const bounds=box([a,b]);return {...item('shape',bounds.x,bounds.y,bounds.w,bounds.h,color),shape:arrow?'arrow':'line',width,points:[a,b].map(p=>[p[0]-bounds.x,p[1]-bounds.y,.5])};
}
function corners(points:XY[],epsilon:number):XY[] {
  // Start at an extreme, so a stroke begun halfway along an edge doesn't add a corner.
  let start=0;for(let i=1;i<points.length;i++)if(points[i][0]+points[i][1]<points[start][0]+points[start][1])start=i;
  const ring=[...points.slice(start),...points.slice(0,start),points[start]];
  const result=simplify(ring,epsilon).slice(0,-1);
  let changed=true;
  while(changed&&result.length>3){changed=false;for(let i=0;i<result.length;i++){if(segmentDistance(result[i],result[(i+result.length-1)%result.length],result[(i+1)%result.length])<epsilon){result.splice(i,1);changed=true;break;}}}
  return result;
}
function rotatedBox(points:XY[],angle:number) {
  const c=Math.cos(angle),s=Math.sin(angle),local=points.map(([x,y])=>[x*c+y*s,-x*s+y*c]as XY),b=box(local);
  const cx=b.x+b.w/2,cy=b.y+b.h/2;
  return {x:cx*c-cy*s-b.w/2,y:cx*s+cy*c-b.h/2,w:b.w,h:b.h,rotation:angle*180/Math.PI};
}

type Candidate = { object:Item; contour:XY[]; perimeter:number };
const quantile=(values:number[],fraction:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.round((sorted.length-1)*fraction)];};
const mean=(values:number[])=>values.reduce((sum,n)=>sum+n,0)/Math.max(1,values.length);
function pathDistance(p:XY,path:XY[]){let best=Infinity;for(let i=1;i<path.length;i++)best=Math.min(best,segmentDistance(p,path[i-1],path[i]));return best;}
function robustSquared(errors:number[]){const limit=quantile(errors,.92);return mean(errors.map(error=>Math.min(error,limit)**2));}
function worldPoint(p:XY,angle:number):XY{const c=Math.cos(angle),s=Math.sin(angle);return[p[0]*c-p[1]*s,p[0]*s+p[1]*c];}

/** Fit all four edges together. Rounded corners and endpoint overlap do not add vertices. */
function rectangleFit(points:XY[],color:string,width:number):Candidate {
  const fit=(angle:number)=>{
    const c=Math.cos(angle),s=Math.sin(angle),local=points.map(([x,y])=>[x*c+y*s,-x*s+y*c]as XY);
    let left=quantile(local.map(p=>p[0]),.015),right=quantile(local.map(p=>p[0]),.985),top=quantile(local.map(p=>p[1]),.015),bottom=quantile(local.map(p=>p[1]),.985);
    for(let iteration=0;iteration<5;iteration++){
      const groups:number[][]=[[],[],[],[]];
      for(const[x,y]of local){const distances=[Math.abs(x-left),Math.abs(x-right),Math.abs(y-top),Math.abs(y-bottom)],edge=distances.indexOf(Math.min(...distances));groups[edge].push(edge<2?x:y);}
      const average=(samples:number[],fallback:number)=>{if(samples.length<2)return fallback;const lo=quantile(samples,.1),hi=quantile(samples,.9);return mean(samples.filter(n=>n>=lo&&n<=hi));};
      left=average(groups[0],left);right=average(groups[1],right);top=average(groups[2],top);bottom=average(groups[3],bottom);
    }
    const corners:XY[]=[[left,top],[right,top],[right,bottom],[left,bottom],[left,top]];
    const error=robustSquared(local.map(p=>pathDistance(p,corners)));
    return{angle,left,right,top,bottom,error};
  };
  let best=fit(0);
  for(let degree=3;degree<90;degree+=3){const candidate=fit(degree*Math.PI/180);if(candidate.error<best.error)best=candidate;}
  for(const step of[1,.25]){const center=best.angle;for(let offset=-2;offset<=2;offset++){const candidate=fit(center+offset*step*Math.PI/180);if(candidate.error<best.error)best=candidate;}}
  // Only straighten an almost axis-aligned fit when it remains a good fit.
  const aligned=Math.round(best.angle/(Math.PI/2))*Math.PI/2;
  if(Math.abs(best.angle-aligned)<Math.PI/36){const candidate=fit(aligned);if(candidate.error<=best.error*1.3+1)best=candidate;}
  const w=Math.max(1,best.right-best.left),h=Math.max(1,best.bottom-best.top),center=worldPoint([(best.left+best.right)/2,(best.top+best.bottom)/2],best.angle);
  const object={...item('shape',center[0]-w/2,center[1]-h/2,w,h,color),shape:'rectangle' as const,width,rotation:best.angle*180/Math.PI};
  const contour:XY[]=[[best.left,best.top],[best.right,best.top],[best.right,best.bottom],[best.left,best.bottom],[best.left,best.top]].map(p=>worldPoint(p as XY,best.angle));
  return{object,contour,perimeter:2*(w+h)};
}

function ellipseFit(points:XY[],color:string,width:number):Candidate {
  const cx=mean(points.map(p=>p[0])),cy=mean(points.map(p=>p[1]));let xx=0,yy=0,xy=0;
  for(const p of points){xx+=(p[0]-cx)**2;yy+=(p[1]-cy)**2;xy+=(p[0]-cx)*(p[1]-cy);}
  const angle=.5*Math.atan2(2*xy,xx-yy),initial=rotatedBox(points,angle);
  // Refine center, radii, and angle using robust orthogonal-distance least squares.
  let parameters=[initial.x+initial.w/2,initial.y+initial.h/2,initial.w/2,initial.h/2,angle];
  const objective=(v:number[])=>{
    const[cx,cy,rx,ry,theta]=v;if(Math.min(rx,ry)<3)return Infinity;
    const c=Math.cos(theta),s=Math.sin(theta);
    return robustSquared(points.map(([x,y])=>{const u=(x-cx)*c+(y-cy)*s,v=-(x-cx)*s+(y-cy)*c,r=Math.hypot(u/rx,v/ry);const gradient=Math.hypot(u/(rx*rx),v/(ry*ry))/Math.max(r,1e-6);return Math.abs(r-1)/Math.max(gradient,1/Math.max(rx,ry));}));
  };
  let error=objective(parameters);const size=Math.hypot(initial.w,initial.h);
  for(const scale of[.03,.012,.004])for(let pass=0;pass<5;pass++){
    let changed=false;
    for(let dimension=0;dimension<5;dimension++)for(const direction of[-1,1]){const next=[...parameters];next[dimension]+=direction*(dimension===4?scale:size*scale);const nextError=objective(next);if(nextError<error){parameters=next;error=nextError;changed=true;}}
    if(!changed)break;
  }
  let[centerX,centerY,rx,ry,theta]=parameters;
  if(Math.abs(rx-ry)/Math.max(rx,ry)<.09){rx=ry=(rx+ry)/2;theta=0;}
  const contour:XY[]=[];for(let i=0;i<=96;i++){const p=worldPoint([rx*Math.cos(i*Math.PI/48),ry*Math.sin(i*Math.PI/48)],theta);contour.push([centerX+p[0],centerY+p[1]]);}
  return{object:{...item('shape',centerX-rx,centerY-ry,rx*2,ry*2,color),shape:'ellipse',width,rotation:theta*180/Math.PI},contour,perimeter:Math.PI*(3*(rx+ry)-Math.sqrt((3*rx+ry)*(rx+3*ry)))};
}

/** Two-way contour error prevents a partial shape or scribble fitting just one edge. */
function candidateScore(candidate:Candidate,points:XY[],length:number,diagonal:number):number {
  const ratio=length/candidate.perimeter;if(ratio<.72||ratio>1.38||Math.min(candidate.object.w,candidate.object.h)<8)return Infinity;
  const samples=resample(candidate.contour),forward=points.map(p=>pathDistance(p,candidate.contour)),reverse=samples.map(p=>pathDistance(p,points));
  const rms=Math.sqrt(robustSquared(forward)),coverage=Math.sqrt(mean(reverse.map(n=>n*n)));
  if(quantile(forward,.9)>diagonal*.085||quantile(reverse,.9)>diagonal*.095)return Infinity;
  const score=(rms+coverage*.65)/diagonal;
  return score<.07?score:Infinity;
}

/** Geometric model fitting and ranked candidates, following the primitive-recognition approach. */
export function recognizeShape(input:Point[],color:string,width:number):Item|null {
  if(input.length<2)return null;
  const raw=input.filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>[p[0],p[1]]as XY);
  const clean=raw.filter((p,i)=>i===0||distance(p,raw[i-1])>.01);if(clean.length<2)return null;
  const points=resample(clean),bounds=box(points),diagonal=Math.hypot(bounds.w,bounds.h);
  if(diagonal<20)return null;
  const a=points[0],b=points.at(-1)!,endDistance=distance(a,b);
  const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
  if(endDistance>diagonal*.65&&length/endDistance<1.16&&Math.max(...points.map(p=>segmentDistance(p,a,b)))<diagonal*.055)return line(a,b,color,width);

  const closed=endDistance<diagonal*.3&&length>diagonal*1.55;
  if(!closed){
    // One continuous arrow: shaft, first wing, tip, second wing.
    const vertices=simplify(points,diagonal*.035);
    if(vertices.length>=4&&vertices.length<=6){
      const tip=vertices[1],shaft=distance(vertices[0],tip),ux=(tip[0]-vertices[0][0])/shaft,uy=(tip[1]-vertices[0][1])/shaft;
      const wings=vertices.slice(2).filter(p=>distance(p,tip)>shaft*.08&&distance(p,tip)<shaft*.48&&(p[0]-tip[0])*ux+(p[1]-tip[1])*uy<-shaft*.04);
      if(shaft>diagonal*.65&&wings.length>=2){const sides=wings.map(p=>(p[0]-tip[0])*uy-(p[1]-tip[1])*ux);if(Math.min(...sides)<-shaft*.04&&Math.max(...sides)>shaft*.04)return line(vertices[0],tip,color,width,true);}
    }
    return null;
  }
  const candidates:Candidate[]=[rectangleFit(points,color,width),ellipseFit(points,color,width)];
  for(const tolerance of[.025,.04,.06,.085]){
    const vertices=corners(points,diagonal*tolerance);
    if(vertices.length!==3)continue;
    const area=Math.abs(vertices.reduce((sum,p,i)=>{const q=vertices[(i+1)%3];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
    if(area>bounds.w*bounds.h*.2){const vbox=box(vertices),contour=[...vertices,vertices[0]],perimeter=contour.slice(1).reduce((sum,p,i)=>sum+distance(p,contour[i]),0);candidates.push({object:{...item('shape',vbox.x,vbox.y,vbox.w,vbox.h,color),shape:'triangle',width,points:vertices.map(p=>[p[0]-vbox.x,p[1]-vbox.y,.5])},contour,perimeter});}
  }
  const ranked=candidates.map(candidate=>({candidate,score:candidateScore(candidate,points,length,diagonal)})).sort((a,b)=>a.score-b.score);
  return Number.isFinite(ranked[0]?.score)?ranked[0].candidate.object:null;
}
