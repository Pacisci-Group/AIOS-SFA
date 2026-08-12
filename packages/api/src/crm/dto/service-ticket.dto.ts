import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ONBOARDING_EMAIL_MILESTONE_KEYS,
  RENEWAL_OUTCOMES,
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_NOTE_TYPES,
  SERVICE_TICKET_PRIORITIES,
  SERVICE_TICKET_STATUSES,
} from '@sfa/shared';
import type {
  OnboardingEmailMilestoneKey,
  RenewalOutcome,
  ServiceTicketCategory,
  ServiceTicketNoteType,
  ServiceTicketPriority,
  ServiceTicketStatus,
} from '@sfa/shared';

export class CreateServiceTicketDto {
  /**
   * Optional: when a household or policy is linked, the client name is taken
   * from that record instead of being typed in.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  clientName?: string;

  @IsIn(SERVICE_TICKET_CATEGORIES)
  category: ServiceTicketCategory;

  @IsOptional()
  @IsIn(SERVICE_TICKET_PRIORITIES)
  priority?: ServiceTicketPriority;

  @IsOptional()
  @IsIn(SERVICE_TICKET_STATUSES)
  status?: ServiceTicketStatus;

  @IsOptional()
  @IsMongoId()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  assignedRep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  policyNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  policyType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  household?: string;

  /** Optional links to the real client records. */
  @IsOptional()
  @IsMongoId()
  policyId?: string;

  @IsOptional()
  @IsMongoId()
  householdId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** Optional opening note recorded as the first timeline entry. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  openingNote?: string;
}

export class UpdateStatusDto {
  @IsIn(SERVICE_TICKET_STATUSES)
  status: ServiceTicketStatus;
}

export class AddNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;

  /** What kind of touchpoint this is (defaults to an internal note). */
  @IsOptional()
  @IsIn(SERVICE_TICKET_NOTE_TYPES)
  type?: ServiceTicketNoteType;
}

/**
 * Toggle onboarding checklist items. Every field is optional — the caller
 * sends only the boxes it is changing. These land on the per-client
 * `Onboarding` record, not the ticket.
 */
export class UpdateOnboardingChecklistDto {
  @IsOptional()
  @IsBoolean()
  mortgageeClauseVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  loanNumberVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  portalAccessVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  rulesOfEngagementSet?: boolean;

  /** Asked for during the 30-day call, which is why it is not its own step. */
  @IsOptional()
  @IsBoolean()
  googleReviewRequested?: boolean;
}

/**
 * Mark a client touchpoint as having gone out. Nothing is sent — there is no
 * mailer; `recorded: false` clears the timestamp if it was marked in error.
 */
export class UpdateOnboardingEmailsDto {
  @IsIn(ONBOARDING_EMAIL_MILESTONE_KEYS)
  milestone: OnboardingEmailMilestoneKey;

  @IsOptional()
  @IsBoolean()
  recorded?: boolean;
}

/* -------------------------------------------------------------------------- *
 * Proactive renewal outreach
 * -------------------------------------------------------------------------- */

/**
 * Tick one policy off the call's checklist. Addressed by ticket id — the CSR
 * reaches it from the call in front of them — but persisted on the parent
 * `RenewalCycle`, since the checklist describes the deal, not one call.
 */
export class UpdateRenewalPoliciesDto {
  @IsString()
  policyId: string;

  @IsOptional()
  @IsBoolean()
  discussed?: boolean;
}

/**
 * Close a renewal call.
 *
 * `outcome` is **required on the renewal review** and rejected on the annual
 * review: the 45-day call is where the client decides, and a completed one
 * with no recorded decision is exactly the reporting hole this closes.
 */
export class CompleteRenewalStepDto {
  @IsOptional()
  @IsIn(RENEWAL_OUTCOMES)
  outcome?: RenewalOutcome;

  @IsOptional()
  @IsString()
  note?: string;
}

/** Correct a recorded outcome — CSRs mis-click, and clients change their minds. */
export class SetRenewalOutcomeDto {
  @IsIn(RENEWAL_OUTCOMES)
  outcome: RenewalOutcome;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ListTicketsQueryDto {
  @IsOptional()
  @IsIn(SERVICE_TICKET_STATUSES)
  status?: ServiceTicketStatus;

  @IsOptional()
  @IsIn(SERVICE_TICKET_CATEGORIES)
  category?: ServiceTicketCategory;

  /**
   * Archive window filter. Omitted (the default) returns only active tickets —
   * resolved ones drop out once they pass the archive window. `true` returns
   * exactly those archived tickets.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  archived?: boolean;
}
