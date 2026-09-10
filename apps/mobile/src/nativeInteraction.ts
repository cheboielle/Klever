// Native pickers and permissions temporarily move the app out of focus.
// Keep their return event separate from an ordinary trip to another app.
let count=0;
let returningUntil=0;
export function nativeInteractionActive(returning=true){return count>0||(returning&&Date.now()<returningUntil);}
export async function nativeInteraction<T>(work:()=>Promise<T>):Promise<T>{
 count++;
 try{return await work();}finally{count--;returningUntil=Date.now()+500;}
}
