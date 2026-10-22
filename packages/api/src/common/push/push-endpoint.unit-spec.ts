import { isAllowedPushEndpoint } from './push-endpoint';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/dEvIcE-1:APA91bF%2Fabc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGxxYw',
    'https://db5p.notify.windows.com/w/?token=AwYAAAB',
    'https://FCM.GOOGLEAPIS.COM/fcm/send/upper-case-host',
  ])('accepts a known push service: %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    // The SSRF shapes the review named: any https host is not good enough.
    'https://169.254.169.254/latest/meta-data/',
    'https://internal-service.local/collect',
    'https://attacker.example.com/fcm.googleapis.com/',
    // Look-alikes: a suffix must match on a label boundary.
    'https://fcm.googleapis.com.evil.net/send',
    'https://notpush.services.mozilla.com/x',
    'https://evilpush.apple.com/x',
    // Right host, wrong scheme; and not a URL at all.
    'http://fcm.googleapis.com/fcm/send/x',
    'fcm.googleapis.com/fcm/send/x',
    '',
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});
