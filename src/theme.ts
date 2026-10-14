/** Indigo theme (matches the latest mockups). */
export const colors = {
  page: '#F7F8FC',
  card: '#FFFFFF',
  border: '#E2E6EF',
  divider: '#EEF0F6',
  inputBorder: '#D4D9E4',
  subtle: '#EEF0F6',
  text: '#151A2B',
  textSecondary: '#5B6275',
  textTertiary: '#878EA1',
  accent: '#3D4ED8',
  accentSoft: '#ECEEFF',
  onAccent: '#FFFFFF',
  low: '#C8402B',
  lowSoft: '#FDEDE9',
  lowText: '#9A2E1C',
  out: '#B42318',
  sealed: '#0E6655',
  sealedSoft: '#E1F3EF',
  opened: '#A3321F',
  openedSoft: '#FDEDE9',
  scrim: 'rgba(21,26,43,0.35)',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, color: colors.text },
  meta: { fontSize: 13, color: colors.textSecondary },
  small: { fontSize: 12, color: colors.textSecondary },
  section: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.7,
  },
};

/** Minimum touch target. */
export const HIT = 44;
