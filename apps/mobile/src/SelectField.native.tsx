import React,{useEffect,useState} from 'react';
import {Modal,Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Feather} from '@expo/vector-icons';

export function SelectField<T extends string>({label,value,options,onChange,disabled=false}:{label:string;value:T;options:{value:T;label:string}[];onChange:(value:T)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 return <View style={{gap:7}}>
  <Text style={{fontSize:14,fontWeight:'600',color:'#153C32'}}>{label}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{text:options.find(o=>o.value===value)?.label??value}} accessibilityState={{disabled,expanded:open}} disabled={disabled} onPress={()=>setOpen(true)} style={{padding:15,minHeight:52,borderWidth:1,borderColor:'#CBD6CC',borderRadius:14,backgroundColor:'white',flexDirection:'row',alignItems:'center',gap:12,opacity:disabled?.5:1}}>
   <Text style={{flex:1,fontSize:16,color:'#153C32'}}>{options.find(o=>o.value===value)?.label??'Choose an option'}</Text><Feather name="chevron-down" size={20} color="#226A50"/>
  </Pressable>
  <Modal visible={open} transparent animationType="slide" onRequestClose={()=>setOpen(false)}>
   <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0006'}}>
    <Pressable accessibilityLabel="Dismiss choices" accessibilityRole="button" onPress={()=>setOpen(false)} style={{flex:1}}/>
    <SafeAreaView edges={['bottom','left','right']} style={{maxHeight:'80%',backgroundColor:'#F5F6F0',borderTopLeftRadius:24,borderTopRightRadius:24}}>
     <View style={{padding:20,flexDirection:'row',alignItems:'center',gap:12}}><Text style={{flex:1,fontSize:22,fontWeight:'700',color:'#153C32'}}>{label}</Text><Pressable accessibilityLabel="Close choices" accessibilityRole="button" onPress={()=>setOpen(false)} style={{padding:12}}><Feather name="x" size={22} color="#153C32"/></Pressable></View>
     <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:20,paddingBottom:20,gap:6}}>
      {options.map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityState={{checked:value===option.value,disabled}} disabled={disabled} onPress={()=>{onChange(option.value);setOpen(false);}} style={{padding:16,minHeight:52,borderRadius:14,backgroundColor:option.value===value?'#E3EDE2':'white',flexDirection:'row',alignItems:'center',gap:12}}><Text style={{flex:1,fontSize:16,color:'#153C32'}}>{option.label}</Text>{value===option.value?<Feather name="check" size={20} color="#226A50"/>:null}</Pressable>)}
     </ScrollView>
    </SafeAreaView>
   </View>
  </Modal>
 </View>;
}
