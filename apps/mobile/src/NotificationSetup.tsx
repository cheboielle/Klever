import React from 'react';
import {Text} from 'react-native';
export function NotificationSetup(_props:{onOpenAlert:(data:unknown)=>Promise<boolean>}){return <Text style={{fontSize:12,color:'#6B7870'}}>Phone alerts can be enabled in the native app.</Text>;}
