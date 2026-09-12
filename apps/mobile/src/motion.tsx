import React,{createContext,useContext,useEffect,useState} from 'react';
import {AccessibilityInfo,LayoutAnimation} from 'react-native';
export const MotionContext=createContext(true);
export function MotionProvider({children}:{children:React.ReactNode}){const [reduced,setReduced]=useState(true);useEffect(()=>{let alive=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(alive)setReduced(value);});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{alive=false;sub.remove();};},[]);return <MotionContext.Provider value={reduced}>{children}</MotionContext.Provider>;}
export function useGentleLayout(){const reduced=useContext(MotionContext);return()=>{if(!reduced)LayoutAnimation.configureNext({duration:180,update:{type:'easeInEaseOut'},create:{type:'easeInEaseOut',property:'opacity'},delete:{type:'easeInEaseOut',property:'opacity'}});};}
