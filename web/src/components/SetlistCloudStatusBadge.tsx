import React from 'react'
import { CloudCheck, UploadCloud, CloudOff, CloudDownload } from 'lucide-react'
import type { SetlistPublicationStatus } from '../utils/setlistPublicationStatus'
import { SETLIST_STATUS_DESCRIPTORS } from '../utils/setlistPublicationStatus'
import { SongStatusBadge } from './SongStatusBadge'
import type { WebSetlist } from '../types/gtar'

export interface SetlistCloudStatusBadgeProps {
  status: SetlistPublicationStatus
  setlistId: string | number
  setlist?: WebSetlist
  testId?: string
  className?: string
  align?: 'left' | 'right'
  zIndex?: number
  isFresh?: boolean
  publisherText?: string | null
}

export const SetlistCloudStatusBadge: React.FC<SetlistCloudStatusBadgeProps> = ({
  status,
  setlistId,
  setlist,
  testId,
  className = '',
  align = 'left',
  zIndex = 25,
  isFresh = true,
  publisherText,
}) => {
  if (status === 'NEVER_PUBLISHED') {
    return null
  }

  const descriptor = SETLIST_STATUS_DESCRIPTORS[status] || {
    title: 'Sharing status unavailable',
    ariaLabel: 'Sharing status unavailable',
  }
  const idAttr = testId || `setlist-cloud-status-${setlistId}`

  if (status === 'IMPORTED_FROM_CATALOG') {
    return (
      <SongStatusBadge
        testId={idAttr}
        dataStatus={status}
        ariaLabel={descriptor.ariaLabel}
        align={align}
        zIndex={zIndex}
        className={`p-0.5 rounded flex items-center justify-center shrink-0 text-sky-400 hover:text-sky-300 ${className}`}
        icon={<CloudDownload className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />}
        popoverContent={
          <div className="space-y-1">
            <div className="font-semibold text-app-heading flex items-center gap-1.5">
              <CloudDownload className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Imported from Shared Catalog</span>
            </div>
            <div className="text-[11px] text-app-text">
              {publisherText ? (
                <>
                  Publisher: <span className="font-medium text-app-heading">{publisherText}</span>
                </>
              ) : setlist?.catalogSource?.revision ? (
                <>
                  Source: <span className="font-mono text-app-heading">Revision {setlist.catalogSource.revision}</span>
                </>
              ) : (
                <span className="text-app-muted italic">Source unavailable</span>
              )}
            </div>
            <div className="text-[10px] text-app-muted font-medium">
              Independent personal copy
            </div>
          </div>
        }
      />
    )
  }

  if (status === 'CONFIRMED_PUBLISHED') {
    const label = isFresh ? 'Published to Shared Catalog (Server Confirmed)' : 'Published to Shared Catalog (Cached)'
    return (
      <SongStatusBadge
        testId={idAttr}
        dataStatus={status}
        ariaLabel={label}
        align={align}
        zIndex={zIndex}
        className={isFresh
          ? `p-0.5 rounded flex items-center justify-center shrink-0 text-emerald-400 hover:text-emerald-300 ${className}`
          : `p-0.5 rounded flex items-center justify-center shrink-0 text-amber-400 opacity-90 hover:opacity-100 ${className}`}
        icon={<CloudCheck className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />}
        popoverContent={
          <div className="space-y-1">
            <div className="font-semibold text-app-heading flex items-center gap-1.5">
              <CloudCheck className={isFresh ? 'w-3.5 h-3.5 text-emerald-400 shrink-0' : 'w-3.5 h-3.5 text-amber-400 shrink-0'} />
              <span>Published to Shared Catalog</span>
            </div>
            <div className="text-[11px] text-app-text">
              Publisher: <span className="font-medium text-app-heading">You</span>
            </div>
            <div className="text-[11px] flex items-center gap-1 text-app-text">
              Status: <span className={isFresh ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
                {isFresh ? 'Server Confirmed' : 'Cached/Offline'}
              </span>
            </div>
          </div>
        }
      />
    )
  }

  if (status === 'LOCAL_CHANGES_NOT_PUBLISHED') {
    return (
      <SongStatusBadge
        testId={idAttr}
        dataStatus={status}
        ariaLabel={descriptor.ariaLabel}
        align={align}
        zIndex={zIndex}
        className={`p-0.5 rounded flex items-center justify-center shrink-0 text-amber-400 hover:text-amber-300 ${className}`}
        icon={<UploadCloud className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />}
        popoverContent={
          <div className="space-y-1">
            <div className="font-semibold text-app-heading flex items-center gap-1.5">
              <UploadCloud className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Changes Not Shared</span>
            </div>
            <div className="text-[11px] text-app-text">
              Publisher: <span className="font-medium text-app-heading">You</span>
            </div>
            <div className="text-[11px] flex items-center gap-1 text-app-text">
              Status: <span className="font-medium text-amber-400">Local changes pending publish</span>
            </div>
          </div>
        }
      />
    )
  }

  return (
    <SongStatusBadge
      testId={idAttr}
      dataStatus={status}
      ariaLabel={descriptor.ariaLabel}
      align={align}
      zIndex={zIndex}
      className={`p-0.5 rounded flex items-center justify-center shrink-0 text-app-muted hover:text-app-text opacity-80 ${className}`}
      icon={<CloudOff className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />}
      popoverContent={
        <div className="space-y-1">
          <div className="font-semibold text-app-heading flex items-center gap-1.5">
            <CloudOff className="w-3.5 h-3.5 text-app-muted shrink-0" />
            <span>Sharing Status Unavailable</span>
          </div>
          <div className="text-[11px] text-app-muted">
            Unable to verify shared catalog status while offline or unverified
          </div>
        </div>
      }
    />
  )
}
