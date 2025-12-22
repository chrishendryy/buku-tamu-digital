// =======================================================
// 📁 routes/superadmin.js — FINAL STABLE VERSION
// 🔥 + AUTO SYNC STATUS SEWA (MASA BERLAKU)
// =======================================================

import express from "express";
import bcrypt from "bcrypt";

export default function (pool) {
  const router = express.Router();

  // =======================================================
  // VALIDATOR ADMIN
  // =======================================================
  function validateAdminInput(username, password, isEdit = false) {
    if (!/^[A-Z]/.test(username))
      return "Username harus diawali huruf besar!";

    if (username.length < 5)
      return "Username minimal 5 karakter!";

    if (!/[0-9]/.test(username))
      return "Username harus mengandung angka!";

    if (isEdit && !password) return null;

    if (!password) return "Password wajib diisi!";

    if (!/^[A-Z]/.test(password))
      return "Password harus diawali huruf besar!";

    if (password.length < 5)
      return "Password minimal 5 karakter!";

    if (!/[0-9]/.test(password))
      return "Password harus mengandung angka!";

    if (!/[!@#$%^&*(),.?\":{}|<>]/.test(password))
      return "Password harus mengandung simbol!";

    return null;
  }

  // =======================================================
  // LOGIN SUPERADMIN
  // =======================================================
  router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
      const result = await pool.query(
        "SELECT * FROM public.superadmin WHERE username=$1",
        [username]
      );

      const user = result.rows[0];
      if (!user)
        return res.status(401).json({ error: "Username tidak ditemukan" });

      const valid = await bcrypt.compare(password, user.password);
      if (!valid)
        return res.status(401).json({ error: "Password salah" });

      return res.json({ success: true, user });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // =======================================================
  // GET PERUSAHAAN LIST + AUTO SYNC STATUS SEWA
  // =======================================================
  router.get("/perusahaan", async (req, res) => {
    try {
      // Ambil semua perusahaan
      const q = await pool.query(`
        SELECT *
        FROM public.perusahaan
        ORDER BY created_at DESC
      `);

      const today = new Date();

      // Loop setiap perusahaan → sync status sewa berdasarkan masa berlaku
      for (const p of q.rows) {
        const expired = p.masa_berlaku && new Date(p.masa_berlaku) < today;

        const correctStatus = expired ? "nonaktif" : "aktif";

        if (p.status_sewa !== correctStatus) {
          await pool.query(
            `UPDATE public.perusahaan 
             SET status_sewa=$1, updated_at=NOW()
             WHERE id=$2`,
            [correctStatus, p.id]
          );

          // Auto sync admin under perusahaan
          await pool.query(
            `UPDATE public.admin 
             SET aktif=$1, updated_at=NOW()
             WHERE tenant_id=$2`,
            [!expired, p.id]
          );
        }
      }

      // Ambil ulang data yang sudah disinkronisasi
      const updated = await pool.query(`
        SELECT *
        FROM public.perusahaan
        ORDER BY created_at DESC
      `);

      return res.json(updated.rows);

    } catch (err) {
      console.error("❌ Sync perusahaan error:", err);
      return res.status(500).json({ error: "Gagal ambil perusahaan" });
    }
  });

  // =======================================================
  // TAMBAH PERUSAHAAN
  // =======================================================
  router.post("/perusahaan", async (req, res) => {
    const {
      nama_perusahaan,
      domain,
      logo_url,
      alamat,
      kontak_admin,
      masa_berlaku,
      status_sewa = "aktif",
    } = req.body;

    try {
      const q = await pool.query(
        `INSERT INTO public.perusahaan 
        (nama_perusahaan, domain, logo_url, alamat, kontak_admin, masa_berlaku, status_sewa, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        RETURNING *`,
        [
          nama_perusahaan,
          domain,
          logo_url,
          alamat,
          kontak_admin,
          masa_berlaku,
          status_sewa.toLowerCase(),
        ]
      );

      return res.json({ success: true, data: q.rows[0] });
    } catch (err) {
      console.error("❌ Tambah perusahaan error:", err);
      return res.status(500).json({ error: "Gagal tambah perusahaan" });
    }
  });

  // =======================================================
  // EDIT PERUSAHAAN + AUTO SYNC ADMIN
  // =======================================================
  router.put("/perusahaan/:id", async (req, res) => {
    const id = req.params.id;

    const {
      nama_perusahaan,
      domain,
      logo_url,
      alamat,
      kontak_admin,
      masa_berlaku,
      status_sewa,
    } = req.body;

    try {
      const q = await pool.query(
        `UPDATE public.perusahaan 
         SET nama_perusahaan=$1,
             domain=$2,
             logo_url=$3,
             alamat=$4,
             kontak_admin=$5,
             masa_berlaku=$6,
             status_sewa=$7,
             updated_at=NOW()
         WHERE id=$8
         RETURNING *`,
        [
          nama_perusahaan,
          domain,
          logo_url,
          alamat,
          kontak_admin,
          masa_berlaku,
          status_sewa.toLowerCase(),
          id,
        ]
      );

      if (!q.rows.length)
        return res.status(404).json({ error: "Perusahaan tidak ditemukan" });

      const perusahaan = q.rows[0];
      const expired =
        perusahaan.masa_berlaku &&
        new Date(perusahaan.masa_berlaku) < new Date();

      // AUTO SYNC ADMIN
      await pool.query(
        `UPDATE public.admin 
         SET aktif=$1, updated_at=NOW()
         WHERE tenant_id=$2`,
        [!expired && perusahaan.status_sewa === "aktif", id]
      );

      return res.json({ success: true, data: perusahaan });
    } catch (err) {
      console.error("❌ Update perusahaan error:", err);
      return res.status(500).json({ error: "Gagal update perusahaan" });
    }
  });

  // =======================================================
  // DELETE PERUSAHAAN
  // =======================================================
  router.delete("/perusahaan/:id", async (req, res) => {
    const id = req.params.id;

    try {
      await pool.query("DELETE FROM public.admin WHERE tenant_id=$1", [id]);

      const q = await pool.query(
        "DELETE FROM public.perusahaan WHERE id=$1 RETURNING id",
        [id]
      );

      if (!q.rowCount)
        return res.status(404).json({ error: "Perusahaan tidak ditemukan" });

      return res.json({ success: true });
    } catch (err) {
      console.error("❌ Delete perusahaan error:", err);
      return res.status(500).json({ error: "Gagal hapus perusahaan" });
    }
  });

  // =======================================================
  // GET ADMIN LIST
  // =======================================================
  router.get("/admin", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          a.id,
          a.email,
          a.username,
          a.aktif,
          a.tenant_id,
          a.role,
          a.last_login,
          a.created_at,
          p.nama_perusahaan
        FROM public.admin a
        LEFT JOIN public.perusahaan p ON p.id = a.tenant_id
        ORDER BY a.created_at DESC
      `);

      return res.json(result.rows);
    } catch (err) {
      console.error("❌ ERROR GET ADMIN:", err);
      return res.status(500).json({ error: "Gagal ambil admin" });
    }
  });

  // =======================================================
  // TAMBAH ADMIN
  // =======================================================
  router.post("/admin", async (req, res) => {
    const { email, username, password, tenant_id, aktif } = req.body;

    const error = validateAdminInput(username, password);
    if (error) return res.status(400).json({ error });

    try {
      const cek = await pool.query(
        "SELECT id FROM public.admin WHERE tenant_id=$1",
        [tenant_id]
      );

      if (cek.rows.length > 0)
        return res
          .status(400)
          .json({ error: "Perusahaan ini sudah memiliki admin." });

      const hashed = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO public.admin (email, username, password, tenant_id, aktif, role, created_at)
         VALUES ($1,$2,$3,$4,$5,'admin',NOW())
         RETURNING *`,
        [email, username, hashed, tenant_id, aktif]
      );

      return res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Gagal tambah admin" });
    }
  });

  // =======================================================
  // EDIT ADMIN
  // =======================================================
  router.put("/admin/:id", async (req, res) => {
    const { email, username, password, tenant_id, aktif } = req.body;
    const id = req.params.id;

    const error = validateAdminInput(username, password, true);
    if (error) return res.status(400).json({ error });

    try {
      let q;

      if (password) {
        const hashed = await bcrypt.hash(password, 10);

        q = await pool.query(
          `UPDATE public.admin 
           SET email=$1, username=$2, password=$3, tenant_id=$4, aktif=$5, updated_at=NOW()
           WHERE id=$6 RETURNING *`,
          [email, username, hashed, tenant_id, aktif, id]
        );
      } else {
        q = await pool.query(
          `UPDATE public.admin 
           SET email=$1, username=$2, tenant_id=$3, aktif=$4, updated_at=NOW()
           WHERE id=$5 RETURNING *`,
          [email, username, tenant_id, aktif, id]
        );
      }

      return res.json({ success: true, data: q.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Gagal update admin" });
    }
  });

  // =======================================================
  // DELETE ADMIN
  // =======================================================
  router.delete("/admin/:id", async (req, res) => {
    try {
      const result = await pool.query(
        "DELETE FROM public.admin WHERE id=$1 RETURNING id",
        [req.params.id]
      );

      if (!result.rowCount)
        return res.status(404).json({ error: "Admin tidak ditemukan" });

      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Gagal hapus admin" });
    }
  });

  // =======================================================
  // TOGGLE ADMIN ACTIVE
  // =======================================================
  router.put("/admin/:id/status", async (req, res) => {
    const { aktif } = req.body;
    const id = req.params.id;

    try {
      const result = await pool.query(
        `UPDATE public.admin 
         SET aktif=$1, updated_at=NOW()
         WHERE id=$2 RETURNING *`,
        [aktif, id]
      );

      return res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Gagal mengubah status admin" });
    }
  });

  // =======================================================
  // 📊 STATISTIK GLOBAL
  // =======================================================
  router.get("/statistik-global", async (req, res) => {
    try {
      const perusahaan = await pool.query(
        "SELECT COUNT(*) FROM public.perusahaan"
      );

      const admin = await pool.query(
        "SELECT COUNT(*) FROM public.admin"
      );

      return res.json({
        total_perusahaan: Number(perusahaan.rows[0].count),
        total_admin: Number(admin.rows[0].count),
      });

    } catch (err) {
      console.error("❌ Statistik error:", err);
      return res.status(500).json({ error: "Gagal ambil statistik" });
    }
  });

  return router;
}
