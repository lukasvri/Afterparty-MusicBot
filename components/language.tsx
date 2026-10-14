'use client';
import {createContext,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {translate,type Language} from '@/lib/messages';
const LanguageContext=createContext({language:'nb' as Language,setLanguage:(_language:Language)=>{},t:(text:string,values?:Record<string,string|number>)=>translate('nb',text,values)});
export function LanguageProvider({children}:{children:ReactNode}){
 const [language,setLanguageState]=useState<Language>('nb');
 useEffect(()=>{try{if(localStorage.getItem('gutta-language')==='en')setLanguageState('en');}catch{}const sync=(event:StorageEvent)=>{if(event.key==='gutta-language')setLanguageState(event.newValue==='en'?'en':'nb');};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
 useEffect(()=>{document.documentElement.lang=language;},[language]);
 const value=useMemo(()=>({language,setLanguage:(next:Language)=>{setLanguageState(next);try{localStorage.setItem('gutta-language',next);}catch{}},t:(text:string,values?:Record<string,string|number>)=>translate(language,text,values)}),[language]);
 return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export const useLanguage=()=>useContext(LanguageContext);
export function LanguageSwitch(){const {language,setLanguage}=useLanguage();return <div className="language-switch" role="group" aria-label="Språk / Language"><button type="button" lang="nb" title="Bokmål" aria-label="Bokmål" aria-pressed={language==='nb'} onClick={()=>setLanguage('nb')}>NO</button><button type="button" lang="en" title="English" aria-label="English" aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>EN</button></div>;}
