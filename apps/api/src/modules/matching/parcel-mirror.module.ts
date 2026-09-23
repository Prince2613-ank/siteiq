import { Module } from '@nestjs/common';
import { ParcelMirrorRepository } from './parcel-mirror.repository';
import { ZoningDistrictRepository } from './zoning-district.repository';

/**
 * Split out from MatchingModule so FieldsModule (which needs these
 * repositories for enrichment) and MatchingModule (which needs
 * ParcelMirrorRepository for the matching pipeline) can both depend on
 * them without MatchingModule and FieldsModule importing each other.
 */
@Module({
  providers: [ParcelMirrorRepository, ZoningDistrictRepository],
  exports: [ParcelMirrorRepository, ZoningDistrictRepository],
})
export class ParcelMirrorModule {}
