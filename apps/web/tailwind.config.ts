import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './features/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        sidebar: 'rgb(var(--sidebar) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        blue: 'rgb(var(--athlete-blue) / <alpha-value>)',
        red: 'rgb(var(--athlete-red) / <alpha-value>)',
        timer: 'rgb(var(--timer) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)'
      },
      fontFamily: { sans: ['Inter', 'Arial', 'sans-serif'], display: ['Barlow Condensed', 'Arial Narrow', 'sans-serif'] },
      boxShadow: { glow: '0 0 32px rgba(23, 102, 255, .18)' },
      animation: { 'pulse-soft': 'pulseSoft 2s ease-in-out infinite' },
      keyframes: { pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } } }
    }
  },
  plugins: [animate]
};
export default config;
