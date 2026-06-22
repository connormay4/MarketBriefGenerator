/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
      },
      colors: {
        cfa: {
          red: '#E4002B',      // Chick-fil-A primary red
          redDark: '#A30021',
          redSoft: '#FDECEF',
        },
      },
      keyframes: {
        'bar-grow': { from: { width: '0%' }, to: { width: 'var(--bar-w)' } },
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        'bar-grow': 'bar-grow 700ms cubic-bezier(.2,.8,.2,1) both',
        'fade-in': 'fade-in 320ms ease both',
      },
    },
  },
  plugins: [],
}
