// Deliberately bounded JSON Schema subset used by checked-in schemas.
// Unsupported keywords fail closed. Replace with an audited full validator if
// external schemas are introduced; this is not a general-purpose implementation.
const supported = new Set(['$schema','$id','$defs','$ref','type','properties','required','additionalProperties','items','enum','const','pattern','format','minimum','maximum','minLength','maxLength','maxItems','maxProperties','propertyNames']);
function formatValid(format,value) {
  if(format==='date') return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  if(format==='date-time') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
  if(format==='uri') {try { return ['https:','http:'].includes(new URL(value).protocol); } catch {return false;}}
  if(format==='iana-timezone') {try {new Intl.DateTimeFormat('en-US',{timeZone:value}).format();return true;} catch {return false;}}
  throw new Error(`Unsupported schema format ${format}`);
}
export function validateSchema(schema,value) {
  const errors=[];
  function visit(s,v,path) {
    for(const k of Object.keys(s)) if(!supported.has(k)) throw new Error(`Unsupported schema keyword ${k}`);
    if(s.$ref) {const name=s.$ref.replace('#/$defs/','');if(!schema.$defs?.[name]) throw new Error('Unknown schema reference');return visit(schema.$defs[name],v,path);}
    if('const' in s && v!==s.const) errors.push(`${path}: unexpected value`);
    if(s.enum && !s.enum.includes(v)) errors.push(`${path}: unsupported value`);
    if(s.type) {
      const valid=s.type==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):s.type==='array'?Array.isArray(v):s.type==='integer'?Number.isSafeInteger(v):s.type==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===s.type;
      if(!valid) {errors.push(`${path}: expected ${s.type}`);return;}
    }
    if(typeof v==='string') {
      if(s.minLength!==undefined&&v.length<s.minLength||s.maxLength!==undefined&&v.length>s.maxLength) errors.push(`${path}: invalid length`);
      if(s.pattern&&!new RegExp(s.pattern).test(v)) errors.push(`${path}: invalid pattern`);
      if(s.format&&!formatValid(s.format,v)) errors.push(`${path}: invalid ${s.format}`);
    }
    if(typeof v==='number'&&(s.minimum!==undefined&&v<s.minimum||s.maximum!==undefined&&v>s.maximum)) errors.push(`${path}: outside range`);
    if(Array.isArray(v)) {if(v.length>(s.maxItems??Infinity)) errors.push(`${path}: too many items`); v.forEach((item,i)=>visit(s.items??{},item,`${path}[${i}]`));}
    else if(v&&typeof v==='object') {
      if(Object.keys(v).length>(s.maxProperties??Infinity)) errors.push(`${path}: too many entries`);
      for(const k of s.required??[]) if(!Object.hasOwn(v,k)) errors.push(`${path}.${k}: required`);
      for(const [k,item] of Object.entries(v)) {
        if(['__proto__','prototype','constructor'].includes(k)) {errors.push(`${path}: unsafe key`);continue;}
        if(s.propertyNames) visit(s.propertyNames,k,`${path} key`);
        if(s.properties?.[k]) visit(s.properties[k],item,`${path}.${k}`);
        else if(s.additionalProperties===false) errors.push(`${path}.${k}: unknown field`);
        else if(typeof s.additionalProperties==='object') visit(s.additionalProperties,item,`${path}.${k}`);
      }
    }
  }
  visit(schema,value,'$');return errors;
}
export function assertSchema(schema,value) {
  const errors=validateSchema(schema,value);if(errors.length) throw new Error(errors.slice(0,8).join('\n'));return value;
}
