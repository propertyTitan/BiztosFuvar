// Sentry PII-szűrés web-oldal (launch-kapu 8. pont): a jelszó-reset /
// email-verify oldalak URL-tokenje és a form-payload sosem mehet ki a
// hibaeseménnyel.
import { describe, it, expect } from 'vitest';
import { scrubSentryEvent, scrubUrlLike } from './sentryScrub';

describe('scrubUrlLike (web)', () => {
  it('a jelszó-reset token-paramétert kitakarja', () => {
    expect(scrubUrlLike('https://gofuvar.hu/jelszo-reset?token=SECRET'))
      .not.toContain('SECRET');
  });

  it('a /nyomon-kovetes/:token útvonal-tokent kitakarja', () => {
    expect(scrubUrlLike('https://gofuvar.hu/nyomon-kovetes/a1b2c3'))
      .not.toContain('a1b2c3');
  });

  it('ártalmatlan oldal-URL-t nem bánt', () => {
    const url = 'https://gofuvar.hu/sofor/fuvarok?pickup_city=Szeged';
    expect(scrubUrlLike(url)).toBe(url);
  });
});

describe('scrubSentryEvent (web)', () => {
  it('body-t dob, tokent takar, auth-fejlécet töröl', () => {
    const out = scrubSentryEvent({
      request: {
        url: 'https://gofuvar.hu/email-megerositese?token=SECRET',
        data: { phone: '+36201234567' },
        headers: { authorization: 'Bearer xxx', 'user-agent': 'ua' },
      },
    });
    expect(out.request.data).toBeUndefined();
    expect(out.request.url).not.toContain('SECRET');
    expect(out.request.headers.authorization).toBeUndefined();
    expect(out.request.headers['user-agent']).toBe('ua');
  });

  it('breadcrumb-navigációból is kitakarja a tokent', () => {
    const out = scrubSentryEvent({
      breadcrumbs: [
        { category: 'navigation', data: { from: '/jelszo-reset?token=SECRET', to: '/' } },
      ],
    });
    expect(out.breadcrumbs![0].data.from).not.toContain('SECRET');
  });

  it('sosem dob üres eseményre', () => {
    expect(scrubSentryEvent({})).toEqual({});
  });
});
