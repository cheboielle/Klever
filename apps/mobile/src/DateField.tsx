import {ChoiceSheet} from './ChoiceSheet';
import {Ionicons} from './BrandIcons';
import React,{useState} from 'react';
import {Modal,Pressable,Text,View,ScrollView} from './brandUI';
import {SafeAreaView} from './brandUI';
import {SelectField} from './SelectField';
import {calendarValue,dateParts} from './dateTimeValues';
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
export function DateField({label,value,onChange,disabled=false,clearable=false}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;clearable?:boolean}){
 const [open,setOpen]=useState(false),[year,setYear]=useState(new Date().getFullYear()),[month,setMonth]=useState(new Date().getMonth()+1);
 const selected=dateParts(value),first=(new Date(year,month-1,1,12).getDay()+6)%7,count=new Date(year,month,0,12).getDate();
 function show(){const current=selected??{year:new Date().getFullYear(),month:new Date().getMonth()+1};setYear(current.year);setMonth(current.month);setOpen(true);}
 function step(delta:number){const next=new Date(year,month-1+delta,1,12);setYear(next.getFullYear());setMonth(next.getMonth()+1);}
 return <View style={{gap:7}}><Text style={{fontWeight:'600',color:'#153C32'}}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={show} style={{padding:14,borderWidth:1,borderColor:'#CBD6CC',borderRadius:12,backgroundColor:'white',opacity:disabled?.5:1}}><Text style={{color:'#153C32'}}>▦  {selected?`${selected.day} ${months[selected.month-1]} ${selected.year}`:'Choose date'}</Text></Pressable>
 <ChoiceSheet visible={open} title={label} onClose={()=>setOpen(false)}><ScrollView contentContainerStyle={{padding:20,gap:14}}>
 <SelectField label="Year" value={String(year)} options={Array.from({length:Math.max(2100,year)-Math.min(1900,year)+1},(_,i)=>String(Math.min(1900,year)+i)).map(value=>({value,label:value}))} onChange={v=>setYear(Number(v))}/><SelectField label="Month" value={String(month)} options={months.map((label,i)=>({value:String(i+1),label}))} onChange={v=>setMonth(Number(v))}/>
 <View style={{flexDirection:'row',justifyContent:'space-between'}}><Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={()=>step(-1)} style={{padding:12}}><Text>‹ Previous</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={()=>step(1)} style={{padding:12}}><Text>Next ›</Text></Pressable></View>
 <View style={{flexDirection:'row'}}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><Text key={day} style={{width:'14.2857%',textAlign:'center'}}>{day}</Text>)}</View><View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:first+count},(_,i)=>{const day=i-first+1,date=calendarValue(year,month,day);return day<1?<View key={i} style={{width:'14.2857%'}}/>:<Pressable key={i} accessibilityRole="button" accessibilityLabel={`${day} ${months[month-1]} ${year}`} accessibilityState={{selected:date===value}} onPress={()=>{onChange(date);setOpen(false);}} style={{width:'14.2857%',minHeight:48,justifyContent:'center',borderRadius:8,backgroundColor:date===value?'#226A50':'transparent'}}><Text style={{textAlign:'center',color:date===value?'white':'#153C32'}}>{day}</Text></Pressable>;})}</View>
 {clearable?<Pressable accessibilityRole="button" onPress={()=>{onChange('');setOpen(false);}} style={{padding:14}}><Text>Clear date / unknown</Text></Pressable>:null}
 </ScrollView></ChoiceSheet></View>;
}
