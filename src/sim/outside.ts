// Stand-ins for things outside the game that this phone "has": a Telegram
// account and Google accounts. Kept on the device so signing in the same way
// again finds the same player, as it would with the real services.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SimTelegram {
  id: number;
  username: string;
  phone: string;
}

export interface SimGoogle {
  sub: string;
  email: string;
  name: string;
}

interface SimDevice {
  telegram: SimTelegram;
  google: SimGoogle[];
}

const KEY = 'mcombat.sim';

function randomDigits(n: number) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function fresh(): SimDevice {
  const tag = randomDigits(4);
  return {
    telegram: { id: Number('7' + randomDigits(8)), username: `trader_${tag}`, phone: `+7 9${randomDigits(2)} ${randomDigits(3)}-${randomDigits(2)}-${randomDigits(2)}` },
    google: [{ sub: `g-${tag}`, email: `player${tag}@gmail.com`, name: `Player ${tag}` }],
  };
}

let cached: SimDevice | null = null;

export async function simDevice(): Promise<SimDevice> {
  if (cached) return cached;
  try {
    const text = await AsyncStorage.getItem(KEY);
    cached = text ? (JSON.parse(text) as SimDevice) : fresh();
  } catch {
    cached = fresh();
  }
  save();
  return cached;
}

function save() {
  if (cached) AsyncStorage.setItem(KEY, JSON.stringify(cached)).catch(() => {});
}

export async function setSimPhone(phone: string) {
  const d = await simDevice();
  d.telegram.phone = phone;
  save();
}

export async function addSimGoogle(email: string): Promise<SimGoogle> {
  const d = await simDevice();
  const clean = email.trim().toLowerCase();
  const existing = d.google.find((g) => g.email === clean);
  if (existing) return existing;
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (Math.imul(h, 31) + clean.charCodeAt(i)) | 0;
  const account = { sub: `g-${(h >>> 0).toString(36)}`, email: clean, name: clean.split('@')[0] };
  d.google.push(account);
  save();
  return account;
}
