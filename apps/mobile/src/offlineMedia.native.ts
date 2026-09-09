import * as FS from 'expo-file-system/legacy';
import {File} from 'expo-file-system';
function folder(user:string){if(!/^[a-f0-9-]{36}$/i.test(user)||!FS.documentDirectory)throw Error('Photo storage is unavailable.');return FS.documentDirectory+'klever-offline/'+user+'/';}
function path(uri:string){const match=/^offline-media:([a-f0-9-]{36})\/([a-f0-9-]{36})$/i.exec(uri);if(!match)throw Error('Invalid saved photo.');return folder(match[1])+match[2]+'.jpg';}
export async function persistMedia(user:string,id:string,uri:string){if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid photo ID.');await FS.makeDirectoryAsync(folder(user),{intermediates:true});const reference='offline-media:'+user+'/'+id;await FS.copyAsync({from:uri,to:path(reference)});return reference;}
export async function mediaBytes(uri:string):Promise<ArrayBuffer>{return new File(path(uri)).arrayBuffer();}
export async function removeMedia(uri:string){await FS.deleteAsync(path(uri),{idempotent:true});}
export async function clearMedia(user:string){await FS.deleteAsync(folder(user),{idempotent:true});}
