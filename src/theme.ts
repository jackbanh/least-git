import { createTheme, type MantineColorsTuple } from "@mantine/core";

// A sage scale whose hue tracks the app's configurable accent (--lg-accent-hue),
// so Mantine's primary-coloured components (Buttons, active states…) follow the
// chosen accent instead of Mantine's default blue.
const sage: MantineColorsTuple = [
  "oklch(96% 0.02 var(--lg-accent-hue))",
  "oklch(92% 0.03 var(--lg-accent-hue))",
  "oklch(85% 0.05 var(--lg-accent-hue))",
  "oklch(77% 0.07 var(--lg-accent-hue))",
  "oklch(70% 0.08 var(--lg-accent-hue))",
  "oklch(63% 0.088 var(--lg-accent-hue))",
  "oklch(55% 0.09 var(--lg-accent-hue))",
  "oklch(48% 0.088 var(--lg-accent-hue))",
  "oklch(41% 0.08 var(--lg-accent-hue))",
  "oklch(34% 0.07 var(--lg-accent-hue))",
];

// Maps the app's design tokens into Mantine so its components inherit the app's
// fonts and accent automatically — no per-component palette CSS needed.
export const theme = createTheme({
  fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace",
  headings: { fontFamily: "'Fraunces', 'Iowan Old Style', Georgia, serif" },
  colors: { sage },
  primaryColor: "sage",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: "md",
});
