import {afterEach,describe,expect,it,vi} from 'vitest';
import {nativeInteraction,nativeInteractionActive} from '../apps/mobile/src/nativeInteraction';
afterEach(()=>vi.useRealTimers());
describe('native interaction refresh guard',()=>{
 it('releases the interaction guard after cancellation/errors and nested permission prompts',async()=>{
  vi.useFakeTimers();
  await expect(nativeInteraction(async()=>{
   await nativeInteraction(async()=>{});expect(nativeInteractionActive(false)).toBe(true);throw Error('cancelled');
  })).rejects.toThrow('cancelled');
  expect(nativeInteractionActive(false)).toBe(false);
  vi.advanceTimersByTime(501);expect(nativeInteractionActive()).toBe(false);
 });
});
