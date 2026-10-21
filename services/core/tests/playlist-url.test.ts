import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePlaylistUrl } from '../src/playlist-url.ts';

const list = 'PLeeZgE3_zp1w';
const spotifyId = '37i9dQZF1DX4dyzvuaRJ0n';

test('YouTube playlist links and watch links normalize to the same canonical playlist', () => {
  for (const host of ['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com']) {
    for (const path of ['/playlist?list=' + list, '/watch?v=known000001&list=' + list, '/watch?list=' + list + '&v=known000001']) {
      assert.deepEqual(normalizePlaylistUrl('  https://' + host + path + '&si=tracking  '), {
        source: 'youtube', url: 'https://www.youtube.com/playlist?list=' + list,
      });
    }
  }
  assert.deepEqual(normalizePlaylistUrl('HTTPS://WWW.YOUTUBE.COM/playlist?list=PL0123456789_-'), {
    source: 'youtube', url: 'https://www.youtube.com/playlist?list=PL0123456789_-',
  });
});

test('Spotify canonical, localized and short share links retain only supported identities', () => {
  for (const kind of ['playlist', 'album']) {
    for (const locale of ['', 'intl-no/', 'intl-en/']) assert.deepEqual(
      normalizePlaylistUrl(`https://open.spotify.com/${locale}${kind}/${spotifyId}?si=tracking&utm_source=share`),
      { source: 'spotify', url: `https://open.spotify.com/${kind}/${spotifyId}` },
    );
  }
  assert.deepEqual(normalizePlaylistUrl('https://spotify.link/aB12-c_D?si=tracking'), {
    source: 'spotify', url: 'https://spotify.link/aB12-c_D',
  });
});

test('schemes, credentials, explicit default ports, fragments and misleading hosts are rejected', () => {
  const addresses = [
    `http://youtube.com/playlist?list=${list}`, `ftp://youtube.com/playlist?list=${list}`,
    `//youtube.com/playlist?list=${list}`, `https:youtube.com/playlist?list=${list}`,
    `https:///youtube.com/playlist?list=${list}`, `https://user@youtube.com/playlist?list=${list}`,
    `https://user:secret@youtube.com/playlist?list=${list}`, `https://youtube.com:443/playlist?list=${list}`,
    `https://youtube.com:8443/playlist?list=${list}`, `https://youtube.com:/playlist?list=${list}`,
    `https://youtube.com.evil.test/playlist?list=${list}`, `https://evil.test/youtube.com/playlist?list=${list}`,
    `https://youtube.com./playlist?list=${list}`, `https://%79outube.com/playlist?list=${list}`,
    `https://youtube.com/playlist?list=${list}#`, `https://youtube.com/playlist?list=${list}#fragment`,
    `https://youtube.com\\evil.test/playlist?list=${list}`, `https://you\ttube.com/playlist?list=${list}`,
    `\nhttps://youtube.com/playlist?list=${list}`, `https://youtube.com/playlist?list=${list}\t`,
    `https://youtube.com/playlist?list=${list}\u202e`, `https://youtube.com/playlist?list=${list} mid`,
    `https://open.spotify.com:443/playlist/${spotifyId}`, `https://spotify.link:443/share`,
    `spotify:playlist:${spotifyId}`, 'https://spotify.link.evil.test/share', 'https://[::1]/playlist',
  ];
  for (const address of addresses) assert.throws(() => normalizePlaylistUrl(address), /^Error: The playlist URL is invalid\.$/, address);
});

test('YouTube requires exactly one bounded playlist identity regardless of video parameters', () => {
  for (const suffix of [
    '/watch?v=known000001', '/playlist', '/playlist?list=', '/playlist?list=short',
    '/playlist?list=' + 'a'.repeat(101), '/playlist?list=oneplaylist&list=otherlist1',
    `/watch?list=${list}&%6cist=${list}`, `/playlist/?list=${list}`, `/shorts/known000001?list=${list}`,
    `/play%2flist?list=${list}`, `/playlist?list=${list}%2Fmore`, `/playlist?list=${list}%5cmore`,
  ]) assert.throws(() => normalizePlaylistUrl('https://youtube.com' + suffix), suffix);
  assert.throws(() => normalizePlaylistUrl('https://youtube.com/playlist?list=' + 'a'.repeat(2048)));
});

test('Spotify rejects other entities, malformed IDs, nested shares and encoded path separators', () => {
  for (const suffix of [
    '/track/' + spotifyId, '/artist/' + spotifyId, '/playlist/short', '/playlist/' + spotifyId + 'a',
    '/playlist/' + spotifyId.slice(0, -1) + '_', '/playlist/' + spotifyId + '/', '/intl-nor/album/' + spotifyId,
    '/playlist%2f' + spotifyId, '/playlist/' + spotifyId + '%2fmore',
  ]) assert.throws(() => normalizePlaylistUrl('https://open.spotify.com' + suffix), suffix);
  for (const suffix of ['', '/', '/nested/share', '/..', '/a%2fb', '/a.b', '/' + 'a'.repeat(101)])
    assert.throws(() => normalizePlaylistUrl('https://spotify.link' + suffix), suffix);
  assert.throws(() => normalizePlaylistUrl(''));
  assert.throws(() => normalizePlaylistUrl(null as unknown as string));
});
