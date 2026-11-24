/** Public names and links. Update REPO_URL if you fork or rename the project. */
export const APP_NAME = 'Bluetick'
export const REPO_URL = 'https://github.com/voirlabs/bluetick'

/** Public base URL of this deployment; Meta delivers webhooks here. */
export const APP_URL = (
  process.env['NEXT_PUBLIC_APP_URL']?.trim() || 'http://localhost:3000'
).replace(/\/+$/, '')
