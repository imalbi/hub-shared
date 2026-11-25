import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Parser, YTNodes } from 'youtubei.js';
import { mapArtist, mapPlaylist, mapRelated, mapSongs } from './youtube.ts';

void test('maps playlist header and songs from youtubei nodes', () => {
  const header = new YTNodes.MusicResponsiveHeader({
    title: { runs: [{ text: 'Mix' }] },
    subtitle: {},
    straplineTextOne: {},
    secondSubtitle: {},
    buttons: [],
  });
  const song = new YTNodes.MusicResponsiveListItem({
    flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song' }] } } }],
  });
  song.id = 'abcdefghijk';
  song.title = 'Song';
  song.artists = [{ name: 'Artist' }];
  assert.deepEqual(mapPlaylist({ header, items: [song] }), {
    title: 'Mix',
    songs: [{ id: 'abcdefghijk', title: 'Song', artists: [{ name: 'Artist' }] }],
  });
});

void test('maps artist header, top songs and albums from youtubei nodes', () => {
  const header = new YTNodes.MusicVisualHeader({
    title: { runs: [{ text: 'Artist' }] },
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/banner', width: 540, height: 225 }] },
      },
    },
  });
  const shelf = new YTNodes.MusicShelf({ title: { runs: [{ text: 'Top songs' }] }, contents: [] });
  const song = new YTNodes.MusicResponsiveListItem({
    flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song' }] } } }],
  });
  song.id = 'abcdefghijk';
  song.title = 'Song';
  song.artists = [{ name: 'Artist', channel_id: 'UCabcdefghijklmnopqrstuv' }];
  shelf.contents.push(song);
  const other = new YTNodes.MusicShelf({ title: { runs: [{ text: 'Other' }] }, contents: [] });
  other.contents.push(song);
  const carousel = new YTNodes.MusicCarouselShelf({ contents: [] });
  const album = new YTNodes.MusicTwoRowItem({
    title: { runs: [{ text: 'Album' }] },
    subtitle: {},
    navigationEndpoint: {
      browseEndpoint: {
        browseId: 'album',
        browseEndpointContextSupportedConfigs: {
          browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' },
        },
      },
    },
    thumbnailRenderer: {
      musicThumbnailRenderer: {
        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/album', width: 100, height: 100 }] },
      },
    },
  });
  carousel.contents.push(album);
  assert.deepEqual(mapArtist({ header, sections: [shelf, other, carousel] }), {
    name: 'Artist',
    banner: 'https://i.ytimg.com/banner',
    songs: [{ id: 'abcdefghijk', title: 'Song', artists: [{ name: 'Artist', id: 'UCabcdefghijklmnopqrstuv' }] }],
    albums: [{ title: 'Album', cover: 'https://i.ytimg.com/album' }],
  });
});

void test('maps song fields and counts missing identifiers', () => {
  const { songs, dropped } = mapSongs([
    {
      id: 'abcdefghijk',
      title: 'Song',
      artists: [{ name: 'Artist', channel_id: 'UC123' }],
      album: { name: 'Album' },
      duration: { seconds: 123 },
      thumbnail: { contents: [{ url: 'https://example.org/art' }] },
    },
    { title: 'No id' },
  ]);
  assert.deepEqual(songs, [
    {
      id: 'abcdefghijk',
      title: 'Song',
      artists: [{ name: 'Artist', id: 'UC123' }],
      album: 'Album',
      seconds: 123,
      cover: 'https://example.org/art',
    },
  ]);
  assert.equal(dropped, 1);
});

void test('M4: mapRelated reads related artists from a localized fixture ignoring shelf title and non-artist rows', () => {
  const raw: Parameters<typeof Parser.parseResponse>[0] = JSON.parse(
    readFileSync(new URL('./fixtures/artist.json', import.meta.url), 'utf8'),
  );
  const page = Parser.parseResponse(raw);
  const sections = [
    ...(page.contents_memo?.getType(YTNodes.MusicShelf) ?? []),
    ...(page.contents_memo?.getType(YTNodes.MusicCarouselShelf) ?? []),
  ];
  assert.deepEqual(mapRelated({ sections }), [
    {
      id: 'UC0000000000000000000001',
      name: 'Simile Uno',
      cover: 'https://lh3.googleusercontent.com/example-artist-1-544',
    },
    {
      id: 'UC0000000000000000000002',
      name: 'Simile Due',
      cover: 'https://lh3.googleusercontent.com/example-artist-2-544',
    },
    {
      id: 'UC0000000000000000000003',
      name: 'Simile Tre',
      cover: 'https://lh3.googleusercontent.com/example-artist-3-544',
    },
  ]);
});
