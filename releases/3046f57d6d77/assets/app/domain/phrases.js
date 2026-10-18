import {assertSchema} from './schema.js';

// A phrasebook is authored once alongside the trip, not in an interface or translation service.
export function validatePhrasebook(book, schema, bundle) {
  assertSchema(schema, book);
  if (book.tripId !== bundle.trip.tripId || book.contentVersion !== bundle.manifest.contentVersion ||
      book.classification !== bundle.manifest.classification) throw new Error('Phrasebook identity does not match this content edition');
  const ids = new Set(), targets = new Set();
  const unique = id => {if (ids.has(id)) throw new Error('Duplicate phrasebook ID'); ids.add(id);};
  for (const group of book.groups) {
    unique(group.groupId);
    for (const phrase of group.phrases) {
      unique(phrase.phraseId); targets.add(phrase.phraseId);
      if (!phrase.variants.length) throw new Error('Phrase needs local-language text');
      for (const variant of phrase.variants) {
        try {new Intl.Locale(variant.language);} catch {throw new Error('Invalid phrase language identifier');}
        if (!variant.text.trim()) throw new Error('Empty local phrase');
      }
    }
  }
  for (const item of [...book.sources, ...book.verification]) unique(item.sourceId ?? item.verificationId);
  const sources = new Set(book.sources.map(s => s.sourceId)), records = new Map(book.verification.map(v => [v.verificationId,v]));
  for (const record of book.verification) {
    if (!targets.has(record.targetId) || record.sourceIds.some(id => !sources.has(id))) throw new Error('Broken phrase verification reference');
  }
  for (const phrase of book.groups.flatMap(g => g.phrases)) {
    if ((phrase.sourceIds ?? []).some(id => !sources.has(id)) ||
      (phrase.verificationRecordIds ?? []).some(id => records.get(id)?.targetId !== phrase.phraseId)) throw new Error('Broken phrase evidence reference');
  }
  return book;
}

export async function loadSamplePhrasebook(name, bundle, schema, fetcher = fetch) {
  if (!['japan','iceland'].includes(name) || bundle.manifest.classification !== 'sample') throw new Error('Only validated samples use the static phrase loader');
  const base = typeof document === 'undefined' ? new URL('../../',import.meta.url) : document.baseURI;
  const root = typeof document === 'undefined' ? 'content/samples/' :
    document.querySelector('meta[name="mcs-sample-root"]')?.content ?? 'content/samples/';
  const response = await fetcher(new URL(`${root}${name}.phrases.json`,base));
  if (response.status === 404) return null; // Older editions need no migration.
  if (!response.ok) throw new Error('Phrase content unavailable');
  return validatePhrasebook(await response.json(),schema,bundle);
}
