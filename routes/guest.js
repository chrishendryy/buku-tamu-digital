import express from "express";

const router = express.Router();

export default (pool) => {
  // ===============================================
  // 🔹 GET PENGATURAN TAMPILAN (Domain -> Tenant)
  // ===============================================
  router.get("/pengaturan-tampilan/:domain", async (req, res) => {
    const { domain } = req.params;
    try {
      const result = await pool.query(
        `SELECT p.id AS tenant_id, p.nama_perusahaan, p.domain,
                t.logo_url, t.teks_samping_logo, t.subjudul,
                t.judul_utama, t.deskripsi, t.copyright_text
         FROM public.perusahaan p
         LEFT JOIN public.pengaturan_tampilan t 
         ON p.id = t.tenant_id
         WHERE p.domain = $1 OR p.domain = $1 || '.id'
         LIMIT 1`,
        [domain]
      );

      if (result.rowCount === 0)
        return res.status(404).json({ error: "Domain tidak ditemukan" });

      res.json(result.rows[0]);
    } catch (err) {
      console.error("❌ [GET /pengaturan-tampilan] Error:", err.message);
      res
        .status(500)
        .json({ error: "Gagal memuat pengaturan", detail: err.message });
    }
  });

  // ===============================================
  // 🔹 POST DATA TAMU (Form Buku Tamu)
  // ===============================================
  router.post("/tamu/:domain", async (req, res) => {
    const { domain } = req.params;
    const {
      nama,
      no_telp,
      instansi,
      email,
      alamat,
      tujuan_kunjungan,
      keperluan,
    } = req.body;

    // ✅ Validasi field wajib
    if (!nama || !tujuan_kunjungan || !keperluan) {
      return res.status(400).json({
        error: "Nama, tujuan kunjungan, dan keperluan wajib diisi",
      });
    }

    try {
      // 🔍 Cari perusahaan berdasarkan domain (.id dan tanpa .id)
      const tenantRes = await pool.query(
        `SELECT id, nama_perusahaan 
         FROM public.perusahaan 
         WHERE domain = $1 OR domain = $1 || '.id'
         LIMIT 1`,
        [domain]
      );

      if (tenantRes.rowCount === 0) {
        console.warn(`⚠️ Domain ${domain} tidak ditemukan di tabel perusahaan`);
        return res
          .status(404)
          .json({ error: "Perusahaan tidak ditemukan untuk domain ini" });
      }

      const tenant_id = tenantRes.rows[0].id;

      // 💾 Simpan data tamu
      await pool.query(
        `INSERT INTO public.tamu 
        (tenant_id, nama, no_telp, instansi, email, alamat, tujuan_kunjungan, keperluan, tanggal)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [
          tenant_id,
          nama,
          no_telp,
          instansi,
          email,
          alamat,
          tujuan_kunjungan,
          keperluan,
        ]
      );

      console.log(
        `🟢 TAMU BARU (${domain}): ${nama} (${instansi || "Umum"})`
      );
      res.json({ success: true, message: "Data tamu berhasil disimpan" });
    } catch (err) {
      console.error("❌ [POST /tamu/:domain] Error:", err.message);
      res
        .status(500)
        .json({ error: "Gagal simpan tamu", detail: err.message });
    }
  });

  // ✅ Kembalikan router agar bisa dipakai di index.js
  return router;
};
