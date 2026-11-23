// Design tokens — a night gallery for books.
// Majid's palette: #081325 deep navy · #A9CDBE sage · #F2B53A marigold.
// Cream is kept only for placards and labels, like museum cards under a lamp.

export const APP_NAME = 'The Book Butler';

export const palette = {
  navy: '#081325',
  sage: '#A9CDBE',
  marigold: '#F2B53A',
};

export const colors = {
  // surfaces
  paper: '#081325', // app background (deep navy)
  paperDeep: '#0D1C33',
  paperEdge: '#16294A',
  // text on navy
  ink: '#EEF2EC',
  inkSoft: '#A9CDBE',
  sepia: '#86AA9C',
  sepiaSoft: '#5E7F73',
  // accents
  gold: '#F2B53A',
  goldBright: '#F7C863',
  line: 'rgba(169,205,190,0.18)',
  // the darker wall for the Finder and showcase
  wall: '#050D1A',
  wallSoft: '#0B172B',
  wallText: '#EEF2EC',
  wallMuted: '#8DB1A3',
  // museum cards
  cream: '#F4ECDD',
  creamInk: '#0B1A30',
  creamSoft: '#4F6B66',
  // statuses
  owned: '#A9CDBE',
  missing: '#9FC3F0',
  flagged: '#E7785C',
  danger: '#E7785C',
  white: '#FBF8F1',
};

export const fonts = {
  display: 'CormorantGaramond_500Medium',
  displayLight: 'CormorantGaramond_400Regular',
  displayItalic: 'CormorantGaramond_400Regular_Italic',
  displayItalicMedium: 'CormorantGaramond_500Medium_Italic',
  displayBold: 'CormorantGaramond_600SemiBold',
  body: 'EBGaramond_400Regular',
  bodyMedium: 'EBGaramond_500Medium',
  bodyItalic: 'EBGaramond_400Regular_Italic',
  script: 'PinyonScript_400Regular',
};

export const space = (n: number) => n * 4;

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
