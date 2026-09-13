import type { ActiveSongState, WebSetlist } from '../types/gtar'
import type { SyncLibrary } from './syncMerge'

export const DEFAULT_TEMPLATE_SONGS: ActiveSongState[] = [
  {
    id: 1,
    title: 'Stand By Me',
    artist: 'Ben E. King',
    key: 'A',
    capo: 'Capo 2',
    bpm: '118',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: Stand By Me}
{artist: Ben E. King}
{key: A}
{capo: Capo 2}
{tempo: 118}

Intro: [A] [F#m] [D] [E] [A]

[Verse 1]
When the [A]night has come
[F#m]And the land is dark
And the [D]moon is the [E]only light we'll [A]see
No I [A]won't be afraid, no I [F#m]won't be afraid
Just as [D]long as you [E]stand, stand by [A]me

[Chorus]
So darling, darling, [A]stand by me
Oh [F#m]stand by me
Oh [D]stand, [E]stand by me, [A]stand by me

[Verse 2]
If the [A]sky that we look upon
[F#m]Should tumble and fall
Or the [D]mountains should [E]crumble to the [A]sea
I won't [A]cry, I won't cry, no I [F#m]won't shed a tear
Just as [D]long as you [E]stand, stand by [A]me

[Outro]
[A]Whenever you're in trouble, won't you [F#m]stand by me
Oh [D]stand by me, [E]oh stand by [A]me`,
  },
  {
    id: 2,
    title: 'Ang Huling El Bimbo',
    artist: 'Eraserheads',
    key: 'G',
    capo: 'No Capo',
    bpm: '124',
    format: 'TWO_LINE',
    transposeOffset: 0,
    rawContent: `{title: Ang Huling El Bimbo}
{artist: Eraserheads}
{key: G}
{capo: No Capo}
{tempo: 124}

[Intro]
G - A7 - C - G
[G] [A7] [C] [G]

[Verse 1]
Kamukha mo si Paraluman
Nung tayo ay bata pa
At ang galing-galing mong sumayaw
Mapa-Boogie man o Cha-Cha

[Chorus]
Magkahawak ang ating kamay
At walang kamalay-malay
Na ang huling El Bimbo
Ay papunta na sa dulo

[Bridge]
At dahan-dahang lumipas
Ang mga araw at taon
Lumaki tayong dalawa
Naiwan ang kahapon

[Outro]
[G] [A7] [C] [G]
La la la la la la la la la`,
  },
  {
    id: 3,
    title: 'Hotel California',
    artist: 'Eagles',
    key: 'Bm',
    capo: 'Capo 2',
    bpm: '75',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: Hotel California}
{artist: Eagles}
{key: Bm}
{capo: Capo 2}
{tempo: 75}

Intro: [Bm] [F#7] [A] [E] [G] [D] [Em] [F#7]

[Verse 1]
On a [Bm]dark desert highway, [F#7]cool wind in my hair
[A]Warm smell of colitas [E]rising up through the air
[G]Up ahead in the distance, [D]I saw a shimmering light
[Em]My head grew heavy and my sight grew dim, [F#7]I had to stop for the night

[Chorus]
[G]Welcome to the Hotel Cali[D]fornia
Such a [F#7]lovely place, such a [Bm]lovely face
Plenty of [G]room at the Hotel Cali[D]fornia
Any [Em]time of year, you can [F#7]find it here`,
  },
  {
    id: 4,
    title: 'Hallelujah',
    artist: 'Leonard Cohen',
    key: 'C',
    capo: 'No Capo',
    bpm: '56',
    format: 'CHORD_PRO',
    transposeOffset: 0,
    rawContent: `{title: Hallelujah}
{artist: Leonard Cohen}
{key: C}
{capo: No Capo}
{tempo: 56}

Intro: [C] [Am] [C] [Am]

[Verse 1]
Now I've [C]heard there was a [Am]secret chord
That [C]David played, and it [Am]pleased the Lord
But [F]you don't really [G]care for music, [C]do you? [G]
It [C]goes like this, the [F]fourth, the [G]fifth
The [Am]minor fall, the [F]major lift
The [G]baffled king com[E7]posing Halle[Am]lujah

[Chorus]
Halle[F]lujah, Halle[Am]lujah
Halle[F]lujah, Halle[C]lu---[G]--[C]jah`,
  },
]

export const DEFAULT_TEMPLATE_SETLISTS: WebSetlist[] = [
  {
    id: 'gig-set-1',
    name: 'Acoustic Gig Set',
    songs: [
      { title: 'Stand By Me', artist: 'Ben E. King' },
      { title: 'Ang Huling El Bimbo', artist: 'Eraserheads' },
      { title: 'Hotel California', artist: 'Eagles' },
      { title: 'Hallelujah', artist: 'Leonard Cohen' },
    ],
  },
]

/**
 * Returns true if library is empty or contains only untouched default template songs/setlists.
 */
export function isDefaultTemplateLibrary(library: SyncLibrary | null | undefined): boolean {
  if (!library) return true
  const songs = library.songs || []
  const setlists = library.setlists || []

  if (songs.length === 0 && setlists.length === 0) return true

  // Check if all songs are a subset of the default template songs (matching title and artist)
  // and have untouched content, transpose, BPM, favorites, and tags
  const defaultSongMap = new Map<string, ActiveSongState>()
  for (const song of DEFAULT_TEMPLATE_SONGS) {
    const key = `${song.title.trim().toLowerCase()}::${(song.artist || '').trim().toLowerCase()}`
    defaultSongMap.set(key, song)
  }

  for (const song of songs) {
    const key = `${song.title.trim().toLowerCase()}::${(song.artist || '').trim().toLowerCase()}`
    const defaultSong = defaultSongMap.get(key)
    if (!defaultSong) {
      // User has added a non-default song
      return false
    }
    // If raw content was modified, it's not a pristine template song
    if ((song.rawContent || '').trim() !== (defaultSong.rawContent || '').trim()) {
      return false
    }
    // If transpose was modified
    if ((song.transposeOffset || 0) !== (defaultSong.transposeOffset || 0)) {
      return false
    }
    // If custom BPM
    if ((song.bpm || '').trim() !== (defaultSong.bpm || '').trim()) {
      return false
    }
    // If marked as favorite
    if (song.isFavorite) {
      return false
    }
    // If user added tags
    if (song.tags && song.tags.trim() !== '') {
      return false
    }
    // If key or capo was modified
    if ((song.key || '').trim() !== (defaultSong.key || '').trim()) {
      return false
    }
    if ((song.capo || '').trim() !== (defaultSong.capo || '').trim()) {
      return false
    }
  }

  // Check setlists: user with custom setlists or customized default setlists is not pristine
  if (setlists.length > 0) {
    const defaultSetlistMap = new Map<string, WebSetlist>()
    for (const s of DEFAULT_TEMPLATE_SETLISTS) {
      defaultSetlistMap.set(s.name.trim().toLowerCase(), s)
    }

    for (const setlist of setlists) {
      const defaultSetlist = defaultSetlistMap.get(setlist.name.trim().toLowerCase())
      if (!defaultSetlist) {
        // User created a custom setlist
        return false
      }
      // Check if songs in setlist match default setlist
      if (setlist.songs.length !== defaultSetlist.songs.length) {
        return false
      }
      for (let i = 0; i < setlist.songs.length; i++) {
        const ref = setlist.songs[i]
        const defRef = defaultSetlist.songs[i]
        if (
          ref.title.trim().toLowerCase() !== defRef.title.trim().toLowerCase() ||
          (ref.artist || '').trim().toLowerCase() !== (defRef.artist || '').trim().toLowerCase()
        ) {
          return false
        }
      }
    }
  }

  return true
}
