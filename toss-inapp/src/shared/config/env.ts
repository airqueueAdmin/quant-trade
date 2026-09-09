const fallbackBackendUrl = 'http://127.0.0.1:8000'

function readConfiguredValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readAdGroupId(value: unknown) {
  const adGroupId = readConfiguredValue(value)

  // Test ad groups must never be embedded in a mini-app bundle. When no
  // console-issued ID is configured, the ad feature stays disabled.
  return /(?:^|[-_.])test(?:[-_.]|$)/i.test(adGroupId) ? '' : adGroupId
}

function readConsoleIdentifier(value: unknown) {
  const identifier = readConfiguredValue(value)

  // Do not activate a test or placeholder promotion module in any build.
  return /(?:^|[-_.])test(?:[-_.]|$)|replace[-_ ]?with/i.test(identifier)
    ? ''
    : identifier
}

const configuredInterstitialAdGroupId = (
  readAdGroupId(import.meta.env.VITE_INTERSTITIAL_AD_GROUP_ID)
)

const configuredRewardedAdGroupId = (
  readAdGroupId(import.meta.env.VITE_REWARDED_AD_GROUP_ID)
)

const configuredBannerAdGroupId = (
  readAdGroupId(import.meta.env.VITE_BANNER_AD_GROUP_ID)
)

const configuredContactsViralModuleId = (
  readConsoleIdentifier(import.meta.env.VITE_CONTACTS_VIRAL_MODULE_ID)
)

export const env = {
  backendUrl: (import.meta.env.VITE_BACKEND_URL || fallbackBackendUrl).trim(),
  ads: {
    interstitialAdGroupId: configuredInterstitialAdGroupId,
    rewardedAdGroupId: configuredRewardedAdGroupId,
    bannerAdGroupId: configuredBannerAdGroupId,
  },
  rewards: {
    contactsViralModuleId: configuredContactsViralModuleId,
  },
}
