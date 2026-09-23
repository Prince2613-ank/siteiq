import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Local-disk file storage — a deliberate, documented stand-in for the S3 +
 * presigned-URL design in docs/01 §10. Real AWS credentials aren't
 * available in this dev environment; the storageKey/service boundary here
 * is shaped so swapping in real S3 later touches only this file (save the
 * bytes, read the bytes, delete the bytes) — nothing in the API contract,
 * the Document model, or the frontend needs to change.
 */
const UPLOAD_ROOT = path.join(__dirname, '..', '..', '..', 'uploads');

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  async list(organizationId: string, siteId: string) {
    await this.assertSiteInOrg(organizationId, siteId);
    return this.prisma.document.findMany({
      where: { siteId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
      include: { uploadedBy: { select: { id: true, email: true } } },
    });
  }

  async upload(
    actor: AuthenticatedUser,
    siteId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    category: string,
  ) {
    const site = await this.assertSiteInOrg(actor.organizationId, siteId);

    const documentId = crypto.randomUUID();
    const siteDir = path.join(UPLOAD_ROOT, site.id);
    fs.mkdirSync(siteDir, { recursive: true });
    const storageKey = path.join(site.id, `${documentId}-${sanitizeFilename(file.originalname)}`);
    fs.writeFileSync(path.join(UPLOAD_ROOT, storageKey), file.buffer);

    const doc = await this.prisma.document.create({
      data: {
        id: documentId,
        siteId,
        filename: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        category,
        uploadedById: actor.userId,
      },
      include: { uploadedBy: { select: { id: true, email: true } } },
    });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId,
      actorId: actor.userId,
      eventType: 'document_uploaded',
      metadata: { documentId: doc.id, filename: doc.filename, category: doc.category },
    });

    return doc;
  }

  async getFileForDownload(organizationId: string, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null, site: { organizationId } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const filePath = path.join(UPLOAD_ROOT, doc.storageKey);
    if (!fs.existsSync(filePath)) throw new NotFoundException('Stored file is missing');
    return { doc, filePath };
  }

  async remove(actor: AuthenticatedUser, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null, site: { organizationId: actor.organizationId } },
    });
    if (!doc) throw new NotFoundException('Document not found');

    // Soft delete — recoverable, consistent with the rest of the app
    // (doc 01 §10) — the underlying file is left in place.
    await this.prisma.document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });

    await this.activity.log({
      organizationId: actor.organizationId,
      siteId: doc.siteId,
      actorId: actor.userId,
      eventType: 'document_deleted',
      metadata: { documentId: doc.id, filename: doc.filename },
    });

    return { ok: true };
  }

  private async assertSiteInOrg(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId, deletedAt: null } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
}
