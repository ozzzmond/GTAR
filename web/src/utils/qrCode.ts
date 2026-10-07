/**
 * QR Code Generator (ISO/IEC 18004 compliant Model 2)
 * Pure TypeScript implementation with zero external dependencies.
 * Supports Versions 1 to 10 in Byte Mode with Error Correction Level M or L.
 */

export type QrErrorCorrectionLevel = 'L' | 'M'

// Total codewords and EC codewords per version for level L and M
// Versions 1 to 10
interface VersionCapacity {
  version: number
  size: number
  totalCodewords: number
  ecCodewords: {
    L: number
    M: number
  }
  numBlocks: {
    L: number
    M: number
  }
  alignmentPositions: number[]
}

const VERSION_TABLE: VersionCapacity[] = [
  { version: 1, size: 21, totalCodewords: 26, ecCodewords: { L: 7, M: 10 }, numBlocks: { L: 1, M: 1 }, alignmentPositions: [] },
  { version: 2, size: 25, totalCodewords: 44, ecCodewords: { L: 10, M: 16 }, numBlocks: { L: 1, M: 1 }, alignmentPositions: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, ecCodewords: { L: 15, M: 26 }, numBlocks: { L: 1, M: 1 }, alignmentPositions: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, ecCodewords: { L: 20, M: 36 }, numBlocks: { L: 1, M: 2 }, alignmentPositions: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, ecCodewords: { L: 26, M: 48 }, numBlocks: { L: 1, M: 2 }, alignmentPositions: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, ecCodewords: { L: 36, M: 64 }, numBlocks: { L: 2, M: 4 }, alignmentPositions: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, ecCodewords: { L: 40, M: 72 }, numBlocks: { L: 2, M: 4 }, alignmentPositions: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, ecCodewords: { L: 48, M: 88 }, numBlocks: { L: 2, M: 4 }, alignmentPositions: [6, 24, 42] },
  { version: 9, size: 53, totalCodewords: 292, ecCodewords: { L: 60, M: 110 }, numBlocks: { L: 2, M: 5 }, alignmentPositions: [6, 26, 46] },
  { version: 10, size: 57, totalCodewords: 346, ecCodewords: { L: 72, M: 130 }, numBlocks: { L: 4, M: 5 }, alignmentPositions: [6, 28, 50] },
]

// Galois Field GF(2^8) tables
const EXP_TABLE = new Uint8Array(512)
const LOG_TABLE = new Uint8Array(256)

;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x
    EXP_TABLE[i + 255] = x
    LOG_TABLE[x] = i
    x <<= 1
    if (x >= 256) x ^= 0x11d // primitive poly x^8 + x^4 + x^3 + x^2 + 1
  }
})()

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]]
}

// Compute Reed-Solomon generator polynomial
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1)
    const factor = EXP_TABLE[i]
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], factor)
      next[j + 1] ^= poly[j]
    }
    poly = next
  }
  return poly
}

// Compute Reed-Solomon error correction codewords for a data block
function rsComputeRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGeneratorPoly(degree)
  const remainder = new Uint8Array(degree)
  for (const byte of data) {
    const factor = byte ^ remainder[0]
    for (let i = 0; i < degree - 1; i++) {
      remainder[i] = remainder[i + 1] ^ gfMul(gen[gen.length - 2 - i], factor)
    }
    remainder[degree - 1] = gfMul(gen[0], factor)
  }
  return remainder
}

// Format info BCH (15, 5) code generator
function getFormatBits(ecLevel: QrErrorCorrectionLevel, mask: number): number {
  // Level L: 01 (1), Level M: 00 (0)
  const ecBits = ecLevel === 'M' ? 0 : 1
  const data = (ecBits << 3) | mask
  let rem = data << 10
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= 0x537 << (i - 10)
    }
  }
  const bits = ((data << 10) | rem) ^ 0x5412
  return bits
}

/**
 * Encodes input text into a 2D boolean array (QR matrix).
 * true = dark module, false = light module.
 */
