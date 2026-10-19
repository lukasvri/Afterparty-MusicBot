/** These prefixes require explicit URL Mappings on the separate test app.
 * This adapter only routes the official API/player, never video streams. */
export const youtubeMappings = [{prefix:'/youtube',target:'www.youtube.com'}];
type Remap = (url:URL) => URL;
export function youtubeActivityUrl(input:string, origin:string) {
  const url=new URL(input);
  if (url.origin !== 'https://www.youtube.com' || url.username || url.password ||
      !(url.pathname === '/iframe_api' || /^\/s\/player\/[\w-]+\/www-widgetapi(?:\.vflset)?\/www-widgetapi\.js$/.test(url.pathname) ||
        /^\/embed\/[\w-]{11}$/.test(url.pathname))) throw Error('Unsupported YouTube mapping.');
  return new URL('/youtube'+url.pathname+url.search,origin).href;
}

/** The SDK's src rewriting pattern, scoped to head scripts with an explicit
 * disconnect. No fetch/XHR/WebSocket patch or access to nested player content.
 * The app-owned first script is already mapped before insertion. */
export function installActivityYoutubeScripts(remap:Remap) {
  const owned=new Set<HTMLScriptElement>();
  const rewrite=(node:Node) => {
    if (!(node instanceof HTMLScriptElement)) return;
    const raw=node.getAttribute('src');if(!raw)return;
    let source:URL;
    try {source=new URL(raw,location.href);youtubeActivityUrl(source.href,location.origin);} catch {return;}
    const mapped=remap(source);
    // Refuse an unexpected SDK target rather than broadening script access.
    if(mapped.href !== youtubeActivityUrl(source.href,location.origin))return;
    const replacement=document.createElement('script');
    for(const attribute of node.attributes)replacement.setAttribute(attribute.name,attribute.value);
    replacement.src=mapped.href;owned.add(replacement);node.replaceWith(replacement);
  };
  const observer=new MutationObserver(records=>{
    for(const record of records){
      if(record.type==='attributes')rewrite(record.target);
      else for(const node of record.addedNodes){rewrite(node);if(node instanceof Element)node.querySelectorAll('script[src]').forEach(rewrite);}
    }
  });
  observer.observe(document.head,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  return ()=>{observer.disconnect();for(const script of owned)script.remove();owned.clear();};
}

/** Pre-created frames are supported by the official IFrame API. Keeping the
 * actual parent origin avoids inventing an origin or rewriting postMessage. */
export function activityYoutubeFrame(id:string,origin:string) {
  if(!/^[\w-]{11}$/.test(id))throw Error('Invalid video ID.');
  const url=new URL('https://www.youtube.com/embed/'+id);
  url.search=new URLSearchParams({enablejsapi:'1',origin,playsinline:'1',controls:'1',rel:'0',fs:'1',autoplay:'0'}).toString();
  return youtubeActivityUrl(url.href,origin);
}
