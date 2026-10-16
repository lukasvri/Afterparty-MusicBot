'use client';
import {createContext,useContext,useEffect,useMemo,type ReactNode} from 'react';
import {useBrowserValue} from '@/hooks/use-browser-value';
import {browserStorage} from '@/lib/browser-storage';
import {translate,type Language} from '@/lib/messages';
const LanguageContext=createContext<{language:Language;setLanguage:(language:Language)=>void;t:(text:string,values?:Record<string,string|number>)=>string}>({language:'nb',setLanguage:()=>{},t:(text,values)=>translate('nb',text,values)});
export function LanguageProvider({children}:{children:ReactNode}){
 const saved=useBrowserValue('gutta-language','nb');
 const language:Language=saved==='en'?'en':'nb';
 useEffect(()=>{document.documentElement.lang=language;},[language]);
 const value=useMemo(()=>({language,setLanguage:(next:Language)=>{browserStorage.set('gutta-language',next);},t:(text:string,values?:Record<string,string|number>)=>translate(language,text,values)}),[language]);
 return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export const useLanguage=()=>useContext(LanguageContext);
export function LanguageSwitch(){const {language,setLanguage}=useLanguage();return <div className="language-switch" role="group" aria-label="Språk / Language"><button type="button" lang="nb" title="Bokmål" aria-label="Bokmål" aria-pressed={language==='nb'} onClick={()=>setLanguage('nb')}>NO</button><button type="button" lang="en" title="English" aria-label="English" aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>EN</button></div>;}
