export type Player = {
  loadVideoById: (v: { videoId: string; startSeconds: number }) => void;
  cueVideoById: (v: { videoId: string; startSeconds: number }) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (n: number, a: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  setVolume: (n: number) => void;
  mute: () => void;
  unMute: () => void;
  destroy: () => void;
  setPlaybackRate: (rate: number) => void;
  getVolume: () => number;
  isMuted: () => boolean;
};
declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => Player;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeReady: Promise<void> | undefined;
export function loadYoutube() {
  if (window.YT?.Player) return Promise.resolve();
  return (youtubeReady ??= new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearInterval(check);
      if (error) {
        youtubeReady = undefined;
        reject(error);
      } else resolve();
    };
    const old = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      old?.();
      finish();
    };
    const timeout = setTimeout(
        () => finish(new Error("YouTube svarer ikke. Last videoen på nytt.")),
        12000,
      ),
      check = setInterval(() => {
        if (window.YT?.Player) finish();
      }, 200);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = () => {
      script.remove();
      finish(new Error("Videospilleren kunne ikke lastes."));
    };
    document.head.appendChild(script);
  }));
}
