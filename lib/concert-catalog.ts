export type ConcertRecording = Readonly<{
  id: string; eventId: string; eventName: string; year: number; artist: string; title: string;
  videoId: string; uploaderName?: string; uploaderUrl?: string; sourcePublisher?: string; stage?: string; sourceUrl: string; verifiedAt: string; evidenceUrls: readonly string[];
}>;

/** Individually checked official uploads retained alongside festival source indexes. */
const curatedRecordings: readonly ConcertRecording[] = [
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
    "id": "tomorrowland-belgium-2026-fhiZ1Rj9o-A",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Alesso",
    "title": "Alesso | Tomorrowland 2026 (Freedom Stage Weekend 2) [Full DJ Live Set]",
    "videoId": "fhiZ1Rj9o-A",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=fhiZ1Rj9o-A",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=fhiZ1Rj9o-A",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-NpL_bT5vgmU",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Boris Brejcha",
    "title": "Boris Brejcha WE1 | Tomorrowland 2026",
    "videoId": "NpL_bT5vgmU",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=NpL_bT5vgmU",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=NpL_bT5vgmU",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-uMgz40hvySQ",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Charlotte de Witte",
    "title": "Charlotte de Witte WE1 | Tomorrowland 2026",
    "videoId": "uMgz40hvySQ",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=uMgz40hvySQ",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=uMgz40hvySQ",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-jSJEkiV3cCs",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Chase & Status",
    "title": "Chase & Status (DJ set) WE2 | Tomorrowland 2026",
    "videoId": "jSJEkiV3cCs",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=jSJEkiV3cCs",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=jSJEkiV3cCs",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
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
    "id": "tomorrowland-belgium-2026-Tj8NbfUMS-0",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Fisher",
    "title": "Fisher WE 1 | Tomorrowland 2026",
    "videoId": "Tj8NbfUMS-0",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=Tj8NbfUMS-0",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=Tj8NbfUMS-0",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-Py-GG74lLU8",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Hardwell",
    "title": "HARDWELL - Tomorrowland 2026 [FULL MAINSTAGE CLOSING SHOW]",
    "videoId": "Py-GG74lLU8",
    "uploaderName": "Hardwell",
    "sourceUrl": "https://www.youtube.com/watch?v=Py-GG74lLU8",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=Py-GG74lLU8",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ]
  },
  {
    "id": "tomorrowland-belgium-2026-KLyeLMJuIOY",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Lost Frequencies",
    "title": "Lost Frequencies - Live at Tomorrowland 2026 (Mainstage) (Full Set HD)",
    "videoId": "KLyeLMJuIOY",
    "uploaderName": "Lost Frequencies",
    "sourceUrl": "https://www.youtube.com/watch?v=KLyeLMJuIOY",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=KLyeLMJuIOY",
      "https://press.belgium.tomorrowland.com/millions-of-beats-and-millions-of-views-tomorrowland-closes-the-gates-of-the-belgian-consciencia-chapter"
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
    "id": "tomorrowland-belgium-2026-JKM0Gy0lxYE",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "NERVO",
    "title": "NERVO WE1 | Tomorrowland 2026",
    "videoId": "JKM0Gy0lxYE",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=JKM0Gy0lxYE",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=JKM0Gy0lxYE",
      "https://press.belgium.tomorrowland.com/millions-of-beats-and-millions-of-views-tomorrowland-closes-the-gates-of-the-belgian-consciencia-chapter"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-TsyGMhx8izw",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Nicky Romero",
    "title": "Nicky Romero WE2 | Tomorrowland 2026",
    "videoId": "TsyGMhx8izw",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=TsyGMhx8izw",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=TsyGMhx8izw",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-2i3XOxbp54U",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Oliver Heldens",
    "title": "Oliver Heldens WE1 | Tomorrowland 2026",
    "videoId": "2i3XOxbp54U",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=2i3XOxbp54U",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=2i3XOxbp54U",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-EuqrehK1XFw",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Sara Landry",
    "title": "Sara Landry WE1 | Tomorrowland 2026",
    "videoId": "EuqrehK1XFw",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=EuqrehK1XFw",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=EuqrehK1XFw",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-aDAWctObTvI",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Sara Landry",
    "title": "Sara Landry WE2 | Tomorrowland 2026",
    "videoId": "aDAWctObTvI",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=aDAWctObTvI",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=aDAWctObTvI",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-jXEtB43exs0",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Sebastian Ingrosso",
    "title": "Sebastian Ingrosso WE1 | Tomorrowland 2026",
    "videoId": "jXEtB43exs0",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=jXEtB43exs0",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=jXEtB43exs0",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-g4vR2VlhNtk",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Sebastian Ingrosso",
    "title": "Sebastian Ingrosso WE2 | Tomorrowland 2026",
    "videoId": "g4vR2VlhNtk",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=g4vR2VlhNtk",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=g4vR2VlhNtk",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-eir5Sh_gHbo",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Steve Angello",
    "title": "Steve Angello WE1 | Tomorrowland 2026",
    "videoId": "eir5Sh_gHbo",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=eir5Sh_gHbo",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=eir5Sh_gHbo",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-5AdQy7lCbN0",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Steve Angello",
    "title": "Steve Angello WE2 | Tomorrowland 2026",
    "videoId": "5AdQy7lCbN0",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=5AdQy7lCbN0",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=5AdQy7lCbN0",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-8-J01-hcHfA",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Steve Aoki",
    "title": "Steve Aoki WE2 | Tomorrowland 2026",
    "videoId": "8-J01-hcHfA",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=8-J01-hcHfA",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=8-J01-hcHfA",
      "https://press.belgium.tomorrowland.com/millions-of-beats-and-millions-of-views-tomorrowland-closes-the-gates-of-the-belgian-consciencia-chapter"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-1lqmFLr-SkA",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "The Chainsmokers",
    "title": "The Chainsmokers WE1 | Tomorrowland 2026",
    "videoId": "1lqmFLr-SkA",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=1lqmFLr-SkA",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=1lqmFLr-SkA",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
  },
  {
    "id": "tomorrowland-belgium-2026-QcvGuOhSVlc",
    "eventId": "tomorrowland-belgium",
    "eventName": "Tomorrowland Belgium",
    "year": 2026,
    "artist": "Timmy Trumpet",
    "title": "Timmy Trumpet WE2 | Tomorrowland 2026",
    "videoId": "QcvGuOhSVlc",
    "uploaderName": "Tomorrowland",
    "sourceUrl": "https://www.youtube.com/watch?v=QcvGuOhSVlc",
    "verifiedAt": "2026-10-21",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=QcvGuOhSVlc",
      "https://www.tomorrowland.com/article/tomorrowland-belgium-2026-relive/"
    ],
    "uploaderUrl": "https://www.youtube.com/c/tomorrowland"
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
  },
  {
    "id": "creamfields-2024-bVF_7IiTAsI",
    "eventId": "creamfields",
    "eventName": "Creamfields",
    "year": 2024,
    "artist": "CAMELPHAT",
    "title": "CAMELPHAT Live | Rockstar Energy presents Creamfields 2024 | Beatport Live",
    "videoId": "bVF_7IiTAsI",
    "uploaderName": "Beatport",
    "sourceUrl": "https://www.youtube.com/watch?v=bVF_7IiTAsI",
    "verifiedAt": "2026-10-25",
    "evidenceUrls": [
      "https://www.youtube.com/watch?v=bVF_7IiTAsI",
      "https://www.beatportal.com/articles/594895-beatport-livestream-creamfields-2024"
    ]
  }
];


