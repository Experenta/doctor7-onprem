'use strict';

// A small cookie store that behaves like a browser for one site. A cookie is
// sent only to the host that set it, and only on paths that match its Path. The
// Secure flag is kept but not checked, so a run over loopback HTTP still works.
// Cookie values are never printed by the smoke.

function pathMatches(requestPath, cookiePath) {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
}

class CookieJar {
  constructor() {
    this.cookies = [];
  }

  // Stores the cookies of one response. A cookie with an empty value or a
  // Max-Age of zero or less removes the cookie of the same name and path.
  store(url, setCookieHeaders) {
    const { host } = new URL(url);
    for (const raw of setCookieHeaders) {
      const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
      const equals = pair.indexOf('=');
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      let path = '/';
      let expired = value === '';
      for (const attribute of attributes) {
        const separator = attribute.indexOf('=');
        const key = (separator === -1 ? attribute : attribute.slice(0, separator)).toLowerCase();
        const argument = separator === -1 ? '' : attribute.slice(separator + 1);
        if (key === 'path' && argument.startsWith('/')) path = argument;
        if (key === 'max-age' && Number(argument) <= 0) expired = true;
      }
      this.cookies = this.cookies.filter((cookie) => !(cookie.host === host && cookie.name === name && cookie.path === path));
      if (!expired) {
        this.cookies.push({ host, name, value, path });
      }
    }
  }

  // The Cookie header for a request to `url`, or an empty string.
  headerFor(url) {
    const target = new URL(url);
    return this.cookies
      .filter((cookie) => cookie.host === target.host && pathMatches(target.pathname, cookie.path))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }
}

module.exports = { CookieJar, pathMatches };
