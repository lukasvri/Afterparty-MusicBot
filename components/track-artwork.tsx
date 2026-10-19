"use client";
import Image, {type ImageProps} from 'next/image';
import {artworkUrl} from '@/lib/artwork';
import type {Video} from '@/lib/types';

export function TrackArtwork({video, alt, ...props}: Omit<ImageProps,'src'|'unoptimized'|'onError'> & {video:Pick<Video,'id'|'image'|'source'>}) {
  return <Image {...props} alt={alt} unoptimized src={artworkUrl(video)} onError={event => {
    const image = event.currentTarget;
    if (image.getAttribute('src') !== '/afterparty-mark.svg') image.src = '/afterparty-mark.svg';
  }} />;
}