type IndexedSet = readonly [videoId: string, artist: string, stage: string, title?: string, evidenceUrl?: string];
type SourceIndex = Readonly<{
  eventId: string;
  eventName: string;
  year: number;
  sourceUrl: string;
  publisherName: string;
  listedCount: number;
  records: readonly IndexedSet[];
  excluded: readonly Readonly<{ sourceUrl: string; videoId: string; reason: string }>[];
}>;

/** Exact links exposed by the named festival indexes on 25 October 2026.
 * A complete checked index is not every performance at that festival, nor playback proof.
 */
const sourceIndexes: readonly SourceIndex[] = [
  {
    eventId: "edc-las-vegas",
    eventName: "EDC Las Vegas",
    year: 2026,
    sourceUrl: "https://lasvegas.edc.com/2026-sets/",
    publisherName: "EDC Las Vegas",
    listedCount: 116,
    records: [
      ["OI02QgEA1Zw", "Above & Beyond", "Kinetic Field"],
      ["Sc8ohmCAwwk", "AR/CO", "Kinetic Field"],
      ["n-MhD_TdzN4", "Armin van Buuren", "Kinetic Field"],
      ["is834eCbUD4", "Charlotte de Witte", "Kinetic Field"],
      ["NsmhG-ec6XI", "Fisher", "Kinetic Field"],
      ["APt5j9Abwo8", "Funk Tribu", "Kinetic Field"],
      ["xq-7nU66OmQ", "Griz B2B Wooli", "Kinetic Field"],
      ["UNtEX3GB6jU", "Hardwell", "Kinetic Field"],
      ["IIquvML5M4M", "HAYLA", "Kinetic Field"],
      ["l5wro3bMZWc", "Kaskade", "Kinetic Field"],
      ["sl7ogG9pypM", "Korolova", "Kinetic Field"],
      ["IzsShRhd5cw", "Laidback Luke B2B Chuckie", "Kinetic Field"],
      ["euV8srBycPM", "Layton Giordani", "Kinetic Field"],
      ["zkT8FjfBjYI", "Porter Robinson", "Kinetic Field"],
      ["B_6j_7ijHV4", "Ship Wrek", "Kinetic Field"],
      ["kw_C3HE6VRY", "Steve Aoki", "Kinetic Field"],
      ["-A-XIBMDgj0", "Subtronics", "Kinetic Field"],
      ["3AQ_Srbe1lQ", "The Chainsmokers", "Kinetic Field"],
      ["rViPl2wgfnI", "Trace", "Kinetic Field"],
      ["qtmgGEKcS8E", "Alison Wonderland", "Cosmic Meadow"],
      ["1VPVlylpsh4", "BTSM", "Cosmic Meadow"],
      ["KfXGNpoL5QQ", "Dabin", "Cosmic Meadow"],
      ["Oz4YrX3FmQI", "DJ Gigola B2B MCR-T", "Cosmic Meadow"],
      ["a8OfrpQLQuY", "Frost Children", "Cosmic Meadow"],
      ["0gzd1Y3GXYo", "Gravagerz", "Cosmic Meadow"],
      ["h0UoFF7MDEU", "Jackie Hollander", "Cosmic Meadow"],
      ["W3VuzjQfWz4", "Meduza³", "Cosmic Meadow"],
      ["YPkxfeU-pxU", "Roddy Lima", "Cosmic Meadow"],
      ["JGbl-zSWxJw", "San Holo", "Cosmic Meadow"],
      ["tpteTL5ycRo", "Seven Lions", "Cosmic Meadow"],
      ["4wzyC3J6-NU", "Underworld", "Cosmic Meadow"],
      ["C4BkbUETBfM", "VTSS", "Cosmic Meadow"],
      ["HLRLV_OPixQ", "Walker & Royce B2B VNSSA", "Cosmic Meadow"],
      ["jQLWYc2UrFY", "Westend", "Cosmic Meadow"],
      ["RBieMmkqqUc", "1991", "Circuit Grounds"],
      ["VHcMS47PSJY", "DJ Mandy", "Circuit Grounds"],
      ["D8eLxmifH4o", "Holy Priest", "Circuit Grounds"],
      ["uYLk84L1-Cs", "Level Up", "Circuit Grounds"],
      ["aSCa4codmQY", "Lilly Palmer", "Circuit Grounds"],
      ["f_p6nfbrm0E", "Nico Moreno", "Circuit Grounds"],
      ["QpVM_g6PPs8", "Ray Volpe", "Circuit Grounds"],
      ["WVzqS_R6-uk", "RØZ", "Circuit Grounds"],
      ["g1vH9C_o-vo", "Solomun", "Circuit Grounds"],
      ["1x_Bs1_a5hA", "T78", "Circuit Grounds"],
      ["kG0SVvz9e-g", "Tiësto", "Circuit Grounds"],
      ["pFh9sJsc8jw", "Airrica", "Neon Garden"],
      ["beQH5eaJBbo", "Alignment", "Neon Garden"],
      ["MVg7m6dgUqw", "Eli Brown", "Neon Garden"],
      ["I02YBw_-vw8", "ÆON:MODE", "Basspod"],
      ["NNKJh_xbAQs", "Adventure Club", "Basspod"],
      ["vMXiBq657PQ", "Avello B2B Dennett", "Basspod"],
      ["WL1ms-g0m_Y", "Boogie T B2B Distinct Motive", "Basspod"],
      ["iJyxx84Jo4Q", "Culture Shock", "Basspod"],
      ["_oEiJGLkcc8", "Delta Heavy", "Basspod"],
      ["vsPrpmZ4MCU", "EAZYBAKED", "Basspod"],
      ["S1YQ4VFkyXg", "Eptic B2B Space Laces", "Basspod"],
      ["o1Wly2tbJ1c", "Fallen with MC Dino", "Basspod"],
      ["rWcft58AigY", "Ghengar", "Basspod"],
      ["nR8GqHnxNO4", "Getter", "Basspod"],
      ["cYETa5qYdPk", "GorillaT", "Basspod"],
      ["VEfhTggBFG4", "HOL!", "Basspod"],
      ["QFY1IqfXiaM", "Infekt B2B Samplifire", "Basspod"],
      ["m5kcQdmGdFw", "Kai Wachi", "Basspod"],
      ["uy9qp5bg78E", "Muzz", "Basspod"],
      ["4ea_5jbyu8g", "Mary Droppinz", "Basspod"],
      ["xCrVXGHz13Q", "Nightstalker with MC Dino", "Basspod"],
      ["h5_XfGZy99w", "Viperactive", "Basspod"],
      ["1Q-j11Nlm4k", "Whethan", "Basspod"],
      ["PaBcY8VTZZI", "Wooli", "Basspod"],
      ["xPscuo3l2mM", "YDG", "Basspod"],
      ["M_0o5nuWT00", "Amal Nemer", "Stereo Bloom"],
      ["l7Ytbzj7uGo", "Biscits", "Stereo Bloom"],
      ["iJ4sDJMUX3o", "CID", "Stereo Bloom"],
      ["evExq8QiGsY", "HNTR", "Stereo Bloom"],
      ["SNdp1tCoikI", "Mattilo", "Stereo Bloom"],
      ["zzNLgrlKggs", "Wax Motif", "Stereo Bloom"],
      ["YKYSeJEwzFQ", "Andrew Rayel", "Quantum Valley"],
      ["AkKTQwjIFi8", "Billy Gillies", "Quantum Valley"],
      ["nsLTs0KG0lA", "Chris Metcalfe", "Quantum Valley"],
      ["TBTeywt_XAA", "Cold Blue", "Quantum Valley"],
      ["EO8fj6FfCPk", "Cosmic Gate", "Quantum Valley"],
      ["NVCy6AxuhJs", "Darren Porter", "Quantum Valley"],
      ["dXBoIY65P8s", "Darude", "Quantum Valley"],
      ["FuozAYwtdlY", "Eli & Fur", "Quantum Valley"],
      ["Psc-_y8eAus", "Gareth Emery", "Quantum Valley"],
      ["lBkvmpPoWIU", "Ilan Bluestone", "Quantum Valley"],
      ["XPMPhXsEENE", "Innellea", "Quantum Valley"],
      ["kM7iuhXXaZg", "KREAM", "Quantum Valley"],
      ["okj8arPC3-k", "Maddix", "Quantum Valley"],
      ["pz1cTZzSBns", "Massano", "Quantum Valley"],
      ["i7PGl_PyHvI", "Mathame", "Quantum Valley"],
      ["yUA0Ht2PdG0", "Pegassi", "Quantum Valley"],
      ["KIb3psOt9hI", "Sarah de Warren", "Quantum Valley"],
      ["u8y3cbpoY3E", "Superstrings", "Quantum Valley"],
      ["j1PFNCA1gyg", "Alves", "Bionic Jungle"],
      ["3orBbM0HHEw", "BAUGRUPPE90", "Bionic Jungle"],
      ["sFZlb4PwDCQ", "Club Angel", "Bionic Jungle"],
      ["J9i1QgkmkfQ", "ISAbella", "Bionic Jungle"],
      ["Wo8Gxt-hetE", "KinAhau", "Bionic Jungle"],
      ["CHoqTHETVoY", "Robert Hood", "Bionic Jungle"],
      ["CM80hrwF6io", "Sippy", "Bionic Jungle"],
      ["ROX9gE8LeIU", "Stacy Christine", "Bionic Jungle"],
      ["K0Qg0wqhCdY", "The Carry Nation", "Bionic Jungle"],
      ["CTLggF5F0O8", "Tiga", "Bionic Jungle"],
      ["t3UtUpatiWw", "Virtual Riot", "Bionic Jungle"],
      ["8w5BCTl0iq8", "Alyssa Jolee", "Wasteland"],
      ["4NSxVUJFqXg", "Clawz", "Wasteland"],
      ["hobSsy3NVPA", "CUTDWN", "Wasteland"],
      ["8ZO61JfNFI0", "DØMINA", "Wasteland"],
      ["64X5oVyCjes", "GRAVEDGR", "Wasteland"],
      ["xd8Vef-uy7U", "LNY TNZ B2B Lady Faith", "Wasteland"],
      ["rs8fz_uGyMs", "Mish", "Wasteland"],
      ["IfqBMO903fw", "Yosuf", "Wasteland"],
      ["V96jBrTDGJY", "Close Friends Only", "Casa Bacardí"],
      ["WVLte5KOzeo", "Luke Alexander", "Casa Bacardí"],
      ["PVh5bKxUjPo", "SKILAH", "Casa Bacardí"],
    ],
    excluded: [],
  },
  {
    eventId: "edc-las-vegas",
    eventName: "EDC Las Vegas",
    year: 2025,
    sourceUrl: "https://lasvegas.edc.com/2025-sets/",
    publisherName: "EDC Las Vegas",
    listedCount: 86,
    records: [
      ["trXRltKkl1g", "Afrojack", "Kinetic Field"],
      ["-qBlYtNdm1I", "Alesso", "Kinetic Field"],
      ["kletgNAPkDc", "Alok", "Kinetic Field"],
      ["Dp7AwrAKckQ", "Armin van Buuren", "Kinetic Field"],
      ["eJcc0MjKFUY", "Ben Nicky", "Kinetic Field"],
      ["FX4S_Sh4M4s", "Danny Avila", "Kinetic Field"],
      ["N3YWZxr0QpU", "Deorro & Friends", "Kinetic Field"],
      ["aL9Rsey-ieA", "Dimension", "Kinetic Field"],
      ["PNPpSPS1nok", "Fisher", "Kinetic Field"],
      ["F2OqDwCr0-c", "Gorgon City", "Kinetic Field"],
      ["SXPdDTDBgAI", "Illenium B2B SLANDER", "Kinetic Field"],
      ["CAWf5dTiFKI", "James Hype", "Kinetic Field"],
      ["-je6YbvDRiU", "Kaskade", "Kinetic Field"],
      ["JX2STP6HL5k", "Marlon Hoffstadt", "Kinetic Field"],
      ["BlS2A-1nEb0", "Meduza", "Kinetic Field"],
      ["1gBeqQ7DO2c", "MORTEN B2B ARTBAT", "Kinetic Field"],
      ["3PLNKKo64m4", "Noizu", "Kinetic Field"],
      ["M1MbXD78Whg", "Nora En Pure", "Kinetic Field"],
      ["LrJtjGPNHPE", "Sara Landry", "Kinetic Field"],
      ["PUMXKSvmElA", "ARMNHMR", "Cosmic Meadow"],
      ["VaE5DSKkdm4", "Brutalismus 3000", "Cosmic Meadow"],
      ["0J2uOZfNaZ0", "CHYL", "Cosmic Meadow"],
      ["L5VzEvfKTEY", "Dombresky", "Cosmic Meadow"],
      ["tEvkdC6cGwk", "Girl Math (VNSSA B2B Nala)", "Cosmic Meadow"],
      ["EZxb2VK7GiI", "it’s murph", "Cosmic Meadow"],
      ["gJ9rFaIFRJo", "Loud Luxury", "Cosmic Meadow"],
      ["lVNk3L3dGY8", "RL Grime", "Cosmic Meadow"],
      ["xoBwEB1NUys", "SIDEPIECE", "Cosmic Meadow"],
      ["F9ZwsSEIeA4", "Tape B", "Cosmic Meadow"],
      ["Q-DAQ7a7RQA", "TOKiMONSTA", "Cosmic Meadow"],
      ["N5ZXMoKKt8U", "Trivecta", "Cosmic Meadow"],
      ["OmV2BviroAI", "Yellow Claw", "Cosmic Meadow"],
      ["5n7iU3GNn-s", "ALLEYCVT", "Circuit Grounds"],
      ["vbyIioz2yfE", "Annicka", "Circuit Grounds"],
      ["rY9TLLXqu5o", "Armand van Helden", "Circuit Grounds"],
      ["_oJGyE9v9Pk", "Black Tiger Sex Machine", "Circuit Grounds"],
      ["YCquMdLncH4", "Eli Brown", "Circuit Grounds"],
      ["meoWTGZFsls", "Excision", "Circuit Grounds"],
      ["JdCmzkt5xdo", "ISOKNOCK", "Circuit Grounds"],
      ["ErIqPsTDq1U", "Layton Giordani", "Circuit Grounds"],
      ["xCvaCI5GN1g", "Maddix", "Circuit Grounds"],
      ["N40pkDgwNfg", "Max Styler", "Circuit Grounds"],
      ["Cd5TO9j3sfQ", "Rezz", "Circuit Grounds"],
      ["UYCisfVZkqc", "Space 92 B2B Popof", "Circuit Grounds"],
      ["k9pYsuLTL2o", "Tchami x Malaa: No Redemption", "Circuit Grounds"],
      ["wFl_ttYwixk", "Tiësto", "Circuit Grounds"],
      ["aQvQXLrCe5w", "Torren Foot", "Circuit Grounds"],
      ["pFh9sJsc8jw", "Airrica", "Neon Garden"],
      ["beQH5eaJBbo", "Alignment", "Neon Garden"],
      ["2_VrORlu2JM", "Carlita", "Neon Garden"],
      ["GRl8zlVlxGQ", "Clara Cuvé", "Neon Garden"],
      ["EgSdaX--t-A", "Cole Knight", "Neon Garden"],
      ["0wlQJeBfuwY", "Masha Mar", "Neon Garden"],
      ["j_xmJOwwagA", "Selective Response", "Neon Garden"],
      ["knJyJPP45dg", "Vintage Culture", "Neon Garden"],
      ["FNXWc_cteBo", "AHEE", "Basspod"],
      ["lIAalwQyE7E", "Andy C", "Basspod"],
      ["z7nFhHWlZvo", "Crankdat B2B Tape B", "Basspod"],
      ["m0M2zS3qF48", "Distinct Motive", "Basspod"],
      ["eAU8zlvV0GM", "DRINKURWATER", "Basspod"],
      ["kiTC0MpruuE", "INFEKT", "Basspod"],
      ["EDIu0g3AGm4", "Jessica Audiffred B2B LAYZ", "Basspod"],
      ["JFhlrajr4XI", "Kompany", "Basspod"],
      ["R9pZMUJ4Ubw", "Level Up", "Basspod"],
      ["rWx7hgQGnRQ", "Liquid Stranger", "Basspod"],
      ["gFON8Y1-04w", "Ray Volpe", "Basspod"],
      ["we9MjOJs4_k", "Riot Ten", "Basspod"],
      ["Yy5_ArB4bL8", "RZRKT B2B Vastive", "Basspod"],
      ["L435tA2uzP0", "Samplifire", "Basspod"],
      ["8xh48FrlT6w", "Soothslayer", "Basspod"],
      ["4psAuZO4jTk", "Sota B2B Basstripper", "Basspod"],
      ["JhKHTRky7s0", "Steller", "Basspod"],
      ["TpkYi4_mPtc", "Sullivan King", "Basspod"],
      ["IbFoGUXiIZw", "Truth", "Basspod"],
      ["OCp9g2cVswk", "YDG", "Basspod"],
      ["M_0o5nuWT00", "Amal Nemer", "Stereo Bloom"],
      ["l7Ytbzj7uGo", "Biscits", "Stereo Bloom"],
      ["SNdp1tCoikI", "Mattilo", "Stereo Bloom"],
      ["pXtrDm8M3U8", "Clawz", "Wasteland"],
      ["NdRks688X4M", "Lady Faith", "Wasteland"],
      ["LHtKoJO8eko", "RayRay", "Wasteland"],
      ["cd6rg4Qg7QU", "Restricted", "Wasteland"],
      ["e534qA1sBhI", "Yosuf", "Wasteland"],
      ["xqeG-D7016A", "David Rust", "Quantum Valley"],
      ["orCsZKWhXOY", "Hannah Laing", "Quantum Valley"],
      ["oMUuOYOOq1g", "Miyuki", "Quantum Valley"],
    ],
    excluded: [],
  },
  {
    eventId: "edc-las-vegas",
    eventName: "EDC Las Vegas",
    year: 2023,
    sourceUrl: "https://lasvegas.edc.com/2023-sets/",
    publisherName: "EDC Las Vegas",
    listedCount: 26,
    records: [
      ["yg3k1TdYliE", "Malaa B2B Wax Motif", "kineticFIELD"],
      ["yU4yrbUQYlU", "Tiësto", "kineticFIELD"],
      ["Ojw5OHHCk2I", "James Hype", "kineticFIELD"],
      ["yEeGED9sk4k", "MORTEN", "kineticFIELD"],
      ["boZR0-mvhGk", "Korolova", "kineticFIELD"],
      ["GMm0MheUdBA", "Armin van Buuren", "kineticFIELD"],
      ["27iKJsnJ1Iw", "Loud Luxury", "kineticFIELD"],
      ["7DQrDsU4sQw", "Gareth Emery", "kineticFIELD"],
      ["VlBXcTowSTM", "Ship Wrek", "kineticFIELD"],
      ["GIqtyI5o3qk", "Marten Hørger", "kineticFIELD"],
      ["RObBjjKwuv8", "Kaivon", "cosmicMEADOW"],
      ["hi1gXtzdKhQ", "Above & Beyond", "circuitGROUNDS"],
      ["0chMH8oXbQQ", "Meduza", "circuitGROUNDS"],
      ["S515L_YLFl8", "Kill Script", "circuitGROUNDS"],
      ["kuJVbpaFuXs", "SUBJOHNICS (Subtronics B2B John Summit)", "circuitGROUNDS"],
      ["usKhSYApJGU", "Modapit", "circuitGROUNDS"],
      ["Gdj6CZ3DbcA", "Yellow Claw", "circuitGROUNDS"],
      ["R75AFoBPBVs", "Marshmello B2B Svdden Death", "circuitGROUNDS"],
      ["0P65xP5mp1w", "Blanke", "circuitGROUNDS"],
      ["TCd23VzxrFo", "12th Planet", "bassPOD"],
      ["Rbf5erNI6c0", "Ray Volpe", "bassPOD"],
      ["9y_pwrMVXhs", "Barely Alive", "bassPOD"],
      ["P2B1JArFhJw", "Andy C", "bassPOD"],
      ["k2U8x0ixCZU", "IMANU", "bassPOD"],
      ["x9vxiFTNikQ", "Bensley B2B Justin Hawkes", "bassPOD"],
      ["4j06l15up5s", "Giuseppe Ottaviani", "quantumVALLEY"],
    ],
    excluded: [],
  },
  {
    eventId: "creamfields",
    eventName: "Creamfields",
    year: 2024,
    sourceUrl: "https://creamfields.com/2024_live/all-streams/",
    publisherName: "Creamfields",
    listedCount: 24,
    records: [
      ["xk_5do5HDVg", "Adrianna", "Steel Yard", "ADRIANNA Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/friday/steel-yard/adrianna/"],
      ["_oLhJ_RxVRE", "SOSA", "Zenless Zone Zero", "ARCHIVED: Sosa Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/friday/zenless-zone-zero/sosa/"],
      ["4PilF1i7j6k", "MK", "Arc", "MK Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/arc/mk/"],
      ["ShI_YcEvyPI", "Eliza Rose", "Arc", "Eliza Rose Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/arc/eliza-rose/"],
      ["E6JDnEUW580", "Millie Cotton", "Arc", "Millie Cotton Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/arc/millie-cotton/"],
      ["gVEXjvzGHKI", "Tyson O'Brien", "Arc", "Tyson O’Brien Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/arc/tyson-o-brien/"],
      ["nbh7HouhSdI", "Eric Prydz", "Steel Yard", "Eric Prydz LIVE @ Rockstar Energy presents Creamfields 2024 | @beatport live", "https://creamfields.com/2024_live/saturday/steel-yard/eric-prydz/"],
      ["QlpIE4QZxKU", "Ewan McVicar", "Steel Yard", "Ewan McVicar Live | Rockstar Energy presents @creamfields 2024 | @beatport  Live", "https://creamfields.com/2024_live/saturday/steel-yard/ewan-mcvicar/"],
      ["l-mU_rvVYHo", "Pete Tong", "Steel Yard", "Pete Tong Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/steel-yard/pete-tong/"],
      ["XlJxlEtRkEY", "Solomun B2B Patrick Topping", "Steel Yard", "Solomun B2B Patrick Topping Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/steel-yard/solomun-b2b-patricktopping/"],
      ["NlXog2cbM_A", "It's Murph", "Steel Yard", "It’s Murph Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/steel-yard/its-murph/"],
      ["NqRIwVtTtOU", "Ben Hemsley", "Zenless Zone Zero", "Ben Hemsley · Creamfields 2024", "https://creamfields.com/2024_live/saturday/zenless-zone-zero/ben-hemsley/"],
      ["a1rFspyEcII", "Armin Van Buuren", "Zenless Zone Zero", "Armin van Buuren Live at Rockstar Energy presents @Creamfields 2024 | @Beatport", "https://creamfields.com/2024_live/saturday/zenless-zone-zero/armin-van-buuren/"],
      ["UI9VLsqmH9w", "Third Party", "Zenless Zone Zero", "Third Party Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/zenless-zone-zero/relive-third-party/"],
      ["xJLiPYufDbg", "Kimmic", "Zenless Zone Zero", "KIMMIC Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/saturday/zenless-zone-zero/kimmic/"],
      ["n8lQjIr3BUA", "Example", "Arc", "Example Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/arc/example/"],
      ["blyu2TNkezo", "Belters Only", "Arc", "Belters Only Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/arc/belters-only/"],
      ["e1BMc5pEh-M", "Jazzy", "Arc", "Jazzy Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/arc/jazzy/"],
      ["arowbYnNFGY", "Hannah Laing", "Zenless Zone Zero", "Hannah Laing Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/zenless-zone-zero/hannah-laing/"],
      ["QcdlF8pSzZ4", "Max Dean", "Zenless Zone Zero", "Max Dean Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/zenless-zone-zero/relive-max-dean/"],
      ["Gsh_lK43jhY", "Cassö B2B Daire", "Zenless Zone Zero", "Cassö B2B Daire Live | Rockstar Energy presents @creamfields 2024  | @beatport Live", "https://creamfields.com/2024_live/sunday/zenless-zone-zero/relive-casso-b2b-daire/"],
      ["omf-wsbCCtA", "Carta", "Zenless Zone Zero", "Carta Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/zenless-zone-zero/relive-carta/"],
      ["WqxkGqLug_A", "Beauz", "Zenless Zone Zero", "Beauz Live | Rockstar Energy presents @creamfields 2024 | @beatport Live", "https://creamfields.com/2024_live/sunday/zenless-zone-zero/beauz/"],
    ],
    excluded: [{"sourceUrl": "https://creamfields.com/2024_live/friday/steel-yard/eli-brown/", "videoId": "Bz3StgzmGos", "reason": "The embedded recording identifies Creamfields 2023, not 2024."}],
  },
 ];

