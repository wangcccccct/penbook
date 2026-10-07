import { Page } from './model';
export function cropPage(page:Page,x:number,y:number,w:number,h:number){
  if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<10||h<10||x+w>page.width+.001||y+h>page.height+.001)throw new Error('裁切区域必须位于页面内，宽高至少为 10。');
  const previous=page.backgroundCrop??{x:0,y:0,w:1,h:1};
  page.backgroundCrop={x:previous.x+x/page.width*previous.w,y:previous.y+y/page.height*previous.h,w:w/page.width*previous.w,h:h/page.height*previous.h};
  for(const o of page.items){o.x-=x;o.y-=y;}
  for(const link of page.pdfLinks??[]){link.x-=x;link.y-=y;}
  page.width=w;page.height=h;
}
export function rotateCrop(page:Page){
  const c=page.backgroundCrop;if(c)page.backgroundCrop={x:1-c.y-c.h,y:c.x,w:c.h,h:c.w};
  for(const link of page.pdfLinks??[]){const x=link.x;link.x=page.height-link.y-link.h;link.y=x;[link.w,link.h]=[link.h,link.w];}
}
