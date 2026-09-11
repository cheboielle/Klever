import React,{useEffect,useState} from 'react';
import {Pressable,Text,View} from './brandUI';
import {Ionicons} from './BrandIcons';

/** Keep opened forms mounted so collapsing a tile never discards a draft or photo. */
export function DetailTile({title,description,icon,children,initiallyOpen=false}:{title:string;description?:string;icon?:React.ComponentProps<typeof Ionicons>['name'];children:React.ReactNode;initiallyOpen?:boolean}){
 const [open,setOpen]=useState(initiallyOpen),[visited,setVisited]=useState(initiallyOpen);
 useEffect(()=>{if(initiallyOpen){setVisited(true);setOpen(true);}},[initiallyOpen]);
 return <View style={{backgroundColor:'white',borderWidth:1,borderColor:'#DFE5DC',borderRadius:18,overflow:'hidden'}}>
  <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{expanded:open}} onPress={()=>{setVisited(true);setOpen(!open);}} style={{padding:18,minHeight:56,flexDirection:'row',alignItems:'center',gap:12}}>
   {icon?<View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{width:42,height:42,borderRadius:12,backgroundColor:'#EAF0E7',alignItems:'center',justifyContent:'center',flexShrink:0}}><Ionicons name={icon} size={23} color="#226A50"/></View>:null}
   <View style={{flex:1}}><Text style={{fontSize:17,fontWeight:'700',color:'#153C32'}}>{title}</Text>{description?<Text style={{fontSize:13,lineHeight:20,color:'#53665B',marginTop:4}}>{description}</Text>:null}</View><Ionicons name={open?'chevron-up':'chevron-down'} size={20} color="#226A50"/>
  </Pressable>
  {visited?<View accessibilityElementsHidden={!open} importantForAccessibility={open?'auto':'no-hide-descendants'} style={{display:open?'flex':'none',padding:18,paddingTop:0,gap:16}}>{children}</View>:null}
 </View>;
}
