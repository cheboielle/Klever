import React,{createContext,useEffect,useState} from 'react';
import {AccessibilityInfo} from 'react-native';
export const MotionContext=createContext(true);
export function MotionProvider({children}:{children:React.ReactNode}){const [reduced,setReduced]=useState(true);useEffect(()=>{let alive=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive)setReduced(value);}).catch(()=>{/* Keep reduced motion if the setting cannot be read. */});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{alive=false;sub.remove();};},[]);return <MotionContext.Provider value={reduced}>{children}</MotionContext.Provider>;}
