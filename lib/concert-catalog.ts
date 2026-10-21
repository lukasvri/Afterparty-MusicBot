export type ConcertRecording = Readonly<{
  id: string; eventId: string; eventName: string; year: number; artist: string; title: string;
  videoId: string; uploaderName: string; uploaderUrl?: string; sourceUrl: string; verifiedAt: string; evidenceUrls: readonly string[];
}>;

/** Editorial links to official uploads. Runtime metadata decides availability and playback. */
export const CONCERT_CATALOG: readonly ConcertRecording[] = Object.freeze(
[
  {
    "id": "ultra-miami-2026-i_BPdQ-FidY",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2026,
    "artist": "Hardwell",
    "title": "HARDWELL - LIVE @ ULTRA MUSIC FESTIVAL MIAMI 2026",
    "videoId": "i_BPdQ-FidY",
    "uploaderName": "Hardwell",
    "sourceUrl": "https://www.youtube.com/watch?v=i_BPdQ-FidY",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=i_BPdQ-FidY",
      "https://ultramusicfestival.com/"
    ]
  },
  {
    "id": "ultra-miami-2026-vBvZaydcCzc",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2026,
    "artist": "Martin Garrix B2B Alesso",
    "title": "MARTIN GARRIX B2B ALESSO LIVE @ ULTRA MUSIC FESTIVAL MIAMI 2026",
    "videoId": "vBvZaydcCzc",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=vBvZaydcCzc",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=vBvZaydcCzc",
      "https://ultramusicfestival.com/"
    ]
  },
  {
    "id": "ultra-miami-2025-hQ6k0_Iura0",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2025,
    "artist": "Alesso",
    "title": "ALESSO LIVE @ ULTRA MUSIC FESTIVAL MIAMI 2025 (FULL DJ SET)",
    "videoId": "hQ6k0_Iura0",
    "uploaderName": "Alesso",
    "sourceUrl": "https://www.youtube.com/watch?v=hQ6k0_Iura0",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=hQ6k0_Iura0"
    ]
  },
  {
    "id": "ultra-miami-2025-3-ELBiUkUWc",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2025,
    "artist": "Martin Garrix",
    "title": "MARTIN GARRIX LIVE @ ULTRA MUSIC FESTIVAL MIAMI 2025",
    "videoId": "3-ELBiUkUWc",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=3-ELBiUkUWc",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=3-ELBiUkUWc"
    ]
  },
  {
    "id": "ultra-miami-2024-w3zCxh-70Ms",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2024,
    "artist": "Hardwell",
    "title": "HARDWELL LIVE AT ULTRA MUSIC FESTIVAL MIAMI 2024",
    "videoId": "w3zCxh-70Ms",
    "uploaderName": "Hardwell",
    "sourceUrl": "https://www.youtube.com/watch?v=w3zCxh-70Ms",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=w3zCxh-70Ms"
    ]
  },
  {
    "id": "ultra-miami-2023-uPhsq1msjl8",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2023,
    "artist": "Hardwell",
    "title": "HARDWELL LIVE @ ULTRA MUSIC FESTIVAL MIAMI 2023",
    "videoId": "uPhsq1msjl8",
    "uploaderName": "Hardwell",
    "sourceUrl": "https://www.youtube.com/watch?v=uPhsq1msjl8",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=uPhsq1msjl8"
    ]
  },
  {
    "id": "ultra-miami-2019-fz-3arJT8fc",
    "eventId": "ultra-miami",
    "eventName": "Ultra Miami",
    "year": 2019,
    "artist": "David Guetta",
    "title": "David Guetta | Miami Ultra Music Festival 2019",
    "videoId": "fz-3arJT8fc",
    "uploaderName": "David Guetta",
    "sourceUrl": "https://www.youtube.com/watch?v=fz-3arJT8fc",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=fz-3arJT8fc",
      "https://ultramusicfestival.com/news/ultra-music-festival-reveals-phase-two-lineup-ahead-of-historic-virginia-key-beach-park-and-miami-marine-stadium-debut"
    ]
  },
  {
    "id": "tomorrowland-belgium-2026-GSnPwle4FOE",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "David Guetta",
    "title": "David Guetta live @ Tomorrowland 2026 | MainStage WE1",
    "videoId": "GSnPwle4FOE",
    "uploaderName": "David Guetta",
    "sourceUrl": "https://www.youtube.com/watch?v=GSnPwle4FOE",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=GSnPwle4FOE",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ]
  },
  {
    "id": "tomorrowland-belgium-2026-sqxFW3RXGdo",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Martin Garrix",
    "title": "MARTIN GARRIX LIVE @ TOMORROWLAND 2026 (W2)",
    "videoId": "sqxFW3RXGdo",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=sqxFW3RXGdo",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=sqxFW3RXGdo",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ]
  },
  {
    "id": "tomorrowland-belgium-2025-RmxWqo83MO4",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2025,
    "artist": "Martin Garrix",
    "title": "MARTIN GARRIX LIVE @ TOMORROWLAND 2025 (W2)",
    "videoId": "RmxWqo83MO4",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=RmxWqo83MO4",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=RmxWqo83MO4",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2025-full-sets/"
    ]
  },
  {
    "id": "tomorrowland-belgium-2024-_KWuiCtWyNA",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2024,
    "artist": "Alesso",
    "title": "Alesso | Tomorrowland 2024 (Freedom Stage Weekend 2) [Full DJ Live Set]",
    "videoId": "_KWuiCtWyNA",
    "uploaderName": "Alesso",
    "sourceUrl": "https://www.youtube.com/watch?v=_KWuiCtWyNA",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=_KWuiCtWyNA",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2024-full-sets/"
    ]
  },
  {
    "id": "tomorrowland-belgium-2024-dSK13X9oGi8",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2024,
    "artist": "Swedish House Mafia",
    "title": "Swedish House Mafia WE2 | Tomorrowland 2024",
    "videoId": "dSK13X9oGi8",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=dSK13X9oGi8",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=dSK13X9oGi8",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2024-full-sets/"
    ]
  },
  {
    "id": "tomorrowland-belgium-2023-2WJoKYs4xnk",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2023,
    "artist": "Alesso",
    "title": "Alesso | Tomorrowland 2023 | Mainstage Weekend 1",
    "videoId": "2WJoKYs4xnk",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=2WJoKYs4xnk",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=2WJoKYs4xnk",
      "https://press.belgium.tomorrowland.com/relive-the-magic-of-tomorrowland-2023"
    ]
  },
  {
    "id": "tomorrowland-belgium-2023-1MelBcPuHXU",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2023,
    "artist": "Hardwell",
    "title": "Hardwell | Tomorrowland 2023",
    "videoId": "1MelBcPuHXU",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=1MelBcPuHXU",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=1MelBcPuHXU",
      "https://press.belgium.tomorrowland.com/relive-the-magic-of-tomorrowland-2023"
    ]
  },
  {
    "id": "tomorrowland-belgium-2023-raOVXUB13vw",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2023,
    "artist": "Martin Garrix B2B Alesso",
    "title": "MARTIN GARRIX B2B ALESSO LIVE @ TOMORROWLAND 2023",
    "videoId": "raOVXUB13vw",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=raOVXUB13vw",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=raOVXUB13vw",
      "https://press.belgium.tomorrowland.com/relive-the-magic-of-tomorrowland-2023"
    ]
  },
  {
    "id": "tomorrowland-belgium-2022-9cWsoVKpNjw",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2022,
    "artist": "Alesso",
    "title": "Alesso Live at Tomorrowland 2022 (Weekend 1 Mainstage Full DJ Set)",
    "videoId": "9cWsoVKpNjw",
    "uploaderName": "Alesso",
    "sourceUrl": "https://www.youtube.com/watch?v=9cWsoVKpNjw",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=9cWsoVKpNjw",
      "https://press.belgium.tomorrowland.com/tomorrowland-2022-full-sets-now-available"
    ]
  },
  {
    "id": "edc-las-vegas-2026-OI02QgEA1Zw",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2026,
    "artist": "Above & Beyond",
    "title": "Above & Beyond: Live from EDC Las Vegas 2026 (Official Full Set)",
    "videoId": "OI02QgEA1Zw",
    "uploaderName": "Above & Beyond",
    "sourceUrl": "https://www.youtube.com/watch?v=OI02QgEA1Zw",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=OI02QgEA1Zw",
      "https://lasvegas.edc.com/2026-sets/"
    ]
  },
  {
    "id": "edc-las-vegas-2026-kG0SVvz9e-g",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2026,
    "artist": "Tiësto",
    "title": "Tiësto Live at EDC Las Vegas 2026",
    "videoId": "kG0SVvz9e-g",
    "uploaderName": "Tiësto",
    "sourceUrl": "https://www.youtube.com/watch?v=kG0SVvz9e-g",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=kG0SVvz9e-g",
      "https://lasvegas.edc.com/2026-sets/"
    ]
  },
  {
    "id": "edc-las-vegas-2025--qBlYtNdm1I",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2025,
    "artist": "Alesso",
    "title": "Alesso Live at EDC Las Vegas 2025 (Kinetic Field Full DJ Set)",
    "videoId": "-qBlYtNdm1I",
    "uploaderName": "Alesso",
    "sourceUrl": "https://www.youtube.com/watch?v=-qBlYtNdm1I",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=-qBlYtNdm1I",
      "https://lasvegas.edc.com/2025-sets/"
    ]
  },
  {
    "id": "edc-las-vegas-2025-Dp7AwrAKckQ",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2025,
    "artist": "Armin van Buuren",
    "title": "Armin van Buuren live at EDC Las Vegas 2025",
    "videoId": "Dp7AwrAKckQ",
    "uploaderName": "Armin van Buuren",
    "sourceUrl": "https://www.youtube.com/watch?v=Dp7AwrAKckQ",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=Dp7AwrAKckQ",
      "https://lasvegas.edc.com/2025-sets/"
    ]
  },
  {
    "id": "edc-las-vegas-2023-hi1gXtzdKhQ",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2023,
    "artist": "Above & Beyond",
    "title": "Above & Beyond: Live at EDC Las Vegas 2023 (Official Set)",
    "videoId": "hi1gXtzdKhQ",
    "uploaderName": "Above & Beyond",
    "sourceUrl": "https://www.youtube.com/watch?v=hi1gXtzdKhQ",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=hi1gXtzdKhQ",
      "https://lasvegas.edc.com/2023-sets/"
    ]
  },
  {
    "id": "edc-las-vegas-2023-GMm0MheUdBA",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2023,
    "artist": "Armin van Buuren",
    "title": "Armin van Buuren live at EDC Las Vegas 2023",
    "videoId": "GMm0MheUdBA",
    "uploaderName": "Armin van Buuren",
    "sourceUrl": "https://www.youtube.com/watch?v=GMm0MheUdBA",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=GMm0MheUdBA",
      "https://lasvegas.edc.com/2023-sets/"
    ]
  },
  {
    "id": "edc-las-vegas-2023-yU4yrbUQYlU",
    "eventId": "edc-las-vegas",
    "eventName": "EDC Las Vegas",
    "year": 2023,
    "artist": "Tiësto",
    "title": "Tiësto - Live from EDC Las Vegas 2023",
    "videoId": "yU4yrbUQYlU",
    "uploaderName": "Tiësto",
    "sourceUrl": "https://www.youtube.com/watch?v=yU4yrbUQYlU",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=yU4yrbUQYlU",
      "https://lasvegas.edc.com/2023-sets/"
    ]
  },
  {
    "id": "creamfields-2024-nbh7HouhSdI",
    "eventId": "creamfields",
    "eventName": "Creamfields",
    "year": 2024,
    "artist": "Eric Prydz",
    "title": "Eric Prydz LIVE @ Rockstar Energy presents Creamfields 2024 | @beatport live",
    "videoId": "nbh7HouhSdI",
    "uploaderName": "Beatport",
    "sourceUrl": "https://www.youtube.com/watch?v=nbh7HouhSdI",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=nbh7HouhSdI",
      "https://creamfields.com/2024_live/saturday/steel-yard/eric-prydz/",
      "https://www.beatportal.com/videos/606590-eric-prydz-live-rockstar-energy-presents-creamfields-2024"
    ]
  },
  {
    "id": "creamfields-2024-n8lQjIr3BUA",
    "eventId": "creamfields",
    "eventName": "Creamfields",
    "year": 2024,
    "artist": "Example",
    "title": "Example Live | Rockstar Energy presents @creamfields 2024 | @beatport Live",
    "videoId": "n8lQjIr3BUA",
    "uploaderName": "Beatport",
    "sourceUrl": "https://www.youtube.com/watch?v=n8lQjIr3BUA",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=n8lQjIr3BUA",
      "https://www.beatportal.com/articles/594895-beatport-livestream-creamfields-2024"
    ]
  },
  {
    "id": "creamfields-2024-XlJxlEtRkEY",
    "eventId": "creamfields",
    "eventName": "Creamfields",
    "year": 2024,
    "artist": "Solomun B2B Patrick Topping",
    "title": "Solomun B2B Patrick Topping Live | Rockstar Energy presents @creamfields 2024 | @beatport Live",
    "videoId": "XlJxlEtRkEY",
    "uploaderName": "Beatport",
    "sourceUrl": "https://www.youtube.com/watch?v=XlJxlEtRkEY",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=XlJxlEtRkEY",
      "https://www.beatportal.com/videos/607957-solomun-b2b-patrick-topping-live-from-the-steel-yard-stage-for-rockstar-energy-presents-creamfields-2024-on-beatport"
    ]
  },
  {
    "id": "creamfields-2024-UI9VLsqmH9w",
    "eventId": "creamfields",
    "eventName": "Creamfields",
    "year": 2024,
    "artist": "Third Party",
    "title": "Third Party Live | Rockstar Energy presents @creamfields 2024 | @beatport Live",
    "videoId": "UI9VLsqmH9w",
    "uploaderName": "Beatport",
    "sourceUrl": "https://www.youtube.com/watch?v=UI9VLsqmH9w",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=UI9VLsqmH9w",
      "https://www.beatportal.com/articles/594895-beatport-livestream-creamfields-2024"
    ]
  },
  {
    "id": "amsterdam-rai-2023-cWJV0DgMqEA",
    "eventId": "amsterdam-rai",
    "eventName": "Amsterdam RAI",
    "year": 2023,
    "artist": "Martin Garrix",
    "title": "MARTIN GARRIX LIVE @ IDEM (Amsterdam RAI 2023)",
    "videoId": "cWJV0DgMqEA",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=cWJV0DgMqEA",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=cWJV0DgMqEA"
    ]
  },
  {
    "id": "amsterdam-rai-2019-lGCo8ILvauI",
    "eventId": "amsterdam-rai",
    "eventName": "Amsterdam RAI",
    "year": 2019,
    "artist": "Martin Garrix",
    "title": "MARTIN GARRIX LIVE @ THE ETHER (Amsterdam RAI 2019)",
    "videoId": "lGCo8ILvauI",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=lGCo8ILvauI",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=lGCo8ILvauI"
    ]
  },
  {
    "id": "amsterdam-rai-2018-CwE-haZR2fc",
    "eventId": "amsterdam-rai",
    "eventName": "Amsterdam RAI",
    "year": 2018,
    "artist": "Martin Garrix",
    "title": "Martin Garrix Presents: ANIMA (Live @ Amsterdam RAI 2018)",
    "videoId": "CwE-haZR2fc",
    "uploaderName": "Martin Garrix",
    "sourceUrl": "https://www.youtube.com/watch?v=CwE-haZR2fc",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=CwE-haZR2fc"
    ]
  }
].map(recording => Object.freeze({ ...recording, evidenceUrls: Object.freeze(recording.evidenceUrls) })));
