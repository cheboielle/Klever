import {expect,it} from 'vitest';
import {submissionFeedback} from '../apps/mobile/src/submissionFeedback';
it('does not claim sync from a different submission or from an empty history',()=>{
 expect(submissionFeedback('task','ours',[{id:'other'}])).toBeNull();
 expect(submissionFeedback('service','ours',[])).toBeNull();
 expect(submissionFeedback('task',undefined,[{id:'other'}])).toBeNull();
 expect(submissionFeedback('task','ours',[{id:'ours'}])).toContain('saved and synced');
});
it('distinguishes a synced service needing correction from one that advanced its schedule',()=>{
 expect(submissionFeedback('service','ours',[{id:'ours',state:'pending_correction'}])).toContain('administrator needs to review');
 expect(submissionFeedback('service','ours',[{id:'ours',state:'applied'}])).toBe('Service and photo saved and synced.');
 expect(submissionFeedback('service','ours',[{id:'ours',state:'unexpected'}])).toBeNull();
});
