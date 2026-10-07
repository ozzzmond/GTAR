/**
 * Trusted Guitar Voicings Catalog - Natural Roots (C, D, E, F, G, A, B)
 * Verified, standard guitar chord fingerings.
 * Format matches ChordVoicing interface:
 * chord: string
 * baseFret: number
 * frets: number[] (6 elements, string 6 to string 1: E A D G B e, -1 = muted, 0 = open, 1..n = fret)
 * fingers?: number[] (6 elements: 0 = none, 1 = index, 2 = middle, 3 = ring, 4 = pinky)
 * barres?: number[]
 */

import type { ChordVoicing } from '../utils/chordDictionary'

export const NATURAL_CHORD_VOICINGS: ChordVoicing[] = [
  // ================= C ROOT =================
  // Triads & Basics
  { chord: 'C', baseFret: 1, frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  { chord: 'Cm', baseFret: 3, frets: [-1, 3, 5, 5, 4, 3], fingers: [0, 1, 3, 4, 2, 1], barres: [3] },
  { chord: 'C5', baseFret: 3, frets: [-1, 3, 5, 5, -1, -1], fingers: [0, 1, 3, 4, 0, 0] },
  { chord: 'C6', baseFret: 1, frets: [-1, 3, 2, 2, 1, 0], fingers: [0, 3, 2, 2, 1, 0] },
  { chord: 'Cm6', baseFret: 1, frets: [-1, 3, 1, 2, 1, -1], fingers: [0, 3, 1, 2, 1, 0] },
  { chord: 'Cdim', baseFret: 1, frets: [-1, -1, 1, 2, 1, 2], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Cdim7', baseFret: 1, frets: [-1, 3, 4, 2, 4, 2], fingers: [0, 2, 3, 1, 4, 1], barres: [2] },
  { chord: 'Caug', baseFret: 1, frets: [-1, 3, 2, 1, 1, 0], fingers: [0, 3, 2, 1, 1, 0] },

  // Seventh & Major Seventh
  { chord: 'C7', baseFret: 1, frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  { chord: 'Cmaj7', baseFret: 1, frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  { chord: 'Cm7', baseFret: 3, frets: [-1, 3, 5, 3, 4, 3], fingers: [0, 1, 3, 1, 2, 1], barres: [3] },
  { chord: 'Cm7b5', baseFret: 1, frets: [-1, 3, 4, 3, 4, -1], fingers: [0, 1, 3, 2, 4, 0] },

  // Suspended & Added
  { chord: 'Csus2', baseFret: 1, frets: [-1, 3, 0, 0, 1, 0], fingers: [0, 3, 0, 0, 1, 0] },
  { chord: 'Csus4', baseFret: 1, frets: [-1, 3, 3, 0, 1, 1], fingers: [0, 3, 4, 0, 1, 1] },
  { chord: 'C7sus4', baseFret: 1, frets: [-1, 3, 3, 3, 1, 1], fingers: [0, 2, 3, 4, 1, 1], barres: [1] },
  { chord: 'Cadd2', baseFret: 1, frets: [-1, 3, 0, 0, 1, 0], fingers: [0, 3, 0, 0, 1, 0] },
  { chord: 'Cadd9', baseFret: 1, frets: [-1, 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  { chord: 'Cadd4', baseFret: 1, frets: [-1, 3, 3, 0, 1, 0], fingers: [0, 2, 3, 0, 1, 0] },

  // Extended & Altered
  { chord: 'C9', baseFret: 2, frets: [-1, 3, 2, 3, 3, 3], fingers: [0, 2, 1, 3, 3, 3], barres: [3] },
  { chord: 'Cm9', baseFret: 3, frets: [-1, 3, 1, 3, 3, -1], fingers: [0, 2, 1, 3, 4, 0] },
  { chord: 'Cmaj9', baseFret: 1, frets: [-1, 3, 2, 4, 3, -1], fingers: [0, 2, 1, 4, 3, 0] },
  { chord: 'C7b9', baseFret: 1, frets: [-1, 3, 2, 3, 2, -1], fingers: [0, 2, 1, 3, 1, 0], barres: [2] },
  { chord: 'C7#9', baseFret: 2, frets: [-1, 3, 2, 3, 4, -1], fingers: [0, 2, 1, 3, 4, 0] },
  { chord: 'C6/9', baseFret: 1, frets: [-1, 3, 2, 2, 3, 3], fingers: [0, 2, 1, 1, 3, 4] },

  // Slash chords
  { chord: 'C/E', baseFret: 1, frets: [0, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  { chord: 'C/G', baseFret: 1, frets: [3, 3, 2, 0, 1, 0], fingers: [3, 4, 2, 0, 1, 0] },
  { chord: 'C/B', baseFret: 1, frets: [-1, 2, 2, 0, 1, 0], fingers: [0, 2, 3, 0, 1, 0] },
  { chord: 'C/Bb', baseFret: 1, frets: [-1, 1, 2, 0, 1, 0], fingers: [0, 1, 3, 0, 2, 0] },

  // ================= D ROOT =================
  // Triads & Basics
  { chord: 'D', baseFret: 1, frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  { chord: 'Dm', baseFret: 1, frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  { chord: 'D5', baseFret: 1, frets: [-1, -1, 0, 2, 3, -1], fingers: [0, 0, 0, 1, 2, 0] },
  { chord: 'D6', baseFret: 1, frets: [-1, -1, 0, 2, 0, 2], fingers: [0, 0, 0, 1, 0, 2] },
  { chord: 'Dm6', baseFret: 1, frets: [-1, -1, 0, 2, 0, 1], fingers: [0, 0, 0, 2, 0, 1] },
  { chord: 'Ddim', baseFret: 1, frets: [-1, -1, 0, 1, 3, 1], fingers: [0, 0, 0, 1, 3, 2] },
  { chord: 'Ddim7', baseFret: 1, frets: [-1, -1, 0, 1, 0, 1], fingers: [0, 0, 0, 1, 0, 2] },
  { chord: 'Daug', baseFret: 1, frets: [-1, -1, 0, 3, 3, 2], fingers: [0, 0, 0, 2, 3, 1] },

  // Seventh & Major Seventh
  { chord: 'D7', baseFret: 1, frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  { chord: 'Dmaj7', baseFret: 1, frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1], barres: [2] },
  { chord: 'Dm7', baseFret: 1, frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] },
  { chord: 'Dm7b5', baseFret: 1, frets: [-1, -1, 0, 1, 1, 1], fingers: [0, 0, 0, 1, 1, 1], barres: [1] },

  // Suspended & Added
  { chord: 'Dsus2', baseFret: 1, frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 2, 0] },
  { chord: 'Dsus4', baseFret: 1, frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] },
  { chord: 'D7sus4', baseFret: 1, frets: [-1, -1, 0, 2, 1, 3], fingers: [0, 0, 0, 2, 1, 3] },
  { chord: 'Dadd9', baseFret: 1, frets: [-1, -1, 0, 2, 5, 2], fingers: [0, 0, 0, 1, 4, 2] },

  // Extended & Altered
  { chord: 'D9', baseFret: 4, frets: [-1, 5, 4, 5, 5, 5], fingers: [0, 2, 1, 3, 3, 3], barres: [5] },
  { chord: 'Dm9', baseFret: 5, frets: [-1, 5, 3, 5, 5, -1], fingers: [0, 2, 1, 3, 4, 0] },
  { chord: 'Dmaj9', baseFret: 4, frets: [-1, 5, 4, 6, 5, -1], fingers: [0, 2, 1, 4, 3, 0] },

  // Slash chords
  { chord: 'D/F#', baseFret: 1, frets: [2, 0, 0, 2, 3, 2], fingers: [1, 0, 0, 2, 4, 3] },
  { chord: 'D/A', baseFret: 1, frets: [-1, 0, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  { chord: 'D/C', baseFret: 1, frets: [-1, 3, 0, 2, 3, 2], fingers: [0, 2, 0, 1, 4, 3] },
  { chord: 'D/B', baseFret: 1, frets: [-1, 2, 0, 2, 3, 2], fingers: [0, 1, 0, 2, 4, 3] },
  { chord: 'Dm/F', baseFret: 1, frets: [1, -1, 0, 2, 3, 1], fingers: [1, 0, 0, 2, 4, 1] },
  { chord: 'Dm/C', baseFret: 1, frets: [-1, 3, 0, 2, 3, 1], fingers: [0, 3, 0, 2, 4, 1] },

  // ================= E ROOT =================
  // Triads & Basics
  { chord: 'E', baseFret: 1, frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  { chord: 'Em', baseFret: 1, frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  { chord: 'E5', baseFret: 1, frets: [0, 2, 2, -1, -1, -1], fingers: [0, 1, 2, 0, 0, 0] },
  { chord: 'E6', baseFret: 1, frets: [0, 2, 2, 1, 2, 0], fingers: [0, 2, 3, 1, 4, 0] },
  { chord: 'Em6', baseFret: 1, frets: [0, 2, 2, 0, 2, 0], fingers: [0, 1, 2, 0, 3, 0] },
  { chord: 'Edim', baseFret: 1, frets: [-1, -1, 2, 3, 2, 3], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Edim7', baseFret: 1, frets: [0, 1, 2, 0, 2, 0], fingers: [0, 1, 2, 0, 3, 0] },
  { chord: 'Eaug', baseFret: 1, frets: [0, 3, 2, 1, 1, 0], fingers: [0, 4, 3, 1, 2, 0] },

  // Seventh & Major Seventh
  { chord: 'E7', baseFret: 1, frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  { chord: 'Emaj7', baseFret: 1, frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  { chord: 'Em7', baseFret: 1, frets: [0, 2, 2, 0, 3, 0], fingers: [0, 2, 3, 0, 4, 0] },
  { chord: 'Em7b5', baseFret: 1, frets: [0, 1, 2, 0, 3, 0], fingers: [0, 1, 2, 0, 4, 0] },

  // Suspended & Added
  { chord: 'Esus2', baseFret: 1, frets: [0, 2, 4, 4, 0, 0], fingers: [0, 1, 3, 4, 0, 0] },
  { chord: 'Esus4', baseFret: 1, frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0] },
  { chord: 'E7sus4', baseFret: 1, frets: [0, 2, 0, 2, 0, 0], fingers: [0, 1, 0, 2, 0, 0] },
  { chord: 'Eadd9', baseFret: 1, frets: [0, 2, 2, 1, 0, 2], fingers: [0, 2, 3, 1, 0, 4] },

  // Extended & Altered
  { chord: 'E9', baseFret: 1, frets: [0, 2, 0, 1, 0, 2], fingers: [0, 2, 0, 1, 0, 3] },
  { chord: 'Em9', baseFret: 1, frets: [0, 2, 0, 0, 0, 2], fingers: [0, 1, 0, 0, 0, 2] },
  { chord: 'Emaj9', baseFret: 1, frets: [0, 2, 1, 1, 0, 2], fingers: [0, 2, 1, 1, 0, 3] },

  // Slash chords
  { chord: 'E/G#', baseFret: 1, frets: [4, 2, 2, 1, 0, 0], fingers: [4, 2, 3, 1, 0, 0] },
  { chord: 'E/B', baseFret: 1, frets: [-1, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  { chord: 'E/D', baseFret: 1, frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  { chord: 'Em/G', baseFret: 1, frets: [3, 2, 2, 0, 0, 0], fingers: [3, 1, 2, 0, 0, 0] },
  { chord: 'Em/D', baseFret: 1, frets: [0, 2, 0, 0, 0, 0], fingers: [0, 1, 0, 0, 0, 0] },
  { chord: 'Em/B', baseFret: 1, frets: [-1, 2, 2, 0, 0, 0], fingers: [0, 1, 2, 0, 0, 0] },

  // ================= F ROOT =================
  // Triads & Basics
  { chord: 'F', baseFret: 1, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barres: [1] },
  { chord: 'Fm', baseFret: 1, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1], barres: [1] },
  { chord: 'F5', baseFret: 1, frets: [1, 3, 3, -1, -1, -1], fingers: [1, 3, 4, 0, 0, 0] },
  { chord: 'F6', baseFret: 1, frets: [1, -1, 0, 2, 1, 1], fingers: [1, 0, 0, 3, 2, 2] },
  { chord: 'Fdim', baseFret: 1, frets: [-1, -1, 3, 4, 3, 4], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Fdim7', baseFret: 1, frets: [-1, -1, 3, 4, 3, 4], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Faug', baseFret: 1, frets: [-1, -1, 3, 2, 2, 1], fingers: [0, 0, 4, 2, 3, 1] },

  // Seventh & Major Seventh
  { chord: 'F7', baseFret: 1, frets: [1, 3, 1, 2, 1, 1], fingers: [1, 3, 1, 2, 1, 1], barres: [1] },
  { chord: 'Fmaj7', baseFret: 1, frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  { chord: 'Fm7', baseFret: 1, frets: [1, 3, 1, 1, 1, 1], fingers: [1, 3, 1, 1, 1, 1], barres: [1] },
  { chord: 'Fm7b5', baseFret: 1, frets: [-1, -1, 3, 4, 4, 4], fingers: [0, 0, 1, 2, 3, 4] },

  // Suspended & Added
  { chord: 'Fsus2', baseFret: 1, frets: [-1, -1, 3, 0, 1, 1], fingers: [0, 0, 3, 0, 1, 1], barres: [1] },
  { chord: 'Fsus4', baseFret: 1, frets: [1, 3, 3, 3, 1, 1], fingers: [1, 2, 3, 4, 1, 1], barres: [1] },
  { chord: 'Fadd9', baseFret: 1, frets: [1, 3, 3, 2, 1, 3], fingers: [1, 2, 3, 2, 1, 4] },

  // Extended
  { chord: 'F9', baseFret: 1, frets: [-1, -1, 3, 2, 4, 3], fingers: [0, 0, 2, 1, 4, 3] },
  { chord: 'Fmaj9', baseFret: 1, frets: [-1, -1, 3, 0, 1, 0], fingers: [0, 0, 3, 0, 1, 0] },

  // Slash chords
  { chord: 'F/A', baseFret: 1, frets: [-1, 0, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1], barres: [1] },
  { chord: 'F/C', baseFret: 1, frets: [-1, 3, 3, 2, 1, 1], fingers: [0, 3, 4, 2, 1, 1], barres: [1] },
  { chord: 'F/G', baseFret: 1, frets: [3, 3, 3, 2, 1, 1], fingers: [3, 4, 4, 2, 1, 1] },

  // ================= G ROOT =================
  // Triads & Basics
  { chord: 'G', baseFret: 1, frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  { chord: 'Gm', baseFret: 3, frets: [3, 5, 5, 3, 3, 3], fingers: [1, 3, 4, 1, 1, 1], barres: [3] },
  { chord: 'G5', baseFret: 1, frets: [3, 5, 5, -1, -1, -1], fingers: [1, 3, 4, 0, 0, 0] },
  { chord: 'G6', baseFret: 1, frets: [3, 2, 0, 0, 0, 0], fingers: [2, 1, 0, 0, 0, 0] },
  { chord: 'Gm6', baseFret: 1, frets: [3, 5, 3, 3, 5, 3], fingers: [1, 3, 1, 1, 4, 1], barres: [3] },
  { chord: 'Gdim', baseFret: 1, frets: [-1, -1, 5, 6, 5, 6], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Gdim7', baseFret: 1, frets: [-1, -1, 5, 6, 5, 6], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Gaug', baseFret: 1, frets: [3, 2, 1, 0, 0, 3], fingers: [3, 2, 1, 0, 0, 4] },

  // Seventh & Major Seventh
  { chord: 'G7', baseFret: 1, frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  { chord: 'Gmaj7', baseFret: 1, frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] },
  { chord: 'Gm7', baseFret: 3, frets: [3, 5, 3, 3, 3, 3], fingers: [1, 3, 1, 1, 1, 1], barres: [3] },
  { chord: 'Gm7b5', baseFret: 3, frets: [3, 4, 3, 3, -1, -1], fingers: [1, 3, 1, 2, 0, 0] },

  // Suspended & Added
  { chord: 'Gsus2', baseFret: 1, frets: [3, 0, 0, 0, 3, 3], fingers: [1, 0, 0, 0, 3, 4] },
  { chord: 'Gsus4', baseFret: 1, frets: [3, 3, 0, 0, 1, 3], fingers: [3, 4, 0, 0, 1, 2] },
  { chord: 'G7sus4', baseFret: 1, frets: [3, 3, 0, 0, 1, 1], fingers: [3, 4, 0, 0, 1, 1], barres: [1] },
  { chord: 'Gadd9', baseFret: 1, frets: [3, 2, 0, 2, 0, 3], fingers: [2, 1, 0, 3, 0, 4] },

  // Extended
  { chord: 'G9', baseFret: 1, frets: [3, 0, 0, 2, 0, 1], fingers: [3, 0, 0, 2, 0, 1] },
  { chord: 'Gmaj9', baseFret: 1, frets: [3, 0, 0, 0, 0, 2], fingers: [2, 0, 0, 0, 0, 1] },

  // Slash chords
  { chord: 'G/B', baseFret: 1, frets: [-1, 2, 0, 0, 0, 3], fingers: [0, 1, 0, 0, 0, 2] },
  { chord: 'G/D', baseFret: 1, frets: [-1, -1, 0, 0, 0, 3], fingers: [0, 0, 0, 0, 0, 1] },
  { chord: 'G/F', baseFret: 1, frets: [1, 2, 0, 0, 0, 3], fingers: [1, 2, 0, 0, 0, 3] },
  { chord: 'G/F#', baseFret: 1, frets: [2, 2, 0, 0, 0, 3], fingers: [1, 2, 0, 0, 0, 3] },
  { chord: 'Gm/Bb', baseFret: 1, frets: [-1, 1, 0, 0, 3, 3], fingers: [0, 1, 0, 0, 3, 4] },
  { chord: 'Gm/D', baseFret: 1, frets: [-1, -1, 0, 3, 3, 3], fingers: [0, 0, 0, 1, 2, 3] },

  // ================= A ROOT =================
  // Triads & Basics
  { chord: 'A', baseFret: 1, frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  { chord: 'Am', baseFret: 1, frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  { chord: 'A5', baseFret: 1, frets: [-1, 0, 2, 2, -1, -1], fingers: [0, 0, 1, 2, 0, 0] },
  { chord: 'A6', baseFret: 1, frets: [-1, 0, 2, 2, 2, 2], fingers: [0, 0, 1, 1, 1, 1], barres: [2] },
  { chord: 'Am6', baseFret: 1, frets: [-1, 0, 2, 2, 1, 2], fingers: [0, 0, 2, 3, 1, 4] },
  { chord: 'Adim', baseFret: 1, frets: [-1, 0, 1, 2, 1, -1], fingers: [0, 0, 1, 3, 2, 0] },
  { chord: 'Adim7', baseFret: 1, frets: [-1, 0, 1, 2, 1, 2], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Aaug', baseFret: 1, frets: [-1, 0, 3, 2, 2, 1], fingers: [0, 0, 4, 2, 3, 1] },

  // Seventh & Major Seventh
  { chord: 'A7', baseFret: 1, frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  { chord: 'Amaj7', baseFret: 1, frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  { chord: 'Am7', baseFret: 1, frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  { chord: 'Am7b5', baseFret: 1, frets: [-1, 0, 1, 0, 1, -1], fingers: [0, 0, 1, 0, 2, 0] },

  // Suspended & Added
  { chord: 'Asus2', baseFret: 1, frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  { chord: 'Asus4', baseFret: 1, frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  { chord: 'A7sus4', baseFret: 1, frets: [-1, 0, 2, 0, 3, 0], fingers: [0, 0, 2, 0, 3, 0] },
  { chord: 'Aadd9', baseFret: 1, frets: [-1, 0, 2, 4, 2, 0], fingers: [0, 0, 1, 3, 2, 0] },

  // Extended
  { chord: 'A9', baseFret: 1, frets: [-1, 0, 2, 4, 2, 3], fingers: [0, 0, 1, 3, 2, 4] },
  { chord: 'Am9', baseFret: 1, frets: [-1, 0, 2, 4, 1, 0], fingers: [0, 0, 2, 4, 1, 0] },
  { chord: 'Amaj9', baseFret: 1, frets: [-1, 0, 2, 1, 0, 0], fingers: [0, 0, 2, 1, 0, 0] },

  // Slash chords
  { chord: 'A/C#', baseFret: 1, frets: [-1, 4, 2, 2, 2, 0], fingers: [0, 4, 1, 2, 3, 0] },
  { chord: 'A/E', baseFret: 1, frets: [0, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  { chord: 'A/G', baseFret: 1, frets: [3, 0, 2, 2, 2, 0], fingers: [3, 0, 1, 2, 3, 0] },
  { chord: 'Am/C', baseFret: 1, frets: [-1, 3, 2, 2, 1, 0], fingers: [0, 4, 2, 3, 1, 0] },
  { chord: 'Am/E', baseFret: 1, frets: [0, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  { chord: 'Am/G', baseFret: 1, frets: [3, 0, 2, 0, 1, 0], fingers: [3, 0, 2, 0, 1, 0] },
  { chord: 'Am7/G', baseFret: 1, frets: [3, 0, 2, 0, 1, 0], fingers: [3, 0, 2, 0, 1, 0] },

  // ================= B ROOT =================
  // Triads & Basics
  { chord: 'B', baseFret: 2, frets: [-1, 2, 4, 4, 4, 2], fingers: [0, 1, 2, 3, 4, 1], barres: [2] },
  { chord: 'Bm', baseFret: 2, frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], barres: [2] },
  { chord: 'B5', baseFret: 2, frets: [-1, 2, 4, 4, -1, -1], fingers: [0, 1, 3, 4, 0, 0] },
  { chord: 'B6', baseFret: 2, frets: [-1, 2, 4, 4, 4, 4], fingers: [0, 1, 3, 3, 3, 3], barres: [4] },
  { chord: 'Bdim', baseFret: 1, frets: [-1, 2, 3, 4, 3, -1], fingers: [0, 1, 2, 4, 3, 0] },
  { chord: 'Bdim7', baseFret: 1, frets: [-1, 2, 0, 1, 0, 1], fingers: [0, 2, 0, 1, 0, 1] },
  { chord: 'Baug', baseFret: 1, frets: [-1, 2, 1, 0, 0, 3], fingers: [0, 2, 1, 0, 0, 3] },

  // Seventh & Major Seventh
  { chord: 'B7', baseFret: 1, frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  { chord: 'Bmaj7', baseFret: 2, frets: [-1, 2, 4, 3, 4, 2], fingers: [0, 1, 3, 2, 4, 1], barres: [2] },
  { chord: 'Bm7', baseFret: 2, frets: [-1, 2, 4, 2, 3, 2], fingers: [0, 1, 3, 1, 2, 1], barres: [2] },
  { chord: 'Bm7b5', baseFret: 1, frets: [-1, 2, 3, 2, 3, -1], fingers: [0, 1, 3, 2, 4, 0] },

  // Suspended & Added
  { chord: 'Bsus2', baseFret: 2, frets: [-1, 2, 4, 4, 2, 2], fingers: [0, 1, 3, 4, 1, 1], barres: [2] },
  { chord: 'Bsus4', baseFret: 2, frets: [-1, 2, 4, 4, 5, 2], fingers: [0, 1, 2, 3, 4, 1], barres: [2] },
  { chord: 'B7sus4', baseFret: 2, frets: [-1, 2, 4, 2, 5, 2], fingers: [0, 1, 3, 1, 4, 1], barres: [2] },
  { chord: 'Badd9', baseFret: 2, frets: [-1, 2, 4, 4, 2, -1], fingers: [0, 1, 3, 4, 1, 0], barres: [2] },

  // Extended
  { chord: 'B9', baseFret: 1, frets: [-1, 2, 1, 2, 2, 2], fingers: [0, 2, 1, 3, 3, 3], barres: [2] },

  // Slash chords
  { chord: 'B/D#', baseFret: 1, frets: [-1, -1, 1, 4, 4, 2], fingers: [0, 0, 1, 3, 4, 2] },
  { chord: 'B/F#', baseFret: 2, frets: [2, 2, 4, 4, 4, 2], fingers: [1, 1, 2, 3, 4, 1], barres: [2] },
  { chord: 'B/A', baseFret: 1, frets: [-1, 2, 4, 2, 4, 2], fingers: [0, 1, 3, 1, 4, 1], barres: [2] },
  { chord: 'Bm/D', baseFret: 1, frets: [-1, -1, 0, 4, 3, 2], fingers: [0, 0, 0, 3, 2, 1] },
  { chord: 'Bm/A', baseFret: 2, frets: [-1, 0, 4, 4, 3, 2], fingers: [0, 0, 3, 4, 2, 1] },
]