const curatedIds = new Set(curatedRecordings.map(recording => `${recording.eventId}:${recording.year}:${recording.videoId}`));
const indexedRecordings: ConcertRecording[] = sourceIndexes.flatMap(group => group.records.map(([videoId, artist, stage, title, evidenceUrl]) => ({
  id: `${group.eventId}-${group.year}-${videoId}`,
  eventId: group.eventId,
  eventName: group.eventName,
  year: group.year,
  artist,
  title: title ?? `${artist} · ${group.eventName} ${group.year}`,
  videoId,
  sourcePublisher: group.publisherName,
  stage,
  sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
  verifiedAt: '2026-10-25',
  evidenceUrls: [`https://www.youtube.com/watch?v=${videoId}`, group.sourceUrl, ...(evidenceUrl ? [evidenceUrl] : [])],
}))).filter(recording => !curatedIds.has(`${recording.eventId}:${recording.year}:${recording.videoId}`));

/** Canonical source snapshots for coverage, attribution and regression checks. */
export const CONCERT_SOURCES = Object.freeze(sourceIndexes.map(({records, ...source}) => Object.freeze({
  ...source,
  checkedAt: '2026-10-25',
  videoIds: Object.freeze(records.map(([videoId]) => videoId)),
  excluded: Object.freeze(source.excluded.map(item => Object.freeze(item))),
})));

