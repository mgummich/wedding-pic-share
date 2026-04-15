import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'surface-base': 'var(--color-surface-base)',
        'surface-card': 'var(--color-surface-card)',
        border: 'var(--color-ui-border)',
        'ui-border': 'var(--color-ui-border)',
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        success: 'var(--color-success)',
        error: 'var(--color-error)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        thumb: 'var(--radius-thumb)',
      },
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'sans-serif'],
        display: ['var(--font-playfair)', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
