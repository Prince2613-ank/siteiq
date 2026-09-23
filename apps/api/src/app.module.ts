import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { SitesModule } from './modules/sites/sites.module';
import { NotesModule } from './modules/notes/notes.module';
import { ActivityModule } from './modules/activity/activity.module';
import { MatchingModule } from './modules/matching/matching.module';
import { FieldsModule } from './modules/fields/fields.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RefreshStatusModule } from './modules/refresh-status/refresh-status.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    SitesModule,
    NotesModule,
    ActivityModule,
    MatchingModule,
    FieldsModule,
    DocumentsModule,
    AnalysisModule,
    ReportsModule,
    RefreshStatusModule,
  ],
  providers: [
    // Applied globally: every route requires a valid access token unless
    // marked @Public(). See docs/01 §6 / apps/api/src/common/guards.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
