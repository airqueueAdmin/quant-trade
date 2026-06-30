const fallbackBackendUrl = 'http://127.0.0.1:8000'

export const env = {
  backendUrl: (import.meta.env.VITE_BACKEND_URL || fallbackBackendUrl).trim(),
}
