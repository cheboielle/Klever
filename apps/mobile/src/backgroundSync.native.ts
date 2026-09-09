import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import {runBackgroundSync} from './backgroundWork';
const TASK='klever-pending-sync-v1';
TaskManager.defineTask(TASK,async()=>await runBackgroundSync()?BackgroundTask.BackgroundTaskResult.Success:BackgroundTask.BackgroundTaskResult.Failed);
let serial:Promise<void>=Promise.resolve();
export async function configureBackgroundSync(enabled:boolean){
 const action=serial.then(async()=>{
  if(!await TaskManager.isAvailableAsync())return;
  const registered=await TaskManager.isTaskRegisteredAsync(TASK);
  if(!enabled){if(registered)await BackgroundTask.unregisterTaskAsync(TASK);return;}
  if(!registered&&await BackgroundTask.getStatusAsync()===BackgroundTask.BackgroundTaskStatus.Available)await BackgroundTask.registerTaskAsync(TASK,{minimumInterval:15});
 });serial=action.catch(()=>{});return action;
}
