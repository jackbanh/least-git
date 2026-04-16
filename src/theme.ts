import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Sage: desaturated green — dried herbs, moss, lichen.
// Ten required shades from near-white to near-black.
const sage: MantineColorsTuple = [
  "#f2f6f0", // 0  barely-sage white
  "#dfe9db", // 1  pale sage mist
  "#bfd2b9", // 2  light sage
  "#9ab89b", // 3  medium-light sage
  "#779e79", // 4  medium sage
  "#5b8660", // 5  sage green
  "#456e4a", // 6  primary — forest sage
  "#325437", // 7  deep sage
  "#213b25", // 8  dark sage
  "#122514", // 9  near-black sage
];

export const theme = createTheme({
  primaryColor: "sage",
  colors: { sage },

  // Slightly warmer black/white anchors for the default palette.
  black: "#2c2820",
  white: "#faf7f2",

  defaultRadius: 4,
});
