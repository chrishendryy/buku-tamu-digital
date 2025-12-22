// ===============================================
// routes/admin.js (FINAL COMPLETE MULTI-TENANT SECURITY + SUBADMIN CRUD + PDF FIX)
// ===============================================

import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import multer from "multer";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";


export default function (pool) {
  const router = express.Router();

  // Pastikan folder upload ada
  const uploadDir = path.join(process.cwd(), "uploads/logo");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // =====================================================
  // 🔐 MIDDLEWARE VERIFY ADMIN + CEK STATUS PERUSAHAAN
  // =====================================================
  const verifyAdmin = async (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({ error: "Token tidak ditemukan" });

    try {
      const token = header.split(" ")[1];
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "bukutamu_secret"
      );

      req.admin_id = decoded.id;
      req.tenant_id = decoded.tenant_id;

      const adminCheck = await pool.query(
        "SELECT aktif FROM admin WHERE id = $1",
        [req.admin_id]
      );

      if (!adminCheck.rows.length)
        return res.status(403).json({ error: "Admin tidak ditemukan" });

      if (!adminCheck.rows[0].aktif)
        return res.status(403).json({ error: "Akun admin nonaktif" });

      const perusahaanCheck = await pool.query(
        "SELECT status_sewa FROM perusahaan WHERE id = $1",
        [req.tenant_id]
      );

      if (!perusahaanCheck.rows.length)
        return res.status(404).json({ error: "Perusahaan tidak ditemukan" });

      if (perusahaanCheck.rows[0].status_sewa !== "aktif")
        return res.status(403).json({ error: "Perusahaan NONAKTIF" });

      next();

    } catch (err) {
      console.error("Verify Admin Error:", err);
      return res.status(403).json({ error: "Token tidak valid" });
    }
  };

  // =====================================================
  // 🔥 CEK STATUS ADMIN + PERUSAHAAN
  // =====================================================
  router.get("/cek-status", async (req, res) => {
    try {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer "))
        return res.json({ aktif: false, perusahaan: false });

      const decoded = jwt.verify(
        header.split(" ")[1],
        process.env.JWT_SECRET || "bukutamu_secret"
      );

      const admin = await pool.query(
        "SELECT aktif, tenant_id FROM admin WHERE id = $1",
        [decoded.id]
      );

      if (!admin.rows.length)
        return res.json({ aktif: false, perusahaan: false });

      const perusahaan = await pool.query(
        "SELECT status_sewa FROM perusahaan WHERE id = $1",
        [admin.rows[0].tenant_id]
      );

      return res.json({
        aktif: admin.rows[0].aktif,
        perusahaan: perusahaan.rows[0]?.status_sewa === "aktif"
      });

    } catch {
      return res.json({ aktif: false, perusahaan: false });
    }
  });

  // =====================================================
  // LOGIN ADMIN
  // =====================================================
  router.post("/login", async (req, res) => {
    const { username, password } = req.body;

    try {
      const result = await pool.query(
        "SELECT * FROM admin WHERE username = $1",
        [username]
      );

      if (!result.rows.length)
        return res.status(404).json({ error: "Admin tidak ditemukan" });

      const admin = result.rows[0];

      if (!admin.aktif)
        return res.status(403).json({ error: "Akun admin NONAKTIF" });

      const match = await bcrypt.compare(password, admin.password);
      if (!match)
        return res.status(401).json({ error: "Password salah" });

      const perusahaan = await pool.query(
        "SELECT status_sewa FROM perusahaan WHERE id = $1",
        [admin.tenant_id]
      );

      if (perusahaan.rows[0].status_sewa !== "aktif")
        return res.status(403).json({ error: "Perusahaan NONAKTIF" });

   // 🔥 UPDATE LAST LOGIN
await pool.query(
  "UPDATE admin SET last_login = NOW() WHERE id = $1",
  [admin.id]
);

// =====================================================
// 🔥 INIT PENGATURAN TAMPILAN (ADMIN FIRST)
// =====================================================
await pool.query(
  `
  INSERT INTO pengaturan_tampilan (tenant_id, updated_at)
  VALUES ($1, NOW())
  ON CONFLICT (tenant_id) DO NOTHING
  `,
  [admin.tenant_id]
);

// =====================================================

const token = jwt.sign(
  {
    id: admin.id,
    role: "admin",
    tenant_id: admin.tenant_id,
  },
  process.env.JWT_SECRET || "bukutamu_secret",
  { expiresIn: "12h" }
);

return res.json({
  success: true,
  token,
  admin,
});

    } catch (err) {
      console.error("Login admin error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });




  // =====================================================
  // 📊 ENDPOINT STATISTIK
  // =====================================================
  router.get("/statistik/:tenant_id", verifyAdmin, async (req, res) => {
    try {
      const { tenant_id } = req.params;

      const total = await pool.query(
        "SELECT COUNT(*) FROM tamu WHERE tenant_id = $1",
        [tenant_id]
      );

      const bulanIni = await pool.query(
        `SELECT COUNT(*) FROM tamu
         WHERE tenant_id = $1
         AND DATE_PART('month', created_at) = DATE_PART('month', CURRENT_DATE)
         AND DATE_PART('year', created_at) = DATE_PART('year', CURRENT_DATE)`,
        [tenant_id]
      );

      const mingguIni = await pool.query(
        `SELECT COUNT(*) FROM tamu
         WHERE tenant_id = $1
         AND DATE_PART('week', created_at) = DATE_PART('week', CURRENT_DATE)
         AND DATE_PART('year', created_at) = DATE_PART('year', CURRENT_DATE)`,
        [tenant_id]
      );

      const rataHarian = await pool.query(
        `SELECT AVG(jumlah) FROM (
           SELECT COUNT(*) AS jumlah
           FROM tamu
           WHERE tenant_id = $1
           GROUP BY DATE(created_at)
         ) AS daily`,
        [tenant_id]
      );

      res.json({
        total_pengunjung: total.rows[0].count,
        bulan_ini: bulanIni.rows[0].count,
        minggu_ini: mingguIni.rows[0].count,
        rata_harian: Math.round(rataHarian.rows[0].avg || 0),
      });

    } catch (err) {
      console.error("Statistik error:", err);
      res.status(500).json({ error: "Gagal ambil statistik" });
    }
  });

  // =====================================================
  // 🎨 GET PENGATURAN TAMPILAN
  // =====================================================
  router.get("/pengaturan-tampilan/:tenant_id", verifyAdmin, async (req, res) => {
  try {
    const { tenant_id } = req.params;

    const q = await pool.query(
      `SELECT logo_url, teks_samping_logo, subjudul, judul_utama, deskripsi, copyright_text
       FROM pengaturan_tampilan
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenant_id]
    );

    if (!q.rows.length) {
      return res.json({
        logo: "",
        teks: "",
        subjudul: "",
        judul_utama: "",
        deskripsi: "",
        copyright: ""
      });
    }

    const d = q.rows[0];

    res.json({
      logo: d.logo_url,
      teks: d.teks_samping_logo,
      subjudul: d.subjudul,
      judul_utama: d.judul_utama,
      deskripsi: d.deskripsi,
      copyright: d.copyright_text
    });

  } catch (err) {
    console.error("ADMIN GET PENGATURAN ERROR:", err);
    res.status(500).json({ error: "Gagal memuat pengaturan" });
  }
});


  // =====================================================
  // 🎨 UPDATE PENGATURAN TAMPILAN
  // =====================================================
router.put("/pengaturan-tampilan/:tenant_id", verifyAdmin, async (req, res) => {
  try {
    const { tenant_id } = req.params;
    const {
      logo,
      teks,
      subjudul,
      judul_utama,
      deskripsi,
      copyright
    } = req.body;

    await pool.query(
      `
      INSERT INTO pengaturan_tampilan
      (tenant_id, logo_url, teks_samping_logo, subjudul, judul_utama, deskripsi, copyright_text, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        logo_url = EXCLUDED.logo_url,
        teks_samping_logo = EXCLUDED.teks_samping_logo,
        subjudul = EXCLUDED.subjudul,
        judul_utama = EXCLUDED.judul_utama,
        deskripsi = EXCLUDED.deskripsi,
        copyright_text = EXCLUDED.copyright_text,
        updated_at = NOW()
      `,
      [
        tenant_id,
        logo,
        teks,
        subjudul,
        judul_utama,
        deskripsi,
        copyright
      ]
    );

    res.json({ success: true, message: "Pengaturan berhasil disimpan" });

  } catch (err) {
    console.error("ADMIN UPDATE ERROR:", err);
    res.status(500).json({ error: "Gagal update pengaturan" });
  }
});

  // =====================================================
  // 📤 UPLOAD LOGO
  // =====================================================
  router.post("/upload-logo/:tenant_id", verifyAdmin, async (req, res) => {
  try {
    const { tenant_id } = req.params;
    const { file, filename } = req.body;

    if (!file || !filename)
      return res.status(400).json({ error: "File tidak valid" });

    const ext = filename.split(".").pop();
    const newName = `logo_${tenant_id}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadDir, newName);

    const buffer = Buffer.from(file, "base64");
    await fs.promises.writeFile(filePath, buffer);

    const url = `${req.protocol}://${req.get("host")}/uploads/logo/${newName}`;

    // 🔥 SIMPAN URL KE DATABASE
    await pool.query(
      `
      INSERT INTO pengaturan_tampilan (tenant_id, logo_url, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        logo_url = EXCLUDED.logo_url,
        updated_at = NOW()
      `,
      [tenant_id, url]
    );

    res.json({ success: true, url });

  } catch (err) {
    console.error("🔥 ADMIN UPLOAD LOGO ERROR DETAIL:");
  console.error(err);              // <-- PENTING
  console.error(err.message);      // <-- PENTING
  console.error(err.stack);  

   res.status(500).json({
    error: "Gagal upload logo",
    detail: err.message
  });
  }
});

  // =====================================================
  // 📌 GET TAMU (WITH FILTER) — FIXED
  // =====================================================
  // ✅ FIX START
  router.get("/tamu", verifyAdmin, async (req, res) => {
    try {
      const { keyword = "", start = "", end = "" } = req.query;

      let query = `
        SELECT *
        FROM tamu
        WHERE tenant_id = $1
      `;

      const params = [req.tenant_id];

      if (keyword) {
        params.push(`%${keyword}%`);
        query += ` AND (
          nama ILIKE $${params.length}
          OR instansi ILIKE $${params.length}
          OR tujuan_kunjungan ILIKE $${params.length}
        )`;
      }

      if (start) {
        params.push(start);
        query += ` AND DATE(created_at) >= $${params.length}`;
      }

      if (end) {
        params.push(end);
        query += ` AND DATE(created_at) <= $${params.length}`;
      }

      query += ` ORDER BY created_at DESC`;

      const q = await pool.query(query, params);

      res.json(q.rows);
    } catch (err) {
      console.error("FILTER TAMU ERROR:", err);
      res.status(500).json({ error: "Gagal memuat tamu" });
    }
  });
  // ✅ FIX END

  // =====================================================
  // 🗑 DELETE TAMU — FIXED & DIPINDAHKAN KELUAR
  // =====================================================
  // ✅ FIX START
  router.delete("/tamu/:id", verifyAdmin, async (req, res) => {
    try {
      const q = await pool.query(
        "DELETE FROM tamu WHERE id = $1 AND tenant_id = $2",
        [req.params.id, req.tenant_id]
      );

      if (q.rowCount === 0) {
        return res.status(404).json({
          error: "Data tamu tidak ditemukan"
        });
      }

      res.json({ success: true, message: "Data tamu berhasil dihapus" });
    } catch (err) {
      console.error("DELETE TAMU ERROR:", err);
      res.status(500).json({ error: "Gagal menghapus tamu" });
    }
  });
  // ✅ FIX END

  // =====================================================
  // 🟦 SUBADMIN CRUD — FULL MULTI-TENANT
  // =====================================================

  // LIST SUBADMIN (HANYA SUBADMIN PERUSAHAAN INI)
  router.get("/subadmin", verifyAdmin, async (req, res) => {
    try {
      const q = await pool.query(
        `SELECT s.*, p.nama_perusahaan
         FROM subadmin s
         LEFT JOIN perusahaan p ON p.id = s.perusahaan_id
         WHERE s.perusahaan_id = $1
         ORDER BY s.created_at DESC`,
        [req.tenant_id]
      );

      res.json(q.rows);
    } catch (err) {
      console.error("GET SUBADMIN ERROR:", err);
      res.status(500).json({ error: "Gagal mengambil subadmin" });
    }
  });

  // TAMBAH SUBADMIN (AUTO AMBIL TENANT ADMIN LOGIN)
  router.post("/subadmin", verifyAdmin, async (req, res) => {
    const { username, password, nama_lengkap } = req.body;

    try {
      const hashed = await bcrypt.hash(password, 10);

      await pool.query(
        `INSERT INTO subadmin (username, password, nama_lengkap, perusahaan_id, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [username, hashed, nama_lengkap, req.tenant_id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("POST SUBADMIN ERROR:", err);
      res.status(500).json({ error: "Gagal menambah subadmin" });
    }
  });

  // UPDATE STATUS (AMANKAN DENGAN TENANT)
  router.put("/subadmin/:id/status", verifyAdmin, async (req, res) => {
    try {
      const { status } = req.body;

      await pool.query(
        `UPDATE subadmin SET status=$1 WHERE id=$2 AND perusahaan_id=$3`,
        [status, req.params.id, req.tenant_id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("UPDATE SUBADMIN ERROR:", err);
      res.status(500).json({ error: "Gagal update status" });
    }
  });

  // DELETE SUBADMIN (HARUS TENANT SAMA)
  router.delete("/subadmin/:id", verifyAdmin, async (req, res) => {
    try {
      await pool.query(
        `DELETE FROM subadmin WHERE id=$1 AND perusahaan_id=$2`,
        [req.params.id, req.tenant_id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("DELETE SUBADMIN ERROR:", err);
      res.status(500).json({ error: "Gagal hapus subadmin" });
    }
  });


router.get("/export/pdf", verifyAdmin, async (req, res) => {
  try {
    const { keyword = "", start = "", end = "" } = req.query;

    // =============================
    // Ambil nama perusahaan (tenant)
    // =============================
    const tenant = await pool.query(
      "SELECT nama_perusahaan FROM perusahaan WHERE id = $1",
      [req.tenant_id]
    );

    const namaPerusahaan =
      tenant.rows[0]?.nama_perusahaan || "Perusahaan Tidak Diketahui";

    // =============================
    // QUERY DATA
    // =============================
    let query = `
      SELECT 
        nama, 
        no_telp, 
        instansi, 
        email, 
        alamat, 
        tujuan_kunjungan, 
        tanggal
      FROM tamu
      WHERE tenant_id = $1
    `;

    const params = [req.tenant_id];
    let paramIndex = 2;

    // Filter keyword
    if (keyword) {
      query += `
        AND (
          nama ILIKE $${paramIndex} OR
          instansi ILIKE $${paramIndex} OR
          tujuan_kunjungan ILIKE $${paramIndex}
        )
      `;
      params.push(`%${keyword}%`);
      paramIndex++;
    }

    // Filter tanggal
    if (start && end) {
      query += ` AND tanggal BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(start, end);
      paramIndex += 2;
    }

    query += ` ORDER BY tanggal DESC`;
    const result = await pool.query(query, params);

  


    // =============================
    // PDF (PORTRAIT)
    // =============================
    const doc = new PDFDocument({
      margin: 30,
      size: "A4",
      layout: "portrait",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=data_tamu.pdf"
    );

    doc.pipe(res);

    

    // =============================
    // JUDUL UTAMA
    // =============================
    doc.fontSize(18).text("LAPORAN BUKU TAMU", { align: "center" });
    doc.fontSize(13).text(`Perusahaan: ${namaPerusahaan}`, { align: "center" });
    doc
      .fontSize(11)
      .text(
        `Tanggal Cetak: ${new Date().toLocaleDateString("id-ID")}`,
        { align: "center" }
      );

    doc.moveDown(2);

    // =============================
    // TABEL (DIMPERKECIL AGAR MUAT PORTRAIT)
    // =============================
    const col = {
      nama: 70,
      no_telp: 65,
      instansi: 70,
      email: 100,
      alamat: 100,
      tujuan: 80,
      tanggal: 60,
    };

    const startX = 25;
    let y = 170; // ruang untuk judul

    doc.fontSize(8);

    function drawCell(text, x, width, height, align = "left") {
      doc.rect(x, y, width, height).stroke();
      doc.text(text, x + 3, y + 3, {
        width: width - 6,
        align,
      });
    }

    // =============================
    // HEADER
    // =============================
    const headerHeight = 22;

    drawCell("Nama", startX, col.nama, headerHeight);
    drawCell("No. Telp", startX + col.nama, col.no_telp, headerHeight);
    drawCell(
      "Instansi",
      startX + col.nama + col.no_telp,
      col.instansi,
      headerHeight
    );
    drawCell(
      "Email",
      startX + col.nama + col.no_telp + col.instansi,
      col.email,
      headerHeight
    );
    drawCell(
      "Alamat",
      startX + col.nama + col.no_telp + col.instansi + col.email,
      col.alamat,
      headerHeight
    );
    drawCell(
      "Tujuan",
      startX +
        col.nama +
        col.no_telp +
        col.instansi +
        col.email +
        col.alamat,
      col.tujuan,
      headerHeight
    );
    drawCell(
      "Tanggal",
      startX +
        col.nama +
        col.no_telp +
        col.instansi +
        col.email +
        col.alamat +
        col.tujuan,
      col.tanggal,
      headerHeight
    );

    y += headerHeight;

    // =============================
    // BARIS DATA
    // =============================
    result.rows.forEach((row) => {
      const rowHeight = 30;

      if (y + rowHeight > 780) {
        doc.addPage({ layout: "portrait" });
        y = 50;
      }

      drawCell(row.nama || "-", startX, col.nama, rowHeight);
      drawCell(row.no_telp || "-", startX + col.nama, col.no_telp, rowHeight);
      drawCell(
        row.instansi || "-",
        startX + col.nama + col.no_telp,
        col.instansi,
        rowHeight
      );
      drawCell(
        row.email || "-",
        startX + col.nama + col.no_telp + col.instansi,
        col.email,
        rowHeight
      );
      drawCell(
        row.alamat || "-",
        startX + col.nama + col.no_telp + col.instansi + col.email,
        col.alamat,
        rowHeight
      );
      drawCell(
        row.tujuan_kunjungan || "-",
        startX +
          col.nama +
          col.no_telp +
          col.instansi +
          col.email +
          col.alamat,
        col.tujuan,
        rowHeight
      );

      const formattedDate = row.tanggal
        ? new Date(row.tanggal).toLocaleDateString("id-ID")
        : "-";

      drawCell(
        formattedDate,
        startX +
          col.nama +
          col.no_telp +
          col.instansi +
          col.email +
          col.alamat +
          col.tujuan,
        col.tanggal,
        rowHeight,
        "center"
      );

      y += rowHeight;
    });

    doc.end();
  } catch (err) {
    console.error("PDF EXPORT ERROR:", err);
    res.status(500).json({ error: "Gagal membuat PDF" });
  }
});


// =====================================================
// 📤 EXPORT XLSX (ADMIN)
// =====================================================
router.get("/export/xlsx", verifyAdmin, async (req, res) => {
  try {
    const { keyword = "", start = "", end = "" } = req.query;
    const ExcelJS = (await import("exceljs")).default;

    // =============================
    // Ambil nama perusahaan
    // =============================
    const tenant = await pool.query(
      "SELECT nama_perusahaan FROM perusahaan WHERE id = $1",
      [req.tenant_id]
    );

    const namaPerusahaan =
      tenant.rows[0]?.nama_perusahaan || "Perusahaan Tidak Diketahui";

    // =============================
    // QUERY DATA
    // =============================
    let query = `
      SELECT 
        nama, 
        no_telp, 
        instansi, 
        email, 
        alamat, 
        tujuan_kunjungan, 
        tanggal
      FROM tamu
      WHERE tenant_id = $1
    `;

    const params = [req.tenant_id];
    let index = 2;

    if (keyword) {
      query += `
        AND (
          nama ILIKE $${index} OR
          instansi ILIKE $${index} OR
          tujuan_kunjungan ILIKE $${index}
        )
      `;
      params.push(`%${keyword}%`);
      index++;
    }

    if (start && end) {
      query += ` AND tanggal BETWEEN $${index} AND $${index + 1}`;
      params.push(start, end);
      index += 2;
    }

    query += ` ORDER BY tanggal DESC`;

    const result = await pool.query(query, params);

    // =============================
    // BUAT FILE EXCEL
    // =============================
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data Tamu");

    // Header
    ws.addRow([
      "Nama Perusahaan:",
      namaPerusahaan,
    ]);
    ws.addRow([]);
    ws.addRow([
      "Nama",
      "No. Telp",
      "Instansi",
      "Email",
      "Alamat",
      "Tujuan Kunjungan",
      "Tanggal",
    ]);

    // STYLE HEADER
    ws.getRow(3).eachCell((c) => {
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Data rows
    result.rows.forEach((r) => {
      ws.addRow([
        r.nama || "-",
        r.no_telp || "-",
        r.instansi || "-",
        r.email || "-",
        r.alamat || "-",
        r.tujuan_kunjungan || "-",
        r.tanggal
          ? new Date(r.tanggal).toLocaleDateString("id-ID")
          : "-",
      ]);
    });

    // Autofit kolom
    ws.columns.forEach((col) => {
      let max = 15;
      col.eachCell({ includeEmpty: true }, (cell) => {
        max = Math.max(
          max,
          cell.value ? cell.value.toString().length + 5 : 10
        );
      });
      col.width = max;
    });

    // =============================
    // KIRIM FILE
    // =============================
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=data_tamu.xlsx"
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("XLSX EXPORT ERROR:", err);
    res.status(500).json({ error: "Gagal membuat XLSX" });
  }
});


// =====================================================
// 🔑 GANTI PASSWORD ADMIN
// =====================================================
router.put("/ganti-password", verifyAdmin, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "Password tidak lengkap" });
  }

  try {
    // Ambil data admin
    const q = await pool.query(
      "SELECT password FROM admin WHERE id = $1",
      [req.admin_id]
    );

    if (!q.rows.length) {
      return res.status(404).json({ error: "Admin tidak ditemukan" });
    }

    const admin = q.rows[0];

    // Cek password lama benar
    const match = await bcrypt.compare(oldPassword, admin.password);

    if (!match) {
      return res.status(400).json({ error: "Password lama salah!" });
    }

    // Hash password baru
    const hashed = await bcrypt.hash(newPassword, 10);

    // Update database
    await pool.query(
      "UPDATE admin SET password = $1 WHERE id = $2",
      [hashed, req.admin_id]
    );

    res.json({ success: true, message: "Password berhasil diganti" });

  } catch (err) {
    console.error("GANTI PASSWORD ERROR:", err);
    res.status(500).json({ error: "Gagal mengganti password" });
  }
});





  return router;
}
