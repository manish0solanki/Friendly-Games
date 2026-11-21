export interface League {
  key: string; // ESPN path "sport/league" (or 'cricket/all' for the cricket feed)
  name: string;
  short: string;
  country?: string;
  allowDraw: boolean;
}

export interface Sport {
  key: string;
  name: string;
  icon: string;
  leagues: League[];
}

export const SPORTS: Sport[] = [
  {
    key: 'soccer',
    name: 'Football',
    icon: '⚽',
    leagues: [
      { key: 'soccer/eng.1', name: 'Premier League', short: 'EPL', country: 'England', allowDraw: true },
      { key: 'soccer/uefa.champions', name: 'Champions League', short: 'UCL', country: 'Europe', allowDraw: true },
      { key: 'soccer/esp.1', name: 'LaLiga', short: 'LaLiga', country: 'Spain', allowDraw: true },
      { key: 'soccer/ita.1', name: 'Serie A', short: 'Serie A', country: 'Italy', allowDraw: true },
      { key: 'soccer/ger.1', name: 'Bundesliga', short: 'BUN', country: 'Germany', allowDraw: true },
      { key: 'soccer/fra.1', name: 'Ligue 1', short: 'L1', country: 'France', allowDraw: true },
      { key: 'soccer/uefa.europa', name: 'Europa League', short: 'UEL', country: 'Europe', allowDraw: true },
      { key: 'soccer/eng.2', name: 'Championship', short: 'EFL', country: 'England', allowDraw: true },
      { key: 'soccer/ned.1', name: 'Eredivisie', short: 'ERE', country: 'Netherlands', allowDraw: true },
      { key: 'soccer/por.1', name: 'Primeira Liga', short: 'POR', country: 'Portugal', allowDraw: true },
      { key: 'soccer/usa.1', name: 'MLS', short: 'MLS', country: 'USA', allowDraw: true },
      { key: 'soccer/ksa.1', name: 'Saudi Pro League', short: 'SPL', country: 'Saudi Arabia', allowDraw: true },
      { key: 'soccer/ind.1', name: 'Indian Super League', short: 'ISL', country: 'India', allowDraw: true },
    ],
  },
  {
    key: 'cricket',
    name: 'Cricket',
    icon: '🏏',
    // ESPN exposes cricket as many small competitions; we read them all from one feed.
    leagues: [{ key: 'cricket/all', name: 'All Cricket', short: 'Cricket', allowDraw: false }],
  },
  {
    key: 'basketball',
    name: 'Basketball',
    icon: '🏀',
    leagues: [
      { key: 'basketball/nba', name: 'NBA', short: 'NBA', country: 'USA', allowDraw: false },
      { key: 'basketball/wnba', name: 'WNBA', short: 'WNBA', country: 'USA', allowDraw: false },
      { key: 'basketball/mens-college-basketball', name: 'NCAA Men', short: 'NCAAM', country: 'USA', allowDraw: false },
    ],
  },
  {
    key: 'football',
    name: 'American Football',
    icon: '🏈',
    leagues: [
      { key: 'football/nfl', name: 'NFL', short: 'NFL', country: 'USA', allowDraw: false },
      { key: 'football/college-football', name: 'NCAA Football', short: 'NCAAF', country: 'USA', allowDraw: false },
    ],
  },
  {
    key: 'tennis',
    name: 'Tennis',
    icon: '🎾',
    leagues: [
      { key: 'tennis/atp', name: 'ATP', short: 'ATP', allowDraw: false },
      { key: 'tennis/wta', name: 'WTA', short: 'WTA', allowDraw: false },
    ],
  },
  {
    key: 'hockey',
    name: 'Ice Hockey',
    icon: '🏒',
    leagues: [{ key: 'hockey/nhl', name: 'NHL', short: 'NHL', country: 'USA', allowDraw: false }],
  },
  {
    key: 'baseball',
    name: 'Baseball',
    icon: '⚾',
    leagues: [{ key: 'baseball/mlb', name: 'MLB', short: 'MLB', country: 'USA', allowDraw: false }],
  },
  {
    key: 'mma',
    name: 'MMA',
    icon: '🥊',
    leagues: [{ key: 'mma/ufc', name: 'UFC', short: 'UFC', allowDraw: false }],
  },
];

/** Leagues shown on the home page "Top events" view. */
export const FEATURED_LEAGUES = [
  'soccer/eng.1',
  'soccer/uefa.champions',
  'soccer/esp.1',
  'cricket/all',
  'basketball/nba',
  'football/nfl',
  'soccer/ita.1',
  'soccer/ger.1',
];

export function findLeague(key: string): League | undefined {
  for (const s of SPORTS) for (const l of s.leagues) if (l.key === key) return l;
  return undefined;
}

export function findSport(key: string): Sport | undefined {
  return SPORTS.find((s) => s.key === key);
}

export function sportIcon(key: string): string {
  if (key === 'custom') return '⭐';
  return findSport(key)?.icon ?? '🏆';
}
