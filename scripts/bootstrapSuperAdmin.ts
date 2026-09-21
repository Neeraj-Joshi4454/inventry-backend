import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { User } from '../src/models/user.model';
import { UserRole, AccountStatus } from '../src/types/enums';
import { hashPassword } from '../src/utils/password';
import { normalizeMobileNumber, mobileNumberSchema } from '../src/utils/mobileNumber';
import { passwordSchema } from '../src/utils/passwordPolicy';

// One-time setup script: creates the first SUPER_ADMIN account directly in
// the database, since there's no signup flow (Super Admin creates everyone
// else, but nobody creates the Super Admin via the API). This is the ONLY
// place in the entire codebase that creates a SUPER_ADMIN — no API route
// ever assigns that role (see users module's assignableRoleSchema, which
// deliberately excludes it).
async function main() {
  const rawMobileNumber = process.env.SUPER_ADMIN_MOBILE;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME ?? 'Super Admin';

  if (!rawMobileNumber || !password) {
    throw new Error('SUPER_ADMIN_MOBILE and SUPER_ADMIN_PASSWORD must be set in .env');
  }

  const mobileParse = mobileNumberSchema.safeParse(rawMobileNumber);
  if (!mobileParse.success) {
    throw new Error(`SUPER_ADMIN_MOBILE is invalid: ${mobileParse.error.issues[0]?.message}`);
  }
  const mobileNumber = normalizeMobileNumber(rawMobileNumber);

  const passwordParse = passwordSchema.safeParse(password);
  if (!passwordParse.success) {
    throw new Error(`SUPER_ADMIN_PASSWORD is invalid: ${passwordParse.error.issues[0]?.message}`);
  }

  await mongoose.connect(env.MONGODB_URI);

  const existing = await User.findOne({ mobileNumber });
  if (existing) {
    console.log(`Super admin with mobile ${mobileNumber} already exists (id: ${existing._id}).`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await hashPassword(password);
  const superAdmin = await User.create({
    tenantId: null,
    name,
    mobileNumber,
    passwordHash,
    role: UserRole.SUPER_ADMIN,
    status: AccountStatus.ACTIVE,
    mustChangePassword: true,
  });

  console.log(`Super admin created: ${superAdmin._id} (mobile: ${mobileNumber})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
