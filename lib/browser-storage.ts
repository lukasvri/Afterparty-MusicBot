/** Migrate saved browser state lazily without losing room ownership or preferences. */
export function readBrowserValue(storage: Pick<Storage,'getItem'|'setItem'>, key:string):string|null {
  const current=storage.getItem(key);
  if(current!==null)return current;
  // This is an input format only. New state always uses the Afterparty namespace.
  const previous=key.startsWith('afterparty-')?storage.getItem(key.replace(/^afterparty-/,'muse-')):null;
  if(previous!==null){try{storage.setItem(key,previous);}catch{/* Return the saved value even when storage is read-only. */}}
  return previous;
}
export const browserStorage={
  get(key:string){try{return readBrowserValue(localStorage,key);}catch{return null;}},
  set(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Keep browser-local controls usable when persistence is blocked. */}},
};
