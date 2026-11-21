import React, { useMemo } from 'react';
import type { ActiveSongState, WebSetlist } from '../types/gtar';
import { findSharedSetlistDuplicate, sharedSongMetadata } from '../utils/sharedSetlistLibrary';
import type { SharedSetlistPayload } from '../utils/sharedSetlist';

interface ImportSharedSetlistModalProps {
  sharedSetlist: SharedSetlistPayload;
  onImport: (shared: SharedSetlistPayload) => void;
  onOpenStage: (shared: SharedSetlistPayload, existing?: WebSetlist) => void;
  localSetlists?: WebSetlist[];
  localSongs?: ActiveSongState[];
  onViewExisting?: (existing: WebSetlist) => void;
  onClose: () => void;
}

export const ImportSharedSetlistModal: React.FC<ImportSharedSetlistModalProps> = ({
  sharedSetlist,
  onImport,
  onOpenStage,
  onClose,
  localSetlists,
  localSongs,
  onViewExisting,
}) => {
  const duplicate = useMemo(() => findSharedSetlistDuplicate(sharedSetlist, localSetlists || [], localSongs || []), [sharedSetlist, localSetlists, localSongs]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface ui-primary-text text-app-heading p-5 shadow-2xl space-y-3 max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-app-border/60 pb-2 shrink-0">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-app-action/20 text-app-action border border-app-action/30">
                Shared Setlist
              </span>
              <h3 className="ui-section-text font-bold text-sm ui-primary-text text-app-heading break-words min-w-0">
                {sharedSetlist.name}
              </h3>
            </div>
            <p className="text-[11px] ui-muted-text text-app-muted">
              {sharedSetlist.songs.length} {sharedSetlist.songs.length === 1 ? 'song' : 'songs'} in this snapshot
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shared setlist preview"
            className="w-11 h-11 sm:w-9 sm:h-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-60 min-h-0 overflow-y-auto divide-y divide-app-border/60 rounded-lg border border-app-border bg-app-base px-2 py-1">
          {sharedSetlist.songs.map((song, idx) => (
            <div key={idx} className="flex flex-col gap-1 py-1.5 px-1 text-xs">
              <div className="min-w-0 sm:pr-2">
                <p className="font-semibold ui-primary-text text-app-heading break-words">{song.title}</p>
                <p className="ui-muted-text text-app-muted break-words">{song.artist || 'Unknown Artist'}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                {sharedSongMetadata(song).map(detail => (
                  <span key={detail} className="px-1.5 py-0.5 rounded bg-app-surface text-[10px] font-mono ui-secondary-text text-app-muted border border-app-border">{detail}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {duplicate && (
          <div role="status" className="text-xs ui-secondary-text text-app-muted flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>This setlist is already in your library.</span>
            {onViewExisting && <button type="button" onClick={() => onViewExisting(duplicate)} className="min-h-11 sm:min-h-9 px-2 text-app-action underline">View Existing</button>}
          </div>
        )}
        <div className="space-y-1 shrink-0">
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
            <button
              onClick={() => onImport(sharedSetlist)}
              className="w-full min-h-11 sm:min-h-9 py-1.5 px-2 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 text-xs font-mono font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {duplicate ? 'Import Anyway' : 'Import to Songbook'}
            </button>
            <button
              onClick={() => onOpenStage(sharedSetlist, duplicate || undefined)}
              className="w-full min-h-11 sm:min-h-9 py-1.5 px-2 rounded-lg bg-app-base border border-app-border hover:border-app-action ui-secondary-text text-app-muted hover:text-app-heading text-xs font-mono font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.264 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View in Stage Mode
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full min-h-11 sm:min-h-9 py-1.5 text-center text-xs font-mono font-bold ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
