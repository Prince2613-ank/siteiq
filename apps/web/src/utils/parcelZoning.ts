// One palette shared by zoning filters, map parcels, and property information.
export const ZONING_COLORS = {
  residential: '#E5AE38',
  commercial: '#E16B5A',
  industrial: '#8963C4',
  mixedUse: '#4589CC',
  officePark: '#279C9B',
  openSpace: '#4F9565',
} as const;
export const ZONING_DISTRICTS = [
  { code: '6M', name: 'Smithtown Village & North Village Mixed Use', color: ZONING_COLORS.mixedUse },
  { code: '6R', name: 'Smithtown Village Residential', color: ZONING_COLORS.residential },
  { code: 'C', name: 'Commercial / General Commercial', color: ZONING_COLORS.commercial },
  { code: 'C2', name: 'Commercial II', color: ZONING_COLORS.commercial },
  { code: 'C3', name: 'Office Park / Commercial III', color: ZONING_COLORS.commercial },
  { code: 'C4', name: 'Commercial IV', color: ZONING_COLORS.commercial },
  { code: 'COM', name: 'Commercial (Generic Class)', color: ZONING_COLORS.commercial },
  { code: 'I', name: 'Industrial / Light Industrial', color: ZONING_COLORS.industrial },
  { code: 'LM', name: 'Lafayette-Main Commercial District', color: ZONING_COLORS.commercial },
  { code: 'LM-A', name: 'Lafayette-Main Sub-district A', color: ZONING_COLORS.officePark },
  { code: 'LM-C', name: 'Lafayette-Main Sub-district C', color: ZONING_COLORS.mixedUse },
  { code: 'OP', name: 'Office Park District', color: ZONING_COLORS.officePark },
  { code: 'OSC', name: 'Open Space Conservancy', color: ZONING_COLORS.openSpace },
  { code: 'R1', name: 'Low-Density Residential', color: ZONING_COLORS.residential },
  { code: 'R2', name: 'Medium-Density Residential', color: ZONING_COLORS.residential },
  { code: 'R20', name: 'Residence 20 (20,000 sq. ft. min)', color: ZONING_COLORS.residential },
  { code: 'R-20', name: 'Residence 20 (20,000 sq. ft. min)', color: ZONING_COLORS.residential },
  { code: 'R40', name: 'Residence 40 (40,000 sq. ft. min)', color: ZONING_COLORS.residential },
  { code: 'R8', name: 'Residence 8 (8,000 sq. ft. min)', color: ZONING_COLORS.residential },
  { code: 'RC', name: 'Rural Cluster', color: ZONING_COLORS.openSpace },
  { code: 'RCZD', name: 'Regional Commercial Zoning District', color: ZONING_COLORS.commercial },
  { code: 'RES', name: 'Residential (Generic Class)', color: ZONING_COLORS.residential },
  { code: 'RESIDNTL', name: 'Residential (Generic Class)', color: ZONING_COLORS.residential },
] as const;

// Zoning families retain the district groupings from the reference sheet.
export const ZONING_GROUPS = [
  { id: 'residential', name: 'Residential', color: ZONING_COLORS.residential, codes: ['6R', 'R1', 'R2', 'R8', 'R20', 'R-20', 'R40', 'RES', 'RESIDNTL'] },
  { id: 'commercial', name: 'Commercial', color: ZONING_COLORS.commercial, codes: ['C', 'C2', 'C3', 'C4', 'COM', 'LM', 'RCZD'] },
  { id: 'industrial', name: 'Industrial', color: ZONING_COLORS.industrial, codes: ['I'] },
  { id: 'mixed-use', name: 'Mixed Use', color: ZONING_COLORS.mixedUse, codes: ['6M', 'LM-C'] },
  { id: 'office-park', name: 'Office Park & Business', color: ZONING_COLORS.officePark, codes: ['LM-A', 'OP'] },
  { id: 'open-space', name: 'Open Space & Rural', color: ZONING_COLORS.openSpace, codes: ['OSC', 'RC'] },
] as const;

export function zoningCode(value?: string | null): string {
  const code = (value ?? '').trim().toUpperCase();
  return code === 'R-8' ? 'R8' : code;
}

export function zoningColor(value?: string | null): string {
  return ZONING_DISTRICTS.find(district => district.code === zoningCode(value))?.color ?? '#64748b';
}
