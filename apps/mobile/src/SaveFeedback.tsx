import React,{useContext,useEffect,useRef,useState} from 'react';
import {Animated,AppState,Platform} from 'react-native';
import * as Haptics from 'expo-haptics';
import {View,Text,useBrandTheme} from './brandUI';
import {Ionicons} from './BrandIcons';
import {MotionContext} from './motion';
import {subscribeSaveFeedback,type SaveEvent} from './saveEvents';
export function FeedbackHaptics(){useEffect(()=>subscribeSaveFeedback(event=>{if(event.kind==='local'&&Platform.OS!=='web'&&AppState.currentState==='active')void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});}),[]);return null;}
export function SaveFeedback(){const [event,setEvent]=useState<SaveEvent|null>(null),scale=useRef(new Animated.Value(1)).current,reduced=useContext(MotionContext),theme=useBrandTheme();useEffect(()=>subscribeSaveFeedback(setEvent),[]);useEffect(()=>{if(!event)return;scale.setValue(reduced?1:.96);if(!reduced)Animated.spring(scale,{toValue:1,useNativeDriver:true,damping:18,stiffness:240}).start();const timer=setTimeout(()=>setEvent(null),4500);return()=>clearTimeout(timer);},[event,reduced,scale]);if(!event)return null;return <Animated.View style={{transform:[{scale}]}}><View accessibilityLiveRegion="polite" style={{padding:14,borderRadius:14,backgroundColor:theme.soft,flexDirection:'row',gap:10,alignItems:'center'}}><Ionicons name={event.kind==='review'?'alert-circle-outline':event.kind==='local'?'checkmark-circle-outline':'cloud-done-outline'} size={26} color={theme.accent}/><Text style={{color:theme.ink,flex:1,fontWeight:'600'}}>{event.message}</Text></View></Animated.View>;}
