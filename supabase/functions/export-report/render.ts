import {PDFDocument,rgb,type PDFPage,type PDFFont} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
export type ExportData={kind:string;business:string;timezone:string;generated_at:string;asset:null|{name:string;serial:string;meter_unit:string;current_reading:number};rows:Record<string,any>[]};
const columns:Record<string,string[]>={assets:['id','name','serial','type','status','meter_unit','current_reading','archived'],logs:['id','asset','reading','unit','delta','performer','capture_time','server_time','correction_of','correction_of_setup','reason'],services:['id','asset','serial','service','reading','unit','performer','capture_time','server_time','state','cost','currency','mechanic_notes','instructions','corrections','photo_path'],tasks:['id','asset','task','performer','capture_time','server_time','due_date','effective_completion','notes','instructions','checked_ids','corrections','photo_path']};
function cell(value:unknown){let text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
export function renderCsv(data:ExportData){const keys=columns[data.kind];if(!keys)throw Error('Unknown export');return '\uFEFF'+[keys.map(cell).join(','),...data.rows.map(row=>keys.map(key=>cell(row[key])).join(','))].join('\r\n')+'\r\n';}
export async function renderPdf(data:ExportData,fontBytes:Uint8Array,photo:(row:Record<string,any>)=>Promise<Uint8Array|null>){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true});
 pdf.setTitle(data.kind==='services'?'Maintenance history':'Klever Assets export');pdf.setAuthor(data.business);
 const ink=rgb(.08,.23,.19),muted=rgb(.36,.42,.39);let page:PDFPage;let y=0;
 const title=data.kind==='services'?'Maintenance history':data.kind==='logs'?'Meter readings':data.kind==='tasks'?'Task history':'Asset register';
 function newPage(){page=pdf.addPage([595.28,841.89]);page.drawRectangle({x:0,y:779,width:596,height:63,color:ink});page.drawText('KLEVER ASSETS',{x:42,y:811,size:10,font,color:rgb(1,1,1)});page.drawText(title,{x:42,y:790,size:17,font,color:rgb(1,1,1)});y=751;}
 function space(height:number){if(y-height<55)newPage();}
 function text(value:unknown,size=10,color=ink){const content=String(value??'').replace(/\r/g,'');for(const paragraph of content.split('\n')){let line='';for(const char of paragraph){if(font.widthOfTextAtSize(line+char,size)>510){space(size+5);const split=line.lastIndexOf(' ');page.drawText(split>0?line.slice(0,split):line,{x:42,y,size,font,color});y-=size+5;line=split>0?line.slice(split+1):'';}line+=char;}space(size+5);if(line)page.drawText(line,{x:42,y,size,font,color});y-=size+5;}}
 function date(value:unknown){if(!value)return 'Not recorded';return new Date(String(value)).toLocaleString('en-NZ',{timeZone:data.timezone,dateStyle:'medium',timeStyle:'short'});}
 newPage();text(data.business,18);if(data.asset){text(data.asset.name,15);text(`Serial: ${data.asset.serial||'Not recorded'} | Current reading: ${data.asset.current_reading} ${data.asset.meter_unit}`);}
 text(`Exported ${date(data.generated_at)} (${data.timezone})`,9,muted);text(`${data.rows.length} records. Original entries and corrections are retained.`,9,muted);y-=12;
 if(!data.rows.length)text('No records in this export.');
 for(let index=0;index<data.rows.length;index++){
  const row=data.rows[index];if(index>0&&(data.kind==='services'||data.kind==='tasks'))newPage();space(150);text(`${index+1}. ${row.service??row.task??row.name??row.asset??'Record'}`,14);text(`Record ${row.id}`,8,muted);
  if(data.kind==='services'||data.kind==='tasks'){
   text(`${row.asset??'Company-wide task'}${row.serial?' | Serial: '+row.serial:''}`);text(`Performed by: ${row.performer??'Not recorded'}`);
   if(row.reading!=null)text(`Reading at service: ${row.reading} ${row.unit}`);
   text(`Phone capture: ${date(row.capture_time)}`);text(`Server received: ${date(row.server_time)}`);
   if(row.state==='pending_correction')text('Pending admin correction - this entry did not advance the service schedule.');
   if(row.effective_completion===false)text('Completion voided - original evidence retained.');
   if(row.instructions?.instructions)text(row.instructions.instructions);
   for(const item of row.instructions?.checklist??[])text(`${row.checked_ids?.includes(item.id)?'[x]':'[ ]'} ${item.label}`);
   if(row.notes)text('Notes: '+row.notes);if(row.cost!=null)text('Recorded cost: '+(row.currency??'')+' '+Number(row.cost).toFixed(2));if(row.mechanic_notes)text('Mechanic notes: '+row.mechanic_notes);
   for(const correction of row.corrections??[]){text(`Correction (${date(correction.server_time)}): ${correction.action??'void'}. ${correction.reason}`);if(correction.reading!=null)text(`Replacement baseline: ${correction.reading} ${correction.unit}${correction.date?' on '+correction.date:''}`);else if(correction.date)text('Replacement baseline date: '+correction.date);}
   const bytes=await photo(row);if(bytes){const jpg=await pdf.embedJpg(Uint8Array.from(bytes));const scale=Math.min(510/jpg.width,310/jpg.height);const width=jpg.width*scale,height=jpg.height*scale;space(height+38);text('Evidence photo - '+(row.service??row.task),9,muted);page.drawImage(jpg,{x:42,y:y-height,width,height});y-=height+14;}else if(data.kind==='services')text('No photo evidence is recorded for this entry.');
  }else for(const key of columns[data.kind].filter(k=>k!=='id'&&k!=='name'))text(`${key.replaceAll('_',' ')}: ${key.endsWith('_time')?date(row[key]):row[key]??''}`);
  y-=20;
 }
 const pages=pdf.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:42,y:41},end:{x:553,y:41},thickness:.5,color:muted});p.drawText(`Klever Assets | ${i+1} / ${pages.length}`,{x:42,y:27,size:8,font,color:muted});});
 return pdf.save();
}
