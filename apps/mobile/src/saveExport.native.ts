import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
export async function saveExport(bytes:Uint8Array,name:string,mime:string){if(!await Sharing.isAvailableAsync())throw Error('File sharing is unavailable on this phone.');const file=new File(Paths.cache,Crypto.randomUUID()+'-'+name);try{file.write(bytes);await Sharing.shareAsync(file.uri,{mimeType:mime,dialogTitle:'Save or share export',UTI:mime==='application/pdf'?'com.adobe.pdf':'public.comma-separated-values-text'});}finally{if(file.exists)file.delete();}}
