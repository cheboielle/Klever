import React,{useState} from 'react';
import {Modal,Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import {rpc} from './client';
type Rule={kind:string;enabled:boolean;recipients:string;channel:string;local_time:string;weekdays:number[];revision:number};
const labels:Record<string,string>={hour_log:'Meter reading reminders',task_due:'Tasks due and overdue',service_due:'Service reminders',compliance:'Compliance expiry',issue_reported:'Issue reports',reassignment:'Assignment changes'};
const box={padding:14,borderWidth:1,borderColor:'#DFE5DC',borderRadius:12,gap:10} as const;
function Choice({label,selected=false,onPress,disabled=false}:{label:string;selected?:boolean;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" accessibilityState={{selected,disabled}} disabled={disabled} onPress={onPress} style={{padding:11,borderRadius:9,backgroundColor:selected?'#226A50':'#EAF0E7',opacity:disabled?.5:1}}><Text style={{color:selected?'white':'#153C32'}}>{label}</Text></Pressable>;}
export function NotificationSettings({writable}:{writable:boolean}){
 const [open,setOpen]=useState(false),[rules,setRules]=useState<Rule[]>([]),[zone,setZone]=useState(''),[savedZone,setSavedZone]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function load(){const data=await rpc<{timezone:string;rules:Rule[]}>('notification_settings');setRules(data.rules);setZone(data.timezone);setSavedZone(data.timezone);}
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await action();}catch(e){setMessage(e instanceof Error?e.message:'Unable to save. Check your connection and retry.');}finally{setBusy(false);}}
 function change(kind:string,patch:Partial<Rule>){setRules(previous=>previous.map(r=>r.kind===kind?{...r,...patch}:r));}
 async function save(rule:Rule){if(!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rule.local_time))throw Error('Enter a time such as 08:00 or 17:00.');if(!rule.weekdays.length)throw Error('Choose at least one day.');
  const result=await rpc<{status:string}>('save_notification_rule',{p_kind:rule.kind,p_enabled:rule.enabled,p_recipients:rule.recipients,p_channel:rule.channel,p_time:rule.local_time,p_weekdays:rule.weekdays,p_revision:rule.revision});
  if(result.status!=='accepted')throw Error('These settings changed elsewhere. Close and reopen to load the latest settings.');setRules(previous=>previous.map(r=>r.kind===rule.kind?{...r,revision:r.revision+1}:r));setMessage('Reminder settings saved.');
 }
 return <><Choice label="Reminder settings" onPress={()=>{setOpen(true);void run(load);}}/>
 <Modal visible={open} animationType="slide" onRequestClose={()=>setOpen(false)}><ScrollView contentContainerStyle={{padding:24,paddingTop:50,gap:16,backgroundColor:'#F5F6F0'}}>
 <Choice label="Close" onPress={()=>setOpen(false)}/><Text style={{fontSize:26,fontWeight:'700',color:'#153C32'}}>Reminder settings</Text>
 <Text>Urgent issues always alert all admins by push and email. Overdue tasks are reminded daily, with admins included after seven days.</Text>
 <Text>Delivery is awaiting business setup. These preferences will apply when alerts are activated.</Text>
 {message?<Text accessibilityLiveRegion="polite">{message}</Text>:null}{busy?<Text>Working…</Text>:null}
 <View style={box}><Text>Business timezone</Text><TextInput accessibilityLabel="Business timezone" value={zone} onChangeText={setZone} editable={writable&&!busy} autoCapitalize="none" style={{padding:12,backgroundColor:'white'}}/>
 <Choice label="Save timezone" disabled={!writable||busy} onPress={()=>void run(async()=>{if(!await rpc('save_business_timezone',{p_timezone:zone.trim(),p_previous:savedZone}))throw Error('Timezone changed elsewhere. Close and reopen these settings.');setSavedZone(zone.trim());setMessage('Timezone saved.');})}/></View>
 {rules.map(rule=><View key={rule.kind} style={box}><Text style={{fontWeight:'700',fontSize:18}}>{labels[rule.kind]}</Text>
 <Choice label={rule.enabled?'Enabled':'Disabled'} selected={rule.enabled} disabled={!writable||busy} onPress={()=>change(rule.kind,{enabled:!rule.enabled})}/>
 <Text>Who receives it</Text><View style={{flexDirection:'row',gap:8,flexWrap:'wrap'}}>{[['admin','Admins'],['assigned','Assigned technicians'],['both','Both']].map(([value,label])=><Choice key={value} label={label} selected={rule.recipients===value} disabled={!writable||busy} onPress={()=>change(rule.kind,{recipients:value})}/>)}</View>
 <Text>Delivery</Text><View style={{flexDirection:'row',gap:8}}>{[['push','Phone alert'],['email','Email'],['both','Both']].map(([value,label])=><Choice key={value} label={label} selected={rule.channel===value} disabled={!writable||busy} onPress={()=>change(rule.kind,{channel:value})}/>)}</View>
 {['issue_reported','reassignment'].includes(rule.kind)?<Text>Sent when the change happens.</Text>:<><Text>Local time (24-hour format)</Text><TextInput accessibilityLabel={`${labels[rule.kind]} time`} value={rule.local_time.slice(0,5)} onChangeText={local_time=>change(rule.kind,{local_time})} editable={writable&&!busy} style={{padding:12,backgroundColor:'white'}}/>
 <View style={{flexDirection:'row',gap:6,flexWrap:'wrap'}}>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,index)=><Choice key={day} label={day} selected={rule.weekdays.includes(index+1)} disabled={!writable||busy} onPress={()=>change(rule.kind,{weekdays:rule.weekdays.includes(index+1)?rule.weekdays.filter(d=>d!==index+1):[...rule.weekdays,index+1]})}/>)}</View>{rule.kind==='service_due'?<Text>A new due service also triggers an alert before its next scheduled reminder.</Text>:null}</>}
 <Choice label="Save reminder" disabled={!writable||busy} onPress={()=>void run(()=>save(rule))}/></View>)}
 </ScrollView></Modal></>;
}
