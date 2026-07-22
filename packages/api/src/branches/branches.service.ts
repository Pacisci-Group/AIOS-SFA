import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Branch, BranchDocument } from './schemas/branch.schema';

@Injectable()
export class BranchesService {
  constructor(
    @InjectModel(Branch.name) private branchModel: Model<BranchDocument>,
  ) {}

  findByAgency(agencyId: string) {
    return this.branchModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ isDefault: -1, name: 1 })
      .lean();
  }

  async findById(agencyId: string, branchId: string) {
    const branch = await this.branchModel
      .findOne({
        _id: new Types.ObjectId(branchId),
        agencyId: new Types.ObjectId(agencyId),
      })
      .lean();
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    return branch;
  }

  create(
    agencyId: string,
    input: { name: string; slug: string; isDefault?: boolean },
  ) {
    return this.branchModel.create({
      agencyId: new Types.ObjectId(agencyId),
      name: input.name,
      slug: input.slug,
      isDefault: input.isDefault ?? false,
    });
  }
}
