export type SaveEvent={kind:'local'|'synced'|'review';message:string;at:number};
const listeners=new Set<(event:SaveEvent)=>void>();
export function subscribeSaveFeedback(fn:(event:SaveEvent)=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function publishSaveFeedback(kind:SaveEvent['kind'],message:string){for(const fn of listeners){try{fn({kind,message,at:Date.now()});}catch{/* Presentation must never interrupt durable saving. */}}}
