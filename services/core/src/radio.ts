import type {PublicTrack,Track} from './types.ts';

const normalize=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
type RadioTrack=PublicTrack & Pick<Partial<Track>,'catalog'>;
export function canPlayRadioTrack(seed:Track,track:Track){
    return !track.live&&(!seed.concert||((track.source??'youtube')==='youtube'&&track.embeddable));
}
export function radioArtist(track:RadioTrack){
    const prefix=track.title.split(/\s[-\u2013\u2014]\s/)[0];
    const artist=track.catalog?.artist||(/(?:- Topic|VEVO)$/i.test(track.artist)?track.artist:prefix!==track.title?prefix:track.artist);
    return artist.replace(/\s*(?:- Topic|VEVO|Official(?: Music)?)$/i,'').split(',')[0].trim();
}
export function radioTitle(track:RadioTrack){
    if(track.catalog?.title)return track.catalog.title;
    const parts=track.title.split(/\s[-\u2013\u2014]\s/);
    const artist=normalize(radioArtist(track)),prefix=normalize(parts[0]);
    const hasArtistPrefix=Boolean(artist)&&(prefix===artist||prefix.startsWith(artist+' '));
    return (parts.length>1&&hasArtistPrefix?parts.slice(1).join(' - '):track.title).split('|')[0]
        .replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/\b(?:feat\.?|ft\.?)\s+.*/i,'').trim();
}
export function radioQuery(track:RadioTrack){
    const artist=radioArtist(track),song=radioTitle(track).replace(/"/g,'');
    return `${artist} audio${song?` -"${song}"`:''}`;
}
export function songIdentity(track:RadioTrack){
    return normalize(radioTitle(track).replace(/\([^)]*\)|\[[^\]]*\]/g,'').replace(/\b(?:feat\.?|ft\.?)\s+.*/i,'').replace(/\b(?:official|music|video|audio|lyrics?|visualizer|hd|hq|4k)\b/gi,''));
}
/** Conservative radio: prefer another real song by the seed artist to unrelated video guesses. */
export function rankRadio(seed:Track,candidates:Track[],recent:PublicTrack[],excluded:string[]){
    const artist=normalize(radioArtist(seed));
    if(!artist)return [];
    const ids=new Set([seed.id,...excluded,...recent.map(t=>t.id)]);
    const songs=new Set([songIdentity(seed),...recent.map(songIdentity)]);
    const seen=new Set<string>();
    return candidates.map((track,index)=>{
        const title=normalize(track.title),identity=songIdentity(track);
        const matches=normalize(radioArtist(track))===artist||normalize(track.artist.replace(/(?:- Topic|VEVO)$/i,''))===artist||title.startsWith(artist+' ');
        const unwanted=/\b(reaction|reacts|interview|tutorial|podcast|compilation|playlist|full album|full set|dj set|live set|concert|hour|hours|best of|top \d+|karaoke|cover|fanmade|sped up|slowed)\b/i.test(title);
        const valid=matches&&!unwanted&&!track.live&&!track.concert&&track.duration>=90&&track.duration<=600&&!ids.has(track.id)&&!songs.has(identity)&&!seen.has(identity);
        if(valid)seen.add(identity);
        const official=/\b(official audio|official music video|provided to youtube)\b/i.test(track.title)||/Topic$|VEVO$/i.test(track.artist);
        return {track,score:valid?100+(official?20:0)+(track.artist===seed.artist?30:0)-index:-1};
    }).filter(t=>t.score>=0).sort((a,b)=>b.score-a.score).map(t=>t.track);
}
