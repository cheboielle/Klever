// Session-only decoded images. Call only after current profile metadata is authorized.
export class ProfileImageCache {
 private owner:object|null=null;
 private images=new Map<string,string>();
 private pending=new Map<string,Promise<string>>();
 private size=0;
 clear(){this.owner=null;this.images.clear();this.pending.clear();this.size=0;}
 async read(owner:object|null,id:string,load:()=>Promise<string>):Promise<string>{
  if(!owner)return load();
  if(owner!==this.owner){this.clear();this.owner=owner;}
  const found=this.images.get(id);if(found!==undefined)return found;
  const active=this.pending.get(id);if(active)return active;
  const work=load().then(image=>{
   if(this.owner===owner&&image.length<=16_000_000){
    while(this.images.size&&(this.size+image.length>16_000_000||this.images.size>=24)){const key=this.images.keys().next().value!;this.size-=this.images.get(key)!.length;this.images.delete(key);}
    this.images.set(id,image);this.size+=image.length;
   }
   return image;
  }).finally(()=>{if(this.pending.get(id)===work)this.pending.delete(id);});
  this.pending.set(id,work);return work;
 }
}
export const profileImages=new ProfileImageCache();