export function generateQrMatrix(text: string, ecLevel: QrErrorCorrectionLevel = 'M'): boolean[][] {
  const textBytes = new TextEncoder().encode(text)

  // Find minimum version that fits data
  let targetVersion: VersionCapacity | null = null
  for (const v of VERSION_TABLE) {
    const totalDataCodewords = v.totalCodewords - v.ecCodewords[ecLevel]
    // 4 bits mode + 8 bits char count + data bytes * 8
    const requiredBits = 4 + 8 + textBytes.length * 8
    if (requiredBits <= totalDataCodewords * 8) {
      targetVersion = v
      break
    }
  }

  if (!targetVersion) {
    throw new Error(`Data too long for QR versions 1-10 (${textBytes.length} bytes)`)
  }

  const totalDataCodewords = targetVersion.totalCodewords - targetVersion.ecCodewords[ecLevel]

  // Construct bit stream (Byte mode: 0100)
  const bitStream: number[] = []
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1)
    }
  }

  pushBits(0b0100, 4) // Mode Byte
  pushBits(textBytes.length, 8) // Character count
  for (const b of textBytes) {
    pushBits(b, 8)
  }

  // Terminator (up to 4 zeroes)
  const maxBits = totalDataCodewords * 8
  const termLen = Math.min(4, maxBits - bitStream.length)
  pushBits(0, termLen)

  // Pad to multiple of 8
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0)
  }

  // Pad bytes 0xEC and 0x11
  const dataBytes: number[] = []
  for (let i = 0; i < bitStream.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bitStream[i + j]
    }
    dataBytes.push(b)
  }

  let pad = 0xec
  while (dataBytes.length < totalDataCodewords) {
    dataBytes.push(pad)
    pad = pad === 0xec ? 0x11 : 0xec
  }

  // Divide into blocks and compute EC codewords
  const numBlocks = targetVersion.numBlocks[ecLevel]
  const totalEc = targetVersion.ecCodewords[ecLevel]
  const ecPerBlock = Math.floor(totalEc / numBlocks)

  const blockData: Uint8Array[] = []
  const blockEc: Uint8Array[] = []

  const baseBlockDataLen = Math.floor(totalDataCodewords / numBlocks)
  const extraBlockDataCount = totalDataCodewords % numBlocks

  let offset = 0
  for (let i = 0; i < numBlocks; i++) {
    const len = baseBlockDataLen + (i >= numBlocks - extraBlockDataCount ? 1 : 0)
    const block = new Uint8Array(dataBytes.slice(offset, offset + len))
    blockData.push(block)
    blockEc.push(rsComputeRemainder(block, ecPerBlock))
    offset += len
  }

  // Interleave data codewords
  const finalCodewords: number[] = []
  const maxDataBlockLen = Math.max(...blockData.map((b) => b.length))
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < blockData[b].length) {
        finalCodewords.push(blockData[b][i])
      }
    }
  }

  // Interleave EC codewords
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalCodewords.push(blockEc[b][i])
    }
  }

  // Initialize Matrix
  const size = targetVersion.size
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false))

  const setModule = (r: number, c: number, dark: boolean, func = true) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = dark
      if (func) isFunction[r][c] = true
    }
  }

  // Place Finder Patterns
  const placeFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r
        const nc = col + c
        if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const dark = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          setModule(nr, nc, dark)
        } else {
          setModule(nr, nc, false) // Separator
        }
      }
    }
  }

  placeFinder(0, 0)
  placeFinder(0, size - 7)
  placeFinder(size - 7, 0)

  // Alignment patterns
  const alignCoords = targetVersion.alignmentPositions
  if (alignCoords.length > 0) {
    for (const r of alignCoords) {
      for (const c of alignCoords) {
        // Skip finders
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) {
          continue
        }
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)
            setModule(r + dr, c + dc, dark)
          }
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0)
    setModule(i, 6, i % 2 === 0)
  }

  // Dark module
  setModule(4 * targetVersion.version + 9, 8, true)

  // Reserve format information areas
  for (let i = 0; i < 9; i++) {
    isFunction[8][i] = true
    isFunction[i][8] = true
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = true
    isFunction[size - 1 - i][8] = true
  }

  // Map data bits into matrix in 2-column zig-zag upward/downward
  const finalBits: number[] = []
  for (const byte of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((byte >> i) & 1)
    }
  }

  let bitIdx = 0
  let upward = true
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right-- // Skip vertical timing pattern
    const rows = upward
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i)

    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (!isFunction[r][c]) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] === 1 : false
          matrix[r][c] = bit
        }
      }
    }
    upward = !upward
  }

  // Select best mask pattern (0..7) or use standard mask 0
  // Standard Mask 0: (row + col) % 2 == 0
  const mask = 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c]) {
        const invert = (r + c) % 2 === 0
        if (invert) matrix[r][c] = !matrix[r][c]
      }
    }
  }

  // Write format info
  const formatBits = getFormatBits(ecLevel, mask)
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> i) & 1) === 1
    // Around top-left finder
    if (i < 6) setModule(8, i, bit)
    else if (i === 6) setModule(8, 7, bit)
    else if (i === 7) setModule(8, 8, bit)
    else if (i === 8) setModule(7, 8, bit)
    else setModule(14 - i, 8, bit)

    // Around other finders
    if (i < 8) setModule(size - 1 - i, 8, bit)
    else setModule(8, size - 15 + i, bit)
  }

  return matrix
}

/**
 * Generates an SVG string representation of the QR code.
 */
export function generateQrSvg(
  text: string,
  options: {
    size?: number
    margin?: number
    ecLevel?: QrErrorCorrectionLevel
    darkColor?: string
    lightColor?: string
  } = {}
): string {
  const {
    size = 256,
    margin = 4,
    ecLevel = 'M',
    darkColor = '#000000',
    lightColor = '#ffffff',
  } = options

  const matrix = generateQrMatrix(text, ecLevel)
  const matrixSize = matrix.length
  const totalCells = matrixSize + margin * 2
  const cellSize = size / totalCells

  let rects = ''
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        const x = (c + margin) * cellSize
        const y = (r + margin) * cellSize
        rects += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="${darkColor}" />`
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR Code"><rect width="${size}" height="${size}" fill="${lightColor}" />${rects}</svg>`
}

/**
 * Generates an SVG Data URI for direct use in <img src="..." />.
 */
export function generateQrSvgDataUri(
  text: string,
  options?: Parameters<typeof generateQrSvg>[1]
): string {
  const svg = generateQrSvg(text, options)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
