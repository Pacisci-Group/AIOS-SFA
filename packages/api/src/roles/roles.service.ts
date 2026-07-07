import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AgencyRole, AgencyRoleDocument } from './schemas/agency-role.schema';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(AgencyRole.name) private roleModel: Model<AgencyRoleDocument>,
  ) {}

  findByAgency(agencyId: string) {
    return this.roleModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ name: 1 })
      .lean();
  }

  async findById(agencyId: string, roleId: string) {
    const role = await this.roleModel
      .findOne({
        _id: new Types.ObjectId(roleId),
        agencyId: new Types.ObjectId(agencyId),
      })
      .lean();
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }
}
