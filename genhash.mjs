// genhash.mjs
import bcrypt from "bcryptjs";
const password = "PasswordBaru123"; // password baru
const saltRounds = 10;

const hash = await bcrypt.hash(password, saltRounds);
console.log("HASH:", hash);
