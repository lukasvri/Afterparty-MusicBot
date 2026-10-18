/** Responses consumed at the provider boundary, independent of SDKs. */
export type YouTubeVideo = {
  id: string;
  snippet: {title: string; channelTitle: string; description?: string; tags?: string[]; categoryId?: string; liveBroadcastContent?: string};
  contentDetails: {duration: string};
  status: {embeddable?: boolean};
};
export type YouTubeResponses = {
  videos: {items: YouTubeVideo[]};
  search: {items: {id: {videoId: string}}[]};
  playlistItems: {items: {contentDetails: {videoId: string}}[]; nextPageToken?: string};
};
export type ExtractedMedia = {
  id?: string | number;
  title?: string;
  description?: string;
  tags?: string[];
  categories?: string[];
  track?: string;
  artist?: string;
  artists?: string[];
  uploader?: string;
  duration?: number;
  full_duration?: number;
  is_live?: boolean;
  playable_in_embed?: boolean;
  webpage_url?: string;
  url?: string;
  http_headers?: Record<string, string>;
  thumbnail?: string;
  thumbnails?: {url: string}[];
  availability?: string;
  is_preview?: boolean;
  entries?: (ExtractedMedia | null)[];
};
