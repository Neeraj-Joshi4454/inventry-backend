import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { Role } from '../src/models/role.model';
import { DEFAULT_ROLES } from '../src/constants/seedData';

// System-wide, run-once (idempotent) seed for the `roles` lookup collection.
async function main() {
  await mongoose.connect(env.MONGODB_URI);

  for (const role of DEFAULT_ROLES) {
    await Role.updateOne(
      { key: role.key },
      { $set: { label: role.label, description: role.description } },
      { upsert: true }
    );
  }

  console.log(`Seeded ${DEFAULT_ROLES.length} roles.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
