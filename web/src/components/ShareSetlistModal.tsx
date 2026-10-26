import { personalContentBlockReason } from '../utils/libraryOwner';
import React, { useState, useEffect } from 'react';
import { generateQrSvgDataUri } from '../utils/qrCode';
import { sanitizeSetlistForShare } from '../utils/sharedSetlist';
import type { SharedSetlistPayload } from '../utils/sharedSetlist';
import type { WebSetlist, ActiveSongState } from '../types/gtar';
import { getStoredSessionStatus } from '../utils/googleAuth';

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
  const [shareToken, setShareToken] = useState<string>('');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [qrDataUri, setQrDataUri] = useState<string>('');
  const [revoked, setRevoked] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Restore focus to triggering element when modal closes
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      previous?.focus?.();
    };
  }, []);

  // Safe Escape dismissal guarded against in-flight network operations
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading && !revoking) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, revoking, onClose]);

  useEffect(() => {
    let isCancelled = false;

    const createShare = async () => {
      setLoading(true);
      setError(null);

      try {
        const { session, isExpired } = getStoredSessionStatus();
        if (!session || isExpired) {
          throw new Error('Authentication required to share setlist');
        }
        const authToken = session.sessionToken || session.idToken || session.token;
        if (!authToken) {
          throw new Error('Authentication token missing');
        }
        const userStatus = session.access_status || session.user?.access_status || 'active';
        if (userStatus !== 'active') {
          throw new Error('Active account approval required to share setlist');
        }
        // #247: a share snapshot is made only from a library this account owns.
        const ownerBlock = personalContentBlockReason(session.user?.id);
        if (ownerBlock) throw new Error(ownerBlock);

        const payload: SharedSetlistPayload = sanitizeSetlistForShare(setlist, allSongs);

        // Request share token from backend with active session authorization
        const res = await fetch('/api/setlist/share', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 429) {
            throw new Error('Share creation limit reached — please wait a moment');
          }
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (isCancelled) return;

        setShareToken(data.token);
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

  const handleRevoke = async () => {
    if (!shareToken || revoking) return;
    if (
      !window.confirm(
        'Revoke this share link? Once revoked, anyone with the QR code or link will no longer be able to view or import this setlist.'
      )
    ) {
      return;
    }
    setRevoking(true);
    setRevokeError(null);
    try {
      const { session } = getStoredSessionStatus();
      const authToken = session?.sessionToken || session?.idToken || session?.token;
      if (!authToken) {
        throw new Error('Authentication required to revoke link');
      }
      const res = await fetch('/api/setlist/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ token: shareToken }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      setRevoked(true);
      setShareUrl('');
      setQrDataUri('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRevokeError(msg || 'Failed to revoke share link');
    } finally {
      setRevoking(false);
    }
  };

  const songCount = (setlist.songs || []).length;

  return (
    <div
      data-testid="share-setlist-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading && !revoking) {
          onClose();
        }
      }}
    >
      <div
        data-testid="share-setlist-modal-card"
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
            disabled={loading || revoking}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-40"
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

        {revoked && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm space-y-2 text-center animate-fade-in">
            <p className="font-semibold flex items-center justify-center gap-1.5">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Share Link Revoked
            </p>
            <p className="text-xs text-slate-400">
              This snapshot has been revoked and can no longer be accessed or imported by anyone.
            </p>
          </div>
        )}

        {!loading && !error && !revoked && qrDataUri && (
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

            {revokeError && (
              <p className="text-xs text-rose-400 text-center">{revokeError}</p>
            )}

            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="w-full py-1.5 px-3 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 text-xs font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span>{revoking ? 'Revoking Link...' : 'Revoke Share Link'}</span>
            </button>
          </div>
        )}

        <div className="pt-2 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            disabled={loading || revoking}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 disabled:opacity-40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
