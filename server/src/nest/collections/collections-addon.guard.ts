import { CanActivate, HttpException, Injectable } from '@nestjs/common';
import { AddonsService } from '../addons/addons.service';
import { ADDON_IDS } from '../../addons';

/**
 * Mirrors the addon mount gate: when the Collections addon is disabled the whole
 * route group answers 404, regardless of auth. Declared before JwtAuthGuard so
 * the addon check wins over the 401, exactly as the Journey addon guard does.
 */
@Injectable()
export class CollectionsAddonGuard implements CanActivate {
  constructor(private readonly addons: AddonsService) {}

  canActivate(): boolean {
    if (!this.addons.isAddonEnabled(ADDON_IDS.COLLECTIONS)) {
      throw new HttpException({ error: 'Collections addon is not enabled' }, 404);
    }
    return true;
  }
}
