// Date-only values never pass through UTC, which can move the selected day.
export function dateParts(value:string){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(!match)return null;
 const [year,month,day]=match.slice(1).map(Number),date=new Date(year,month-1,day,12);
 return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?{year,month,day}:null;
}
export function calendarValue(year:number,month:number,day:number){return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
export const halfHourOptions=Array.from({length:48},(_,i)=>{
 const hour=Math.floor(i/2),minute=i%2?'30':'00';
 return {value:`${String(hour).padStart(2,'0')}:${minute}`,label:`${hour%12||12}:${minute} ${hour<12?'am':'pm'}`};
});
export function timeOptions(value:string){
 const time=value.slice(0,5);
 return halfHourOptions.some(o=>o.value===time)?halfHourOptions:[{value:time,label:`${time} (current)`},...halfHourOptions];
}
