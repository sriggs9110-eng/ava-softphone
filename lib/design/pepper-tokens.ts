export const pepperColors = {
  banana: "#FFCE3A",
  bananaDark: "#E8B420",
  bananaDeep: "#B88A0F",
  coral: "#FF7A5C",
  coralDeep: "#E55C3D",
  leaf: "#2FB67C",
  leafDark: "#1F8A5A",
  navy: "#1B2340",
  navy2: "#2B3356",
  slate: "#6B6E85",
  slate2: "#9B9EB0",
  cream: "#FFF7E6",
  cream2: "#FFEEC9",
  cream3: "#FFF9EC",
  white: "#FFFEFA",
  rose: "#FFE3DC",
  sky: "#D4EEF5",
} as const;

export const pepperShadows = {
  sm: "2px 2px 0 #1B2340",
  md: "4px 4px 0 #1B2340",
  lg: "7px 7px 0 #1B2340",
  xl: "10px 10px 0 #1B2340",
} as const;

export const pepperRadii = {
  sm: "10px",
  md: "14px",
  lg: "18px",
  pill: "100px",
} as const;

export const pepperFonts = {
  display: "var(--font-display)",
  body: "var(--font-body)",
  accent: "var(--font-accent)",
} as const;

export type PepperColor = keyof typeof pepperColors;
export type PepperShadow = keyof typeof pepperShadows;
