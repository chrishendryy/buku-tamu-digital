// ===============================================
// 🔐 UNIVERSAL LOGIN FINAL (SUPERADMIN → SUBADMIN → ADMIN)
// ===============================================

import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export default function (pool) {
  const router = express.Router();

  console.log("✅ [AUTH ROUTES LOADED - FINAL FIX]");

  router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
      // =====================================================
      // 1. SUPERADMIN
      // =====================================================
      const superRes = await pool.query(
        "SELECT * FROM public.superadmin WHERE username = $1",
        [username]
      );

      if (superRes.rows.length > 0) {
        const s = superRes.rows[0];
        const valid = await bcrypt.compare(password, s.password);

        if (!valid)
          return res.status(401).json({ error: "Password salah" });

        const token = jwt.sign(
          { id: s.id, role: "superadmin" },
          process.env.JWT_SECRET || "bukutamu_secret",
          { expiresIn: "6h" }
        );

        return res.json({
          success: true,
          role: "superadmin",
          token,
          user: {
            id: s.id,
            username: s.username,
            nama: s.nama,
          },
        });
      }

      // =====================================================
      // 2. SUBADMIN (DIPRIORITASKAN DULU)
      // =====================================================
      const subRes = await pool.query(
        `SELECT 
            s.id,
            s.username,
            s.password,
            s.nama_lengkap,
            s.status,
            s.perusahaan_id AS tenant_id,
            p.status_sewa AS status_perusahaan
        FROM public.subadmin s
        LEFT JOIN public.perusahaan p ON p.id = s.perusahaan_id
        WHERE s.username = $1
        LIMIT 1`,
        [username]
      );

      if (subRes.rows.length > 0) {
        const sub = subRes.rows[0];

        if (sub.status !== "active") {
          return res.status(403).json({
            error: "Akun subadmin NONAKTIF",
            status: sub.status,
            status_perusahaan: sub.status_perusahaan
          });
        }

        const valid = await bcrypt.compare(password, sub.password);
        if (!valid) {
          return res.status(401).json({
            error: "Password salah",
            status: sub.status,
            status_perusahaan: sub.status_perusahaan
          });
        }

        const token = jwt.sign(
          {
            id: sub.id,
            role: "subadmin",
            tenant_id: sub.tenant_id
          },
          process.env.JWT_SECRET || "bukutamu_secret",
          { expiresIn: "6h" }
        );

        return res.json({
          success: true,
          role: "subadmin",
          

          // ⬅⬅⬅ TAMBAHKAN INI (WAJIB!)
          status_perusahaan: sub.status_perusahaan,

          user: {
            id: sub.id,
            username: sub.username,
            tenant_id: sub.tenant_id,
            nama_lengkap: sub.nama_lengkap,
            status: sub.status,

            // ⬅⬅⬅ SUDAH ADA DI DALAM USER (AMAN)
            status_perusahaan: sub.status_perusahaan
          },

          token
        });

      }



      // =====================================================
      // 3. ADMIN (DICEK TERAKHIR)
      // =====================================================
      const adminRes = await pool.query(
        "SELECT * FROM public.admin WHERE username = $1 LIMIT 1",
        [username]
      );

      if (adminRes.rows.length > 0) {
        const admin = adminRes.rows[0];

        if (!admin.aktif)
          return res.status(403).json({ error: "Akun admin nonaktif" });

        const valid = await bcrypt.compare(password, admin.password);
        if (!valid)
          return res.status(401).json({ error: "Password salah" });

        const token = jwt.sign(
          {
            id: admin.id,
            role: "admin",
            tenant_id: admin.tenant_id,
          },
          process.env.JWT_SECRET || "bukutamu_secret",
          { expiresIn: "6h" }
        );

        return res.json({
          success: true,
          role: "admin",
          token,
          user: {
            id: admin.id,
            username: admin.username,
            nama: admin.nama_lengkap,
            tenant_id: admin.tenant_id,
            aktif: admin.aktif,
          },
        });
      }

      // =====================================================
      // 4. Jika semua tidak cocok
      // =====================================================
      return res.status(404).json({ error: "Username tidak ditemukan" });

    } catch (err) {
      console.error("❌ Login Error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
}
