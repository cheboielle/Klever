// Only a server history record for this exact submission proves its outcome.
export function submissionFeedback(kind:'task'|'service',id:string|undefined,rows:{id:string;state?:string}[]):string|null{
 const record=id?rows.find(row=>row.id===id):undefined;
 if(!record)return null;
 if(kind==='task')return 'Task saved and synced. Its completed record is shown below.';
 if(record.state==='pending_correction')return 'Service and photo synced. An administrator needs to review the reading before this service updates the schedule.';
 return record.state==='applied'?'Service and photo saved and synced.':null;
}
