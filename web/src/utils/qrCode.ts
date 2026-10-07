/**
 * QR Code Generator adapter wrapping the mature, standards-compliant 'qrcode' engine.
 * Generates ISO/IEC 18004 compliant QR codes with ECC M, automatic version and mask selection,
 * and standard 4-module quiet zone.
 */

import QRCode from 'qrcode'

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrSvgOptions {
  size?: number
  margin?: number
  ecLevel?: QrErrorCorrectionLevel
  darkColor?: string
  lightColor?: string
}

/**
 * Returns a 2D boolean array representing the QR code matrix (true = dark module, false = light module).
 */
export function generateQrMatrix(text: string, ecLevel: QrErrorCorrectionLevel = 'M'): boolean[][] {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: ecLevel,
  })
  const size = qr.modules.size
  const matrix: boolean[][] = []

  for (let r = 0; r < size; r++) {
    const row: boolean[] = []
    for (let c = 0; c < size; c++) {
      row.push(Boolean(qr.modules.get(r, c)))
    }
    matrix.push(row)
  }

  return matrix
}

/**
 * Generates a clean SVG string representation of the QR code using crisp edges and standard quiet zone.
 */
export function generateQrSvg(
  text: string,
  options: QrSvgOptions = {}
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

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${size}" height="${size}" fill="${lightColor}" />${rects}</svg>`
}

/**
 * Generates an SVG Data URI for direct use in <img src="..." />.
 */
export function generateQrSvgDataUri(
  text: string,
  options?: QrSvgOptions
): string {
  const svg = generateQrSvg(text, options)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
