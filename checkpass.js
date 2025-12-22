import bcrypt from "bcryptjs";

const hash = "$2b$10$B8x/TmvxJ640GYLBdMkiUed/at6rqzJye4PC2OjI3W5.sd3GQ1G8u"; // hash kamu
const coba = "Ajuganteng666"; // ganti ini dengan password yang mau kamu tes

const cocok = await bcrypt.compare(coba, hash);
console.log(cocok ? "✅ Password cocok" : "❌ Tidak cocok");
