import {describe,it,expect} from 'vitest';
import {normalizeHex,hsvToHex,hexToHsv,customTheme,contrast} from '../apps/mobile/src/brandColour';
import {attentionItems,serviceSummary,taskSummary,type Overview} from '../apps/mobile/src/workspaceOverview';
describe('custom brand colours',()=>{
 it('accepts pasted short/full HEX and rejects invalid colour input',()=>{expect(normalizeHex(' 147d92 ')).toBe('#147D92');expect(normalizeHex('#abc')).toBe('#AABBCC');for(const value of ['#abcd','red','#12345g',''])expect(normalizeHex(value)).toBe(null);});
 it('round trips wheel colours including grey, black and white',()=>{for(const hex of ['#147D92','#FFFFFF','#000000','#FF0000','#00FF00','#808080']){const hsv=hexToHsv(hex);expect(hsvToHex(hsv.h,hsv.s,hsv.v)).toBe(hex);}});
 it('keeps exact branding and readable derived colours across the colour spectrum',()=>{for(let h=0;h<360;h+=15)for(const v of [.1,.5,1]){const hex=hsvToHex(h,.9,v),theme=customTheme(hex);expect(theme.brand).toBe(hex);expect(contrast(theme.onBrand,hex)).toBeGreaterThanOrEqual(4.5);expect(contrast(theme.accent,theme.soft)).toBeGreaterThanOrEqual(4.5);expect(contrast(theme.ink,theme.paper)).toBeGreaterThanOrEqual(4.5);}});
});
describe('daily priorities',()=>{
 const row={id:'a',open_issues:1,reading_due:true,services:[{id:'s',config:{name:'Oil service',meter_unit:'hours'},due:true,missing_baseline:false,unit_mismatch:false,remaining:0,next_date:null}],tasks:[{id:'t',due:true,can_complete:true,next_due:'2026-09-12',config:{name:'Wash van'}}]};
 const overview={assets:[row],tasks:[],as_of:'now'} as Overview;
 it('routes each priority to the existing exact recording destination and excludes withdrawn assets',()=>{const items=attentionItems(overview,[{id:'a',name:'Van',meter_unit:'hours',archived:false}] as any);expect(items.map(i=>i.kind)).toEqual(['service_due','task_due','hour_log']);expect(items[0].recordId).toBe('s');expect(items[1].recordId).toBe('t');expect(attentionItems(overview,[])).toEqual([]);});
 it('does not present unconfigured service baselines as actionable completions',()=>{expect(attentionItems({...overview,assets:[{...row,services:[{...row.services[0],missing_baseline:true}]}]},[{id:'a',name:'Van'}] as any).some(i=>i.kind==='service_due')).toBe(false);expect(serviceSummary(row)).toBe('1 service due');expect(taskSummary(row)).toBe('1 task due');expect(serviceSummary(undefined)).toContain('Loading');});
});
