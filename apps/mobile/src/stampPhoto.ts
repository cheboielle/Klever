// Web preview: embed the capture time in the image before binary upload.
export async function stampPhoto(uri:string,label:string,_view:unknown):Promise<string>{
  const photo=new Image();photo.src=uri;await photo.decode();
  const canvas=document.createElement('canvas');
  canvas.width=Math.min(1600,photo.naturalWidth);canvas.height=Math.round(canvas.width*photo.naturalHeight/photo.naturalWidth);
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable in this browser.');
  if(!label){ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);}
  ctx.drawImage(photo,0,0,canvas.width,canvas.height);
  if(label){
  const font=Math.max(14,Math.round(canvas.width/44));ctx.font=`${font}px sans-serif`;
  ctx.fillStyle='rgba(0,0,0,0.75)';ctx.fillRect(0,canvas.height-font*2.5,canvas.width,font*2.5);
  ctx.fillStyle='white';ctx.fillText(label,12,canvas.height-font*.85,canvas.width-24);
  }
  return canvas.toDataURL('image/jpeg',.86);
}
export async function photoBytes(uri:string):Promise<ArrayBuffer>{return (await fetch(uri)).arrayBuffer();}
export function deletePhoto(_uri:string){}
