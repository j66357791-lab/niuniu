/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* 赌桌风格深色主题 */
        table: {
          bg: '#0b100e',
          panel: '#151f1a',
          felt: '#1a5e38',
          border: '#2a3a30',
          hover: '#1e2e26'
        },
        gold: {
          DEFAULT: '#c9a84c',
          dim: '#9a7e38',
          light: '#e0c56e'
        },
        ivory: '#e0dbd2',
        muted: '#7a8a7e',
        btn: {
          green: '#1a8a4e',
          'green-h': '#22a85e',
          red: '#a63d3d',
          'red-h': '#c04a4a'
        }
      },
      fontFamily: {
        body: ['"Microsoft YaHei"', '"PingFang SC"', 'sans-serif']
      }
    }
  },
  plugins: []
}
