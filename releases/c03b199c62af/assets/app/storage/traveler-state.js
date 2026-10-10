import {assertSchema} from '../domain/schema.js';

export const EXPORT_LIMIT_BYTES = 2 * 1024 * 1024;
export const STATE_VERSION = '1.1.0';

export class ConflictError extends Error {
  constructor() {super('Another tab changed this trip. Your change was not saved. Review the latest trip and retry.'); this.name = 'ConflictError';}
}

export class CorruptStateError extends Error {
  constructor(raw) {super('Saved trip data could not be read. It has not been replaced. Download a recovery copy before resetting this trip.'); this.name = 'CorruptStateError'; this.raw = raw;}
}

export function newTravelerState(bundle, now = new Date().toISOString()) {
  return {
    travelerStateSchemaVersion: STATE_VERSION,
    tripId: bundle.trip.tripId,
    contentVersionAtLastOpen: bundle.trip.contentVersion,
    createdAt: now, updatedAt: now, revision: 0, partySize: 1,
    selectedUpgradeIds: [], homeCurrency: 'USD', optionSelections: {}, activityCompletion: {},
    savedItems: [], notes: {}, personalFlights: [], personalLodging: [], personalReservations: [],
    packingChecklist: [], budgetPlan: {totalMinor: 0, categoryMinor: {}}, actualExpenses: [],
    preferences: {}, dismissedNotices: []
  };
}

export function migrateTravelerState(raw, schema, legacySchema) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CorruptStateError(raw);
  try {
    if (raw.travelerStateSchemaVersion === STATE_VERSION) return assertSchema(schema, raw);
    if (raw.travelerStateSchemaVersion !== '1.0.0' || !legacySchema) throw new Error('Unsupported state version');
    assertSchema(legacySchema, raw);
    return assertSchema(schema, {
      ...raw, travelerStateSchemaVersion: STATE_VERSION,
      revision: 0, partySize: 1, selectedUpgradeIds: []
    });
  } catch {throw new CorruptStateError(raw);}
}

export function serializeTravelerState(state, schema, now = new Date().toISOString()) {
  const envelope = {format: 'mcs-traveler-state', schemaVersion: STATE_VERSION,
    tripId: state.tripId, contentVersion: state.contentVersionAtLastOpen, exportedAt: now, state};
  assertSchema(schema, envelope);
  return JSON.stringify(envelope, null, 2);
}

export function parseTravelerExport(text, tripId, schema, legacyExportSchema, legacyStateSchema) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > EXPORT_LIMIT_BYTES) {
    throw new Error('Import exceeds the 2 MiB limit.');
  }
  let data;
  try {data = JSON.parse(text);} catch {throw new Error('Import must be a valid JSON file.');}
  if (data?.schemaVersion === '1.0.0') {
    if (!legacyExportSchema) throw new Error('This backup version cannot be imported here.');
    assertSchema(legacyExportSchema, data);
  } else assertSchema(schema, data);
  if (data.tripId !== tripId || data.state.tripId !== tripId) throw new Error('This backup belongs to a different trip.');
  if (data.contentVersion !== data.state.contentVersionAtLastOpen) throw new Error('Backup content version mismatch.');
  return migrateTravelerState(data.state, schema.properties.state, legacyStateSchema);
}

export function reconcileContent(state, bundle) {
  const knownActivities = new Set(bundle.activities.map(activity => activity.activityId));
  const knownUpgrades = new Set(bundle.activities.flatMap(activity => activity.optionalUpgradeIds ?? []));
  const changedItems = Object.keys(state.activityCompletion).filter(id => !knownActivities.has(id));
  for (const [groupId, optionIds] of Object.entries(state.optionSelections)) {
    const group = bundle.optionGroups.find(candidate => candidate.optionGroupId === groupId);
    if (!group || optionIds.some(id => !group.optionIds.includes(id))) changedItems.push(groupId);
  }
  for (const id of state.selectedUpgradeIds ?? []) if (!knownUpgrades.has(id)) changedItems.push(id);
  return {state: {...state, contentVersionAtLastOpen: bundle.trip.contentVersion}, changedItems};
}

function storageFailure() {
  return new Error('Local trip change was not saved. Storage may be full or disabled.');
}

export function createTravelerStore(schema, indexedDB = globalThis.indexedDB, legacySchema) {
  let dbPromise;
  function open() {
    if (!indexedDB) return Promise.reject(new Error('Local storage is unavailable. Use a browser with IndexedDB enabled.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      try {request = indexedDB.open('mcs-travel-companion', 1);} catch {dbPromise = undefined; reject(new Error('Could not open local trip storage.')); return;}
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('traveler-state')) {
          request.result.createObjectStore('traveler-state', {keyPath: 'tripId'});
        }
      };
      request.onerror = () => {dbPromise = undefined; if (!settled) {settled = true; reject(new Error('Could not open local trip storage.'));}};
      request.onblocked = () => {dbPromise = undefined; if (!settled) {settled = true; reject(new Error('Close other Companion tabs to update local storage.'));}};
      request.onsuccess = () => {
        const db = request.result;
        if (settled) {db.close(); return;}
        settled = true;
        db.onversionchange = () => {db.close(); dbPromise = undefined;};
        resolve(db);
      };
    });
    return dbPromise;
  }

  async function read(tripId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, value;
      try {
        tx = db.transaction('traveler-state', 'readonly');
        const request = tx.objectStore('traveler-state').get(tripId);
        request.onsuccess = () => {value = request.result;};
      } catch {reject(storageFailure()); return;}
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(storageFailure());
      tx.onerror = () => {};
    });
  }

  async function save(value) {
    assertSchema(schema, value);
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, next, failure;
      try {
        tx = db.transaction('traveler-state', 'readwrite');
        const objectStore = tx.objectStore('traveler-state');
        const request = objectStore.get(value.tripId);
        request.onsuccess = () => {
          try {
            const previous = request.result ? migrateTravelerState(request.result, schema, legacySchema) : null;
            const observedRevision = previous?.revision ?? 0;
            if (value.revision !== observedRevision) throw new ConflictError();
            next = {...value, revision: observedRevision + 1, updatedAt: new Date().toISOString()};
            assertSchema(schema, next);
            objectStore.put(structuredClone(next));
          } catch (error) {
            failure = error instanceof ConflictError || error instanceof CorruptStateError ? error : storageFailure();
            tx.abort();
          }
        };
      } catch {reject(storageFailure()); return;}
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(failure ?? storageFailure());
      tx.onerror = () => {};
    });
  }

  async function remove(tripId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {tx = db.transaction('traveler-state', 'readwrite'); tx.objectStore('traveler-state').delete(tripId);} catch {reject(storageFailure()); return;}
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(storageFailure());
      tx.onerror = () => {};
    });
  }

  return {
    async load(tripId) {const raw = await read(tripId); return raw ? migrateTravelerState(raw, schema, legacySchema) : null;},
    loadRaw: read, save, remove,
    async close() {if (dbPromise) {try {(await dbPromise).close();} catch {} dbPromise = undefined;}
    }
  };
}
