import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
const out = process.argv[2] ?? 'release';
const file = join(out,'Penbook PDF 示例.penbook');
try { await access(file); throw new Error('示例文件已存在，拒绝覆盖。'); } catch (e) { if(e.code!=='ENOENT')throw e; }
const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
for(let i=0;i<2;i++){
  const p=pdf.addPage([595,842]);
  p.drawText(`Penbook - PDF annotation ${i+1}`,{x:45,y:775,size:24,font,color:rgb(.2,.35,.3)});
  p.drawText('Original PDF text remains searchable after export.',{x:45,y:730,size:14,font});
  p.drawText('Use your S Pen to write in the space below.',{x:45,y:700,size:14,font});
  for(let y=110;y<660;y+=35)p.drawLine({start:{x:45,y},end:{x:550,y},thickness:.5,color:rgb(.85,.88,.87)});
  if(i===1)p.setRotation(degrees(90));
}
const data=Buffer.from(await pdf.save()).toString('base64'),resource=crypto.randomUUID(),now=new Date().toISOString();
const pages=[0,1].map(i=>({id:crypto.randomUUID(),title:i?'横向 PDF 示例':'PDF 批注示例',width:i?842:595,height:i?595:842,paper:'blank',color:'#ffffff',spacing:28,bookmark:i===0,tags:['示例'],ocr:'',pdfText:`Penbook PDF annotation ${i+1} Original PDF text remains searchable after export.`,background:{resource,page:i},items:[{id:crypto.randomUUID(),kind:'stroke',x:65,y:160,w:235,h:55,bw:235,bh:55,rotation:0,color:'#b54b4b',opacity:1,width:3,pen:'fountain',points:[[3,23,.5],[35,10,.6],[65,40,.5],[100,18,.65],[135,38,.5],[170,5,.6],[225,30,.5]]}]}));
await writeFile(file,JSON.stringify({format:'penbook',version:1,title:'Penbook PDF 示例',cover:'#315b91',tags:['示例'],created:now,modified:now,pages,resources:{[resource]:{type:'pdf',name:'Penbook sample.pdf',mime:'application/pdf',data}}}));
console.log(file);
