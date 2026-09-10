import React from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';

export const invitationStyles=StyleSheet.create({
 card:{padding:20,gap:14,borderRadius:18,backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#DFE5DC'},
 title:{fontSize:23,fontWeight:'700',color:'#153C32'},
 text:{fontSize:16,color:'#52665B',lineHeight:23},
 input:{padding:13,borderWidth:1,borderColor:'#CBD6CD',borderRadius:10,fontSize:17,color:'#153C32',backgroundColor:'#FFFFFF'},
 button:{padding:14,borderRadius:10,backgroundColor:'#EAF0E7'},
 buttonText:{color:'#153C32',fontSize:16,fontWeight:'600'},
});
export function InvitationButton({title,onPress,disabled=false}:{title:string;onPress:()=>void;disabled?:boolean}){
 return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[invitationStyles.button,disabled&&{opacity:.45}]}><Text style={invitationStyles.buttonText}>{title}</Text></Pressable>;
}
export function InvitationField({label,value,onChange,kind='text',disabled=false,maxLength=120}:{label:string;value:string;onChange:(value:string)=>void;kind?:'text'|'email'|'phone'|'password';disabled?:boolean;maxLength?:number}){
 return <View style={{gap:6}}><Text style={invitationStyles.text}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled} maxLength={maxLength} secureTextEntry={kind==='password'} autoCorrect={false} autoCapitalize={kind==='text'?'words':'none'} keyboardType={kind==='email'?'email-address':kind==='phone'?'phone-pad':'default'} style={invitationStyles.input}/></View>;
}
