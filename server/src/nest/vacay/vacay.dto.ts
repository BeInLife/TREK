/**
 * Server-side createZodDto wrappers over the @trek/shared vacay contracts, so
 * the global ZodValidationPipe (APP_PIPE) validates bodies by metatype — the
 * shared Zod schemas stay the single source of truth.
 */
import { createZodDto } from 'nestjs-zod';
import { vacayShareUpdateRequestSchema, vacayYearSettingsRequestSchema } from '@trek/shared';

export class VacayYearSettingsDto extends createZodDto(vacayYearSettingsRequestSchema) {}
export class VacayShareUpdateDto extends createZodDto(vacayShareUpdateRequestSchema) {}
