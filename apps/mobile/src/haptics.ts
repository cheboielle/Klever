import {AppState,Platform} from 'react-native';
import * as Haptics from 'expo-haptics';

// Feedback is presentation only: never let unsupported hardware interrupt work.
export async function tactileFeedback(kind:'selection'|'success'='selection'){
 if(Platform.OS==='web'||AppState.currentState==='background'||AppState.currentState==='inactive')return;
 try{
  if(Platform.OS==='android')await Haptics.performAndroidHapticsAsync(kind==='success'?Haptics.AndroidHaptics.Confirm:Haptics.AndroidHaptics.Clock_Tick);
  else if(kind==='success')await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else await Haptics.selectionAsync();
 }catch{/* Devices can disable or lack haptics; the action still proceeds. */}
}
