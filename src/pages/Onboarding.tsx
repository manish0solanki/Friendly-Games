import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../lib/store';
import { IS_ONLINE } from '../lib/config';
import { LocalBackend } from '../lib/backend/local';

export const PENDING_INVITE = 'fg-pending-invite';

export function CreateOrJoin({ onDone }: { onDone?(): void }) {
  const { backend, refreshGroups, setGroupId, toast } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('1000');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ id: string; name: string }>, verb: string) {
    setBusy(true);
    setError('');
    try {
      const g = await fn();
      await refreshGroups();
      setGroupId(g.id);
      toast(`${verb} ${g.name} 🎉`);
      onDone?.();
      nav('/');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-2">
      <div className="card card-pad">
        <div style={{ fontSize: 26 }}>🏟️</div>
        <h3 style={{ margin: '6px 0 4px' }}>Start a new group</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          You'll be the admin and get an invite code to share.
        </p>
        <div className="field">
          <label>Group name</label>
          <input className="input" placeholder="Sunday League Legends" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Starting coins per player</label>
          <input className="input num" inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value.replace(/\D/g, ''))} />
        </div>
        <button className="btn primary block" disabled={busy || name.trim().length < 2} onClick={() => run(() => backend.createGroup(name, Math.max(10, parseInt(balance) || 1000)), 'Created')}>
          Create group
        </button>
      </div>
      <div className="card card-pad">
        <div style={{ fontSize: 26 }}>🎟️</div>
        <h3 style={{ margin: '6px 0 4px' }}>Join with an invite code</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Ask a friend for their group's 6-character code.
        </p>
        <div className="field">
          <label>Invite code</label>
          <input
            className="input"
            placeholder="ABC123"
            value={code}
            maxLength={6}
            style={{ textTransform: 'uppercase', letterSpacing: '.2em', fontWeight: 800 }}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <button className="btn gold block" disabled={busy || code.trim().length < 6} onClick={() => run(() => backend.joinGroup(code), 'Joined')}>
          Join group
        </button>
      </div>
      {error && (
        <div className="err" style={{ gridColumn: '1 / -1' }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function Welcome() {
  const { user } = useApp();
  return (
    <div style={{ maxWidth: 760, margin: '20px auto' }}>
      <div className="hero">
        <h1>You're in, {user?.username}! 🎉</h1>
        <p>Betting happens inside a private group. Start one for your crew, or join theirs with an invite code.</p>
      </div>
      <CreateOrJoin />
    </div>
  );
}

/** /join/:code — open from an invite link. */
export function JoinRoute() {
  const { code = '' } = useParams();
  const { user, backend, refreshGroups, setGroupId, toast } = useApp();
  const nav = useNavigate();
  useEffect(() => {
    if (!user) {
      try {
        localStorage.setItem(PENDING_INVITE, code);
      } catch {
        /* ignore */
      }
      return;
    }
    backend
      .joinGroup(code)
      .then(async (g) => {
        await refreshGroups();
        setGroupId(g.id);
        toast(`Welcome to ${g.name}! 🎉`);
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => nav('/', { replace: true }));
  }, [user, code]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="empty">Joining group…</div>;
}

export function AuthPage() {
  const { backend, toast } = useApp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const demoPlayers = backend instanceof LocalBackend ? backend.players() : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') await backend.signUp(username, password);
      else await backend.signIn(username, password);
      toast(mode === 'signup' ? 'Account created — welcome!' : 'Welcome back!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="brand">
          <span className="brand-mark">FG</span>
          <span>
            Friendly Games<small>Bragging rights only</small>
          </span>
        </div>
        <div>
          <h1>
            The sportsbook for <em>you and your mates.</em>
          </h1>
          <p>Live fixtures from football, cricket, the NBA, NFL and more. Back your calls, challenge your friends, climb the leaderboard. No money — just glory.</p>
          <div className="auth-feats">
            <div>
              <span>📡</span> Real fixtures &amp; live scores, settled automatically
            </div>
            <div>
              <span>⚔️</span> Head-to-head challenges with your own odds
            </div>
            <div>
              <span>🔒</span> Private, invite-only groups
            </div>
            <div>
              <span>🏆</span> Leaderboards, streaks and trash talk
            </div>
          </div>
        </div>
        <div className="dim" style={{ fontSize: 12 }}>
          Virtual coins only. Not real gambling.
        </div>
      </div>
      <div className="auth-form">
        <form className="auth-card" onSubmit={submit}>
          <h2>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {mode === 'signup' ? 'Pick a username your friends will recognise.' : 'Good to see you again.'}
          </p>
          {!IS_ONLINE && (
            <div className="banner warn">🧪 Demo mode: accounts live in this browser only. No password needed.</div>
          )}
          <div className="field">
            <label>Username</label>
            <input className="input" autoComplete="username" placeholder="e.g. rahul_07" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          {IS_ONLINE && (
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {error && <div className="err">{error}</div>}
          <button className="btn primary block" style={{ marginTop: 6 }} disabled={busy || !username || (IS_ONLINE && (mode === 'signup' ? password.length < 6 : !password))}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
          <div className="muted" style={{ textAlign: 'center', marginTop: 14 }}>
            {mode === 'signup' ? 'Already have an account?' : 'New here?'}{' '}
            <a href="#" style={{ color: 'var(--accent)', fontWeight: 700 }} onClick={(e) => (e.preventDefault(), setMode(mode === 'signup' ? 'signin' : 'signup'), setError(''))}>
              {mode === 'signup' ? 'Sign in' : 'Create an account'}
            </a>
          </div>
          {demoPlayers.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="side-title" style={{ padding: '0 0 8px' }}>
                Players on this device
              </div>
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {demoPlayers.map((p) => (
                  <button type="button" key={p.id} className="chip" onClick={() => backend.signIn(p.username, '')}>
                    {p.username}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
