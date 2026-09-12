import {ChoiceSheet} from './ChoiceSheet';
import React,{useEffect,useState} from 'react';
import {Modal,Pressable,ScrollView,Text,View} from './brandUI';
import {SafeAreaView} from './brandUI';
import {Feather} from './BrandIcons';

export function SelectField<T extends string>({label,value,options,onChange,disabled=false}:{label:string;value:T;options:{value:T;label:string}[];onChange:(value:T)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 return <View style={{gap:7}}>
  <Text style={{fontSize:14,fontWeight:'600',color:'#153C32'}}>{label}</Text>
  <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityValue={{text:options.find(o=>o.value===value)?.label??value}} accessibilityState={{disabled,expanded:open}} disabled={disabled} onPress={()=>setOpen(true)} style={{padding:15,minHeight:52,borderWidth:1,borderColor:'#CBD6CC',borderRadius:14,backgroundColor:'white',flexDirection:'row',alignItems:'center',gap:12,opacity:disabled?.5:1}}>
   <Text style={{flex:1,fontSize:16,color:'#153C32'}}>{options.find(o=>o.value===value)?.label??'Choose an option'}</Text><Feather name="chevron-down" size={20} color="#226A50"/>
  </Pressable>
  <ChoiceSheet visible={open} title={label} onClose={()=>setOpen(false)}>
     <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:20,paddingBottom:20,gap:6}}>
      {options.map(option=><Pressable key={option.value} accessibilityRole="radio" accessibilityState={{checked:value===option.value,disabled}} disabled={disabled} onPress={()=>{onChange(option.value);setOpen(false);}} style={{padding:16,minHeight:52,borderRadius:14,backgroundColor:option.value===value?'#E3EDE2':'white',flexDirection:'row',alignItems:'center',gap:12}}><Text style={{flex:1,fontSize:16,color:'#153C32'}}>{option.label}</Text>{value===option.value?<Feather name="check" size={20} color="#226A50"/>:null}</Pressable>)}
     </ScrollView>
  </ChoiceSheet>
 </View>;
}
