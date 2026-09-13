import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AcmeChallengeController } from './acme-challenge.controller';
import { AcmeChallengeService } from './acme-challenge.service';
import { CertificateRegistrationService } from './certificate-registration.service';
import {
  AcmeChallenge,
  AcmeChallengeSchema,
} from './schemas/acme-challenge.schema';
import { Certificate, CertificateSchema } from './schemas/certificate.schema';

/**
 * The API side of the certificate lifecycle.
 *
 * Deliberately thin. Everything that *obtains* a certificate lives in the
 * worker (`src/worker/acme/`), because ACME is slow, externally rate-limited
 * work that needs durable retries and a schedule — which is the definition of
 * what this codebase hands to Inngest. What is left on the API side is the one
 * thing that must answer a request: the `http-01` responder.
 *
 * ## Why the schemas live here and not in the worker
 * Three processes read this data — the API (challenge responses), the worker
 * (issuance and renewal) and, from Phase 3, the TLS edge (certificate lookup on
 * every cold handshake). None of them owns it. Putting the schemas in the
 * worker would put the shared definition behind the extraction boundary, which
 * forbids anything outside `src/worker/` from importing it — so the API could
 * not answer a challenge without duplicating the schema.
 *
 * The worker imports these schemas across the boundary, which is explicitly
 * allowed: schemas and pure helpers cross, feature services do not.
 *
 * ## Naming
 * `src/tls/` for the feature, `src/worker/acme/` for the machinery. Not
 * `src/worker/tls/` — the eslint boundary matches import *strings*, so a worker
 * subdirectory sharing a name with a feature directory makes the rule fire on
 * the worker's own relative imports. The same trap already forced
 * `src/worker/email/` rather than `src/worker/mail/`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AcmeChallenge.name, schema: AcmeChallengeSchema },
      // Registered although no API-side consumer reads it yet: the edge's
      // certificate lookup lands here in Phase 3, and `autoIndex` needs the
      // model compiled somewhere the API boots for the unique hostname index to
      // exist in environments where the worker has not yet run.
      { name: Certificate.name, schema: CertificateSchema },
    ]),
  ],
  controllers: [AcmeChallengeController],
  providers: [AcmeChallengeService, CertificateRegistrationService],
  // Exported for `AgencyDomainsService`, which registers a hostname the
  // moment it decides the domain may serve. Nothing else should write to
  // the `certificates` collection from the API side.
  exports: [CertificateRegistrationService],
})
export class TlsModule {}
