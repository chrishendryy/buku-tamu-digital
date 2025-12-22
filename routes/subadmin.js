// ====================================================================
// 📘 SUBADMIN ROUTES — FINAL FIXED VERSION (POOL INJECTION)
// ====================================================================
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";

export default function (pool) {
  const router = express.Router();

  // ====================================================================
  // 🔐 MIDDLEWARE: VERIFY SUBADMIN + CEK STATUS SUBADMIN + CEK PERUSAHAAN
  // ====================================================================
  const verifySubadmin = async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer "))
        return res.status(401).json({ error: "TOKEN_INVALID", message: "Token tidak ditemukan" });

      const token = header.split(" ")[1];
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "supersecret123"
      );

      req.subadmin_id = decoded.id;
      req.tenant_id = decoded.tenant_id;

      // 1. CEK STATUS SUBADMIN
      const cekSubadmin = await pool.query(
        `SELECT status FROM subadmin WHERE id = $1`,
        [req.subadmin_id]
      );

      if (!cekSubadmin.rows.length)
        return res.status(404).json({ error: "SUBADMIN_NOT_FOUND", message: "Subadmin tidak ditemukan" });

      if (cekSubadmin.rows[0].status !== "active")
        return res.status(403).json({
          error: "SUBADMIN_NONAKTIF",
          message: "Akun subadmin NONAKTIF. Akses ditolak."
        });

      // 2. CEK STATUS PERUSAHAAN
      const perusahaan = await pool.query(
        `SELECT status_sewa FROM perusahaan WHERE id = $1`,
        [req.tenant_id]
      );

      if (!perusahaan.rows.length)
        return res.status(404).json({ error: "PERUSAHAAN_NOT_FOUND", message: "Perusahaan tidak ditemukan" });

      if (perusahaan.rows[0].status_sewa !== "aktif")
        return res.status(403).json({
          error: "PERUSAHAAN_NONAKTIF",
          message: "Perusahaan NONAKTIF. Akses ditolak."
        });

      next();
    } catch (err) {
      console.error("verifySubadmin error:", err);
      return res.status(401).json({ error: "TOKEN_INVALID", message: "Token tidak valid" });
    }
  };

  // ====================================================================
  // 🔐 LOGIN SUBADMIN — FIX FINAL
  // ====================================================================
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      // ❗ FIX: alias perusahaan_id menjadi tenant_id
      const result = await pool.query(
        `SELECT 
            id,
            username,
            password,
            nama_lengkap,
            status,
            perusahaan_id AS tenant_id
        FROM subadmin
        WHERE username = $1`,
        [username]
      );

      if (!result.rows.length)
        return res.status(401).json({ error: "USERNAME_INVALID", message: "Username tidak ditemukan" });

      const user = result.rows[0];

      if (user.status !== "active")
        return res.status(403).json({
          error: "SUBADMIN_NONAKTIF",
          message: "Akun subadmin NONAKTIF"
        });

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res.status(401).json({ error: "PASSWORD_SALAH", message: "Password salah" });

      // ❗ FIX: pakai tenant_id hasil alias bukan user.tenant_id undefined
      const perusahaan = await pool.query(
        `SELECT status_sewa FROM perusahaan WHERE id = $1`,
        [user.tenant_id]
      );

      if (!perusahaan.rows.length)
        return res.status(404).json({ error: "PERUSAHAAN_NOT_FOUND", message: "Perusahaan tidak ditemukan" });

      const status_perusahaan = perusahaan.rows[0].status_sewa;

      if (status_perusahaan !== "aktif")
        return res.status(403).json({
          error: "PERUSAHAAN_NONAKTIF",
          message: "Perusahaan sedang NONAKTIF. Tidak dapat login."
        });

      // ❗ FIX: tenant_id sekarang benar
      const token = jwt.sign(
        {
          id: user.id,
          role: "subadmin",
          tenant_id: user.tenant_id,
        },
        process.env.JWT_SECRET || "supersecret123",
        { expiresIn: "7d" }
      );

      return res.json({
        error: null,
        message: "Login berhasil",
        role: "subadmin",
        token,
        status_perusahaan,
        user: {
          id: user.id,
          username: user.username,
          nama: user.nama_lengkap || user.nama,
          tenant_id: user.tenant_id, // ❗ sekarang tidak undefined
          status: user.status
        }
      });
    } catch (err) {
      console.error("Error login subadmin:", err);
      res.status(500).json({ error: "SERVER_ERROR", message: "Server error" });
    }
  });

    // ==========================================================
  // 📌 GET PROFIL PERUSAHAAN
  // ==========================================================
  router.get("/profil-perusahaan", verifySubadmin, async (req, res) => {
    try {
      const q = await pool.query(
        `SELECT nama_perusahaan, alamat, logo_url, deskripsi
         FROM perusahaan
         WHERE id = $1`,
        [req.tenant_id]
      );

      if (!q.rows.length) {
        return res.status(404).json({
          message: "Perusahaan tidak ditemukan"
        });
      }

      res.json(q.rows[0]);

    } catch (err) {
      console.error("SUBADMIN PROFIL ERROR:", err);
      res.status(500).json({
        message: "Gagal memuat profil perusahaan"
      });
    }
  });

  // ==========================================================
  // 🎨 GET PENGATURAN TAMPILAN
  // ==========================================================
  router.get("/pengaturan-tampilan", verifySubadmin, async (req, res) => {
    try {
      const q = await pool.query(
        `SELECT
           logo_url,
           teks_samping_logo,
           subjudul,
           judul_utama,
           deskripsi,
           copyright_text
         FROM pengaturan_tampilan
         WHERE tenant_id = $1
         LIMIT 1`,
        [req.tenant_id]
      );

      if (!q.rows.length) {
        return res.json({
          logo_url: "",
          teks_samping_logo: "",
          subjudul: "",
          judul_utama: "",
          deskripsi: "",
          copyright_text: ""
        });
      }

      res.json(q.rows[0]);

    } catch (err) {
      console.error("SUBADMIN GET PENGATURAN ERROR:", err);
      res.status(500).json({
        error: "Gagal memuat pengaturan tampilan"
      });
    }
  });

  // ==========================================================
  // 🎨 UPDATE PENGATURAN TAMPILAN (UPSERT)
  // ==========================================================
  router.put("/pengaturan-tampilan", verifySubadmin, async (req, res) => {
    try {
      const {
        logo_url,
        teks_samping_logo,
        subjudul,
        judul_utama,
        deskripsi,
        copyright_text
      } = req.body;

      await pool.query(
        `
        INSERT INTO pengaturan_tampilan
          (tenant_id, logo_url, teks_samping_logo, subjudul,
           judul_utama, deskripsi, copyright_text, updated_at)
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
          req.tenant_id,
          logo_url,
          teks_samping_logo,
          subjudul,
          judul_utama,
          deskripsi,
          copyright_text
        ]
      );

      res.json({
        success: true,
        message: "Pengaturan tampilan berhasil disimpan"
      });

    } catch (err) {
      console.error("SUBADMIN UPDATE ERROR:", err);
      res.status(500).json({
        error: "Gagal update pengaturan tampilan"
      });
    }
  });

  // ==========================================================
  // 📤 UPLOAD LOGO (BASE64 → FILE + DB)
  // ==========================================================
  router.post("/upload-logo", verifySubadmin, async (req, res) => {
    try {
      const { file, filename } = req.body;

      if (!file || !filename) {
        return res.status(400).json({
          error: "File tidak valid"
        });
      }

      const ext = filename.split(".").pop();
      const fileName = `logo_${req.tenant_id}_${Date.now()}.${ext}`;
      const uploadDir = path.join(process.cwd(), "uploads");
      const savePath = path.join(uploadDir, fileName);

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const buffer = Buffer.from(file, "base64");
      fs.writeFileSync(savePath, buffer);

      const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;

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
        [req.tenant_id, fileUrl]
      );

      res.json({
        success: true,
        url: fileUrl
      });

    } catch (err) {
      console.error("SUBADMIN UPLOAD LOGO ERROR:", err);
      res.status(500).json({
        error: "Gagal upload logo"
      });
    }
  });
  // ====================================================================
  // 📌 DASHBOARD (SUDAH ADA DI PART 1 — Tidak diubah)
  // ====================================================================
  router.get("/dashboard", verifySubadmin, async (req, res) => {
    try {
      const tenant_id = req.tenant_id;

      const today = new Date().toISOString().split("T")[0];

      const todayQuery = await pool.query(
        `SELECT COUNT(*) AS total FROM public.tamu
         WHERE tenant_id = $1 AND DATE(created_at) = $2`,
        [tenant_id, today]
      );

      const weekQuery = await pool.query(
        `SELECT COUNT(*) AS total FROM public.tamu
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 DAYS'`,
        [tenant_id]
      );

      const monthQuery = await pool.query(
        `SELECT COUNT(*) AS total FROM public.tamu
         WHERE tenant_id = $1
         AND DATE_PART('month', created_at) = DATE_PART('month', NOW())
         AND DATE_PART('year', created_at) = DATE_PART('year', NOW())`,
        [tenant_id]
      );

      const totalAllQuery = await pool.query(
        `SELECT COUNT(*) AS total FROM public.tamu WHERE tenant_id = $1`,
        [tenant_id]
      );

      const recentGuests = await pool.query(
        `SELECT nama, instansi, email, no_telp, tujuan_kunjungan, created_at
         FROM public.tamu
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [tenant_id]
      );

      return res.json({
        total_today: Number(todayQuery.rows[0].total),
        total_week: Number(weekQuery.rows[0].total),
        total_month: Number(monthQuery.rows[0].total),
        total_all: Number(totalAllQuery.rows[0].total),
        recent_guests: recentGuests.rows,
      });
    } catch (err) {
      console.error("Dashboard error:", err);
      res.status(500).json({ message: "Gagal load dashboard" });
    }
  });

  // ====================================================================
  // 📌 DATA TAMU (asli, tidak diubah)
  // ====================================================================
  router.get("/tamu", verifySubadmin, async (req, res) => {
    try {
      const tenant_id = req.tenant_id;

      const { keyword = "", start = "", end = "" } = req.query;

      let query = `
        SELECT id, nama, instansi, email, no_telp, alamat, tujuan_kunjungan, created_at
        FROM public.tamu
        WHERE tenant_id = $1
      `;
      const params = [tenant_id];

      if (keyword) {
        params.push(`%${keyword}%`);
        query += ` AND (nama ILIKE $${params.length}
                  OR instansi ILIKE $${params.length}
                  OR tujuan_kunjungan ILIKE $${params.length})`;
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

      const result = await pool.query(query, params);

      return res.json(result.rows);
    } catch (err) {
      console.error("Error tamu list:", err);
      res.status(500).json({ message: "Gagal memuat data tamu" });
    }
  });

  // ====================================================================
// 🗑️ DELETE DATA TAMU (SUBADMIN)
// ====================================================================
router.delete("/tamu/:id", verifySubadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const tenant_id = req.tenant_id;

    const result = await pool.query(
      `
      DELETE FROM public.tamu
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
      `,
      [id, tenant_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "TAMU_NOT_FOUND",
        message: "Data tamu tidak ditemukan atau bukan milik tenant ini"
      });
    }

    res.json({
      success: true,
      message: "Data tamu berhasil dihapus"
    });
  } catch (err) {
    console.error("DELETE TAMU SUBADMIN ERROR:", err);
    res.status(500).json({
      error: "SERVER_ERROR",
      message: "Gagal menghapus data tamu"
    });
  }
});


  /// ====================================================================
  // 🔥 CEK STATUS SUBADMIN & PERUSAHAAN **(YANG BENAR)**
  // ====================================================================
 router.get("/cek-status", async (req, res) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer "))
      return res.status(401).json({
        status_subadmin: "nonaktif",
        status_perusahaan: "nonaktif"
      });

    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecret123");

    const subadmin_id = decoded.id;
    const tenant_id = decoded.tenant_id;

    const sub = await pool.query(
      `SELECT status FROM subadmin WHERE id = $1`,
      [subadmin_id]
    );

    const status_subadmin = sub.rows.length ? sub.rows[0].status : "nonaktif";

    const perusahaan = await pool.query(
      `SELECT status_sewa FROM perusahaan WHERE id = $1`,
      [tenant_id]
    );

    const status_perusahaan = perusahaan.rows.length
      ? perusahaan.rows[0].status_sewa
      : "nonaktif";

    return res.json({
      status_subadmin,
      status_perusahaan
    });

  } catch (err) {
    return res.json({
      status_subadmin: "nonaktif",
      status_perusahaan: "nonaktif"
    });
  }
});



  // ====================================================================
  // 📌 EXPORT PDF (asli, tidak diubah)
  // ====================================================================
  router.get("/export/pdf", verifySubadmin, async (req, res) => {
    try {
      const { keyword = "", start = "", end = "" } = req.query;

      const perusahaan = await pool.query(
        "SELECT nama_perusahaan FROM perusahaan WHERE id = $1",
        [req.tenant_id]
      );

      const namaPerusahaan = perusahaan.rows[0]?.nama_perusahaan || "Perusahaan";

      let query = `
      SELECT nama, no_telp, instansi, email, alamat, tujuan_kunjungan, tanggal
      FROM tamu
      WHERE tenant_id = $1
      `;

      const params = [req.tenant_id];

      if (keyword) {
        params.push(`%${keyword}%`);
        query += `
        AND (
          nama ILIKE $2 OR 
          instansi ILIKE $2 OR 
          tujuan_kunjungan ILIKE $2
        )
      `;
      }

      if (start && end) {
        params.push(start, end);
        query += `
        AND tanggal BETWEEN $${params.length - 1} AND $${params.length}
      `;
      }

      query += " ORDER BY tanggal DESC";

      const result = await pool.query(query, params);

      const doc = new PDFDocument({
        margin: 30,
        size: "A4"
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=data_tamu_subadmin.pdf`
      );

      doc.pipe(res);

      doc.fontSize(16).text(`LAPORAN DATA TAMU - ${namaPerusahaan}`, {
        align: "center"
      });
      doc.moveDown(1);

      const col = {
        nama: 70,
        no_telp: 65,
        instansi: 70,
        email: 90,
        alamat: 100,
        tujuan: 70,
        tanggal: 60,
      };

      const startX = 30;
      let y = 100;

      doc.fontSize(9);

      function drawCell(text, x, width, height, align = "left") {
        doc.rect(x, y, width, height).stroke();
        doc.text(text, x + 3, y + 3, {
          width: width - 6,
          align,
        });
      }

      const headerHeight = 22;

      drawCell("Nama", startX, col.nama, headerHeight);
      drawCell("No. Telp", startX + col.nama, col.no_telp, headerHeight);
      drawCell("Instansi", startX + col.nama + col.no_telp, col.instansi, headerHeight);
      drawCell("Email", startX + col.nama + col.no_telp + col.instansi, col.email, headerHeight);
      drawCell("Alamat", startX + col.nama + col.no_telp + col.instansi + col.email, col.alamat, headerHeight);
      drawCell("Tujuan", startX + col.nama + col.no_telp + col.instansi + col.email + col.alamat, col.tujuan, headerHeight);
      drawCell("Tanggal", startX + col.nama + col.no_telp + col.instansi + col.email + col.alamat + col.tujuan, col.tanggal, headerHeight);

      y += headerHeight;

      result.rows.forEach((row) => {
        const rowHeight = 35;

        if (y + rowHeight > 780) {
          doc.addPage();
          y = 40;
        }

        drawCell(row.nama || "-", startX, col.nama, rowHeight);
        drawCell(row.no_telp || "-", startX + col.nama, col.no_telp, rowHeight);
        drawCell(row.instansi || "-", startX + col.nama + col.no_telp, col.instansi, rowHeight);
        drawCell(row.email || "-", startX + col.nama + col.no_telp + col.instansi, col.email, rowHeight);
        drawCell(row.alamat || "-", startX + col.nama + col.no_telp + col.instansi + col.email, col.alamat, rowHeight);
        drawCell(
          row.tujuan_kunjungan || "-",
          startX + col.nama + col.no_telp + col.instansi + col.email + col.alamat,
          col.tujuan,
          rowHeight
        );

        const formattedDate = row.tanggal
          ? new Date(row.tanggal).toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })
          : "-";

        drawCell(
          formattedDate,
          startX + col.nama + col.no_telp + col.instansi + col.email + col.alamat + col.tujuan,
          col.tanggal,
          rowHeight,
          "center"
        );

        y += rowHeight;
      });

      doc.end();

    } catch (err) {
      console.error("EXPORT SUBADMIN PDF ERROR:", err);
      res.status(500).json({ error: "Gagal membuat PDF" });
    }
  });
  // ====================================================================
  // 📤 EXPORT XLSX (SUBADMIN)
  // ====================================================================
  router.get("/export/xlsx", verifySubadmin, async (req, res) => {
    try {
      const { keyword = "", start = "", end = "" } = req.query;

      const tenant = await pool.query(
        "SELECT nama_perusahaan FROM perusahaan WHERE id = $1",
        [req.tenant_id]
      );

      const namaPerusahaan =
        tenant.rows[0]?.nama_perusahaan || "Perusahaan Tidak Diketahui";

      // =============================
      // QUERY DATA — FIX TANGGAL + CREATED_AT
      // =============================
      let query = `
        SELECT 
          nama, 
          no_telp, 
          instansi, 
          email, 
          alamat, 
          tujuan_kunjungan, 
          created_at
        FROM tamu
        WHERE tenant_id = $1
      `;

      const params = [req.tenant_id];
      let index = 2;

      // Keyword
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

      // Filter tanggal — FIXED
      if (start && end) {
        query += ` AND DATE(created_at) BETWEEN $${index} AND $${index + 1}`;
        params.push(start);
        params.push(end);
        index += 2;
      }

      query += ` ORDER BY created_at DESC`;

      const result = await pool.query(query, params);

      // =============================
      // BUAT FILE EXCEL
      // =============================
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Data Tamu");

      sheet.addRow(["Nama Perusahaan:", namaPerusahaan]);
      sheet.addRow([]);
      sheet.addRow([
        "Nama",
        "No. Telepon",
        "Instansi",
        "Email",
        "Alamat",
        "Tujuan Kunjungan",
        "Tanggal",
      ]);

      sheet.getRow(3).eachCell((cell) => {
        cell.font = { bold: true };
        cell.alignment = { horizontal: "center" };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
          bottom: { style: "thin" },
        };
      });

      // DATA
      result.rows.forEach((row) => {
        sheet.addRow([
          row.nama || "-",
          row.no_telp || "-",
          row.instansi || "-",
          row.email || "-",
          row.alamat || "-",
          row.tujuan_kunjungan || "-",
          row.created_at
            ? new Date(row.created_at).toLocaleDateString("id-ID")
            : "-",
        ]);
      });

      sheet.columns.forEach((col) => {
        let max = 15;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const len = cell.value ? cell.value.toString().length + 5 : 10;
          if (len > max) max = len;
        });
        col.width = max;
      });

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=data_tamu_subadmin.xlsx"
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("SUBADMIN EXPORT XLSX ERROR:", err);
      res.status(500).json({ error: "Gagal membuat file XLSX" });
    }
  });

  // =======================================================
// 🔐 UPDATE PASSWORD SUBADMIN
// =======================================================
router.put("/:id/update-password", async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password)
    return res.status(400).json({ error: "Password tidak boleh kosong" });

  try {
    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE subadmin SET password=$1 WHERE id=$2",
      [hashed, id]
    );

    res.json({ success: true, message: "Password berhasil diperbarui" });

  } catch (err) {
    console.error("❌ ERROR update subadmin password:", err);
    res.status(500).json({ error: "Gagal update password" });
  }
});





  return router;
}
