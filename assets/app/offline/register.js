export async function registerOffline(onStatus) {
 if(!('serviceWorker' in navigator)) {onStatus('Offline storage is unavailable in this browser.');return null;}
 if(!window.isSecureContext) {onStatus('Offline installation requires HTTPS or localhost.');return null;}
 const registration=await navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:new URL('./',document.baseURI).pathname});
 navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='OFFLINE_READY')onStatus('Sample content is saved for offline use. Outside links and maps need internet.');});
 await navigator.serviceWorker.ready;
 registration.active?.postMessage({type:'CHECK_OFFLINE'});
 registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)onStatus('An app update is ready. Close all Companion tabs and reopen when convenient. Your trip data stays on this device.');});});
 return registration;
}
