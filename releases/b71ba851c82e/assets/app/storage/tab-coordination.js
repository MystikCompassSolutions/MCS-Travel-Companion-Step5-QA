export function createTabCoordinator(tripId, onChange, Channel = globalThis.BroadcastChannel) {
  if (!Channel) return {publish() {}, close() {}};
  let channel;
  try {channel = new Channel(`mcs-trip-${tripId}`);} catch {return {publish() {}, close() {}};}
  const sender = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  channel.onmessage = event => {
    const message = event.data;
    if (message?.type === 'trip-saved' && message.tripId === tripId && message.sender !== sender &&
        Number.isSafeInteger(message.revision)) onChange(message.revision);
  };
  return {
    publish(revision) {channel.postMessage({type: 'trip-saved', tripId, revision, sender});},
    close() {channel.close();}
  };
}
