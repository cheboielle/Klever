import { expect,it } from 'vitest';
import { serviceDue,nextTaskDate } from '../packages/domain/src/index';

it('matches the supplied service arithmetic and overdue threshold',()=>{
  const s={mode:'hours' as const,intervalHours:100,intervalDays:null,baselineHours:1200,baselineDate:null};
  expect(serviceDue(s,1240,'2026-09-09')).toMatchObject({nextHours:1300,hoursRemaining:60,due:false,missingBaseline:false});
  expect(serviceDue(s,1300,'2026-09-09').due).toBe(true);
  expect(serviceDue({...s,baselineHours:1310},1310,'2026-09-09').nextHours).toBe(1410);
});
it('Both is due at either boundary, independent of another reading',()=>{
  const s={mode:'both' as const,intervalHours:100,intervalDays:30,baselineHours:100,baselineDate:'2026-08-10'};
  expect(serviceDue(s,150,'2026-09-09').due).toBe(true);
  expect(serviceDue(s,200,'2026-08-11').due).toBe(true);
  expect(serviceDue(s,150,'2026-09-08').due).toBe(false);
});
it('unknown baseline remains explicitly missing',()=>{
  expect(serviceDue({mode:'hours',intervalHours:100,intervalDays:null,baselineHours:null,baselineDate:null},1240,'2026-09-09')).toMatchObject({missingBaseline:true,nextHours:null,due:false});
});
it('monthly keeps the original day after February and late tasks skip missed slots',()=>{
  expect(nextTaskDate('2026-01-31','2026-01-31','monthly')).toBe('2026-02-28');
  expect(nextTaskDate('2026-01-31','2026-02-28','monthly')).toBe('2026-03-31');
  expect(nextTaskDate('2026-09-01','2026-09-24',7)).toBe('2026-09-29');
});
