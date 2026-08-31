import path from 'node:path'

export const REMOTE_URL_RE: RegExp = /^https?:\/\//
// unquoted urls cannot contain unescaped parentheses, and excluding them keeps
// backtracking linear on input like `url((((...`
const URL_RE_G = /url\((?:'([^']*)'|"([^"]*)"|([^()]*))\)/gi
const ABSOLUTE_URL_RE = /^(?:[a-z][\w+.-]*:|\/\/|\/|#)/i

/**
 * Resolve a `url()` value that is relative to `baseHref` (the location of the
 * stylesheet it was declared in) so that it can be used from the document instead.
 */
export function resolveCssUrl(url: string, baseHref: string): string {
  if (!url || ABSOLUTE_URL_RE.test(url)) {
    return url
  }

  const base = baseHref.split('?')[0]!.split('#')[0]!

  if (REMOTE_URL_RE.test(base) || base.startsWith('//')) {
    try {
      const resolved = new URL(url, base.startsWith('//') ? `https:${base}` : base)
      return base.startsWith('//') ? resolved.href.replace(REMOTE_URL_RE, '//') : resolved.href
    }
    catch {
      return url
    }
  }

  const dir = path.posix.dirname(base)
  // the stylesheet sits alongside the document, so relative urls already resolve correctly
  if (dir === '.' || dir === '') {
    return url
  }

  return path.posix.join(dir, url)
}

export function rewriteCssUrls(css: string, baseHref: string): string {
  return css.replace(URL_RE_G, (match, singleQuoted?: string, doubleQuoted?: string, bare?: string) => {
    const quote = singleQuoted !== undefined ? '\'' : doubleQuoted !== undefined ? '"' : ''
    const url = singleQuoted ?? doubleQuoted ?? bare?.trim() ?? ''
    const resolved = resolveCssUrl(url, baseHref)
    return resolved === url ? match : `url(${quote}${resolved}${quote})`
  })
}
