import {describe,it,expect} from 'vitest';
import {renderCsv} from '../supabase/functions/export-report/render';
describe('CSV exports',()=>{
 it('preserves Unicode, commas and multiline values while preventing spreadsheet formulas',()=>{
  const csv=renderCsv({kind:'assets',business:'Fixture',timezone:'Pacific/Auckland',generated_at:new Date().toISOString(),asset:null,rows:[{id:'1',name:'=HYPERLINK("unsafe")',serial:'Māori,\nvan',current_reading:24,meter_unit:'km'}]});
  expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');expect(csv).toContain('"Māori,\nvan"');expect(csv).toContain('"24"');expect(csv.startsWith('\uFEFF')).toBe(true);
 });
});
