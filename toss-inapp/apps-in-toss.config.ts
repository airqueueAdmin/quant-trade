import { defineConfig } from '@apps-in-toss/web-framework/config'

export default defineConfig({
  appName: 'glance-invest',
  brand: {
    primaryColor: '#2f6bff',
  },
  webView: {},
  navigationBar: {
    withBackButton: true,
    withHomeButton: false,
    withTitle: true,
    transparentBackground: false,
  },
  permissions: [],
  webBundleDir: 'dist',
})
