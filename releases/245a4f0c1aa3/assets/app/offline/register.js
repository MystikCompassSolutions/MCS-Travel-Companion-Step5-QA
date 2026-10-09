export async function repairAppFiles() {
 if(!navigator.onLine)throw new Error('Reconnect before repairing app files. Your local trip data remains untouched.');
 const check=new URL('./?repair-check='+Date.now(),document.baseURI);
 const response=await fetch(check,{cache:'no-store'});
 if(!response.ok)throw new Error('The updated app shell is unavailable. Try again while connected.');
 const registration=await navigator.serviceWorker?.getRegistration();
 await registration?.unregister();
 for(const key of await caches.keys())if(key.startsWith('mcs-shell-'))await caches.delete(key);
 location.assign(new URL('./?repair='+Date.now(),document.baseURI));
}

export async function registerOffline(onStatus,onUpdate=()=>{},onRepair=()=>{}) {
 if(!('serviceWorker' in navigator)) {onStatus('Offline storage is unavailable in this browser.');return null;}
 if(!window.isSecureContext) {onStatus('Offline installation requires HTTPS or localhost.');return null;}
 const registration=await navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{
  scope:new URL('./',document.baseURI).pathname,updateViaCache:'none'});
 navigator.serviceWorker.addEventListener('message',event=>{
  if(event.data?.type==='OFFLINE_READY')onStatus('Sample content is saved for offline use. Outside links and maps need internet.');
  if(event.data?.type==='OFFLINE_INCOMPLETE')onRepair('Offline app files are incomplete. Repair app files while connected; your trip data will remain.');
 });
 await navigator.serviceWorker.ready;
 registration.active?.postMessage({type:'CHECK_OFFLINE'});
 let updateOffered=false;
 const offerUpdate=()=>{
  if(!registration.waiting||updateOffered)return;
  updateOffered=true;
  onUpdate(()=>new Promise((resolve,reject)=>{
   const worker=registration.waiting;
   if(!worker){reject(new Error('The update is no longer waiting. Reopen the app.'));return;}
   const timer=setTimeout(()=>reject(new Error('The update did not activate. Use Repair app files while connected.')),10000);
   navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();location.reload();},{once:true});
   worker.postMessage({type:'ACTIVATE_UPDATE'});
  }));
 };
 offerUpdate();
 registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offerUpdate();});});
 let checking=false;
 const checkForUpdate=async()=>{
  if(checking||!navigator.onLine)return;
  checking=true;
  try {await registration.update();offerUpdate();} catch {}
  finally {checking=false;}
 };
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkForUpdate();});
 window.addEventListener('pageshow',()=>{void checkForUpdate();});
 window.addEventListener('focus',()=>{void checkForUpdate();});
 void checkForUpdate();
 return registration;
}
