import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB — matches doc 01 §9's stated per-file limit
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

@Controller('sites/:siteId/documents')
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param('siteId') siteId: string) {
    return this.documentsService.list(user.organizationId, siteId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.ANALYST)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SIZE_BYTES } }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('siteId') siteId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    // Server-side validation — doc 01 §14: never trust a client-side check
    // alone. MIME/size allowlist enforced here, before anything is written.
    if (file.size > MAX_SIZE_BYTES) throw new BadRequestException('File exceeds the 25MB limit');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException(`File type ${file.mimetype} is not allowed`);

    return this.documentsService.upload(user, siteId, file, category || 'Other');
  }
}

@Controller('documents')
@UseGuards(RolesGuard)
export class DocumentDownloadController {
  constructor(private documentsService: DocumentsService) {}

  @Get(':id/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { doc, filePath } = await this.documentsService.getFileForDownload(user.organizationId, id);
    res.download(filePath, doc.filename);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.ANALYST)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentsService.remove(user, id);
  }
}
