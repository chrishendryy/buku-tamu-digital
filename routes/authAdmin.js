import express from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { sendEmail } from "../utils/email.js";

export default function authAdminRoutes(pool) {
  const router = express.Router();

  // ========================================
  // 📌 Request Reset Password Admin
  // ========================================
  router.post("/request-reset-password", async (req, res) => {
    const { email } = req.body;

    try {
      const result = await pool.query(
        "SELECT id FROM admin WHERE email = $1",
        [email]
      );

      // Tidak bocorkan user ada atau tidak
      if (result.rows.length === 0) {
        return res.json({
          message: "Jika email terdaftar, link reset password dikirim."
        });
      }

      const adminId = result.rows[0].id;
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await pool.query(
        `INSERT INTO password_reset_tokens (admin_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [adminId, token, expiresAt]
      );

      const resetLink = `${process.env.FRONTEND_URL}/reset-password-admin?token=${token}`;

      await sendEmail(
        email,
        "Reset Password Admin - Buku Tamu Digital",
        `Silakan klik link berikut untuk reset password:\n${resetLink}`
      );

      return res.json({
        message: "Jika email terdaftar, link reset password dikirim."
      });

    } catch (err) {
      console.error("❌ Error request-reset-password:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // ========================================
  // 📌 Validasi Token Reset Password
  // ========================================
  router.get("/validate-reset-token", async (req, res) => {
    const { token } = req.query;

    try {
      const result = await pool.query(
        `SELECT * FROM password_reset_tokens
         WHERE token = $1 AND expires_at > NOW()`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ valid: false });
      }

      return res.json({ valid: true });

    } catch (err) {
      console.error("❌ Token validation error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // ========================================
  // 📌 Reset Password Admin
  // ========================================
  router.post("/reset-password", async (req, res) => {
    const { token, password } = req.body;

    try {
      const result = await pool.query(
        `SELECT * FROM password_reset_tokens
         WHERE token = $1 AND expires_at > NOW()`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: "Token tidak valid / expired" });
      }

      const adminId = result.rows[0].admin_id;
      const hashed = await bcrypt.hash(password, 10);

      await pool.query(
        `UPDATE admin SET password = $1 WHERE id = $2`,
        [hashed, adminId]
      );

      await pool.query(`DELETE FROM password_reset_tokens WHERE token = $1`, [
        token,
      ]);

      return res.json({ message: "Password berhasil diubah" });

    } catch (err) {
      console.error("❌ Reset password error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  return router;
}
