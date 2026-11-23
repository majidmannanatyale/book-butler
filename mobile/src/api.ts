// Tiny API client. The backend URL comes from (in order): what the user saved in
// Settings, EXPO_PUBLIC_API_URL, or the page's own host on web.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const KEY = 'apiBase';
let cached: string | null = null;

function defaultBase(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8020`;
  }
  // In Expo Go the phone already reaches the laptop's Metro server (hostUri = "192.168.x.y:8081");
  // the backend runs on the same machine, port 8020.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:8020`;
  return 'http://192.168.1.10:8020'; // change in Settings
}

export async function getBase(): Promise<string> {
  if (cached) return cached;
  const saved = await AsyncStorage.getItem(KEY);
  cached = (saved || defaultBase()).replace(/\/$/, '');
  AsyncStorage.setItem('apiBaseResolved', cached).catch(() => {}); // for the home-screen widget
  return cached;
}

export async function setBase(url: string) {
  cached = url.trim().replace(/\/$/, '');
  await AsyncStorage.setItem(KEY, cached);
}

// ---------- sign-in token (none = the demo reader)
let token: string | null | undefined;
export async function getToken() {
  if (token === undefined) token = await AsyncStorage.getItem('authToken');
  return token;
}
export async function setToken(t: string | null) {
  token = t;
  if (t) await AsyncStorage.setItem('authToken', t);
  else await AsyncStorage.removeItem('authToken');
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit, timeoutMs = 90000): Promise<T> {
  const base = await getBase();
  const tk = await getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(init?.headers || {}) },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, data?.detail || `Request failed (${res.status})`);
    return data as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    if (e?.name === 'AbortError') throw new ApiError(0, 'That took too long. Is the server reachable?');
    throw new ApiError(0, 'Cannot reach the library server. Check the address in Settings.');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- types
export type Book = {
  id: number;
  title: string;
  author: string;
  year?: number | null;
  publisher?: string | null;
  binding?: string | null;
  edition?: string | null;
  height_cm?: number | null;
  pages?: number | null;
  isbn?: string | null;
  cover_url?: string | null;
  subjects: string[];
  collection?: string | null;
  series_index?: number | null;
  status: 'owned' | 'wishlist';
  favourite: boolean;
  reading: boolean;
  tbr?: boolean;
  progress: number;
  hours_read: number;
  notes?: string | null;
  position: number;
  faces?: string[];
};

export type Box = { x: number; y: number; w: number; h: number };
export type SpottedBook = {
  id: number;
  title: string;
  author: string;
  box: Box;
  confidence: number;
  status: 'owned' | 'missing' | 'pick' | 'candidate' | 'flagged' | 'unreadable' | 'unknown';
  stars?: number;
  note?: string;
  collection?: string;
  book_id?: number;
  year?: number;
  subjects?: string[];
  cover_url?: string;
};

export type Usage = {
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  requests: number;
  cost_usd: number;
  saved_usd?: number;
  by_agent?: Record<string, any>;
};

export type ScanResult = {
  books: SpottedBook[];
  counts: Record<string, number>;
  notes: string;
  image: { w: number; h: number; dhash: string };
  usage: Usage;
  cached: boolean;
  seconds: number;
  timings?: Record<string, number>;
};

export type Stats = {
  books: number;
  hours_read: number;
  pages: number;
  authors: number;
  reading_now: number;
  wishlist: number;
  favourites: number;
  missing_from_collections: number;
};

export type SearchHit = {
  title: string;
  author: string;
  year?: number;
  isbn?: string;
  pages?: number;
  publisher?: string;
  subjects: string[];
  cover_url?: string;
  owned_id?: number | null;
  gap?: { collection: string; index: number } | null;
};

export type Draft = {
  title: string;
  author: string;
  publisher: string;
  year: number | null;
  isbn: string;
  edition: string;
  binding: string;
  printing_line: string;
  confidence: number;
  cover_url?: string;
  subjects?: string[];
  pages?: number;
};

export type Profile = {
  id: number;
  username: string;
  display_name: string;
  friend_code: string;
  bio: string;
  reader_type: string | null;
  reader_type_label: string | null;
};

export type Explanation = {
  headline: string;
  connections: { your_book: string; why: string }[];
  themes: string[];
  caveat: string;
};

export type Sample = {
  kind: 'excerpt' | 'description' | 'none';
  source: string;
  title?: string;
  opening?: string;
  text: string;
  link: string | null;
  free?: boolean;
};

export type LibBook = { id: number | null; title: string; author: string; cover_url?: string | null; status: string; why?: string };

// ---------- calls
// books we've already fetched, so opening one paints instantly (then refreshes)
export const bookCache = new Map<number, Book>();
const remember = <T extends Book | Book[]>(x: T): T => {
  (Array.isArray(x) ? x : [x]).forEach((b) => bookCache.set(b.id, b));
  return x;
};

