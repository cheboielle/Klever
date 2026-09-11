import {describe,it,expect} from 'vitest';
import {themes} from '../apps/mobile/src/brandThemes';
function luminance(hex:string){const rgb=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a:string,b:string){const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);}
describe('readable business themes',()=>{
 for(const theme of Object.values(themes))it(theme.label+' keeps buttons, links and body text readable',()=>{
  expect(contrast('#FFFFFF',theme.accent)).toBeGreaterThanOrEqual(4.5);
  for(const background of [theme.paper,theme.soft,'#FFFFFF']){
   expect(contrast(theme.ink,background)).toBeGreaterThanOrEqual(4.5);
   expect(contrast(theme.accent,background)).toBeGreaterThanOrEqual(4.5);
  }
 });
});
