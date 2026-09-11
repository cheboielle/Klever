import React,{createContext,useContext,forwardRef} from 'react';
import * as Native from 'react-native';
import {SafeAreaView as NativeSafeAreaView} from 'react-native-safe-area-context';
export * from 'react-native';

import {themes,type ThemeName} from './brandThemes';
export {themes,type ThemeName} from './brandThemes';
export const ThemeContext=createContext<ThemeName>('forest');
export function useBrandTheme(){return themes[useContext(ThemeContext)];}
// Only established brand colours are mapped. Error, warning, white and evidence
// image colours retain their meanings. Context updates also reach open modals.
export function useBrandStyles(){
 const theme=useBrandTheme();
 const palette:Record<string,string>={'#226A50':theme.accent,'#153C32':theme.ink,'#EAF0E7':theme.soft,'#F5F6F0':theme.paper,'#DFE5DC':theme.line,'#DDEBDD':theme.soft,'#EFF2E8':theme.soft};
 const color=(value:unknown)=>typeof value==='string'?(palette[value.toUpperCase()]??value):value;
 const style=(value:any):any=>{
  if(typeof value==='function')return (...args:any[])=>style(value(...args));
  const flat=Native.StyleSheet.flatten(value);if(!flat)return value;
  return Object.fromEntries(Object.entries(flat).map(([key,v])=>[key,key.toLowerCase().includes('color')?color(v):v]));
 };
 return {color,style};
}
function branded<T>(Component:T):T{
 const Wrapped=forwardRef<any,any>((props,ref)=>{
  const {style,color}=useBrandStyles();
  const next:Record<string,any>={...props,ref};
  for(const key of ['style','contentContainerStyle'])if(props[key])next[key]=style(props[key]);
  for(const key of ['color','tintColor','thumbColor','selectionColor','placeholderTextColor','underlayColor'])if(props[key])next[key]=color(props[key]);
  if(props.trackColor)next.trackColor={false:color(props.trackColor.false),true:color(props.trackColor.true)};
  return React.createElement(Component as any,next);
 });
 Wrapped.displayName='BrandedControl';return Wrapped as T;
}
export const View=branded(Native.View);
export const Text=branded(Native.Text);
export const Pressable=branded(Native.Pressable);
export const TextInput=branded(Native.TextInput);
export const ScrollView=branded(Native.ScrollView);
export const Switch=branded(Native.Switch);
export const ActivityIndicator=branded(Native.ActivityIndicator);
export const RefreshControl=branded(Native.RefreshControl);

export type View=Native.View;

export const SafeAreaView=branded(NativeSafeAreaView);
