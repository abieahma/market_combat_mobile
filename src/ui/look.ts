// Styles that follow the look. In the neutral cabinet a screen's styles are
// used as written; inside a universe the display type (Cormorant) becomes the
// plain bold sans of a marketplace app, a little smaller, and the standard
// corners become the universe's own.

import { useMemo } from 'react';
import { TextStyle, ViewStyle } from 'react-native';
import { useStore } from '../state/store';
import { fonts, Look, radius, type } from './theme';

type AnyStyle = ViewStyle & TextStyle;

function adapt<T extends Record<string, unknown>>(base: T, look: Look): T {
  if (!look.brand) return base;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (!value || typeof value !== 'object') {
      out[key] = value;
      continue;
    }
    const st: AnyStyle = { ...(value as AnyStyle) };
    if (st.fontFamily === fonts.display || st.fontFamily === fonts.displaySemi) {
      st.fontWeight = st.fontFamily === fonts.display ? '800' : '700';
      delete st.fontFamily;
      if (typeof st.fontSize === 'number') st.fontSize = Math.round(st.fontSize * look.scale);
      if (typeof st.lineHeight === 'number') st.lineHeight = Math.round(st.lineHeight * look.scale);
      if (st.letterSpacing !== undefined) st.letterSpacing = 0;
    }
    if (st.borderRadius === radius.lg) st.borderRadius = look.shape.card;
    else if (st.borderRadius === radius.md) st.borderRadius = look.shape.button;
    else if (st.borderRadius === radius.sm) st.borderRadius = look.shape.small;
    out[key] = st;
  }
  return out as T;
}

/** A screen's styles adapted to the current look. */
export function useLookStyles<T extends Record<string, unknown>>(base: T): T {
  const { look } = useStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => adapt(base, look), [base, look.id, look.scheme]);
}

/** The shared text styles (display, title, label…) adapted to the current look. */
export function useType(): typeof type {
  return useLookStyles(type);
}
