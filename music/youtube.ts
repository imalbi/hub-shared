import { Innertube, YTNodes } from 'youtubei.js';

type SourceSong = {
  id?: string;
  title?: string;
  artists?: { name: string; channel_id?: string }[];
  album?: { name: string };
  duration?: { seconds: number };
  thumbnail?: { contents: { url: string }[] } | null;
};

export type Song = {
  id: string;
  title: string;
  artists: { name: string; id?: string }[];
  album?: string;
  seconds?: number;
  cover?: string;
};

export type RelatedArtist = {
  id: string;
  name: string;
  cover?: string;
};

const channelId = /^UC[A-Za-z0-9_-]{22}$/;

type ArtistSource = Awaited<ReturnType<Innertube['music']['getArtist']>>;
type PlaylistSource = Awaited<ReturnType<Innertube['music']['getPlaylist']>>;

export function mapRelated(artist: { sections: ArtistSource['sections'][number][] }): RelatedArtist[] {
  const seen = new Set<string>();
  const related: RelatedArtist[] = [];
  for (const section of artist.sections) {
    if (!section.is(YTNodes.MusicCarouselShelf)) continue;
    for (const item of section.contents) {
      if (!item.is(YTNodes.MusicTwoRowItem) || item.item_type !== 'artist') continue;
      const id = item.id;
      const name = item.title.toString().trim();
      if (!id || !channelId.test(id) || !name || seen.has(id)) continue;
      seen.add(id);
      const cover = item.thumbnail[0]?.url;
      related.push({ id, name, ...(cover ? { cover } : {}) });
    }
  }
  return related;
}

export function mapPlaylist(playlist: { header?: PlaylistSource['header']; items: PlaylistSource['items'][number][] }) {
  const header = playlist.header;
  const title = header?.is(YTNodes.MusicResponsiveHeader, YTNodes.MusicDetailHeader) ? header.title.toString() : '';
  const songs = mapSongs(playlist.items.filter((item) => item.is(YTNodes.MusicResponsiveListItem))).songs;
  return { title, songs };
}

export function mapArtist(artist: { header?: ArtistSource['header']; sections: ArtistSource['sections'][number][] }) {
  const header = artist.header;
  const banner = header?.is(YTNodes.MusicVisualHeader)
    ? header.thumbnail.at(-1)?.url
    : header?.is(YTNodes.MusicImmersiveHeader)
      ? header.thumbnail?.contents.at(-1)?.url
      : undefined;
  const songs = artist.sections.flatMap((section) =>
    section.is(YTNodes.MusicShelf) && section.title.toString() === 'Top songs' ? mapSongs(section.contents).songs : [],
  );
  const albums = artist.sections.flatMap((section) =>
    section.is(YTNodes.MusicCarouselShelf)
      ? section.contents.flatMap((item) =>
          item.is(YTNodes.MusicTwoRowItem) && item.item_type === 'album'
            ? [{ title: item.title.toString(), cover: item.thumbnail.at(-1)?.url }]
            : [],
        )
      : [],
  );
  return { name: header?.title?.toString() ?? '', banner, songs, albums };
}

export function mapSongs(items: SourceSong[]) {
  const songs: Song[] = [];
  let dropped = 0;
  for (const item of items) {
    if (!item.id || !item.title) {
      dropped++;
      continue;
    }
    songs.push({
      id: item.id,
      title: item.title,
      artists: (item.artists ?? []).map((artist) => ({
        name: artist.name,
        ...(artist.channel_id ? { id: artist.channel_id } : {}),
      })),
      ...(item.album ? { album: item.album.name } : {}),
      ...(item.duration ? { seconds: item.duration.seconds } : {}),
      ...(item.thumbnail?.contents[0]?.url ? { cover: item.thumbnail.contents[0].url } : {}),
    });
  }
  return { songs, dropped };
}

export function createYouTube() {
  let session: Promise<Innertube> | undefined;
  async function client() {
    session ??= Innertube.create({ generate_session_locally: true, retrieve_player: false });
    return session.catch((error: unknown) => {
      session = undefined;
      throw error;
    });
  }
  return {
    async searchPlaylists(query: string) {
      const yt = await client();
      const result = await yt.music.search(query, { type: 'playlist' });
      return (result.playlists?.contents ?? []).flatMap((item) =>
        item.id && item.title ? [{ id: item.id, title: item.title }] : [],
      );
    },
    async playlist(id: string) {
      const yt = await client();
      let page = await yt.music.getPlaylist(id);
      const result = mapPlaylist(page);
      while (page.has_continuation) {
        page = await page.getContinuation();
        result.songs.push(...mapPlaylist(page).songs);
      }
      return result;
    },
    async artist(id: string) {
      const yt = await client();
      return mapArtist(await yt.music.getArtist(id));
    },
    async searchArtists(query: string) {
      const yt = await client();
      const result = await yt.music.search(query, { type: 'artist' });
      const shelf =
        result.artists ??
        result.contents
          ?.filterType(YTNodes.MusicShelf)
          .find((section) =>
            section.contents.some((item) => item.is(YTNodes.MusicResponsiveListItem) && item.item_type === 'artist'),
          );
      return (shelf?.contents ?? []).flatMap((item) =>
        item.is(YTNodes.MusicResponsiveListItem) &&
        item.item_type === 'artist' &&
        item.id &&
        channelId.test(item.id) &&
        item.name
          ? [{ id: item.id, name: item.name }]
          : [],
      );
    },
    async relatedArtists(id: string) {
      const yt = await client();
      return mapRelated(await yt.music.getArtist(id));
    },
    async search(query: string) {
      const yt = await client();
      const result = await yt.music.search(query, { type: 'song' });
      return mapSongs(result.songs?.contents ?? []);
    },
    /** The song's own artwork, largest first: square album art for a track, the video frame for a music video. */
    async cover(id: string): Promise<string | undefined> {
      const yt = await client();
      const thumbnails = (await yt.music.getInfo(id)).basic_info.thumbnail ?? [];
      return thumbnails.toSorted((a, b) => b.width - a.width)[0]?.url;
    },
    async upNext(id: string) {
      const yt = await client();
      const result = await yt.music.getUpNext(id);
      return mapSongs(
        result.contents.flatMap((item) => {
          const video = 'video_id' in item ? item : 'primary' in item ? item.primary : null;
          if (!video) return [];
          return [
            {
              id: video.video_id,
              title: video.title.toString(),
              artists: video.artists,
              album: video.album,
              duration: video.duration,
              thumbnail: { contents: video.thumbnail },
            },
          ];
        }),
      ).songs;
    },
  };
}
