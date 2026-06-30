import { defineConfig } from '@apps-in-toss/web-framework/config'

export default defineConfig({
  appName: 'glance-invest',
  brand: {
    displayName: '한눈투자',
    primaryColor: '#2f6bff',
    icon: '',
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
})
