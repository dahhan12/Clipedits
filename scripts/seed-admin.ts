/**
 * Create (or update) the default workspace and an ADMIN user for sign-in.
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD (a random password is
 * generated and printed once if ADMIN_PASSWORD is unset). Run: `npm run seed:admin`.
 */
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/security/crypto";

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@campaignclipper.local";
  const password = process.env.ADMIN_PASSWORD ?? crypto.randomBytes(9).toString("base64url");

  const workspace = await prisma.workspace.upsert({
    where: { id: "default" },
    create: { id: "default", name: "Default Workspace" },
    update: {},
  });

  await prisma.user.upsert({
    where: { email },
    create: { email, name: "Admin", role: "ADMIN", passwordHash: hashPassword(password), workspaceId: workspace.id },
    update: { role: "ADMIN", passwordHash: hashPassword(password), workspaceId: workspace.id, active: true },
  });

  console.log(`Admin ready:\n  email:    ${email}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`  password: ${password}   (set ADMIN_PASSWORD to choose your own)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
