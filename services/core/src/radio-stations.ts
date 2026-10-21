import { scoreMatch, type CatalogSong } from './matching.ts';
import { isRadioMusic, sameRadioRecording } from './radio.ts';
import type { RadioTrack } from './radio.ts';
import type { Track } from './types.ts';

type StationSong = Readonly<CatalogSong & { alternateTitles?: readonly string[]; alternateArtists?: readonly string[] }>;
export type RadioStation = Readonly<{ id: string; songs: readonly StationSong[] }>;
/**
 * Small editorial recording relation, not a channel whitelist or proof of human authorship.
 * No video IDs, provider permission claims or automatic NCS membership inference.
 */
const stations: readonly RadioStation[] = Object.freeze([Object.freeze({
  id: 'ncs-melodic-edm',
  songs: Object.freeze([
    { artist: 'Janji', title: 'Heroes Tonight (feat. Johnning)', alternateTitles: Object.freeze(['Heroes Tonight']), duration: 0 },
    { artist: 'Jim Yosef', title: 'Firefly', duration: 0 },
    { artist: 'Tobu', title: 'Hope', duration: 0 },
    { artist: 'Itro & Tobu', alternateArtists: Object.freeze(['Tobu & Itro']), title: 'Cloud 9', duration: 0 },
    { artist: 'Tobu', title: 'Candyland', duration: 0 },
    { artist: 'Jim Yosef', title: 'Link', duration: 0 },
    { artist: 'Tobu', title: 'Infectious', duration: 0 },
    { artist: 'Tobu & Itro', alternateArtists: Object.freeze(['Itro & Tobu']), title: 'Sunburst', duration: 0 },
    { artist: 'Jim Yosef', title: 'Arrow', duration: 0 },
    { artist: 'Tobu', title: 'Colors', duration: 0 },
  ].map(song => Object.freeze(song))),
}), Object.freeze({
  id: 'ncs-melodic-trap',
  songs: Object.freeze([
    { artist: 'Lost Sky', title: 'Dreams', duration: 0 },
    { artist: 'Unknown Brain', title: 'Superhero (feat. Chris Linton)', alternateTitles: Object.freeze(['Superhero']), duration: 0 },
    { artist: 'Rival x Cadmium', title: 'Seasons (feat. Harley Bird)', alternateTitles: Object.freeze(['Seasons']), alternateArtists: Object.freeze(['Rival & Cadmium']), duration: 0 },
    { artist: 'Egzod & Maestro Chives', title: 'Royalty (feat. Neoni)', alternateTitles: Object.freeze(['Royalty']), duration: 0 },
    { artist: 'Lost Sky', title: 'Fearless pt.II (feat. Chris Linton)', alternateTitles: Object.freeze(['Fearless pt.II']), duration: 0 },
    { artist: 'Lost Sky', title: 'Where We Started (feat. Jex)', alternateTitles: Object.freeze(['Where We Started']), duration: 0 },
    { artist: 'Lost Sky', title: 'Vision', duration: 0 },
  ].map(song => Object.freeze(song))),
})]);

/** Check the actual upload fields; an attached catalog object cannot establish this identity. */
export function matchesStationRecording(song: StationSong, track: RadioTrack): boolean {
  if (!isRadioMusic(track)) return false;
  const raw: Track = { ...track, entryId: 'station-check' };
  delete raw.catalog;
  return [song.artist, ...(song.alternateArtists ?? [])].some(artist =>
    [song.title, ...(song.alternateTitles ?? [])].some(title => {
      const descriptor = { title, artist, duration: song.duration };
      const expected = { ...raw, title, artist: artist + ' - Topic', catalog: descriptor };
      return scoreMatch(descriptor, raw) >= 0.85 && sameRadioRecording(expected, raw);
    }),
  );
}
export function radioStation(seed: RadioTrack): RadioStation | undefined {
  return stations.find(station => station.songs.some(song => matchesStationRecording(song, seed)));
}
export function stationSong(station: RadioStation, track: RadioTrack): StationSong | undefined {
  return station.songs.find(song => matchesStationRecording(song, track));
}
export function stationRecording(station: RadioStation, track: RadioTrack): boolean {
  return stationSong(station, track) !== undefined;
}
