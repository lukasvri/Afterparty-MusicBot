'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {enterFullscreen,fullscreenElement,leaveFullscreen} from '@/lib/fullscreen';

export function useFullscreen({viewportOnly = false}: {viewportOnly?: boolean} = {}){
  const element = useRef<HTMLElement>(null);
  const busy = useRef(false);
  const [native,setNative] = useState(false);
  const [fallback,setFallback] = useState(false);
  const focusControl = useCallback(()=>element.current?.querySelector<HTMLElement>('[data-fullscreen-button]')?.focus({preventScroll:true}),[]);
  const toggle = useCallback(async()=>{
    const root=element.current;
    if(!root||busy.current)return;
    busy.current=true;
    try{
      if(fallback){setFallback(false);focusControl();}
      else if(fullscreenElement(root.ownerDocument)===root){await leaveFullscreen(root);setNative(false);focusControl();}
      else if(await enterFullscreen(root,viewportOnly)){setNative(true);}
      else setFallback(true);
    }finally{busy.current=false;}
  },[fallback,focusControl,viewportOnly]);
  useEffect(()=>{
    const change=()=>{const active=fullscreenElement(document)===element.current;setNative(active);if(!active)focusControl();};
    const escape=(event:KeyboardEvent)=>{const root=element.current;if(event.key==='Escape'&&root&&fullscreenElement(document)===root){event.preventDefault();void leaveFullscreen(root).catch(()=>{});}};
    document.addEventListener('keydown',escape);
    document.addEventListener('fullscreenchange',change);
    document.addEventListener('webkitfullscreenchange',change);
    return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('fullscreenchange',change);document.removeEventListener('webkitfullscreenchange',change);};
  },[focusControl]);
  useEffect(()=>{
    if(!fallback)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    element.current?.querySelector<HTMLElement>('[data-fullscreen-close]')?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setFallback(false);focusControl();}
      if(event.key==='Tab'){
        const controls=Array.from(element.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],iframe')??[]).filter(e=>e.getClientRects().length>0&&!e.closest('[inert]'));
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key);};
  },[fallback,focusControl,viewportOnly]);
  useEffect(()=>()=>{const root=element.current;if(root&&fullscreenElement(document)===root)void leaveFullscreen(root).catch(()=>{});},[]);
  return {element,active:native||fallback,native,fallback,toggle};
}
