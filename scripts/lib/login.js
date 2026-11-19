'use strict';

// Signs in through the identity provider the way a browser does, one redirect at
// a time. The account is chosen by its e-mail address on the provider's page. The
// e-mail is only used to find the account, and it is never printed.

const { CookieJar } = require('./cookies');
const { send, SmokeFailure } = require('./http');

function decodeEntities(value) {
  return value.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&amp;/g, '&');
}

// Reads the sign-in page: the form action, its hidden fields, and the value of
// the account button whose block shows `email`. Throws when the account is not offered.
function parseAccountForm(html, email) {
  const form = /<form\b[^>]*\baction="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!form) {
    throw new SmokeFailure('the sign-in page has no form');
  }
  const formBody = form[2];
  const fields = [...formBody.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((match) => [
    decodeEntities(match[1]),
    decodeEntities(match[2]),
  ]);
  const block = formBody
    .split('<li class="account">')
    .slice(1)
    .find((item) => item.includes(`<span>${email}</span>`));
  const button = block ? /<button[^>]*\bname="user" value="([^"]+)"/.exec(block) : null;
  if (!button) {
    throw new SmokeFailure('the sign-in page does not offer this demo account');
  }
  return { action: decodeEntities(form[1]), fields, user: decodeEntities(button[1]) };
}

// True when the callback set a cookie with a value and no removal.
function issuedSession(setCookies) {
  return setCookies.some((raw) => {
    const pair = raw.split(';')[0];
    const value = pair.slice(pair.indexOf('=') + 1).trim();
    return value !== '' && !/;\s*max-age=(0|-\d+)\s*(;|$)/i.test(raw);
  });
}

// Runs the sign-in for one account. Returns { status, sessionIssued, jar }.
// `ctx` gives the API address builder and the site origin.
async function signIn(ctx, email) {
  const jar = new CookieJar();

  const start = await send(ctx.api('/auth/login'), { jar });
  if (start.status !== 302 || !start.location) {
    throw new SmokeFailure(`sign-in did not start (HTTP ${start.status})`);
  }

  const page = await send(start.location, { jar });
  if (page.status !== 200) {
    throw new SmokeFailure(`the identity provider page answered HTTP ${page.status}`);
  }
  const form = parseAccountForm(page.text, email);

  const submitted = await send(form.action, {
    method: 'POST',
    jar,
    origin: ctx.origin,
    form: [...form.fields, ['user', form.user]],
  });
  if (submitted.status !== 302 || !submitted.location) {
    throw new SmokeFailure(`the identity provider did not accept the account (HTTP ${submitted.status})`);
  }

  const callback = await send(submitted.location, { jar });
  return {
    status: callback.status,
    sessionIssued: issuedSession(callback.setCookies),
    jar,
  };
}

module.exports = { signIn, parseAccountForm, issuedSession };
