const fallbackBackendUrl = 'http://127.0.0.1:8000'
const testInterstitialAdGroupId = 'ait-ad-test-interstitial-id'
const testRewardedAdGroupId = 'ait-ad-test-rewarded-id'
const testBannerAdGroupId = 'ait-ad-test-banner-id'

const configuredInterstitialAdGroupId = (
  import.meta.env.VITE_INTERSTITIAL_AD_GROUP_ID || ''
).trim()

const configuredRewardedAdGroupId = (
  import.meta.env.VITE_REWARDED_AD_GROUP_ID || ''
).trim()

const configuredBannerAdGroupId = (
  import.meta.env.VITE_BANNER_AD_GROUP_ID || ''
).trim()

const configuredContactsViralModuleId = (
  import.meta.env.VITE_CONTACTS_VIRAL_MODULE_ID || ''
).trim()

export const env = {
  backendUrl: (import.meta.env.VITE_BACKEND_URL || fallbackBackendUrl).trim(),
  ads: {
    // Never use a live ad group while running the local development server.
    interstitialAdGroupId: import.meta.env.DEV
      ? testInterstitialAdGroupId
      : configuredInterstitialAdGroupId,
    rewardedAdGroupId: import.meta.env.DEV
      ? testRewardedAdGroupId
      : configuredRewardedAdGroupId,
    bannerAdGroupId: import.meta.env.DEV
      ? testBannerAdGroupId
      : configuredBannerAdGroupId,
  },
  rewards: {
    contactsViralModuleId: configuredContactsViralModuleId,
  },
}
