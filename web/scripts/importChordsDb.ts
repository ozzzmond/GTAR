/**
 * Deterministic Normalization and Import Pipeline for External Chord Datasets
 * 
 * Source: chords-db (tombatossals/chords-db, fork: chordbook/chords-db)
 * License: MIT License
 * Provenance: Open-source community guitar chord database (standard 6-string guitar EADGBE)
 * 
 * Output: Normalized bundled TypeScript module containing validated imported voicings.
 */

import fs from 'node:fs'
import path from 'node:path'

const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.resolve(process.cwd(), 'scripts')

interface RawPosition {
  frets: number[]
  fingers?: number[]
  barres?: number[]
  baseFret: number
  capo?: boolean
  midi?: number[]
}

interface RawChordItem {
  key: string
  suffix: string
  positions: RawPosition[]
}

interface RawData {
  main: {
    strings: number
    fretsOnChord: number
    name: string
    numberOfChords: number
  }
  tunings: {
    standard: string[]
  }
  chords: Record<string, RawChordItem[]>
}

export interface ImportedChordVoicing {
  chord: string
  baseFret: number
  frets: number[]
  fingers?: number[]
  barres?: number[]
}

const ROOT_NAME_MAP: Record<string, string> = {
  C: 'C',
  Csharp: 'C#',
  D: 'D',
  Eb: 'Eb',
  E: 'E',
  F: 'F',
  Fsharp: 'F#',
  G: 'G',
  Ab: 'Ab',
  A: 'A',
  Bb: 'Bb',
  B: 'B',
}

export function importChordsDbData(rawData: RawData): ImportedChordVoicing[] {
  const result: ImportedChordVoicing[] = []
  const seenVoicingKeys = new Set<string>()

  for (const [keyName, chordItems] of Object.entries(rawData.chords)) {
    const canonicalRoot = ROOT_NAME_MAP[keyName] || keyName

    for (const item of chordItems) {
      let suffix = item.suffix
      if (suffix === 'major') suffix = ''
      if (suffix === 'minor') suffix = 'm'

      const chordName = `${canonicalRoot}${suffix}`

      for (const pos of item.positions) {
        // Validation rules:
        // 1. Must be 6 strings
        if (!Array.isArray(pos.frets) || pos.frets.length !== 6) continue

        // 2. Fret values must be integers between -1 and 24
        const validFrets = pos.frets.every(
          (f) => typeof f === 'number' && Number.isInteger(f) && f >= -1 && f <= 24
        )
        if (!validFrets) continue

        // 3. baseFret must be integer >= 1 and <= 24
        if (
          typeof pos.baseFret !== 'number' ||
          !Number.isInteger(pos.baseFret) ||
          pos.baseFret < 1 ||
          pos.baseFret > 24
        ) {
          continue
        }

        // 4. Validate fingers if present
        let fingers: number[] | undefined
        if (Array.isArray(pos.fingers) && pos.fingers.length === 6) {
          if (pos.fingers.every((f) => typeof f === 'number' && f >= 0 && f <= 4)) {
            fingers = pos.fingers
          }
        }

        // 5. Validate barres if present
        let barres: number[] | undefined
        if (Array.isArray(pos.barres) && pos.barres.length > 0) {
          if (pos.barres.every((b) => typeof b === 'number' && b >= 1 && b <= 24)) {
            barres = pos.barres
          }
        }

        // 6. Deduplicate identical physical voicings for same chord
        const voicingKey = `${chordName}|${pos.baseFret}|${pos.frets.join(',')}`
        if (seenVoicingKeys.has(voicingKey)) continue
        seenVoicingKeys.add(voicingKey)

        result.push({
          chord: chordName,
          baseFret: pos.baseFret,
          frets: pos.frets,
          ...(fingers ? { fingers } : {}),
          ...(barres ? { barres } : {}),
        })
      }
    }
  }

  return result
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith('importChordsDb.ts')) {
  const rawPath = path.resolve(currentDir, '../src/data/chordsDbRaw.json')
  const outPath = path.resolve(currentDir, '../src/data/importedChords.ts')

  if (!fs.existsSync(rawPath)) {
    console.error(`Source file not found at ${rawPath}`)
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')) as RawData
  const voicings = importChordsDbData(raw)

  const banner = `/**
 * LICENSED IMPORTED GUITAR CHORD VOICINGS
 * 
 * Source: chords-db (https://github.com/tombatossals/chords-db, fork: chordbook/chords-db)
 * License: MIT License (https://opensource.org/licenses/MIT)
 * Provenance: Open source community guitar chord database.
 * 
 * Generated deterministically via scripts/importChordsDb.ts.
 * Offline PWA bundled runtime data. Do not edit directly.
 */

import type { ChordVoicing } from '../utils/chordDictionary'

export const IMPORTED_CHORD_VOICINGS: ChordVoicing[] = ${JSON.stringify(voicings, null, 2)}
`

  fs.writeFileSync(outPath, banner, 'utf8')
  console.log(`Successfully generated ${outPath} with ${voicings.length} voicings.`)
}
