export type ImageryYear = 2021 | 2022 | 2023 | 2024 | 2025;

export interface SaleRecord {
  date: string;
  price: string;
  note: string;
}

export interface ResearchParcel {
  slug: string;
  address: string;
  town: string;
  lat: number;
  lng: number;
  lotSize: string;
  acres: number;
  zoning: string;
  zoningName: string;
  parcelId: string;
  commercialContext: string;
  sourceUrl: string;
  saleHistory: SaleRecord[];
}

export const researchParcels: ResearchParcel[] = [
  {
    slug: '10-swanson-rd-boxborough',
    address: '10 Swanson Rd, Boxborough, MA 01719',
    town: 'Boxborough', lat: 42.4893, lng: -71.548936,
    lotSize: '5.14 acres', acres: 5.14,
    zoning: 'OP', zoningName: 'Office Park', parcelId: '07-010-000',
    commercialContext: 'Office Park district; commercial and employment uses are subject to the Boxborough zoning bylaw.',
    sourceUrl: 'https://boxboroughma.mapgeo.io/', saleHistory: [],
  },
  {
    slug: '105-rabbit-rd-salisbury',
    address: '105 Rabbit Rd, Salisbury, MA 01952',
    town: 'Salisbury', lat: 42.8632, lng: -70.890502,
    lotSize: '10.11 acres', acres: 10.11,
    zoning: 'I', zoningName: 'Light Industrial', parcelId: 'Map 18, Lot 2',
    commercialContext: 'Light Industrial district; confirm proposed use and dimensional requirements with Salisbury Planning.',
    sourceUrl: 'https://salisburyma.mapgeo.io/', saleHistory: [],
  },
  {
    slug: '238-e-main-st-norton',
    address: '238 E Main St, Norton, MA 02766',
    town: 'Norton', lat: 41.9849, lng: -71.158568,
    lotSize: '60,984 sq. ft. / 1.40 acres', acres: 1.4,
    zoning: 'I', zoningName: 'Industrial', parcelId: '11_0_17_0',
    commercialContext: 'Industrial district. The assessor record identifies a storage building and Commonwealth ownership.',
    sourceUrl: 'https://nortonma.mapgeo.io/', saleHistory: [],
  },
  {
    slug: '435-bedford-st-lakeville',
    address: '435 Bedford St, Lakeville, MA 02347',
    town: 'Lakeville', lat: 41.815, lng: -70.921704,
    lotSize: '100.92 acres', acres: 100.917,
    zoning: 'I', zoningName: 'Industrial', parcelId: '066_003_002',
    commercialContext: 'Industrial district; the large tract should be reviewed for wetland buffers, access, and developable upland area.',
    sourceUrl: 'https://lakevillema.mapgeo.io/',
    saleHistory: [{ date: 'Mar 1, 1995', price: '$700,000', note: 'Assessor-reported transfer; verify at the Registry of Deeds.' }],
  },
];

export const imageryLayers: Record<ImageryYear, { available: boolean; url?: string; label: string }> = {
  2021: { available: true, url: 'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/orthos2021/MapServer/tile/{z}/{y}/{x}', label: '2021 statewide orthoimagery' },
  2022: { available: false, label: 'No statewide capture' },
  2023: { available: true, url: 'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/orthos2023/MapServer/tile/{z}/{y}/{x}', label: '2023 statewide orthoimagery' },
  2024: { available: false, label: 'No statewide capture' },
  2025: { available: true, url: 'https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer/tile/{z}/{y}/{x}', label: '2025 statewide orthoimagery' },
};
