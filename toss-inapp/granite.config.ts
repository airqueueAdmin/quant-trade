import { defineConfig } from '@apps-in-toss/web-framework/config'

export default defineConfig({
  appName: 'glance-invest',
  brand: {
    displayName: '한눈투자',
    primaryColor: '#2f6bff',
    icon: 'https://static.toss.im/appsintoss/55493/7e45fd4d-c4f7-4991-a390-f815534f9719.png',
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
