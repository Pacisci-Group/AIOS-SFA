import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  scheduleFromWorkweek,
  weeklyMinutes,
  type AccessContext,
  type WorkSchedule,
  type WorkScheduleTemplateView,
  type WorkScheduleTemplatesResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { validateSchedule } from '../common/hr/employee-profile.rules';
import { EmployeeProfilesService } from '../common/hr/employee-profiles.service';
import { WorkingDaysService } from '../common/working-days/working-days.service';
import type {
  CreateScheduleTemplateDto,
  UpdateScheduleTemplateDto,
} from './dto/schedule-template.dto';
import {
  WorkScheduleTemplate,
  type WorkScheduleTemplateDocument,
} from './schemas/work-schedule-template.schema';

type TemplateLean = {
  _id: Types.ObjectId;
  agencyId: string;
  name: string;
  status: 'active' | 'archived';
  version: number;
  schedule: WorkSchedule;
  archivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

/**
 * Work schedule templates (PAC-162) — `agency:hr:admin` throughout. Shaped
 * like `LeavePoliciesService`: zero templates is a state (everyone is on
 * the workweek), a name is unique among active ones, and an archive 409s
 * while a non-terminated profile references the template.
 */
@Injectable()
export class ScheduleTemplatesService {
  constructor(
    @InjectModel(WorkScheduleTemplate.name)
    private readonly templates: Model<WorkScheduleTemplateDocument>,
    private readonly workingDays: WorkingDaysService,
    private readonly profiles: EmployeeProfilesService,
  ) {}

  async list(agencyId: string): Promise<WorkScheduleTemplatesResponse> {
    const rows = await this.templates
      .find({ agencyId })
      .sort({ status: 1, name: 1 })
      .collation({ locale: 'en', strength: 2 })
      .lean<TemplateLean[]>();
    return {
      templates: await Promise.all(rows.map((row) => this.toView(row))),
    };
  }

  async get(agencyId: string, id: string): Promise<WorkScheduleTemplateView> {
    return this.toView(await this.find(agencyId, id));
  }

  async create(
    access: AccessContext,
    agencyId: string,
    dto: CreateScheduleTemplateDto,
  ): Promise<WorkScheduleTemplateView> {
    await this.assertNameFree(agencyId, dto.name);
    const schedule =
      dto.schedule ??
      scheduleFromWorkweek(
        (await this.workingDays.settings(agencyId)).workweek,
      );
    this.assertValid(schedule);
    const created = await this.templates.create({
      agencyId,
      name: dto.name,
      status: 'active',
      version: 1,
      schedule,
    });
    return this.get(agencyId, created._id.toHexString());
  }

  async update(
    access: AccessContext,
    agencyId: string,
    id: string,
    dto: UpdateScheduleTemplateDto,
  ): Promise<WorkScheduleTemplateView> {
    const current = await this.find(agencyId, id);
    if (current.status !== 'active') {
      throw new ConflictException('An archived schedule cannot be edited.');
    }
    if (dto.name !== undefined && dto.name !== current.name) {
      await this.assertNameFree(agencyId, dto.name);
    }
    if (dto.schedule !== undefined) this.assertValid(dto.schedule);
    await this.templates.updateOne(
      { _id: current._id, agencyId },
      {
        $set: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.schedule !== undefined ? { schedule: dto.schedule } : {}),
        },
        $inc: { version: 1 },
      },
    );
    return this.get(agencyId, id);
  }

  /** 409 while any non-terminated employee is on it. */
  async archive(
    access: AccessContext,
    agencyId: string,
    id: string,
  ): Promise<WorkScheduleTemplateView> {
    const current = await this.find(agencyId, id);
    if (current.status === 'archived') return this.toView(current);
    const employees = await this.profiles.employeesOnScheduleTemplate(
      agencyId,
      current._id,
    );
    if (employees > 0) {
      throw new ConflictException(
        `Move ${employees} employee${employees === 1 ? '' : 's'} to another schedule first.`,
      );
    }
    await this.templates.updateOne(
      { _id: current._id, agencyId, status: 'active' },
      {
        $set: {
          status: 'archived',
          archivedAt: new Date(),
          archivedBy: new Types.ObjectId(access.userId),
        },
      },
    );
    return this.get(agencyId, id);
  }

  private async find(agencyId: string, id: string): Promise<TemplateLean> {
    const row = await this.templates
      .findOne({ _id: new Types.ObjectId(id), agencyId })
      .lean<TemplateLean | null>();
    if (!row) throw new NotFoundException('Schedule template not found');
    return row;
  }

  private async assertNameFree(agencyId: string, name: string): Promise<void> {
    const clash = await this.templates.exists({
      agencyId,
      status: 'active',
      name: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
    });
    if (clash) {
      throw new ConflictException(
        `An active schedule named "${name}" already exists.`,
      );
    }
  }

  private assertValid(schedule: WorkSchedule): void {
    const problems = validateSchedule(schedule);
    if (problems.length > 0) {
      throw new BadRequestException(problems.join(' '));
    }
    if (Object.values(schedule).every((day) => !day)) {
      throw new BadRequestException('A schedule needs at least one shift.');
    }
  }

  private async toView(row: TemplateLean): Promise<WorkScheduleTemplateView> {
    return {
      id: row._id.toHexString(),
      name: row.name,
      status: row.status,
      version: row.version,
      schedule: row.schedule,
      weeklyMinutes: weeklyMinutes(row.schedule),
      employeeCount: await this.profiles.employeesOnScheduleTemplate(
        row.agencyId,
        row._id,
      ),
      createdAt: (row.createdAt ?? new Date(0)).toISOString(),
      updatedAt: (row.updatedAt ?? row.createdAt ?? new Date(0)).toISOString(),
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
