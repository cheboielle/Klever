import {afterEach,describe,expect,it,vi} from 'vitest';
import {ForegroundGate,nativeInteraction,nativeInteractionActive} from '../apps/mobile/src/nativeInteraction';
afterEach(()=>vi.useRealTimers());
describe('phone lock lifecycle',()=>{
 it('locks a genuine background transition but not notification shade focus changes',()=>{
  const gate=new ForegroundGate();
  expect(gate.change('inactive',false).lock).toBe(false);
  expect(gate.change('active',false)).toMatchObject({refresh:true,unlock:false});
  expect(gate.change('background',false).lock).toBe(true);
  expect(gate.change('active',false)).toMatchObject({refresh:true,unlock:true});
 });
 it('does not start another unlock when the picker or authentication prompt returns',async()=>{
  vi.useFakeTimers();const gate=new ForegroundGate();
  await nativeInteraction(async()=>{
   expect(gate.change('background',nativeInteractionActive(false)).lock).toBe(false);
   expect(gate.change('active',nativeInteractionActive()).refresh).toBe(false);
  });
  expect(gate.change('active',nativeInteractionActive()).unlock).toBe(false);
  // A fresh trip to another app must still lock during the short return-event grace.
  expect(gate.change('background',nativeInteractionActive(false)).lock).toBe(true);
  vi.advanceTimersByTime(501);
  expect(gate.change('active',nativeInteractionActive())).toMatchObject({refresh:true,unlock:true});
 });
 it('releases the interaction guard after cancellation/errors and nested permission prompts',async()=>{
  vi.useFakeTimers();
  await expect(nativeInteraction(async()=>{
   await nativeInteraction(async()=>{});expect(nativeInteractionActive(false)).toBe(true);throw Error('cancelled');
  })).rejects.toThrow('cancelled');
  expect(nativeInteractionActive(false)).toBe(false);
  vi.advanceTimersByTime(501);expect(nativeInteractionActive()).toBe(false);
 });
});
