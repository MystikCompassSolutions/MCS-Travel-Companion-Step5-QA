import {el,button} from './dom.js';
import {icon,mediaCredits} from './visual.js';
import {travelTopics,articleTopic,destinationLabel,countryName,languageName,evidenceRecords,officialSources,verifiedField} from '../domain/travel-info.js';

const external = (label,url) => el('a',{class:'info-source',href:url,target:'_blank',rel:'noopener noreferrer'},label);
function evidence(entity,data) {
  const records=evidenceRecords(entity,data);
  return el('div',{class:'info-evidence'},
    entity.regionId&&data.regions?.some(r=>r.regionId===entity.regionId) ? el('p',{},'Applies to '+data.regions.find(r=>r.regionId===entity.regionId).name) : null,
    el('p',{},entity.audienceCountry ? `For travelers from ${countryName(entity.audienceCountry)}` : null),
    el('p',{},records.length ? records.map(v => `${v.status.replaceAll('_',' ')}${v.verifiedAt ? ' · Checked '+v.verifiedAt : ''}${v.nextReviewDue ? ' · Review due '+v.nextReviewDue : ''}${v.scope ? ' · '+v.scope : ''}`).join('; ') : 'Research and verification pending.'),
    entity.lastReviewedAt ? el('p',{},`Last reviewed ${entity.lastReviewedAt}`) : null,
    data.sources.filter(s=>s.active&&new Set([...(entity.sourceIds??[]),...records.flatMap(v=>v.sourceIds)]).has(s.sourceId))
      .map(s=>external(`${officialSources(entity,data).some(o=>o.sourceId===s.sourceId)?'Official source':'Source'} · ${s.title}`,s.url)));
}
function articleView(article,bundle) {
  return el('article',{class:'info-article',id:article.articleId,'data-section':article.articleId},
    el('h2',{},article.title),
    article.summary ? el('p',{},article.summary) : null,
    article.riskLevel==='high' ? el('p',{class:'info-warning'},
      verifiedField(article,'contentBlocks',bundle) ? 'High-risk guidance · Confirm current official requirements for your circumstances.' :
      'Unverified high-risk information · Do not rely on this sample for entry, health or travel requirements.') : null,
    ...article.contentBlocks.map(block=>el('div',{class:block.type==='warning'?'info-warning':'info-block'},
      block.text ? el('p',{},block.text) : null,
      block.items?.length ? el('ul',{},block.items.map(item=>el('li',{},item))) : null,
      (block.links??[]).map(link=>external(link.label,link.url)))),
    evidence(article,bundle));
}
function emergencyView(bundle) {
  return [
    el('p',{class:'info-warning'},bundle.manifest.classification==='sample' ?
      'Verified emergency information is unavailable in this sample. Do not rely on it during travel.' :
      'Use only contacts with current field-level verification. Unverified contact details are withheld.'),
    ...[...bundle.emergencyResources].sort((a,b)=>(a.priority??99)-(b.priority??99)).map(resource=>{
      const verified=field=>verifiedField(resource,field,bundle);
      const contacts=['phone','alternatePhone'].filter(field=>resource[field]&&verified(field)&&/^\+?[0-9 ()-]{3,30}$/.test(resource[field]));
      return el('article',{class:'info-article'},
        el('h2',{},verified('organizationName')?resource.organizationName:'Emergency reference · Verification pending'),
        resource.instructions ? el('p',{},resource.instructions) : null,
        contacts.length ? contacts.map(field=>el('a',{class:'info-contact',href:'tel:'+resource[field].replace(/[ ()-]/g,'')},resource[field])) :
          el('strong',{},'No verified emergency number is supplied.'),
        ['address','hours'].filter(field=>resource[field]&&verified(field)).map(field=>el('p',{},resource[field])),
        resource.officialWebsite&&verified('officialWebsite') ? external('Official emergency resource',resource.officialWebsite) : null,
        evidence(resource,bundle));
    })
  ];
}
function phraseView(book) {
  if(!book?.groups.some(g=>g.phrases.length)) return [el('p',{class:'info-empty'},'Useful phrases have not been authored for this edition. No translation is supplied.')];
  return [el('p',{class:'info-phrase-notice'},book.notice),
    ...book.groups.filter(g=>g.phrases.length).map(group=>el('section',{class:'info-phrase-group'},
      el('h2',{},group.title),group.phrases.map(phrase=>el('article',{class:'info-phrase'},
        el('h3',{},phrase.meaning),phrase.context?el('p',{class:'info-context'},phrase.context):null,
        phrase.variants.map(variant=>{
          const feedback=el('p',{class:'info-copy-status',role:'status','aria-live':'polite'});
          const controls=el('div',{class:'info-copy-controls'},button('Copy phrase',async()=>{
            try {await navigator.clipboard.writeText(variant.text);feedback.textContent='Phrase copied.';}
            catch {feedback.replaceChildren('Could not copy. Select and copy the text below.',
              el('textarea',{'aria-label':'Phrase to copy manually',readonly:true,lang:variant.language,dir:variant.direction??'auto',value:variant.text}));}
          },{'aria-label':`Copy phrase: ${phrase.meaning} (${languageName(variant.language)})`}),el('span',{class:'info-language'},languageName(variant.language)));
          return el('div',{class:'info-variant'},el('p',{class:'info-local',lang:variant.language,dir:variant.direction??'auto'},variant.text),
            variant.transliteration ? el('p',{class:'info-transliteration'},el('span',{},'Transliteration · '),variant.transliteration) : null,
            variant.pronunciation ? el('p',{class:'info-pronunciation'},'Pronunciation · ',variant.pronunciation) : null,controls,feedback);
        }),
        phrase.sourceIds?.length||phrase.verificationRecordIds?.length ? evidence(phrase,book) : null
      ))))];
}
// Navigation state is owned by the caller; the component owns no persisted traveler data.
export function travelInfoView({bundle,phrasebook,phraseError,topic,onOpen,onBack,backLabel='Back to Travel Info'}) {
  const active=travelTopics.find(t=>t.id===topic), title=topic==='emergency'?'Emergency Help':active?.title;
  const intro=el('div',{class:'info-intro'},el('p',{class:'info-eyebrow'},'Your destination essentials'),
    el('h1',{},title??'Travel Info'),el('p',{class:'info-destination'},destinationLabel(bundle)));
  if(topic) {
    const articles=bundle.travelInfo.filter(a=>articleTopic(a)===topic);
    return [el('div',{class:'travel-info'},button(backLabel,onBack,{class:'info-back'}),intro,
      topic==='emergency' ? emergencyView(bundle) : [
        topic==='entry' ? el('section',{class:'info-applicability'},el('h2',{},'Traveler applicability'),el('p',{},bundle.trip.internationalBuyerNotice)) : null,
        topic==='phrases' ? [phraseError?el('p',{class:'info-warning'},'Phrase content could not be validated or loaded. No phrases are shown.'):null,phraseView(phrasebook)] : null,
        articles.length?articles.map(a=>articleView(a,bundle)):
          topic==='phrases'?null:el('p',{class:'info-empty'},'Guidance is awaiting research and verification. No operational advice is supplied in this sample.')
      ])];
  }
  const credits=el('details',{class:'info-credits','data-section':'media-credits'},
    el('summary',{},icon('camera'),'Photography & Visual Credits'),el('div',{},mediaCredits(bundle)));
  return [el('div',{class:'travel-info'},intro,
    button([icon('help'),el('span',{},el('strong',{},'Emergency Help'),el('small',{},
      bundle.manifest.classification==='sample'?'Verified contacts unavailable in this sample':'View emergency references and verification status')),icon('arrow')],
      ()=>onOpen('emergency'),{class:'info-emergency'}),
    el('section',{'aria-labelledby':'info-guide-heading'},el('h2',{id:'info-guide-heading',class:'info-guide-heading'},'Your destination guide'),
      el('div',{class:'info-topic-grid'},travelTopics.map(t=>button([icon(t.icon),el('span',{class:'info-topic-title'},t.title),
        el('span',{class:'info-topic-hint'},t.hint)],()=>onOpen(t.id),{class:'info-topic','data-topic':t.id})))),
    credits)];
}
