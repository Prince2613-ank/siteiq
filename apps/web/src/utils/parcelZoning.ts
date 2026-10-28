// District labels and swatches supplied in the client's zoning reference sheet.
export const ZONING_DISTRICTS = [
  { code: '6M', name: 'Smithtown Village & North Village Mixed Use', color: '#4285f4' },
  { code: '6R', name: 'Smithtown Village Residential', color: '#ffff00' },
  { code: 'C', name: 'Commercial / General Commercial', color: '#ea4335' },
  { code: 'C2', name: 'Commercial II', color: '#ea4335' },
  { code: 'C3', name: 'Office Park / Commercial III', color: '#ea4335' },
  { code: 'C4', name: 'Commercial IV', color: '#ea4335' },
  { code: 'COM', name: 'Commercial (Generic Class)', color: '#ea4335' },
  { code: 'I', name: 'Industrial / Light Industrial', color: '#7030a0' },
  { code: 'LM', name: 'Lafayette-Main Commercial District', color: '#ea4335' },
  { code: 'LM-A', name: 'Lafayette-Main Sub-district A', color: '#ffc000' },
  { code: 'LM-C', name: 'Lafayette-Main Sub-district C', color: '#4285f4' },
  { code: 'OP', name: 'Office Park District', color: '#ffc000' },
  { code: 'OSC', name: 'Open Space Conservancy', color: '#34a853' },
  { code: 'R1', name: 'Low-Density Residential', color: '#ffff00' },
  { code: 'R2', name: 'Medium-Density Residential', color: '#ffff00' },
  { code: 'R20', name: 'Residence 20 (20,000 sq. ft. min)', color: '#ffff00' },
  { code: 'R-20', name: 'Residence 20 (20,000 sq. ft. min)', color: '#ffff00' },
  { code: 'R40', name: 'Residence 40 (40,000 sq. ft. min)', color: '#ffff00' },
  { code: 'R8', name: 'Residence 8 (8,000 sq. ft. min)', color: '#ffff00' },
  { code: 'RC', name: 'Rural Cluster', color: '#34a853' },
  { code: 'RCZD', name: 'Regional Commercial Zoning District', color: '#ea4335' },
  { code: 'RES', name: 'Residential (Generic Class)', color: '#ffff00' },
  { code: 'RESIDNTL', name: 'Residential (Generic Class)', color: '#ffff00' },
] as const;

export function zoningCode(value?: string | null): string {
  const code = (value ?? '').trim().toUpperCase();
  return code === 'R-8' ? 'R8' : code;
}

export function zoningColor(value?: string | null): string {
  return ZONING_DISTRICTS.find(district => district.code === zoningCode(value))?.color ?? '#64748b';
}
