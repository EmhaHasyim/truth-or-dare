export function getWsUrl(path: string): string {
  if (typeof window === 'undefined') return ''
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}${path}`
}
