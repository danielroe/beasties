/**
 * Conservative allowlist for re-emitting a `media` attribute value into
 * generated JavaScript. `validateMediaQuery()` parses the query but tolerates
 * quotes and semicolons, which would break out of the `onload` handler that the
 * `media` and `js*` strategies build.
 *
 * @see https://github.com/angular/angular-cli/issues/33342
 */
const SAFE_MEDIA_RE = /^[\w\s\-(),:.]+$/

export function isSafeMediaValue(media: string): boolean {
  return SAFE_MEDIA_RE.test(media)
}
