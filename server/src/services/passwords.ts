import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;

// Valid hash of a random string; compared against when the user does not exist so that
// "unknown email" and "wrong password" take similar time.
const DUMMY_HASH = '$2b$12$Boz.gUty3P/c1zeGgOSKkefAarb8ej6p5inZbfImVFkPM/iXbMPne';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, BCRYPT_COST);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);
export const burnPasswordCheck = async (plain: string): Promise<void> => {
  await bcrypt.compare(plain, DUMMY_HASH);
};
