// Sentry PII-szűrés (launch-kapu 8. pont): a hibaeseményből SOHA nem mehet
// ki form-payload (cím/telefon/adószám), URL-beli auth-token (verify/reset)
// vagy Authorization/cookie fejléc. Tiszta unit — DB nem kell hozzá.
import { describe, it, expect } from 'vitest';

const { scrubSentryEvent, scrubUrlLike, REDACTED } = require('../src/utils/sentryScrub');

describe('scrubUrlLike', () => {
  it('token query-paramétert kitakar, a többi paramétert megtartja', () => {
    expect(scrubUrlLike('https://api.gofuvar.hu/auth/verify-email?token=abc123&next=profil'))
      .toBe(`https://api.gofuvar.hu/auth/verify-email?token=${REDACTED}&next=profil`);
  });

  it('query_string alakot (kezdő ? nélkül) is szűr', () => {
    expect(scrubUrlLike('token=abc123&x=1')).toBe(`token=${REDACTED}&x=1`);
  });

  it('a /tracking/:token útvonal-tokent kitakarja', () => {
    expect(scrubUrlLike('https://api.gofuvar.hu/tracking/a1b2c3d4?lang=hu'))
      .toBe(`https://api.gofuvar.hu/tracking/${REDACTED}?lang=hu`);
  });

  it('ártalmatlan URL-t nem bánt', () => {
    const url = 'https://api.gofuvar.hu/jobs?status=bidding&pickup_city=Szeged';
    expect(scrubUrlLike(url)).toBe(url);
  });

  it('nem-string bemenetre nem dob (undefined/null/szám)', () => {
    expect(scrubUrlLike(undefined)).toBeUndefined();
    expect(scrubUrlLike(null)).toBeNull();
    expect(scrubUrlLike(42)).toBe(42);
  });
});

describe('scrubSentryEvent', () => {
  it('a request BODY-t egészében eldobja (cím/telefon sosem megy ki)', () => {
    const event = {
      request: {
        method: 'POST',
        url: 'https://api.gofuvar.hu/jobs',
        data: { pickup_address: 'Budapest, Titkos u. 1.', phone: '+36201234567' },
      },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.data).toBeUndefined();
    expect(out.request.method).toBe('POST'); // a hibakereséshez kell, marad
  });

  it('auth-fejléceket töröl (kis/nagybetűs változatban is), a többi marad', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer xxx', Cookie: 'session=yyy',
          'user-agent': 'Mozilla/5.0', 'content-type': 'application/json',
        },
        cookies: { session: 'yyy' },
      },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.headers.authorization).toBeUndefined();
    expect(out.request.headers.Cookie).toBeUndefined();
    expect(out.request.cookies).toBeUndefined();
    expect(out.request.headers['user-agent']).toBe('Mozilla/5.0');
  });

  it('URL-ben és query_string-ben kitakarja a tokent', () => {
    const event = {
      request: {
        url: 'https://api.gofuvar.hu/auth/verify-email?token=SECRET',
        query_string: 'token=SECRET',
      },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.url).not.toContain('SECRET');
    expect(out.request.query_string).not.toContain('SECRET');
  });

  it('breadcrumb-URL-eket is szűri (navigáció to/from + fetch url)', () => {
    const event = {
      breadcrumbs: [
        { category: 'fetch', data: { url: '/auth/verify-email?token=SECRET', method: 'POST' } },
        { category: 'navigation', data: { from: '/jelszo-reset?token=SECRET', to: '/bejelentkezes' } },
        { category: 'console', data: undefined },
      ],
    };
    const out = scrubSentryEvent(event);
    expect(out.breadcrumbs[0].data.url).not.toContain('SECRET');
    expect(out.breadcrumbs[1].data.from).not.toContain('SECRET');
    expect(out.breadcrumbs[1].data.to).toBe('/bejelentkezes');
  });

  it('sosem dob: üres/furcsa eseményekre az eredetit adja vissza', () => {
    expect(scrubSentryEvent(null)).toBeNull();
    expect(scrubSentryEvent({})).toEqual({});
    expect(scrubSentryEvent({ request: null })).toEqual({ request: null });
  });
});
