/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        claude: {
          parchment: '#f5f4ed',
          ivory: '#faf9f5',
          terracotta: '#c96442',
          coral: '#d97757',
          charcoal: '#141413',
          charcoalWarm: '#4d4c48',
          oliveGray: '#5e5d59',
          stoneGray: '#87867f',
          darkWarm: '#3d3d3a',
          warmSilver: '#b0aea5',
          warmSand: '#e8e6dc',
          darkSurface: '#30302e',
          borderCream: '#f0eee6',
          borderWarm: '#e8e6dc',
          errorCrimson: '#b53333',
          focusBlue: '#3898ec',
        },
        comfy: {
          bg: '#0f0f11',
          bgSecondary: '#1a1a1e',
          bgTertiary: '#252529',
          border: '#3a3a3e',
          text: '#e8e8ed',
          textSecondary: '#9898a0',
          accent: '#6366f1',
          accentHover: '#818cf8',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
        }
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        sans: ['system-ui', 'Inter', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        'comfy-sm': '4px',
        'comfy': '8px',
        'comfy-lg': '12px',
      },
      boxShadow: {
        'ring-warm': '0px 0px 0px 1px rgba(209, 207, 197, 0.5)',
        'whisper': 'rgba(0,0,0,0.05) 0px 4px 24px',
      }
    },
  },
  plugins: [],
}
