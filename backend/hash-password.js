// hash-password.js
import bcrypt from 'bcryptjs';

const plainPassword = process.argv[2] || '1Password'; // Default if no argument
const saltRounds = 10;

async function generateHash() {
  try {
    const hash = await bcrypt.hash(plainPassword, saltRounds);
    console.log('Password to hash:', plainPassword);
    console.log('Generated bcrypt hash:', hash);
  } catch (err) {
    console.error('Error hashing password:', err);
  }
  process.exit();
}

generateHash();