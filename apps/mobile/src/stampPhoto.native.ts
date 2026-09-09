import {captureRef} from 'react-native-view-shot';
import {File,Paths} from 'expo-file-system';
export async function stampPhoto(_uri:string,_label:string,view:unknown):Promise<string>{
  return captureRef(view as Parameters<typeof captureRef>[0],{format:'jpg',quality:.86,width:1200,result:'tmpfile'});
}
export async function photoBytes(uri:string):Promise<ArrayBuffer>{return new File(uri).arrayBuffer();}
export function deletePhoto(uri:string){
  if(uri.startsWith(Paths.cache.uri)){try{const file=new File(uri);if(file.exists)file.delete();}catch{/* Cache cleanup can retry at next app startup. */}}
}
