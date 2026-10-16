export const travelTopics = Object.freeze([
  {id:'entry',title:'Entry & Documents',icon:'documents',hint:'Prepare for your journey',match:/entry|document|requirement|health|practical|before.you.travel/},
  {id:'money',title:'Money & Currency',icon:'Budget',hint:'Payments & everyday spending',match:/money|payment|currency/},
  {id:'transport',title:'Getting Around',icon:'transit',hint:'Navigate with confidence',match:/transit|transport|getting.around/},
  {id:'connectivity',title:'Connectivity',icon:'connectivity',hint:'Stay connected',match:/connectivity|internet|esim/},
  {id:'culture',title:'Culture & Etiquette',icon:'culture',hint:'Local customs & consideration',match:/culture|etiquette/},
  {id:'phrases',title:'Useful Phrases',icon:'Info',hint:'Words to carry with you',match:/phrase|language/}
]);
export function articleTopic(article) {
  // Existing free-text categories remain valid; every article has one primary location.
  const category = article.category.toLowerCase();
  return (travelTopics.find(t => t.match.test(category)) ??
    travelTopics.find(t => t.match.test(article.title.toLowerCase())) ?? travelTopics[0]).id;
}
export function countryName(code) {
  try {return new Intl.DisplayNames(['en-US'],{type:'region'}).of(code);} catch {return code;}
}
export function languageName(code) {
  try {return new Intl.DisplayNames(['en-US'],{type:'language'}).of(code);} catch {return code;}
}
export function destinationLabel(bundle) {
  const names = [...new Set(bundle.trip.regionIds.map(id => bundle.regions.find(r => r.regionId === id)?.name).filter(Boolean))];
  const country = countryName(bundle.trip.primaryCountryCode);
  return [country,...(names.length ? [names.filter(n => n !== country).join(' + ')] : [])].filter(Boolean).join(' · ');
}
export function evidenceRecords(entity, data) {
  return data.verification.filter(v => entity.verificationRecordIds?.includes(v.verificationId) &&
    v.targetId === (entity.emergencyResourceId ?? entity.articleId ?? entity.phraseId));
}
export function officialSources(entity, data) {
  const ids = new Set([...(entity.sourceIds ?? []),...evidenceRecords(entity,data).flatMap(v => v.sourceIds)]);
  return data.sources.filter(s => ids.has(s.sourceId) && s.active && ['official','government','operator','tourism_board'].includes(s.sourceType));
}
export function verifiedField(entity, field, data, today = new Date().toISOString().slice(0,10)) {
  return evidenceRecords(entity,data).some(v => v.fieldPath === field && v.status === 'verified' &&
    v.verifiedAt && v.verifiedAt <= today && v.nextReviewDue && v.nextReviewDue >= today &&
    v.sourceIds.some(id => data.sources.some(s => s.sourceId === id && s.active && ['government','official','operator'].includes(s.sourceType))));
}
