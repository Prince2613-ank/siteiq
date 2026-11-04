import type { jsPDF } from 'jspdf';
import type { ParcelReportData } from './parcelReports';

type Section = { title: string; head?: string[]; rows: string[][]; links?: string[]; logos?: string[]; notes?: string[]; description?: string };
export type ParcelReportPdfSnapshot = {
  title: string; location: string; tags: string; filename: string;
  rank?: number | null;
  rankText?: string | null;
  lifeEvents?: string[];
  sections: Section[]; map: string; mapWidth: number; mapHeight: number; mapLegend: string; mapAttribution: string;
};

// Standard PDF fonts support Latin text; normalize punctuation and strip emojis rather than
// producing unreadable glyphs for symbols used by the screen UI.
const text = (value: string | null | undefined) => (value ?? '')
  .replace(/[\u{1F000}-\u{1FFFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
  .replace(/\s+/g, ' ').trim()
  .replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/[\u2192\u2197]/g, '').replace(/\u2026/g, '...').trim();

async function listingLogo(link: HTMLAnchorElement): Promise<string> {
  const image = link.querySelector('img');
  if (!image) return '';
  try {
    if (!image.complete) await image.decode();
    if (!image.naturalWidth) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 48; canvas.height = 48;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(image, 0, 0, 48, 48);
    return canvas.toDataURL('image/png');
  } catch { return ''; }
}

async function captureParcelMap(container: HTMLElement): Promise<{ map: string; mapWidth: number; mapHeight: number }> {
  const bounds = container.getBoundingClientRect();
  if (!bounds.width || !bounds.height) throw new Error('The report map is not ready. Please try again.');
  const ratio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Map export is unavailable.');
  context.scale(ratio, ratio);
  const rectangle = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { x: box.left - bounds.left, y: box.top - bounds.top, width: box.width, height: box.height };
  };
  // Freeze image positions and SVG paths before awaiting imagery, so a subsequent
  // zoom or navigation cannot combine tiles and boundaries from different views.
  const tiles = [...container.querySelectorAll<HTMLImageElement>('.leaflet-tile-pane img.leaflet-tile')]
    .filter(image => image.src && image.getBoundingClientRect().width > 0)
    .map(image => ({
      url: image.src, ...rectangle(image),
      order: Number((image.closest('.leaflet-tile-container') as HTMLElement | null)?.style.zIndex || 0)
    }))
    .sort((a, b) => a.order - b.order);
  if (!tiles.length) throw new Error('Aerial imagery is still loading. Please try exporting again.');
  const overlays = [...container.querySelectorAll<SVGSVGElement>('.leaflet-overlay-pane svg')].map(element => {
    const box = rectangle(element);
    const svg = element.cloneNode(true) as SVGSVGElement;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(box.width * ratio)); svg.setAttribute('height', String(box.height * ratio));
    svg.style.transform = ''; svg.style.left = ''; svg.style.top = '';
    return { ...box, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}` };
  });
  const scales = [...container.querySelectorAll<HTMLElement>('.leaflet-control-scale-line')].map(element => ({
    ...rectangle(element), label: element.textContent || '',
  }));
  const loadImage = (url: string, aerial: boolean) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      image.onload = null; image.onerror = null;
      reject(new Error('Aerial imagery could not be loaded for the PDF. Please try again.'));
    }, 20000);
    image.onload = () => { window.clearTimeout(timeout); resolve(image); };
    image.onerror = () => { window.clearTimeout(timeout); reject(new Error('Aerial imagery could not be loaded for the PDF. Please try again.')); };
    if (aerial) image.crossOrigin = 'anonymous';
    image.src = url;
  });
  const [tileImages, overlayImages] = await Promise.all([
    Promise.all(tiles.map(tile => loadImage(tile.url, true))),
    Promise.all(overlays.map(overlay => loadImage(overlay.url, false))),
  ]);
  for (const [index, tile] of tiles.entries()) context.drawImage(tileImages[index], tile.x, tile.y, tile.width, tile.height);
  for (const [index, overlay] of overlays.entries()) context.drawImage(overlayImages[index], overlay.x, overlay.y, overlay.width, overlay.height);
  for (const scale of scales) {
    context.fillStyle = '#ffffffe0'; context.fillRect(scale.x, scale.y, scale.width, scale.height);
    context.strokeStyle = '#777'; context.lineWidth = 1;
    context.strokeRect(scale.x + 0.5, scale.y + 0.5, scale.width, scale.height);
    context.fillStyle = '#111'; context.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    context.textBaseline = 'middle';
    context.fillText(scale.label, scale.x + 4, scale.y + scale.height / 2);
  }
  return { map: canvas.toDataURL('image/png'), mapWidth: canvas.width, mapHeight: canvas.height };
}

// Capture before loading the PDF library so navigation cannot mix properties.
export async function snapshotParcelReport(article: HTMLElement, data: ParcelReportData, mapElement: HTMLElement): Promise<ParcelReportPdfSnapshot> {
  const p = data.subject.properties;
  const sections: Section[] = [];
  const metrics = [...article.querySelectorAll('.report-key-metrics > div')].map(metric =>
    [text(metric.querySelector('span')?.textContent), text(metric.querySelector('strong')?.textContent)]);
  if (metrics.length) sections.push({ title: 'Key parcel figures', rows: metrics });
  for (const section of article.querySelectorAll('.report-section')) {
    const title = text(section.querySelector('h2')?.textContent);
    if (section.querySelector('table')) {
      const head = [...section.querySelectorAll('thead th')].map(cell => text(cell.textContent));
      const rows = [...section.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('th, td')].map(cell => text(cell.textContent)));
      sections.push({ title, head, rows });
    } else if (section.querySelector('dl')) {
      const rows = [...section.querySelectorAll('dl > div')].map(row => [text(row.querySelector('dt')?.textContent), text(row.querySelector('dd')?.textContent)]);
      const links = await Promise.all([...section.querySelectorAll<HTMLAnchorElement>('.report-listing-links a')].map(link => link.href));
      const logos = await Promise.all([...section.querySelectorAll<HTMLAnchorElement>('.report-listing-links a')].map(listingLogo));
      const description = text(section.querySelector('[data-report-description]')?.textContent);
      sections.push({ title, rows, links: links.length ? links : undefined, logos: logos.some(Boolean) ? logos : undefined, description: description || undefined });
    } else {
      const links = [...section.querySelectorAll<HTMLAnchorElement>('a')].filter(link => /^https?:/i.test(link.href));
      if (links.length) sections.push({ title, rows: links.map(link => [text(link.textContent), link.href]), links: links.map(link => link.href) });
    }
  }

  const lifeEvents = [...article.querySelectorAll('.report-life-events .report-life-event-badge')].map(badge => text(badge.textContent)).filter(Boolean);
  const rankPart = data.rank && data.rank > 0 ? `${data.rank}-` : data.rank === 0 ? 'Unranked-' : '';
  const snapshot: ParcelReportPdfSnapshot = {
    title: text(article.querySelector('h1')?.textContent), location: text(article.querySelector('.report-location')?.textContent),
    rank: data.rank ?? null,
    rankText: data.rank && data.rank > 0 ? `#${data.rank}` : (p.keep === 'Y' ? null : 'Unranked (Excluded)'),
    lifeEvents,
    tags: [...article.querySelectorAll('.report-property-tags > span')].map(tag => text(tag.textContent)).join(' | '),
    filename: `SiteIQ-${rankPart}${p.town}-${p.parcel_id}.pdf`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-'),
    sections, mapAttribution: text(mapElement.querySelector('.leaflet-control-attribution')?.textContent || data.sources.imagery_attribution),
    mapLegend: `Yellow: parcel boundary | Green: subject land${data.wetlands.features.length ? ' | Teal: mapped wetland' : ''}${data.buildings.features.length ? ' | Red: building footprint' : ''}`,
    map: '', mapWidth: 0, mapHeight: 0,
  };
  return { ...snapshot, ...await captureParcelMap(mapElement) };
}

export async function downloadParcelReportPdf(snapshot: ParcelReportPdfSnapshot): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const margin = 40, width = 532, bottom = 742;
  let y = 40;
  doc.setProperties({ title: `${snapshot.title} - SiteIQ property report`, author: 'SiteIQ', creator: 'SiteIQ' });
  const paragraph = (value: string, size: number, bold = false, color = '#243e32') => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color);
    const lines = doc.splitTextToSize(value, width) as string[];
    doc.text(lines, margin, y + size); y += lines.length * size * 1.2 + 7;
  };
  const room = (height: number) => { if (y + height > bottom) { doc.addPage(); y = 54; } };

  // Render Rank on top right
  const rankY = y;
  if (snapshot.rank != null && snapshot.rank > 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor('#64748b');
    doc.text('RANK', 572, rankY + 11, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor('#1e293b');
    doc.text(`#${snapshot.rank}`, 572, rankY + 31, { align: 'right' });
  } else if (snapshot.rank === 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor('#64748b');
    doc.text('Unranked (Excluded)', 572, rankY + 20, { align: 'right' });
  }

  paragraph('SiteIQ / PROPERTY REPORT', 9, true, '#287156');
  paragraph(snapshot.title, 23, true);
  paragraph(snapshot.location, 10);
  if (snapshot.rank != null && snapshot.rank > 0) {
    paragraph(`SiteIQ Rank: #${snapshot.rank}`, 11, true, '#1d4ed8');
  } else if (snapshot.rank === 0) {
    paragraph('SiteIQ Rank: Unranked (Excluded)', 11, true, '#64748b');
  }
  if (snapshot.lifeEvents && snapshot.lifeEvents.length > 0) {
    paragraph(snapshot.lifeEvents.join('   |   '), 8.5, true, '#6b21a8');
  }
  paragraph(snapshot.tags, 9);
  paragraph('Aerial parcel map', 10, true);
  const mapHeight = Math.min(360, width * snapshot.mapHeight / snapshot.mapWidth);
  const mapWidth = mapHeight * snapshot.mapWidth / snapshot.mapHeight;
  doc.addImage(snapshot.map, 'PNG', margin + (width - mapWidth) / 2, y, mapWidth, mapHeight); y += mapHeight + 11;
  paragraph(snapshot.mapLegend, 8, false, '#52685b');
  paragraph(snapshot.mapAttribution, 8, false, '#52685b');
  for (const section of snapshot.sections) {
    room(70 + (section.description ? (doc.splitTextToSize(section.description, width) as string[]).length * 10 + 7 : 0));
    paragraph(section.title, 11, true);
    if (section.description) paragraph(section.description, 8, false, '#52685b');
    autoTable(doc, {
      startY: y - 2, margin: { left: margin, right: margin, top: 54, bottom: 50 },
      theme: 'plain', head: section.head ? [section.head] : undefined, body: section.rows,
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, textColor: '#243e32', overflow: 'linebreak', lineColor: '#e2e9e3', lineWidth: { bottom: 0.4 } },
      headStyles: { fillColor: '#edf4ee', fontStyle: 'bold' },
      columnStyles: section.head ? {} : { 0: { cellWidth: 150, textColor: '#576d60' }, 1: { cellWidth: width - 150 } },
      rowPageBreak: 'avoid',
      didParseCell: cell => {
        if (cell.section === 'body' && cell.column.index === 0 && section.logos?.[cell.row.index]) {
          cell.cell.styles.cellPadding = { top: 5, right: 5, bottom: 5, left: 26 };
          cell.cell.styles.minCellHeight = 26;
        }
      },
      didDrawCell: cell => {
        const url = section.links?.[cell.row.index];
        const logo = section.logos?.[cell.row.index];
        if (logo && cell.section === 'body' && cell.column.index === 0) {
          doc.addImage(logo, 'PNG', cell.cell.x + 5, cell.cell.y + (cell.cell.height - 15.12) / 2, 15.12, 15.12);
        }
        if (url && cell.section === 'body') doc.link(cell.cell.x, cell.cell.y, cell.cell.width, cell.cell.height, { url });
      },
    });
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 21;
    for (const note of section.notes ?? []) {
      const lines = doc.splitTextToSize(note, width) as string[];
      room(lines.length * 8 * 1.2 + 7);
      paragraph(note, 8, false, '#52685b');
    }
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor('#607367');
    if (page > 1) {
      doc.text('SiteIQ / PROPERTY REPORT', margin, 29);
      doc.text(doc.splitTextToSize(snapshot.title, width / 2)[0], 572, 29, { align: 'right' });
    }
    doc.setDrawColor('#dce5de'); doc.line(margin, 755, 572, 755);
    doc.text(`${page} / ${pages}`, 572, 772, { align: 'right' });
  }
  await doc.save(snapshot.filename, { returnPromise: true });
}
