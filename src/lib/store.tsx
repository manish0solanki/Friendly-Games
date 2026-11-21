import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IS_ONLINE } from './config';
import { LocalBackend } from './backend/local';
import { SupabaseBackend } from './backend/supabase';
import type { Backend } from './backend/types';
import { fetchLeague, fetchResult } from './espn';
import type { OddsFormat } from './odds';
import type { Group, GroupData, Match, Outcome, Profile } from './types';

export const backend: Backend = IS_ONLINE ? new SupabaseBackend() : new LocalBackend();

export interface Selection {
  match: Match;
  pick: Outcome;
  stake: string;
}

interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface Ctx {
  backend: Backend;
  ready: boolean;
  user: Profile | null;
  groups: Group[];
  group: Group | null;
  data: GroupData | null;
  setGroupId(id: string | null): void;
  refreshGroups(): Promise<void>;
  refresh(): Promise<void>;
  slip: Selection[];
  toggleSelection(match: Match, pick: Outcome): void;
  updateStake(matchId: string, stake: string): void;
  clearSlip(): void;
  removeSelection(matchId: string): void;
  slipOpen: boolean;
  setSlipOpen(v: boolean): void;
  oddsFormat: OddsFormat;
  setOddsFormat(f: OddsFormat): void;
  toasts: Toast[];
  toast(text: string, kind?: Toast['kind']): void;
  /** Report matches seen in the live feed so finished ones get settled. */
  reportMatches(ms: Match[]): void;
}

const AppCtx = createContext<Ctx | null>(null);

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Profile | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupIdState] = useState<string | null>(lsGet('fg-group'));
  const [data, setData] = useState<GroupData | null>(null);
  const [slip, setSlip] = useState<Selection[]>([]);
  const [slipOpen, setSlipOpen] = useState(false);
  const [oddsFormat, setOddsFormatState] = useState<OddsFormat>((lsGet('fg-odds') as OddsFormat) || 'decimal');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const settling = useRef(new Set<string>());
  const dataRef = useRef<GroupData | null>(null);
  dataRef.current = data;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadUser = useCallback(async () => {
    const u = await backend.currentUser().catch(() => null);
    setUser(u);
    if (u) {
      const gs = await backend.myGroups().catch(() => []);
      setGroups(gs);
      setGroupIdState((cur) => (cur && gs.some((g) => g.id === cur) ? cur : gs[0]?.id ?? null));
    } else {
      setGroups([]);
      setData(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    loadUser();
    return backend.onAuthChange(() => loadUser());
  }, [loadUser]);

  useEffect(() => {
    lsSet('fg-group', groupId);
  }, [groupId]);

  const refresh = useCallback(async () => {
    if (!groupId || !user) {
      setData(null);
      return;
    }
    try {
      setData(await backend.groupData(groupId));
    } catch (e: any) {
      toast(e.message ?? 'Could not load group', 'error');
    }
  }, [groupId, user, toast]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, IS_ONLINE ? 20_000 : 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const refreshGroups = useCallback(async () => {
    const gs = await backend.myGroups();
    setGroups(gs);
  }, []);

  const setGroupId = useCallback((id: string | null) => {
    setGroupIdState(id);
    setSlip([]);
  }, []);

  // ---- automatic settlement --------------------------------------------------
  const settle = useCallback(
    async (eventId: string, result: NonNullable<Match['result']>, hs?: string, as?: string) => {
      if (settling.current.has(eventId)) return;
      settling.current.add(eventId);
      try {
        await backend.settleEvent(eventId, result, hs, as);
        await refresh();
      } catch {
        settling.current.delete(eventId); // retry later
      }
    },
    [refresh],
  );

  const reportMatches = useCallback(
    (ms: Match[]) => {
      const d = dataRef.current;
      if (!d) return;
      for (const m of ms) {
        const ev = d.events[m.id];
        if (m.result && ev && !ev.settledAt && !ev.groupId) settle(m.id, m.result, m.home.score, m.away.score);
      }
    },
    [settle],
  );

  // Periodically look up results for events we have bets on but which aren't on screen.
  useEffect(() => {
    if (!data) return;
    const pending = Object.values(data.events).filter(
      (e) => !e.settledAt && !e.groupId && new Date(e.startTime).getTime() < Date.now() - 60 * 60 * 1000,
    );
    if (!pending.length) return;
    let cancelled = false;
    (async () => {
      for (const e of pending.slice(0, 12)) {
        if (cancelled || settling.current.has(e.id)) continue;
        const r = await fetchResult(e).catch(() => null);
        if (r && !cancelled) await settle(e.id, r.result, r.homeScore, r.awayScore);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, settle]);

  // ---- bet slip ----------------------------------------------------------------
  const toggleSelection = useCallback((match: Match, pick: Outcome) => {
    setSlip((s) => {
      const existing = s.find((x) => x.match.id === match.id);
      if (existing && existing.pick === pick) return s.filter((x) => x.match.id !== match.id);
      if (existing) return s.map((x) => (x.match.id === match.id ? { ...x, pick } : x));
      return [...s, { match, pick, stake: '' }];
    });
  }, []);

  const value: Ctx = {
    backend,
    ready,
    user,
    groups,
    group: groups.find((g) => g.id === groupId) ?? null,
    data: data && data.group.id === groupId ? data : null,
    setGroupId,
    refreshGroups,
    refresh,
    slip,
    toggleSelection,
    updateStake: (id, stake) => setSlip((s) => s.map((x) => (x.match.id === id ? { ...x, stake } : x))),
    clearSlip: () => setSlip([]),
    removeSelection: (id) => setSlip((s) => s.filter((x) => x.match.id !== id)),
    slipOpen,
    setSlipOpen,
    oddsFormat,
    setOddsFormat: (f) => {
      setOddsFormatState(f);
      lsSet('fg-odds', f);
    },
    toasts,
    toast,
    reportMatches,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

// ---- live data hook -------------------------------------------------------------
export function useLeagues(keys: string[]) {
  const { reportMatches } = useApp();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const keyStr = keys.join('|');

  useEffect(() => {
    let alive = true;
    const ks = keyStr ? keyStr.split('|') : [];
    const load = async (first: boolean) => {
      if (first) setLoading(true);
      const results = await Promise.allSettled(ks.map((k) => fetchLeague(k)));
      if (!alive) return;
      const ms: Match[] = [];
      const errs: string[] = [];
      results.forEach((r, i) => (r.status === 'fulfilled' ? ms.push(...r.value) : errs.push(ks[i])));
      ms.sort((a, b) => a.startTime.localeCompare(b.startTime));
      setMatches(ms);
      setErrors(errs);
      setLoading(false);
      reportMatches(ms);
    };
    load(true);
    const t = setInterval(() => load(false), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [keyStr, reportMatches]);

  return { matches, loading, errors };
}
