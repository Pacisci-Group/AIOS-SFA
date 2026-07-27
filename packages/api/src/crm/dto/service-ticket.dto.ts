import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_NOTE_TYPES,
  SERVICE_TICKET_PRIORITIES,
  SERVICE_TICKET_STATUSES,
} from '@sfa/shared';
import type {
  ServiceTicketCategory,
  ServiceTicketNoteType,
  ServiceTicketPriority,
  ServiceTicketStatus,
} from '@sfa/shared';

export class CreateServiceTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  clientName: string;

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

export class ListTicketsQueryDto {
  @IsOptional()
  @IsIn(SERVICE_TICKET_STATUSES)
  status?: ServiceTicketStatus;
}
