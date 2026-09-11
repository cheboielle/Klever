import React from 'react';
import {Text} from './brandUI';
export function NotificationSetup(_props:{showControls?:boolean;onOpenAlert:(data:unknown)=>Promise<boolean>}){return _props.showControls===false?null:<Text style={{fontSize:12,color:'#6B7870'}}>Phone alerts can be enabled in the native app.</Text>;}
