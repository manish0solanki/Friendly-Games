import { useEffect, useState, type ReactNode } from 'react';
import { colorFor } from '../lib/util';
import { fmtCoins } from '../lib/odds';
import { CONFIRM_SECONDS } from '../lib/quote';

export function Avatar({ name, size }: { name: string; size?: 'sm' | 'lg' }) {
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: colorFor(name) }} title={name}>
      {name.slice(0, 2)}
    </span>
  );
}

export function TeamLogo({ src, name, className }: { src?: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return <span className={`logo-fallback ${className ?? ''}`}>{name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase()}</span>;
  return <img className={`logo ${className ?? ''}`} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

export function Coins({ n, className }: { n: number; className?: string }) {
  return (
    <span className={`row num ${className ?? ''}`} style={{ gap: 6, display: 'inline-flex' }}>
      <span className="coin" />
      {fmtCoins(n)}
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          {title}
          <span className="spacer" />
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="card league-block">
      <div className="league-head">
        <div className="skeleton" style={{ width: 140, height: 14 }} />
      </div>
      {Array.from({ length: n }, (_, i) => (
        <div className="match" key={i}>
          <div className="skeleton" style={{ height: 30 }} />
          <div className="skeleton" style={{ height: 34 }} />
          <div className="skeleton" style={{ width: 150, height: 44 }} />
        </div>
      ))}
    </div>
  );
}

/** Re-renders every second (for countdowns). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Live bet / cash out waiting for its 60-second score check. */
export function ConfirmingNote({ since, what = 'Bet' }: { since: string; what?: string }) {
  const now = useNow();
  const left = Math.ceil(CONFIRM_SECONDS - (now - Date.parse(since)) / 1000);
  return (
    <div className="confirming-note" aria-live="polite">
      {left > 0 ? (
        <>
          <span className="clock">⏱</span> {what} confirms in {left}s if the score holds
        </>
      ) : (
        <>
          <span className="spin">⟳</span> Checking the score…
        </>
      )}
    </div>
  );
}
