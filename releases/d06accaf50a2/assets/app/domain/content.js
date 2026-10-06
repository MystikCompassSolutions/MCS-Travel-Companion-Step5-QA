import {assertSchema} from './schema.js';
const entityKeys={regions:'regionId',places:'placeId',days:'dayId',activities:'activityId',options:'optionId',optionGroups:'optionGroupId',transport:'transportId',lodgingGuidance:'lodgingGuideId',costs:'costId',travelInfo:'articleId',emergencyResources:'emergencyResourceId',sources:'sourceId',verification:'verificationId',badges:'badgeId',media:'mediaId',themes:'themeId'};
const refFields={regionId:'regions',primaryRegionId:'regions',regionIds:'regions',secondaryRegionIds:'regions',placeId:'places',fromPlaceId:'places',toPlaceId:'places',nearbyFoodPlaceIds:'places',dayIds:'days',activityId:'activities',activityIds:'activities',transportIds:'transport',optionIds:'options',optionGroupIds:'optionGroups',defaultOptionId:'options',baseOptionId:'options',costIds:'costs',fareCostIds:'costs',optionalUpgradeIds:'costs',travelInfoArticleIds:'travelInfo',emergencyResourceIds:'emergencyResources',sourceIds:'sources',verificationRecordIds:'verification',badgeIds:'badges',defaultThemeId:'themes',heroMediaId:'media'};
export function validateBundle(bundle,schema,{publish=false,now=new Date()}={}) {
 assertSchema(schema,bundle);const errors=[];const maps={};const all=new Set([bundle.trip.tripId]);
 for(const [key,idKey] of Object.entries(entityKeys)) { maps[key]=new Map();for(const entity of bundle[key]) {const id=entity[idKey];if(all.has(id))errors.push(`Duplicate ID ${id}`);all.add(id);maps[key].set(id,entity);} }
 const checkRef=(kind,id)=>{if(!maps[kind].has(id))errors.push(`Missing ${kind} reference ${id}`);};
 function walk(value) {if(Array.isArray(value))return value.forEach(walk);if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)) {if(refFields[key]) for(const id of Array.isArray(v)?v:[v])checkRef(refFields[key],id);else if(key==='tripId'&&v!==bundle.trip.tripId)errors.push('Trip ID mismatch');walk(v);} }
 walk(bundle);
 if(bundle.manifest.contentVersion!==bundle.trip.contentVersion)errors.push('Manifest content version mismatch');
 if(bundle.days.length!==bundle.trip.durationDays||bundle.trip.dayIds.length!==bundle.days.length)errors.push('Trip duration/day IDs mismatch');
 if(new Set(bundle.trip.dayIds).size!==bundle.days.length)errors.push('Duplicate trip day references');
 const scheduleIds=new Set();const groupPlacements=new Map();
 for(const [i,day] of [...bundle.days].sort((a,b)=>a.dayNumber-b.dayNumber).entries()) {
  if(day.dayNumber!==i+1)errors.push('Day numbers must be contiguous');
  let previous=-1;
  for(const item of day.scheduleItems) {
   if(scheduleIds.has(item.scheduleItemId))errors.push('Duplicate schedule item ID');scheduleIds.add(item.scheduleItemId);
   if(item.dayId!==day.dayId||item.sequence<=previous)errors.push('Invalid day schedule ordering');previous=item.sequence;
   if(item.itemType==='option_group')groupPlacements.set(item.referencedEntityId,[...(groupPlacements.get(item.referencedEntityId)??[]),day.dayId]);
   const kind={activity:'activities',transport:'transport',lodging:'lodgingGuidance',option_group:'optionGroups',meal:'activities'}[item.itemType];
   if(kind&&(item.itemType!=='meal'||item.referencedEntityId)) {if(!item.referencedEntityId)errors.push('Missing schedule entity');else checkRef(kind,item.referencedEntityId);}
  }
  const placed=day.scheduleItems.filter(item=>item.itemType==='option_group').map(item=>item.referencedEntityId);
  if(new Set(placed).size!==placed.length||JSON.stringify([...placed].sort())!==JSON.stringify([...(day.optionGroupIds??[])].sort()))errors.push('Day option group list must match its schedule');
 }
 const optionOwners=new Map();
 for(const group of bundle.optionGroups) {
  if(new Set(group.optionIds).size!==group.optionIds.length||!group.optionIds.length)errors.push('Invalid option group members');
  if(group.defaultOptionId&&!group.optionIds.includes(group.defaultOptionId))errors.push('Default option outside group');
  if(group.baseOptionId&&!group.optionIds.includes(group.baseOptionId))errors.push('Base option outside group');
  if(group.baseOptionId===group.defaultOptionId&&group.baseOptionId)errors.push('Base option cannot also be a selectable default');
  if(group.requiredSelection&&!group.defaultOptionId)errors.push('Required group needs a default');
  const placements=groupPlacements.get(group.optionGroupId)??[];
  if(placements.length!==1)errors.push('Option group must be placed on exactly one day');
  for(const id of group.optionIds) {
   if(optionOwners.has(id))errors.push('Option belongs to multiple groups');optionOwners.set(id,group.optionGroupId);
   const option=maps.options.get(id);if(!option)continue;
   if(option.scheduleItems?.length) {
    let previous=-1;
    for(const item of option.scheduleItems) {
     if(scheduleIds.has(item.scheduleItemId))errors.push('Duplicate schedule item ID');scheduleIds.add(item.scheduleItemId);
     if(item.dayId!==placements[0]||item.sequence<=previous||item.itemType==='option_group')errors.push('Invalid option schedule or cross-day item');previous=item.sequence;
     const kind={activity:'activities',transport:'transport',lodging:'lodgingGuidance',meal:'activities'}[item.itemType];
     if(kind&&(item.itemType!=='meal'||item.referencedEntityId)) {if(!item.referencedEntityId)errors.push('Missing option schedule entity');else checkRef(kind,item.referencedEntityId);}
    }
   }
   const entryIds=option.scheduleItems?.length?option.scheduleItems.flatMap(item=>{
    const entity=(item.itemType==='transport'?maps.transport:item.itemType==='lodging'?maps.lodgingGuidance:maps.activities).get(item.referencedEntityId);
    return entity?.costIds??entity?.fareCostIds??[];
   }):[...option.activityIds.flatMap(activityId=>maps.activities.get(activityId)?.costIds??[]),...option.transportIds.flatMap(transportId=>maps.transport.get(transportId)?.fareCostIds??[])];
   if(option.costIds.some(costId=>entryIds.includes(costId)))errors.push('Option supplemental cost duplicates an entity cost');
  }
 }
 for(const cost of bundle.costs) {
  if(cost.pricingModel==='fixed'&&cost.fixedMinor===undefined)errors.push('Fixed cost requires amount');
  if(['range','from'].includes(cost.pricingModel)&&cost.minimumMinor===undefined)errors.push('Cost requires minimum');
  if(cost.pricingModel==='range'&&(cost.maximumMinor===undefined||cost.minimumMinor>cost.maximumMinor))errors.push('Invalid cost range');
  try {new Intl.NumberFormat('en-US',{style:'currency',currency:cost.currency}).format(0);}catch{errors.push('Invalid cost currency');}
 }
 for(const activity of bundle.activities)for(const id of activity.optionalUpgradeIds??[]) {
  const cost=maps.costs.get(id);
  if(cost&&(cost.category!=='upgrade'||cost.mandatory||activity.costIds.includes(id)))errors.push('Optional upgrade must be a separate nonmandatory upgrade cost');
 }
 for(const p of bundle.places) if((p.latitude===undefined)!==(p.longitude===undefined))errors.push('Incomplete coordinates');
 for(const a of bundle.activities) if(a.reservationInfo?.reservationLevel==='required'&&!a.reservationInfo.bookAheadGuidance)errors.push('Required reservation lacks guidance');
 for(const v of bundle.verification) if(!all.has(v.targetId))errors.push('Verification target missing');
 for(const m of bundle.media) if(!m.decorative&&!m.altText.trim())errors.push('Meaningful media needs alt text');
 if(publish) {
  if(bundle.manifest.classification!=='protected'||bundle.trip.status!=='published')errors.push('Samples/draft content cannot publish');
  const currentEvidence=(entity,fieldPath,extraIds=[])=>[...(entity.verificationRecordIds??[]),...extraIds].some(id=>{
   const targetId=entity.emergencyResourceId??entity.articleId??entity.costId??entity.activityId??entity.placeId;
   const v=maps.verification.get(id);const sources=(v?.sourceIds??[]).map(s=>maps.sources.get(s));const today=now.toISOString().slice(0,10);
   return v?.targetId===targetId&&v.fieldPath===fieldPath&&v.status==='verified'&&v.verifiedAt&&v.verifiedAt<=today&&v.nextReviewDue&&v.nextReviewDue>=today&&sources.some(s=>s?.active&&['government','official','operator'].includes(s.sourceType));
  });
  for(const e of bundle.emergencyResources)for(const field of ['organizationName','instructions','phone','alternatePhone','address','hours','officialWebsite'])
   if(e[field]&&!currentEvidence(e,field))errors.push(`Emergency ${e.emergencyResourceId}.${field} needs current authoritative verification`);
  for(const article of bundle.travelInfo.filter(item=>item.riskLevel==='high'))
   if(!currentEvidence(article,'contentBlocks'))errors.push(`High-risk article ${article.articleId}.contentBlocks needs current authoritative verification`);
  for(const p of bundle.places) {
   if(p.status!=='active'||!p.address||p.latitude===undefined)errors.push('Published mapped place unavailable/incomplete');
   for(const field of ['address','latitude','longitude'])if(p[field]!==undefined&&!currentEvidence(p,field))errors.push(`Place ${p.placeId}.${field} needs current authoritative verification`);
  }
  for(const a of bundle.activities) {
   if(a.status!=='verified'&&a.status!=='published')errors.push('Unverified activity cannot publish');
   if(a.reservationInfo?.reservationLevel&&a.reservationInfo.reservationLevel!=='none')for(const field of ['bookAheadGuidance','officialBookingUrl'])
    if(a.reservationInfo[field]&&!currentEvidence(a,`reservationInfo.${field}`,a.reservationInfo.verificationRecordIds))errors.push(`Activity ${a.activityId}.reservationInfo.${field} needs current authoritative verification`);
  }
  for(const c of bundle.costs)if(c.pricingModel!=='free'&&c.pricingModel!=='variable')for(const field of ['fixedMinor','minimumMinor','maximumMinor'])
   if(c[field]!==undefined&&!currentEvidence(c,field))errors.push(`Price ${c.costId}.${field} needs current authoritative verification`);
  for(const m of bundle.media) if(/(^|[- ])NC($|[- ])|(^|[- ])ND($|[- ])/i.test(m.license)||!m.allowedUses.includes('commercial')||/^https?:/.test(m.webAssetReference))errors.push('Media licensing/reference not release-ready');
 }
 if(errors.length)throw new Error(errors.join('\n'));return bundle;
}
export async function loadSamplePack(name,schema,fetcher=fetch) {
 if(!['japan','iceland'].includes(name))throw new Error('Unknown sample pack');
 const root=typeof document==='undefined'?new URL('../../',import.meta.url):document.baseURI;
 const sampleRoot=typeof document==='undefined'?'content/samples/':
  document.querySelector('meta[name="mcs-sample-root"]')?.content??'content/samples/';
 const r=await fetcher(new URL(`${sampleRoot}${name}.json`,root));if(!r.ok)throw new Error('Content unavailable');
 const bundle=validateBundle(await r.json(),schema);
 if(bundle.manifest.classification!=='sample')throw new Error('Static loader accepts samples only');return bundle;
}
// Step 6 implements this interface server-side. No entitlement or premium data
// is fabricated by the static sample shell.
export async function loadProtectedPack() {throw new Error('Authorized content delivery is not implemented until Step 6.');}
