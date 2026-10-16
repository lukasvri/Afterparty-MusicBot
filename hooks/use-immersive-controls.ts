'use client';
import {useCallback,useEffect,useRef,useState,type RefObject,type PointerEvent} from 'react';
const IDLE_MS=2600;
export function useImmersiveControls(active:boolean,keepVisible:boolean,root:RefObject<HTMLElement|null>){
  const [visible,setVisible]=useState(true);
  const [context,setContext]=useState({active,keepVisible});
  if(context.active!==active||context.keepVisible!==keepVisible){setContext({active,keepVisible});setVisible(true);}
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const held=useRef(false),keyboard=useRef(false);
  const clear=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;},[]);
  const arm=useCallback(()=>{
    clear();
    if(!active||keepVisible)return;
    timer.current=setTimeout(()=>{
      const element=root.current;
      if(held.current)return;
      if(keyboard.current&&element?.contains(document.activeElement))return;
      if(matchMedia('(hover: hover)').matches&&element?.querySelector('[data-player-chrome]:hover'))return;
      if(element?.contains(document.activeElement)&&document.activeElement instanceof HTMLElement&&document.activeElement.closest('[data-player-chrome]'))element.focus({preventScroll:true});
      setVisible(false);
    },IDLE_MS);
  },[active,keepVisible,root,clear]);
  const show=useCallback(()=>{setVisible(true);arm();},[arm]);
  const pointerMove=useCallback(()=>{keyboard.current=false;if(active&&root.current?.contains(document.activeElement)&&document.activeElement?.tagName==='IFRAME')root.current.focus({preventScroll:true});show();},[active,root,show]);
  const pointerDown=useCallback((event:PointerEvent<HTMLElement>)=>{
    keyboard.current=false;
    held.current=event.target instanceof Element&&Boolean(event.target.closest('[data-player-chrome]'));
    show();
  },[show]);
  const release=useCallback(()=>{held.current=false;arm();},[arm]);
  useEffect(()=>{held.current=false;keyboard.current=false;arm();return clear;},[active,keepVisible,arm,clear]);
  useEffect(()=>{
    if(!active)return;
    const key=()=>{keyboard.current=true;show();};
    const blur=()=>{held.current=false;keyboard.current=false;arm();};
    document.addEventListener('keydown',key,true);
    document.addEventListener('pointerup',release,true);
    document.addEventListener('pointercancel',release,true);
    window.addEventListener('blur',blur);
    return()=>{document.removeEventListener('keydown',key,true);document.removeEventListener('pointerup',release,true);document.removeEventListener('pointercancel',release,true);window.removeEventListener('blur',blur);};
  },[active,show,release,arm]);
  return {visible:visible||!active||keepVisible,show,onPointerMove:pointerMove,onPointerDown:pointerDown,onPointerUp:release,onPointerCancel:release,onBlurCapture:release,onPointerLeave:arm};
}
