import React from 'react';
import type { SharedSetlistPayload } from '../utils/sharedSetlist';

interface ImportSharedSetlistModalProps {
  sharedSetlist: SharedSetlistPayload;
  onImport: (shared: SharedSetlistPayload) => void;
  onOpenStage: (shared: SharedSetlistPayload) => void;
  onClose: () => void;
}

export const ImportSharedSetlistModal: React.FC<ImportSharedSetlistModalProps> = ({
  sharedSetlist,
  onImport,
  onOpenStage,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                Shared Setlist
              </span>
              <h3 className="text-lg font-bold text-slate-100 truncate max-w-[220px]">
                {sharedSetlist.name}
              </h3>
            </div>
            <p className="text-xs text-slate-400">
              {sharedSetlist.songs.length} {sharedSetlist.songs.length === 1 ? 'song' : 'songs'} in this snapshot
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/60 rounded-lg border border-slate-800 bg-slate-950/50 p-2 space-y-1">
          {sharedSetlist.songs.map((song, idx) => (
            <div key={idx} className="flex items-center justify-between py-2 px-2 text-xs">
              <div className="min-w-0 pr-3">
                <p className="font-semibold text-slate-200 truncate">{song.title}</p>
                <p className="text-slate-400 truncate">{song.artist || 'Unknown Artist'}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {song.key && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-700">
                    Key {song.key}
                  </span>
                )}
                {song.capo && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-700">
                    Capo {song.capo}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onImport(sharedSetlist)}
              className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import to Songbook
            </button>
            <button
              onClick={() => onOpenStage(sharedSetlist)}
              className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.264 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View in Stage Mode
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2 text-center text-xs text-slate-400 hover:text-slate-300"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
