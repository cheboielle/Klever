import React from 'react';
import {Ionicons as NativeIonicons,Feather as NativeFeather} from '@expo/vector-icons';
import {useBrandStyles} from './brandUI';
export function Ionicons(props:React.ComponentProps<typeof NativeIonicons>){const {color}=useBrandStyles();return <NativeIonicons accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...props} color={color(props.color) as string|undefined}/>;}
export function Feather(props:React.ComponentProps<typeof NativeFeather>){const {color}=useBrandStyles();return <NativeFeather accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" {...props} color={color(props.color) as string|undefined}/>;}
