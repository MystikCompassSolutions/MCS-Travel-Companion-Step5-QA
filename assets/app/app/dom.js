export function el(tag,attrs={},...children) {
 const node=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs)) {
  if(key.startsWith('on')&&typeof value==='function')node.addEventListener(key.slice(2).toLowerCase(),value);
  else if(key==='class')node.className=value;
  else if(key==='checked')node.checked=value;
  else if(key==='value')node.value=value;
  else if(value!==undefined&&value!==false)node.setAttribute(key,value===true?'':String(value));
 }
 for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));
 return node;
}
export const button=(label,action,attrs={})=>el('button',{type:'button',onClick:action,...attrs},label);
export const card=(...children)=>el('section',{class:'card'},...children);
export function field(label,input) {return el('label',{},label,input);}
