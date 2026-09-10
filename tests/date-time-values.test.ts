import {expect,it} from 'vitest';
import {calendarValue,dateParts,halfHourOptions,timeOptions} from '../apps/mobile/src/dateTimeValues';
it('keeps selected calendar days unchanged including leap days and NZ daylight-saving dates',()=>{
 for(const value of ['2024-02-29','2026-09-27','2026-04-05']){
  const parts=dateParts(value)!;expect(calendarValue(parts.year,parts.month,parts.day)).toBe(value);
 }
 expect(dateParts('2025-02-29')).toBeNull();expect(dateParts('2026-04-31')).toBeNull();expect(dateParts('')).toBeNull();
});
it('offers every half hour without silently changing existing reminder times',()=>{
 expect(halfHourOptions).toHaveLength(48);
 expect(halfHourOptions[0]).toEqual({value:'00:00',label:'12:00 am'});
 expect(halfHourOptions[24]).toEqual({value:'12:00',label:'12:00 pm'});
 expect(halfHourOptions[47].value).toBe('23:30');
 expect(timeOptions('08:15:00')[0].value).toBe('08:15');expect(timeOptions('08:00:00')).toHaveLength(48);
});
