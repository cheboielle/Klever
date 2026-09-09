import React from 'react';
import {Text,View} from 'react-native';
import {Picker} from '@react-native-picker/picker';
export function SelectField<T extends string>({label,value,options,onChange,disabled=false}:{label:string;value:T;options:{value:T;label:string}[];onChange:(value:T)=>void;disabled?:boolean}){
 return <View style={{gap:7}}><Text style={{fontSize:14,fontWeight:'600',color:'#153C32'}}>{label}</Text><View style={{borderWidth:1,borderColor:'#CBD6CC',borderRadius:12,backgroundColor:'white'}}><Picker accessibilityLabel={label} selectedValue={value} enabled={!disabled} onValueChange={onChange} style={{color:'#153C32',minHeight:50}}>{options.map(option=><Picker.Item key={option.value} value={option.value} label={option.label}/>)}</Picker></View></View>;
}
