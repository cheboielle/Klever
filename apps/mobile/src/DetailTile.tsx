import {MotionContext} from './motion';
import React,{useContext,useEffect,useRef,useState} from 'react';
import {Animated,Easing} from 'react-native';
import {Pressable,Text,View} from './brandUI';
import {Ionicons} from './BrandIcons';

/** Keep opened forms mounted so collapsing a tile never discards a draft or photo. */
export function DetailTile({title,description,icon,children,initiallyOpen=false,onCollapse}:{title:string;description?:string;icon?:React.ComponentProps<typeof Ionicons>['name'];children:React.ReactNode;initiallyOpen?:boolean;onCollapse?:()=>void}){
 const reduced=useContext(MotionContext);
 const [open,setOpen]=useState(initiallyOpen),[visited,setVisited]=useState(initiallyOpen);
 const [contentHeight,setContentHeight]=useState(0);
 const height=useRef(new Animated.Value(0)).current;
 const progress=useRef(new Animated.Value(initiallyOpen?1:0)).current;
 useEffect(()=>{
  const target=open?contentHeight:0;
  if(reduced){height.setValue(target);progress.setValue(open?1:0);return;}
  const animation=Animated.parallel([
   Animated.timing(height,{toValue:target,duration:280,easing:Easing.inOut(Easing.cubic),useNativeDriver:false}),
   Animated.timing(progress,{toValue:open?1:0,duration:280,easing:Easing.inOut(Easing.cubic),useNativeDriver:false}),
  ]);animation.start();return()=>animation.stop();
 },[open,contentHeight,reduced,height,progress]);
 useEffect(()=>{if(initiallyOpen){setVisited(true);setOpen(true);}},[initiallyOpen]);
 return <View style={{backgroundColor:'white',borderWidth:1,borderColor:'#DFE5DC',borderRadius:18,overflow:'hidden'}}>
  <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{expanded:open}} onPress={()=>{setVisited(true);setOpen(!open);if(open)onCollapse?.();}} style={{padding:18,minHeight:56,flexDirection:'row',alignItems:'center',gap:12}}>
   {icon?<View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:42,height:42,borderRadius:12,backgroundColor:'#EAF0E7',alignItems:'center',justifyContent:'center',flexShrink:0}}><Ionicons name={icon} size={23} color="#226A50"/></View>:null}
   <View style={{flex:1}}><Text style={{fontSize:17,fontWeight:'700',color:'#153C32'}}>{title}</Text>{description?<Text style={{fontSize:13,lineHeight:20,color:'#53665B',marginTop:4}}>{description}</Text>:null}</View><Animated.View style={{transform:[{rotate:progress.interpolate({inputRange:[0,1],outputRange:['0deg','180deg']})}]}}><Ionicons name="chevron-down" size={20} color="#226A50"/></Animated.View>
  </Pressable>
  {visited?<Animated.View accessibilityElementsHidden={!open} importantForAccessibility={open?'auto':'no-hide-descendants'} pointerEvents={open?'auto':'none'} style={{height,opacity:progress,overflow:'hidden'}}><View onLayout={event=>setContentHeight(event.nativeEvent.layout.height)} style={{position:'absolute',top:0,left:0,right:0,padding:18,paddingTop:0,gap:16}}>{children}</View></Animated.View>:null}
 </View>;
}
