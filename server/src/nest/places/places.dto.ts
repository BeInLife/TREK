import { createZodDto } from 'nestjs-zod';
import { placeRatingRequestSchema } from '@trek/shared';

/**
 * Server-side createZodDto wrappers over the @trek/shared places contracts.
 * Typing a controller parameter with one of these classes is what lets the
 * global ZodValidationPipe (APP_PIPE) validate it by metatype — the Zod
 * schemas in shared/ remain the single source of truth for the contract.
 */

export class PlaceRatingDto extends createZodDto(placeRatingRequestSchema) {}
