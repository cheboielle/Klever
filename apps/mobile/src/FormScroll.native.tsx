import React from 'react';
import type {ScrollViewProps} from 'react-native';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
export function FormScroll(props:ScrollViewProps){return <KeyboardAwareScrollView bottomOffset={28} keyboardShouldPersistTaps="handled" {...props}/>;}
