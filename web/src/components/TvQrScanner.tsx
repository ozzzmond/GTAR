import React from 'react'
import { parseTvQr } from '../utils/stageCast2Qr'
import { QrScanner } from './QrScanner'
import type { QrScannerCopy } from './qrScannerCopy'

void React

const TV_COPY: QrScannerCopy = {
  scan: 'Scan TV QR',
  photo: 'Choose QR photo',
  cameraLabel: 'TV QR camera preview',
  cancel: 'Cancel scan',
  prompt: 'Allow camera access, then point at the TV QR.',
  noCamera: 'Camera unavailable. Choose a QR photo or enter the TV reference and PIN manually.',
  denied: 'Camera permission denied. Choose a QR photo or enter the TV reference and PIN manually.',
  cameraFailed: 'Camera unavailable. Use a QR photo or manual entry.',
  cancelled: 'Scan cancelled. Manual entry is available.',
  badImage: 'Choose an image smaller than 20 MB, or enter the TV reference manually.',
  noPhotoSupport: 'Photo scanning unavailable. Enter the TV reference and PIN manually.',
  noQrInPhoto: 'No readable QR found. Choose a clearer photo or enter the TV reference manually.',
  unreadableImage: 'Image could not be read. Choose another photo or use manual entry.',
  photoFailed: 'Photo scan failed. Use manual entry.',
}

export function TvQrScanner({ onReference }: { onReference: (ref: string) => void }) {
  return <QrScanner
    copy={TV_COPY}
    containerClassName="cast2-scanner"
    photoClassName="cast2-photo"
    inputClassName=""
    onText={value => {
      const ref = parseTvQr(value, window.location.origin)
      if (!ref) throw Error('This is not a TV QR from this GTAR site. Try again or enter the TV reference manually.')
      onReference(ref)
      return 'TV reference scanned. Enter the six-digit PIN shown on the TV to connect.'
    }}
  />
}