export const api = {
  base: getBase,
  health: () => req<any>('/api/health', undefined, 8000),
  stats: () => req<Stats>('/api/stats'),
  quote: (exclude?: number) =>
    req<{ index: number; text: string; author: string; work: string }>(
      `/api/quote${exclude != null ? `?exclude=${exclude}` : ''}`,
    ),
  books: (status: 'owned' | 'wishlist' | 'all' = 'owned') => req<Book[]>(`/api/books?status=${status}`).then(remember),
  book: (id: number) => req<Book>(`/api/books/${id}`).then(remember),
  addBook: (b: Partial<Book>) =>
    req<Book & { possible_duplicate_of?: number | null }>('/api/books', { method: 'POST', body: JSON.stringify(b) }),
  patchBook: (id: number, b: Partial<Book>) =>
    req<Book>(`/api/books/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteBook: (id: number) => req<{ ok: boolean }>(`/api/books/${id}`, { method: 'DELETE' }),
  reorder: (ids: number[]) => req('/api/books/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
  saveQuote: (title: string, author: string, to: 'wishlist' | 'tbr') =>
    req<{ book: Book; already: string | null }>('/api/quote/save', { method: 'POST', body: JSON.stringify({ title, author, to }) }, 30000),
  collections: () => req<{ collections: any[]; gaps: any[] }>('/api/collections'),
  search: (q: string) => req<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  isbn: (isbn: string) => req<SearchHit>(`/api/isbn/${encodeURIComponent(isbn)}`),
  scan: (image_b64: string) =>
    req<ScanResult>('/api/finder/scan64', { method: 'POST', body: JSON.stringify({ image_b64 }) }, 120000),
  scanSample: (name: 'bookshop' | 'injection') =>
    req<ScanResult>(`/api/finder/sample/${name}`, { method: 'POST' }, 120000),
  sampleUrl: async (name: string) => `${await getBase()}/api/samples/${name}.jpg`,
  catalogue: (image_b64: string) =>
    req<{ draft: Draft; verified: boolean; usage: Usage }>(
      '/api/catalogue64',
      { method: 'POST', body: JSON.stringify({ image_b64 }) },
      90000,
    ),
  librarian: (question: string, history: { role: string; text: string }[]) =>
    req<{ answer: string; tools: string[]; usage: Usage; books?: LibBook[] }>('/api/librarian', {
      method: 'POST',
      body: JSON.stringify({ question, history }),
    }),
  liveMatch: (blocks: { id: number; text: string }[]) =>
    req<{ books: any[]; ms: number }>('/api/live/match', { method: 'POST', body: JSON.stringify({ blocks }) }, 8000),
  liveIdentify: (blocks: { id: number; text: string }[]) =>
    req<{ books: any[]; usage: Usage; cached: boolean; timings: Record<string, number> }>(
      '/api/live/identify',
      { method: 'POST', body: JSON.stringify({ blocks }) },
      15000,
    ),
  debugOcr: (image_b64: string, blocks: any[], raw?: any) =>
    req('/api/debug/ocr', { method: 'POST', body: JSON.stringify({ image_b64, blocks, raw }) }, 15000),
  sessionScout: (blocks: { id: number; text: string }[]) =>
    req<{ results: any[]; usage: Usage; timings: Record<string, number> }>(
      '/api/session/scout',
      { method: 'POST', body: JSON.stringify({ blocks }) },
      20000,
    ),
  explain: (b: { title: string; author: string; stars: number; reason: string }) =>
    req<{ explanation: Explanation; meta: any; usage?: Usage; cached?: boolean }>('/api/explain', { method: 'POST', body: JSON.stringify(b) }, 30000),
  sampleForBook: (id: number) => req<Sample>(`/api/books/${id}/sample`, undefined, 30000),
  sampleByTitle: (title: string, author: string) =>
    req<Sample>(`/api/sample?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`, undefined, 30000),
  uploadFace: (id: number, side: 'front' | 'back' | 'spine', image_b64: string) =>
    req<Book>(`/api/books/${id}/faces/${side}`, { method: 'POST', body: JSON.stringify({ image_b64 }) }, 30000),
  faceUrl: async (id: number, side: string, v = '') => `${await getBase()}/api/books/${id}/face/${side}.jpg${v ? `?v=${v}` : ''}`,
  catalogueMulti: (imgs: { front?: string; back?: string; spine?: string; page?: string }) =>
    req<{ draft: Draft & { needs_info_page?: boolean; ask?: string; isbn_visible?: boolean }; verified: boolean; usage: Usage }>(
      '/api/catalogue/multi',
      { method: 'POST', body: JSON.stringify(imgs) },
      90000,
    ),
  readerTypes: () => req<{ key: string; label: string; blurb: string }[]>('/api/reader-types'),
  register: (b: { username: string; password: string; display_name: string; reader_type?: string }) =>
    req<{ token: string; user: Profile }>('/api/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  login: (username: string, password: string) =>
    req<{ token: string; user: Profile }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => req<Profile & { stats: Stats; signed_in: boolean }>('/api/me'),
  patchMe: (b: Partial<{ display_name: string; bio: string; reader_type: string }>) =>
    req<Profile>('/api/me', { method: 'PATCH', body: JSON.stringify(b) }),
  friends: () => req<(Profile & { books: number; reading_now: number })[]>('/api/friends'),
  addFriend: (code: string) => req<Profile>('/api/friends', { method: 'POST', body: JSON.stringify({ code }) }),
  friendShelf: (id: number) => req<{ user: Profile; stats: Stats; books: Book[] }>(`/api/friends/${id}`),
  importCsv: (csv: string) =>
    req<{ source: string; rows: number; added: number; skipped_duplicates: number; wishlist: number; sample: string[] }>(
      '/api/import',
      { method: 'POST', body: JSON.stringify({ csv }) },
      120000,
    ),
  where: (title: string, author: string) =>
    req<{ links: { name: string; kind: string; url: string }[]; friends: string[] }>(
      `/api/where?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`,
    ),
  nearby: (lat: number, lon: number) =>
    req<{ shops: { name: string; kind: string; km: number; address: string; maps: string }[] }>(`/api/nearby?lat=${lat}&lon=${lon}`, undefined, 40000),
  usage: () => req<any>('/api/usage'),
  audit: () => req<any[]>('/api/audit?n=25'),
};

export const money = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
export const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
