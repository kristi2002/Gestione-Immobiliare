import type { Config } from 'tailwindcss';

/**
 * Immobiliare Orlandi design system.
 * Colors, radii, shadows and typography here are the single source of truth —
 * components reference these tokens (e.g. `bg-primary`, `text-navy`,
 * `shadow-card`) instead of re-typing hex values.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0B3D91', // royal blue — buttons, active states, links
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#4A90D9', // sky blue — secondary elements
          foreground: '#FFFFFF',
        },
        sidebar: '#06224F', // dark navy — sidebar background
        navy: '#06224F', // primary text color
        background: '#EEF2F8', // page background
        card: '#FFFFFF',
        success: '#22C55E',
        warning: '#F97316',
        danger: '#EF4444',
        muted: '#6B7280',
        border: '#E5E7EB',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        brand: ['Playfair Display', 'Georgia', 'serif'],
      },
      fontSize: {
        'page-title': ['26px', { lineHeight: '32px', fontWeight: '700' }],
        'card-title': ['16px', { lineHeight: '22px', fontWeight: '600' }],
        label: ['11px', { lineHeight: '16px', letterSpacing: '0.05em' }],
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        card: '0 4px 24px rgba(0,0,0,0.08)',
        'card-hover': '0 8px 32px rgba(0,0,0,0.12)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
