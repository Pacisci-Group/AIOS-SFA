import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  ProducerGoal,
  ProducerGoalSchema,
} from '../producer-goals/schemas/producer-goal.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

// `ProducerGoal` has never been registered in a module before — the migration
// and demo seed write it, and this is its first read path. Registering it here
// is also what finally builds its indexes on a running API.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: ProducerGoal.name, schema: ProducerGoalSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}
