const fallbackBackendUrl = 'http://127.0.0.1:8000'
const testInterstitialAdGroupId = 'ait-ad-test-interstitial-id'

const configuredInterstitialAdGroupId = (
  import.meta.env.VITE_INTERSTITIAL_AD_GROUP_ID || ''
).trim()

export const env = {
  backendUrl: (import.meta.env.VITE_BACKEND_URL || fallbackBackendUrl).trim(),
  ads: {
    // Never use a live ad group while running the local development server.
    interstitialAdGroupId: import.meta.env.DEV
      ? testInterstitialAdGroupId
      : configuredInterstitialAdGroupId,
  },
}
