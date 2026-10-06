/** First page still visible at the viewport's leading edge, including page gaps. */
export function pageAtOffset(count:number,offset:number,endAt:(index:number)=>number){
  if(!count)return -1;
  let low=0,high=count;
  while(low<high){const middle=(low+high)>>>1;if(endAt(middle)<=offset+.5)low=middle+1;else high=middle;}
  return Math.min(low,count-1);
}
