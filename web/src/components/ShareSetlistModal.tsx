import React, { useState, useEffect } from 'react';
import { generateQrSvgDataUri } from '../utils/qrCode';
import { exportSingleSetlistJson } from '../utils/jsonBackup';
import { sanitizeSetlistForShare, validateSharedSetlistPayload, MAX_SHARE_SONGS_COUNT, MAX_SHARE_RAW_CONTENT_LENGTH } from '../utils/sharedSetlist';
import type { SharedSetlistPayload } from '../utils/sharedSetlist';
import type { WebSetlist, ActiveSongState } from '../types/gtar';
import { resolveSetlistSong } from '../utils/setlistSongs';
import { Share2 } from 'lucide-react';

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
  const [revokeSecret, setRevokeSecret] = useState('');
  const [copyError, setCopyError] = useState('');
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
        if (setlist.songs.length > MAX_SHARE_SONGS_COUNT) throw new Error(`Sharing supports up to ${MAX_SHARE_SONGS_COUNT} songs. Use Export JSON for larger setlists.`);
        if (setlist.songs.some(ref => !resolveSetlistSong(ref, allSongs))) throw new Error('Some songs are missing or in Trash. Restore them before sharing, or use Export JSON.');
        const payload: SharedSetlistPayload = sanitizeSetlistForShare(setlist, allSongs);

        const validation = validateSharedSetlistPayload(payload);
        if (!validation.isValid) throw new Error(validation.error);
        if (payload.songs.some(song => song.rawContent.length > MAX_SHARE_RAW_CONTENT_LENGTH)) throw new Error('A song exceeds the sharing size limit. Use Export JSON.');
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 1024 * 1024) throw new Error('Setlist exceeds the 1 MB sharing limit. Use Export JSON.');

        // Publish only this explicit, self-contained snapshot; no cloud library access.
        const res = await fetch('/api/setlist/share', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          if (res.status === 429) {
            throw new Error('Share creation limit reached — please wait a moment');
          }
          if (res.status === 503) throw new Error('Sharing service unavailable. Try again later or use Export JSON.');
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (isCancelled) return;

        if (!/^[a-f0-9]{64}$/.test(data.token) || !/^[a-f0-9]{64}$/.test(data.revokeSecret)) {
          throw new Error('Invalid sharing service response. Use Export JSON or try again later.');
        }
        setShareToken(data.token);
        setRevokeSecret(data.revokeSecret);
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
    setCopyError('');
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError('Copy unavailable. Select and copy the link above.');
    }
  };

  const handleRevoke = async () => {
    if (!revokeSecret || !shareToken || revoking) return;
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
      const res = await fetch('/api/setlist/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: shareToken, revokeSecret }),
        signal: AbortSignal.timeout(15000),
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
        className="w-full max-w-md rounded-2xl border border-app-border bg-app-surface ui-primary-text text-app-heading p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-app-border/60 pb-3">
          <div>
            <h3 className="ui-section-text font-bold text-sm flex items-center gap-2 ui-primary-text text-app-heading">
              <Share2 className="ui-action-text w-4 h-4 text-app-action" aria-hidden="true" />
              Share Setlist
            </h3>
            <p className="text-[11px] ui-muted-text text-app-muted mt-0.5 truncate max-w-[260px]">
              {setlist.name} ({songCount} {songCount === 1 ? 'song' : 'songs'})
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading || revoking}
            aria-label="Close"
            className="p-1 rounded-lg hover:bg-app-base ui-secondary-text text-app-muted hover:text-app-heading cursor-pointer disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading && (
          <div className="py-12 flex flex-col items-center justify-center space-y-3">
            <div className="w-8 h-8 border-2 border-app-action border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-mono ui-muted-text text-app-muted">Creating snapshot & QR code...</p>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-status-error/10 border border-status-error/30 text-status-error text-xs font-mono space-y-1">
            <p className="font-semibold">Unable to generate share link</p>
            <p className="text-xs opacity-90">{error}</p>
          </div>
        )}

        {revoked && (
          <div className="p-3 rounded-lg bg-status-warning/10 border border-status-warning/30 text-status-warning text-xs font-mono space-y-1 text-center animate-fade-in">
            <p className="font-semibold flex items-center justify-center gap-1.5">
              <svg className="w-4 h-4 text-status-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Share Link Revoked
            </p>
            <p className="text-[11px] ui-muted-text text-app-muted">
              This snapshot has been revoked and can no longer be accessed or imported by anyone.
            </p>
          </div>
        )}

        {!loading && !error && !revoked && qrDataUri && (
          <div className="flex flex-col items-center space-y-4">
            <div className="p-3 bg-white rounded-xl shadow-inner border border-app-border">
              <img
                src={qrDataUri}
                alt="QR Code for Setlist Sharing"
                className="w-52 h-52 block object-contain"
              />
            </div>
            <p className="text-[11px] ui-muted-text text-app-muted text-center px-2">
              Scan with mobile camera. Anyone with this QR code or link can preview and import this snapshot for 3 days. Internet required. Revoke before closing this dialog if needed.
            </p>

            <div className="w-full flex items-center gap-2">
              <input
                type="text"
                readOnly
                aria-label="Setlist share URL"
                onFocus={(event) => event.currentTarget.select()}
                value={shareUrl}
                className="flex-1 min-w-0 rounded-lg border border-app-border bg-app-base p-2 text-xs font-mono ui-primary-text text-app-heading truncate focus:border-app-action focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 rounded-lg border border-app-border hover:border-app-action bg-app-base ui-secondary-text text-app-muted hover:text-app-heading text-xs font-mono font-bold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-status-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 text-app-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2" />
                    </svg>
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            {copyError && <p role="status" className="text-[11px] font-mono ui-muted-text text-app-muted">{copyError}</p>}

            {revokeError && (
              <p className="text-[11px] font-mono text-status-error text-center">{revokeError}</p>
            )}

            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="w-full py-2 px-3 rounded-lg border border-status-error/30 hover:bg-status-error/10 text-status-error text-xs font-mono font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span>{revoking ? 'Revoking Link...' : 'Revoke Share Link'}</span>
            </button>
          </div>
        )}

        <button
          onClick={() => exportSingleSetlistJson(setlist, allSongs)}
          className="w-full py-2 px-3 rounded-lg bg-app-action text-app-on-action hover:bg-app-action/90 text-xs font-mono font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" />
          </svg>
          Export JSON
        </button>

        <div className="pt-3 border-t border-app-border/60 flex justify-end">
          <button
            onClick={onClose}
            disabled={loading || revoking}
            className="px-3.5 py-1.5 rounded-lg bg-app-base ui-secondary-text text-app-muted hover:text-app-heading font-mono text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
