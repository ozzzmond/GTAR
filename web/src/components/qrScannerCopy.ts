export interface QrScannerCopy {
  scan: string
  photo: string
  cameraLabel: string
  cancel: string
  prompt: string
  noCamera: string
  denied: string
  cameraFailed: string
  cancelled: string
  badImage: string
  noPhotoSupport: string
  noQrInPhoto: string
  unreadableImage: string
  photoFailed: string
}

export const SETLIST_QR_COPY: QrScannerCopy = {
  scan: 'Scan QR Code',
  photo: 'Choose QR image',
  cameraLabel: 'Setlist QR camera preview',
  cancel: 'Cancel scan',
  prompt: 'Allow camera access, then point at the GTAR setlist QR.',
  noCamera: 'Camera unavailable on this browser. Choose a QR image or paste the share link.',
  denied: 'Camera permission denied. Choose a QR image or paste the share link.',
  cameraFailed: 'Camera unavailable. Choose a QR image or paste the share link.',
  cancelled: 'Scan cancelled. You can scan again or paste the share link.',
  badImage: 'Choose an image smaller than 20 MB, or paste the share link.',
  noPhotoSupport: 'Image scanning unavailable. Paste the share link instead.',
  noQrInPhoto: 'No readable QR found. Choose a clearer image or paste the share link.',
  unreadableImage: 'Image could not be read. Choose another image or paste the share link.',
  photoFailed: 'Image scan failed. Paste the share link instead.',
}
