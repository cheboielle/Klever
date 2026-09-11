import React from 'react';
import {Text,TextInput,View} from 'react-native';
import Slider from '@react-native-community/slider';

// The slider offers common intervals; direct entry retains every valid existing interval.
export function IntervalField({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
 const numeric=Number(value),within=Number.isInteger(numeric)&&numeric>=1&&numeric<=30;
 return <View style={{gap:10}}>
  <View style={{flexDirection:'row',alignItems:'center',gap:16}}><Text style={{flex:1,fontSize:14,fontWeight:'600',color:'#153C32'}}>Days between tasks</Text><TextInput accessibilityLabel="Days between tasks" keyboardType="number-pad" value={value} onChangeText={onChange} editable={!disabled} selectTextOnFocus style={{minHeight:48,minWidth:80,padding:12,borderRadius:12,borderWidth:1,borderColor:'#CBD6CC',backgroundColor:'white',fontSize:18,textAlign:'center',color:'#153C32'}}/></View>
  <Slider accessibilityLabel="Quick interval, 1 to 30 days" minimumValue={1} maximumValue={30} step={1} value={Number.isFinite(numeric)?Math.min(30,Math.max(1,numeric)):1} disabled={disabled} onValueChange={n=>onChange(String(Math.round(n)))} minimumTrackTintColor="#226A50" maximumTrackTintColor="#DCE5DC" thumbTintColor="#226A50" style={{height:48,width:'100%'}}/>
  <View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{color:'#53665B'}}>1 day</Text><Text style={{color:'#53665B'}}>30 days</Text></View>
  <Text style={{fontSize:13,color:'#53665B'}}>{within?'Slide for a quick choice, or type an exact interval.':'Type an exact interval above. The quick slider covers 1–30 days.'}</Text>
 </View>;
}
