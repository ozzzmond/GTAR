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

export interface QrScannerClasses {
  container: string
  scan: string
  photo: string
  input: string
  videoWrap: string
  video: string
  cancel: string
  status: string
}

const SECONDARY_BTN = 'px-3 py-2 rounded-lg border border-app-border hover:border-app-action bg-app-base ui-secondary-text text-app-muted hover:text-app-heading text-xs font-mono font-bold transition-colors cursor-pointer'

export const SETLIST_QR_CLASSES: QrScannerClasses = {
  container: 'flex flex-wrap items-center gap-2',
  scan: 'px-3 py-2 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 font-mono text-xs font-bold transition-colors cursor-pointer',
  photo: SECONDARY_BTN,
  input: 'sr-only',
  videoWrap: 'w-full space-y-2',
  video: 'w-full max-h-[40dvh] rounded-lg bg-app-base',
  cancel: SECONDARY_BTN,
  status: 'w-full text-[11px] font-mono font-medium ui-muted-text text-app-muted',
}

export const TV_QR_CLASSES: QrScannerClasses = {
  container: 'cast2-scanner', scan: '', photo: 'cast2-photo', input: '',
  videoWrap: '', video: '', cancel: '', status: '',
}
