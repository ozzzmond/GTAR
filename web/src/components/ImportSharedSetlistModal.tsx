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
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-3 sm:p-4 shadow-2xl space-y-3 max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2 shrink-0">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                Shared Setlist
              </span>
              <h3 className="text-base font-bold text-slate-100 break-words min-w-0">
                {sharedSetlist.name}
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              {sharedSetlist.songs.length} {sharedSetlist.songs.length === 1 ? 'song' : 'songs'} in this snapshot
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shared setlist preview"
            className="w-11 h-11 sm:w-9 sm:h-9 shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-60 min-h-0 overflow-y-auto divide-y divide-slate-800/60 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1">
          {sharedSetlist.songs.map((song, idx) => (
            <div key={idx} className="flex flex-col gap-1 py-1.5 px-1 text-xs">
              <div className="min-w-0 sm:pr-2">
                <p className="font-semibold text-slate-200 break-words">{song.title}</p>
                <p className="text-slate-400 break-words">{song.artist || 'Unknown Artist'}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                {sharedSongMetadata(song).map(detail => (
                  <span key={detail} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-700">{detail}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {duplicate && (
          <div role="status" className="text-xs text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>This setlist is already in your library.</span>
            {onViewExisting && <button type="button" onClick={() => onViewExisting(duplicate)} className="min-h-11 sm:min-h-9 px-2 text-indigo-400 underline">View Existing</button>}
          </div>
        )}
        <div className="space-y-1 shrink-0">
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
            <button
              onClick={() => onImport(sharedSetlist)}
              className="w-full min-h-11 sm:min-h-9 py-1.5 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {duplicate ? 'Import Anyway' : 'Import to Songbook'}
            </button>
            <button
              onClick={() => onOpenStage(sharedSetlist, duplicate || undefined)}
              className="w-full min-h-11 sm:min-h-9 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center justify-center gap-2"
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
            className="w-full min-h-11 sm:min-h-9 py-1.5 text-center text-xs text-slate-400 hover:text-slate-300"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
