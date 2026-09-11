import {useBrandStyles} from './brandUI';
import React from 'react';
import type {ScrollViewProps} from './brandUI';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
export function FormScroll(props:ScrollViewProps){const {style}=useBrandStyles();return <KeyboardAwareScrollView bottomOffset={28} keyboardShouldPersistTaps="handled" {...props} style={style(props.style)} contentContainerStyle={style(props.contentContainerStyle)}/>;}
