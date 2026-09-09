import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
export default {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: '0.5rem',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
