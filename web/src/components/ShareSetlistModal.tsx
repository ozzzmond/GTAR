import React, { useState, useEffect } from 'react';
import { generateQrSvgDataUri } from '../utils/qrCode';
import { sanitizeSetlistForShare } from '../utils/sharedSetlist';
import type { SharedSetlistPayload } from '../utils/sharedSetlist';
import type { WebSetlist, ActiveSongState } from '../types/gtar';

interface ShareSetlistModalProps {
  setlist: WebSetlist;
  allSongs: ActiveSongState[];
  onClose: () => void;
}

export const ShareSetlistModal: React.FC<ShareSetlistModalProps> = ({
  setlist,
  allSongs,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [qrDataUri, setQrDataUri] = useState<string>('');

  useEffect(() => {
    let isCancelled = false;

    const createShare = async () => {
      setLoading(true);
      setError(null);

      try {
        const payload: SharedSetlistPayload = sanitizeSetlistForShare(setlist, allSongs);

        // Request share token from backend
        const res = await fetch('/api/setlist/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (isCancelled) return;

        const origin = window.location.origin;
        const generatedUrl = `${origin}?share=${data.token}`;
        setShareUrl(generatedUrl);

        // Generate SVG QR Code
        const svgUri = generateQrSvgDataUri(generatedUrl);
        setQrDataUri(svgUri);
      } catch (err: unknown) {
        if (!isCancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg || 'Failed to generate share link');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    createShare();

    return () => {
      isCancelled = true;
    };
  }, [setlist, allSongs]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl || !navigator.share) return;
    try {
      const songCount = (setlist.songs || []).length;
      await navigator.share({
        title: `GTAR Setlist: ${setlist.name}`,
        text: `Access the setlist "${setlist.name}" (${songCount} songs) in GTAR.`,
        url: shareUrl,
      });
    } catch {
      // User cancelled or share failed
    }
  };

  const songCount = (setlist.songs || []).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Share Setlist
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 font-medium truncate max-w-[240px]">
              {setlist.name} ({songCount} {songCount === 1 ? 'song' : 'songs'})
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

        {loading && (
          <div className="py-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Creating snapshot & QR code...</p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm space-y-2">
            <p className="font-semibold">Unable to generate share link</p>
            <p className="text-xs opacity-90">{error}</p>
          </div>
        )}

        {!loading && !error && qrDataUri && (
          <div className="flex flex-col items-center space-y-4">
            <div className="p-3 bg-white rounded-xl shadow-inner border border-slate-200">
              <img
                src={qrDataUri}
                alt="QR Code for Setlist Sharing"
                className="w-52 h-52 block object-contain"
              />
            </div>
            <p className="text-xs text-slate-400 text-center px-2">
              Scan with mobile camera to import this setlist directly into GTAR.
            </p>

            <div className="w-full flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-300 font-mono truncate focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition flex items-center gap-1.5"
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2" />
                    </svg>
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button
                onClick={handleNativeShare}
                className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow transition flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Link
              </button>
            )}
          </div>
        )}

        <div className="pt-2 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