/** Editorial links to official uploads. Runtime metadata decides availability and playback. */
export const CONCERT_CATALOG: readonly ConcertRecording[] = Object.freeze([...curatedRecordings, ...indexedRecordings].map(recording => Object.freeze({
  ...recording,
  evidenceUrls: Object.freeze(recording.evidenceUrls),
})));

/** Source references expose available entries through the existing bounded metadata importer.
 * Playlist contents and ownership are not inferred from the supplied URL or its title.
 */
export const CONCERT_PLAYLISTS = Object.freeze([
  Object.freeze({
    eventId: 'tomorrowland-belgium', year: 2022,
    url: 'https://www.youtube.com/playlist?list=PLoSIOFPSXQoNFQ1nzaPy90MAt94vqJDb4',
    label: 'Tomorrowland Belgium 2022 liveset playlist',
  }),
  Object.freeze({
    eventId: 'tomorrowland-belgium', year: 2023,
    url: 'https://www.youtube.com/playlist?list=PLoSIOFPSXQoOZSSYZtdmZzagDK9kNfUsu',
    label: 'Tomorrowland Belgium 2023 liveset playlist',
  }),
  Object.freeze({
    eventId: 'tomorrowland-belgium', year: 2024,
    url: 'https://www.youtube.com/playlist?list=PLoSIOFPSXQoO6Y2EaUcVcBXQm7pkkY0n3',
    label: 'Tomorrowland Belgium 2024 liveset playlist',
  }),
  Object.freeze({
    eventId: 'tomorrowland-belgium', year: 2026,
    url: 'https://www.youtube.com/playlist?list=PLeeZgE3_zp1w',
    label: 'Supplied Tomorrowland Belgium 2026 playlist',
  }),
  Object.freeze({
    eventId: 'tomorrowland-belgium', year: 2025,
    url: 'https://www.youtube.com/playlist?list=PLoSIOFPSXQoN-uoi-Bn6R4JA8C4beRJsU',
    label: 'Tomorrowland Belgium 2025 liveset playlist',
  }),
]);
