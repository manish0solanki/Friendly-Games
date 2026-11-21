import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './lib/store';
import { Layout, Toasts } from './components/Layout';
import { Home, LivePage, SpecialsPage, SportPage } from './pages/Lobby';
import { EventPage } from './pages/EventPage';
import { MyBets } from './pages/MyBets';
import { ChallengesPage } from './pages/Challenges';
import { Leaderboard } from './pages/Leaderboard';
import { GroupPage } from './pages/GroupPage';
import { AuthPage, JoinRoute, PENDING_INVITE, Welcome } from './pages/Onboarding';
import { AdminPage } from './pages/AdminPage';

function PendingInvite() {
  const nav = useNavigate();
  useEffect(() => {
    try {
      const code = localStorage.getItem(PENDING_INVITE);
      if (code) {
        localStorage.removeItem(PENDING_INVITE);
        nav(`/join/${code}`);
      }
    } catch {
      /* ignore */
    }
  }, [nav]);
  return null;
}

function Gate() {
  const { ready, user, groups } = useApp();
  if (!ready)
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <span className="brand-mark" style={{ width: 48, height: 48, fontSize: 20 }}>
          FG
        </span>
      </div>
    );
  if (!user)
    return (
      <>
        <Routes>
          <Route path="/join/:code" element={<JoinRoute />} />
          <Route path="*" element={null} />
        </Routes>
        <AuthPage />
        <Toasts />
      </>
    );
  return (
    <>
      <PendingInvite />
      <Layout>
        <Routes>
          <Route path="/join/:code" element={<JoinRoute />} />
          {user.isSuper && <Route path="/admin" element={<AdminPage />} />}
          {groups.length === 0 ? (
            <Route path="*" element={<Welcome />} />
          ) : (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/live" element={<LivePage />} />
              <Route path="/specials" element={<SpecialsPage />} />
              <Route path="/sport/:sport" element={<SportPage />} />
              <Route path="/event/:id" element={<EventPage />} />
              <Route path="/bets" element={<MyBets />} />
              <Route path="/challenges" element={<ChallengesPage />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/group" element={<GroupPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </Layout>
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppProvider>
        <Gate />
      </AppProvider>
    </HashRouter>
  );
}
