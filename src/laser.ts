import { Point } from './model';
export interface LaserTrail<S>{surface:S;points:{point:Point;start:boolean}[];releasedAt?:number}
export function extendLaserTrail<S>(old:LaserTrail<S>|undefined,surface:S,point:Point,start:boolean,dot:boolean,now:number):LaserTrail<S>{
  const trail=old?.surface===surface&&(old.releasedAt===undefined||now-old.releasedAt<1000)?old:{surface,points:[]};
  if(start)trail.releasedAt=undefined;
  const last=trail.points.at(-1);if(!start&&!dot&&last&&Math.hypot(point[0]-last.point[0],point[1]-last.point[1])<.5)return trail;
  if(dot&&!start)trail.points.pop();trail.points.push({point,start:start||trail.points.length===0});return trail;
}
