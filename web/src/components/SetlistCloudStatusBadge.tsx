import React from 'react'
import { CloudCheck, UploadCloud, CloudOff } from 'lucide-react'
import type { SetlistPublicationStatus } from '../utils/setlistPublicationStatus'
import { SETLIST_STATUS_DESCRIPTORS } from '../utils/setlistPublicationStatus'

export interface SetlistCloudStatusBadgeProps {
  status: SetlistPublicationStatus
  setlistId: string | number
  testId?: string
  className?: string
}

export const SetlistCloudStatusBadge: React.FC<SetlistCloudStatusBadgeProps> = ({
  status,
  setlistId,
  testId,
  className = '',
}) => {
  if (status === 'NEVER_PUBLISHED') {
    return null
  }

  const descriptor = SETLIST_STATUS_DESCRIPTORS[status]
  const idAttr = testId || `setlist-cloud-status-${setlistId}`

  if (status === 'CONFIRMED_PUBLISHED') {
    return (
      <span
        data-testid={idAttr}
        data-status={status}
        title={descriptor.title}
        aria-label={descriptor.ariaLabel}
        role="status"
        className={`inline-flex items-center justify-center shrink-0 p-0.5 rounded text-emerald-400 ${className}`}
      >
        <CloudCheck className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
        <span className="sr-only">{descriptor.ariaLabel}</span>
      </span>
    )
  }

  if (status === 'LOCAL_CHANGES_NOT_PUBLISHED') {
    return (
      <span
        data-testid={idAttr}
        data-status={status}
        title={descriptor.title}
        aria-label={descriptor.ariaLabel}
        role="status"
        className={`inline-flex items-center justify-center shrink-0 p-0.5 rounded text-amber-400 ${className}`}
      >
        <UploadCloud className="w-3.5 h-3.5 stroke-[2.5]" aria-hidden="true" />
        <span className="sr-only">{descriptor.ariaLabel}</span>
      </span>
    )
  }

  return (
    <span
      data-testid={idAttr}
      data-status={status}
      title={descriptor.title}
      aria-label={descriptor.ariaLabel}
      role="status"
      className={`inline-flex items-center justify-center shrink-0 p-0.5 rounded text-app-muted opacity-80 ${className}`}
    >
      <CloudOff className="w-3.5 h-3.5 stroke-[2]" aria-hidden="true" />
      <span className="sr-only">{descriptor.ariaLabel}</span>
    </span>
  )
}
