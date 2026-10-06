import plugin from 'tailwindcss/plugin'
import colors from 'tailwindcss/colors'
import { PAGE_BREAKPOINTS } from './src/pageBreakpoints.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { display: ['DM Mono', 'monospace'] },
      colors: {
        base: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--surface2-rgb) / <alpha-value>)',
        card: 'rgb(var(--surface3-rgb) / <alpha-value>)',
        border: 'rgb(var(--border-rgb) / <alpha-value>)',
        'border2': 'rgb(var(--border2-rgb) / <alpha-value>)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-dim': 'rgb(var(--accent-dim-rgb) / <alpha-value>)',
        muted: 'rgb(var(--muted-rgb) / <alpha-value>)',
        subtle: 'rgb(var(--muted2-rgb) / <alpha-value>)',
        text: 'rgb(var(--text-rgb) / <alpha-value>)',
        // Tailwind's own shades (red-400, bg-red-500...) plus a plain `red`
        // (= 400). These were single colours from --red-rgb & co, which no
        // theme ever defined: plain `text-red` had no colour, and every shade
        // (54 text-red-400 alone: errors, delete hovers, the red buttons)
        // generated no CSS at all.
        red: { ...colors.red, DEFAULT: 'rgb(248 113 113 / <alpha-value>)' },
        purple: { ...colors.purple, DEFAULT: 'rgb(192 132 252 / <alpha-value>)' },
        orange: { ...colors.orange, DEFAULT: 'rgb(251 146 60 / <alpha-value>)' },
      },
    },
  },
  plugins: [
    // @sm: @md: @lg: @xl: @2xl: — like sm: md: …, but by the page's width (src/pageWidth.js, src/pageBreakpoints.js).
    plugin(({ addVariant }) => {
      for (const name of Object.keys(PAGE_BREAKPOINTS)) addVariant(`@${name}`, `[data-page~="${name}"] &`)
    }),
  ],
}
