import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { AgencyDocument } from '../../platform/schemas/agency.schema';
import { SenderIdentityService } from './sender-identity.service';

const AGENCY_ID = '507f1f77bcf86cd799439012';
const PLATFORM_FROM = 'AgencyOps <notifications@smithfamily.agency>';

type AgencyLean = Partial<{
  name: string;
  branding: Record<string, unknown>;
  email: Record<string, unknown>;
}> | null;

/** A model stub whose `findById(...).select(...).lean()` yields `agency`. */
function modelReturning(agency: AgencyLean): Model<AgencyDocument> {
  return {
    findById: () => ({
      select: () => ({ lean: () => Promise.resolve(agency) }),
    }),
  } as unknown as Model<AgencyDocument>;
}

function configWith(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function service(agency: AgencyLean, env: Record<string, string> = {}) {
  return new SenderIdentityService(
    modelReturning(agency),
    configWith({ MAIL_DEFAULT_FROM: PLATFORM_FROM, ...env }),
  );
}

describe('SenderIdentityService', () => {
  describe('the default path — no sending domain configured', () => {
    it('sends from our address under the agency name', async () => {
      // Zero DNS work for the agency, and SPF/DKIM still pass against a domain
      // we control. The recipient still sees the agency.
      const { from } = await service({
        name: 'Texas Holdings',
        email: { sendingStatus: 'platform' },
      }).resolve(AGENCY_ID);

      expect(from).toBe('"Texas Holdings" <notifications@smithfamily.agency>');
    });

    it('prefers the configured from-name over the agency name', async () => {
      const { from } = await service({
        name: 'Texas Holdings LLC',
        email: { sendingStatus: 'platform', fromName: 'Texas Holdings' },
      }).resolve(AGENCY_ID);

      expect(from).toContain('"Texas Holdings" <');
    });

    it('uses the agency reply-to so replies reach them with no DNS at all', async () => {
      const { replyTo } = await service({
        name: 'Texas Holdings',
        email: {
          sendingStatus: 'platform',
          replyTo: 'hello@texasholdings.com',
        },
      }).resolve(AGENCY_ID);

      expect(replyTo).toBe('hello@texasholdings.com');
    });
  });

  describe('a verified sending domain', () => {
    it('sends from the agency address', async () => {
      const { from } = await service({
        name: 'Texas Holdings',
        email: {
          sendingStatus: 'verified',
          sendingDomain: 'texasholdings.com',
          fromLocalPart: 'hello',
        },
      }).resolve(AGENCY_ID);

      expect(from).toBe('"Texas Holdings" <hello@texasholdings.com>');
    });

    it('falls back when the domain is verified but no local part is set', async () => {
      // Half-configured is not configured. Sending to `@texasholdings.com`
      // with no mailbox is not a valid address.
      const { from } = await service({
        name: 'Texas Holdings',
        email: {
          sendingStatus: 'verified',
          sendingDomain: 'texasholdings.com',
        },
      }).resolve(AGENCY_ID);

      expect(from).toContain('notifications@smithfamily.agency');
    });
  });

  /**
   * The most important behaviour in this file. Resend rejects an unverified
   * `From:` with `invalid_from_address`, which `ResendTransport` treats as
   * non-retriable — so an optimistic sender here does not delay an invite, it
   * loses it.
   */
  describe.each(['pending', 'failed'])(
    'a %s sending domain',
    (sendingStatus) => {
      it('never sends from the unverified domain', async () => {
        const { from } = await service({
          name: 'Texas Holdings',
          email: {
            sendingStatus,
            sendingDomain: 'texasholdings.com',
            fromLocalPart: 'hello',
          },
        }).resolve(AGENCY_ID);

        expect(from).not.toContain('texasholdings.com');
        expect(from).toContain('notifications@smithfamily.agency');
      });
    },
  );

  describe('header safety', () => {
    it('strips quotes, newlines and angle brackets from an agency name', async () => {
      // An agency name is user-supplied. A bare quote breaks out of the quoted
      // string and a CRLF starts a new header — the latter would add a Bcc.
      const { from } = await service({
        name: 'Evil" <attacker@example.com>, "X\r\nBcc: victim@example.com',
      }).resolve(AGENCY_ID);

      expect(from).not.toContain('\r');
      expect(from).not.toContain('\n');
      expect(from).toBe(
        '"Evil attacker@example.com, XBcc: victim@example.com" <notifications@smithfamily.agency>',
      );
      // Exactly one address in the header, however lenient the parser.
      expect(from.match(/</g)).toHaveLength(1);
    });

    it('does not nest the configured header inside a new one', async () => {
      // `MAIL_DEFAULT_FROM` is a full `Name <addr>` header. Naively prefixing a
      // display name would produce `A <B <c@d>>`, which Resend rejects
      // permanently.
      const { from } = await service({ name: 'Texas Holdings' }).resolve(
        AGENCY_ID,
      );

      expect(from.match(/</g)?.length).toBe(1);
    });
  });

  describe('no agency', () => {
    it.each([null, undefined, 'not-an-object-id'])(
      'falls back to the platform sender for %p',
      async (agencyId) => {
        const { from } = await service(null).resolve(agencyId);
        expect(from).toBe(PLATFORM_FROM);
      },
    );

    it('falls back when the agency no longer exists', async () => {
      // An email must still send if its agency was deleted mid-flight.
      const { from } = await service(null).resolve(AGENCY_ID);
      expect(from).toBe(PLATFORM_FROM);
    });
  });
});
