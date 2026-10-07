import { prisma, disconnectDb } from '../src/db';
import { deleteAccountWithTombstone } from '../src/account/account-tombstones';
import { Logger } from '../src/logger';

const deleteUser = async (email: string) => {
  try {
    // Check if user exists first
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      Logger.warn(`User with email "${email}" not found.`);
      return;
    }

    // Same entry point as DELETE /account: cascading deletes handle the related rows
    // (operations, syncState, devices …) and the tombstone is written in that
    // transaction, so an operator deleting an account cannot produce a backup-restorable
    // account with no closure record.
    await prisma.$transaction((tx) => deleteAccountWithTombstone(tx, user.id));

    Logger.info(`Successfully deleted user: ${email}`);
  } catch (error) {
    Logger.error('Error deleting user:', error);
    process.exit(1);
  } finally {
    await disconnectDb();
  }
};

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('Please provide an email address.');
  console.error('Usage: npm run delete-user -- <email>');
  process.exit(1);
}

deleteUser(email);
