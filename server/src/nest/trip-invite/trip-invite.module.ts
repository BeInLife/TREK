import { Module } from '@nestjs/common';
import { TripInviteLinkController, TripInviteController } from './trip-invite.controller';
import { TripInviteService } from './trip-invite.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PermissionsModule],
  controllers: [TripInviteLinkController, TripInviteController],
  providers: [TripInviteService, RateLimitService],
})
export class TripInviteModule {}
