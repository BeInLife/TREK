import { CanActivate, HttpException, Injectable } from '@nestjs/common';
import { AddonsService } from '../addons/addons.service';
import { ADDON_IDS } from '../../addons';

/**
 * Gates the AirTrail integration routes on the global `airtrail` addon. When the
 * admin has it disabled the whole group answers 404. Declared before the
 * JwtAuthGuard so the addon check wins over the 401 (same ordering as the
 * Journey addon gate).
 */
@Injectable()
export class AirtrailAddonGuard implements CanActivate {
  constructor(private readonly addons: AddonsService) {}

  canActivate(): boolean {
    if (!this.addons.isAddonEnabled(ADDON_IDS.AIRTRAIL)) {
      throw new HttpException({ error: 'AirTrail addon is not enabled' }, 404);
    }
    return true;
  }
}
