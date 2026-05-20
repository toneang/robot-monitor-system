module.exports = {
  content: [
    "./public/**/*.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: '#165DFF',
        success: '#00B42A',
        warning: '#FF7D00',
        danger: '#F53F3F',
        pending: '#86909C',
        charging: '#722ED1',
        history: '#E5E6EB',
        current: '#165DFF',
        future: '#00B42A'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};