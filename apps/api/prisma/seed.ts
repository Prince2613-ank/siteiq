import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const orgName = 'SiteIQ Demo Organization';
  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: { id: '00000000-0000-0000-0000-000000000001', name: orgName },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@siteiq.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      organizationId: org.id,
      email: adminEmail,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });

  const analystEmail = 'analyst@siteiq.local';
  const analystPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  await prisma.user.upsert({
    where: { email: analystEmail },
    update: {},
    create: {
      organizationId: org.id,
      email: analystEmail,
      passwordHash: analystPasswordHash,
      role: Role.ANALYST,
      isActive: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded org "${orgName}" with admin ${admin.email} (password: ${adminPassword})`);
  // eslint-disable-next-line no-console
  console.log(`Seeded analyst ${analystEmail} (password: ChangeMe123!)`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
