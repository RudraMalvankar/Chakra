/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#f9fafb',
        surface: '#ffffff',
        border: '#e5e7eb',
        text: {
          main: '#1f2937',
          muted: '#6b7280',
          light: '#9ca3af'
        },
        rzp: {
          blue: '#0F51E3',
          dark: '#080808',
          red: '#F24240',
          redLight: '#FCECEC',
          green: '#00D289',
          greenLight: '#E6F8F3',
          gray: '#F4F5F5'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace']
      }
    },
  },
  plugins: [],
}
