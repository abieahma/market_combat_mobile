// Countries, their money, and the price of ABIE.
//
// 1 ABIE = 1 unit of the money of the player's country of registration:
// 100 RUB buy 100 ABIE in Russia, 100 KZT buy 100 ABIE in Kazakhstan,
// 100 USD buy 100 ABIE in the USA. There is no conversion between moneys.
//
// The country is fixed once, when the cabinet is registered, and never
// changes. It comes from the strong signals: the country of the phone number
// and the country of the payment card. When the signals disagree (a phone of
// one country and a card of another, or a VPN) the price offered is the most
// expensive of the moneys involved, so a cheaper country cannot be used to
// buy ABIE for less.
//
// Pure functions: the server uses them; the real card and number checks come
// with real payments (RuStore, Google Play).

export const COUNTRIES = {
  US: { currency: 'USD', symbol: '$', before: true, flag: '🇺🇸', calling: ['1'] },
  RU: { currency: 'RUB', symbol: '₽', before: false, flag: '🇷🇺', calling: ['7'] },
  KZ: { currency: 'KZT', symbol: '₸', before: false, flag: '🇰🇿', calling: ['76', '77'] },
  UA: { currency: 'UAH', symbol: '₴', before: false, flag: '🇺🇦', calling: ['380'] },
  BY: { currency: 'BYN', symbol: 'Br', before: false, flag: '🇧🇾', calling: ['375'] },
  UZ: { currency: 'UZS', symbol: 'soʻm', before: false, flag: '🇺🇿', calling: ['998'] },
  KG: { currency: 'KGS', symbol: 'сом', before: false, flag: '🇰🇬', calling: ['996'] },
  TJ: { currency: 'TJS', symbol: 'SM', before: false, flag: '🇹🇯', calling: ['992'] },
  AM: { currency: 'AMD', symbol: '֏', before: false, flag: '🇦🇲', calling: ['374'] },
  AZ: { currency: 'AZN', symbol: '₼', before: false, flag: '🇦🇿', calling: ['994'] },
  MD: { currency: 'MDL', symbol: 'L', before: false, flag: '🇲🇩', calling: ['373'] },
  TM: { currency: 'TMT', symbol: 'm', before: false, flag: '🇹🇲', calling: ['993'] },
} as const;

export type CountryCode = keyof typeof COUNTRIES;
export type CurrencyCode = (typeof COUNTRIES)[CountryCode]['currency'];

/**
 * Rough value of one unit of each money in US dollars. Used only to tell
 * which money is the most expensive when signals disagree, never to convert
 * ABIE. The Go server will keep these up to date.
 */
export const REFERENCE_USD: Record<CurrencyCode, number> = {
  USD: 1,
  AZN: 0.59,
  BYN: 0.31,
  TMT: 0.29,
  TJS: 0.095,
  MDL: 0.057,
  UAH: 0.024,
  RUB: 0.012,
  KGS: 0.0115,
  AMD: 0.0026,
  KZT: 0.002,
  UZS: 0.00008,
};

/** Country used when nothing else is known (a sign-in without a phone, before any payment). */
export const LANGUAGE_REGION: Record<string, CountryCode> = {
  en: 'US',
  ru: 'RU',
  uk: 'UA',
  be: 'BY',
  kk: 'KZ',
  uz: 'UZ',
  ky: 'KG',
  tg: 'TJ',
  hy: 'AM',
  az: 'AZ',
  ro: 'MD',
  tk: 'TM',
};

export function isCountry(v: unknown): v is CountryCode {
  return typeof v === 'string' && v in COUNTRIES;
}

/** Country of a phone number in E.164 (+79…, +77…, +380…), or null. */
export function countryOfPhone(e164: string): CountryCode | null {
  const digits = e164.replace(/[^\d]/g, '');
  let best: { code: CountryCode; length: number } | null = null;
  for (const [code, c] of Object.entries(COUNTRIES) as [CountryCode, (typeof COUNTRIES)[CountryCode]][]) {
    for (const prefix of c.calling) {
      if (digits.startsWith(prefix) && (!best || prefix.length > best.length)) best = { code, length: prefix.length };
    }
  }
  return best?.code ?? null;
}

/** What the server knows about where a player is. */
export interface CountryEvidence {
  /** Country of the phone number (strong). */
  phone?: CountryCode | null;
  /** Country of the payment card or wallet (strong). */
  payment?: CountryCode | null;
  /** Country of the network the request came from (weak; a VPN changes it). */
  network?: CountryCode | null;
  /** The request came through a VPN or a proxy. */
  vpn?: boolean;
  /** Region of the device or app language (weakest). */
  device?: CountryCode | null;
}

export interface RegistrationCountry {
  code: CountryCode;
  currency: CurrencyCode;
  /** Which signal fixed it. */
  source: 'payment' | 'phone' | 'device';
  fixedAt: number;
}

/** The country to fix at registration: payment, then phone, then the device. */
export function registrationCountry(e: CountryEvidence, now: number): RegistrationCountry | null {
  const pick = (code: CountryCode, source: RegistrationCountry['source']): RegistrationCountry => ({
    code,
    currency: COUNTRIES[code].currency,
    source,
    fixedAt: now,
  });
  if (e.payment) return pick(e.payment, 'payment');
  if (e.phone) return pick(e.phone, 'phone');
  if (e.device) return pick(e.device, 'device');
  return null;
}

export interface AbieQuote {
  /** Money the player pays in. */
  currency: CurrencyCode;
  /** Price of the requested ABIE in that money: always 1 unit per ABIE. */
  price: number;
  /** True when the signals disagreed and the most expensive money was offered. */
  mismatch: boolean;
  /** Countries whose moneys were considered. */
  considered: CountryCode[];
}

/**
 * Price of `abie` ABIE for a player registered in `home`. Without
 * disagreement: the home money. With it: the most expensive money among the
 * countries involved.
 */
export function quoteAbie(home: CountryCode, abie: number, e: CountryEvidence): AbieQuote {
  const involved = [home, e.phone, e.payment, e.network].filter((c): c is CountryCode => !!c);
  const considered = [...new Set(involved)];
  const mismatch = !!e.vpn || considered.length > 1;
  let country: CountryCode = home;
  if (mismatch) {
    for (const c of considered) if (REFERENCE_USD[COUNTRIES[c].currency] > REFERENCE_USD[COUNTRIES[country].currency]) country = c;
    // A VPN alone hides where the player is: the dollar is the most expensive money we sell for.
    if (e.vpn && REFERENCE_USD.USD > REFERENCE_USD[COUNTRIES[country].currency]) country = 'US';
  }
  return { currency: COUNTRIES[country].currency, price: abie, mismatch, considered };
}

/** "100 ₽", "$100" for an already formatted number. */
export function formatMoney(formatted: string, country: CountryCode): string {
  const c = COUNTRIES[country];
  return c.before ? `${c.symbol}${formatted}` : `${formatted} ${c.symbol}`;
}
