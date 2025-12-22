// ===============================================
// 📘 Buku Tamu Backend (Node.js + Supabase + Express)
// Versi Multi-Tenant + Superadmin Dashboard + Tenant API
// ===============================================

import express from "express";
import pkg from "pg";
import cors from "cors";
import cron from "node-cron";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dns from "dns";                    // <=== FIX SSRF
import net from "net";
import { fileURLToPath } from "url";

// 🧩 Import Routes
import superadminRoutes from "./routes/superadmin.js";
import adminRoutes from "./routes/admin.js";
import guestRoutes from "./routes/guest.js";
import subadminRoutes from "./routes/subadmin.js";
import authAdminRoutes from "./routes/authAdmin.js";

dotenv.config();
const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 5000;

// ===============================================
// 🛡️ SECURITY HEADERS HARUS PALING AWAL
// ===============================================
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), fullscreen=(self)"
  );
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});



// ===============================================
// 📦 Koneksi Database
// ===============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function pingDB() {
  const r = await pool.query("SELECT NOW()");
  return r.rows?.[0]?.now;
}

// ===============================================
// 🛡️ HELMET SECURITY (FIX HEADER SCANNER)
// ===============================================
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "font-src": ["'self'", "data:"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "connect-src": ["'self'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginEmbedderPolicy: { policy: "require-corp" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-site" },

    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
      usb: [],
      payment: [],
      fullscreen: ["self"],
    },
  })
);

// ===============================================
// 🔵 CORS
// ===============================================
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:5173", "https://gp7621fx-3000.asse.devtunnels.ms"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// ===============================================
// 🚦 RATE LIMIT
// ===============================================
app.use("/tamu", rateLimit({ windowMs: 60000, max: 120 }));
app.use("/health", rateLimit({ windowMs: 60000, max: 120 }));
app.use("/login", rateLimit({ windowMs: 60000, max: 5 }));

// ===============================================
// ⚙️ Middleware Global
// ===============================================
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));



// ===============================================
// 📂 Static Uploads
// ===============================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

// ===============================================
// 🔐 LOGIN UNIVERSAL (FINAL, FIX SUBADMIN)
// ===============================================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    // =====================================================================
    // 1. SUPERADMIN LOGIN
    // =====================================================================
    const superRes = await pool.query(
      "SELECT * FROM public.superadmin WHERE username = $1",
      [username]
    );

    if (superRes.rows.length > 0) {
      const user = superRes.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (!match)
        return res.status(401).json({ error: "Password superadmin salah" });

      const token = jwt.sign(
        { id: user.id, role: "superadmin" },
        process.env.JWT_SECRET || "supersecret123",
        { expiresIn: "3h" }
      );

      return res.json({
        success: true,
        role: "superadmin",
        token,
        user: {
          id: user.id,
          username: user.username,
          created_at: user.created_at,
        },
      });
    }

    // =====================================================================
    // 2. SUBADMIN LOGIN  ✅ *FIX FINAL*
    // =====================================================================
    // ======================================================
    // SUBADMIN LOGIN (FIX FINAL + JOIN PERUSAHAAN)
    // ======================================================
    const subRes = await pool.query(`
      SELECT 
        s.id,
        s.username,
        s.password,
        s.nama_lengkap,
        s.status,
        s.perusahaan_id,
        p.status_sewa
      FROM public.subadmin s
      LEFT JOIN public.perusahaan p 
        ON p.id = s.perusahaan_id
      WHERE s.username = $1
      LIMIT 1
    `, [username]);

    if (subRes.rows.length > 0) {
      const user = subRes.rows[0];

      if (user.status !== "active")
        return res.status(403).json({ error: "Akun subadmin nonaktif" });

      const match = await bcrypt.compare(password, user.password);
      if (!match)
        return res.status(401).json({ error: "Password subadmin salah" });

      if (!user.status_sewa)
        return res.status(404).json({ error: "Perusahaan tidak ditemukan" });

      if (user.status_sewa !== "aktif")
        return res.status(403).json({
          error: "Perusahaan NONAKTIF. Subadmin tidak dapat login.",
        });

      const token = jwt.sign(
        { id: user.id, role: "subadmin", tenant_id: user.perusahaan_id },
        process.env.JWT_SECRET || "supersecret123",
        { expiresIn: "3h" }
      );

      return res.json({
        success: true,
        role: "subadmin",
        token,
        user: {
          id: user.id,
          username: user.username,
          tenant_id: user.perusahaan_id,
          nama_lengkap: user.nama_lengkap,
          status: user.status,
          status_perusahaan: user.status_sewa     // ← ★ SUPER PENTING
        }
      });
    }

    // =====================================================================
    // 3. ADMIN LOGIN
    // =====================================================================
    const adminRes = await pool.query(
      "SELECT * FROM public.admin WHERE username = $1",
      [username]
    );

    if (adminRes.rows.length > 0) {
      const user = adminRes.rows[0];

      if (!user.aktif)
        return res.status(403).json({ error: "Akun admin nonaktif" });

      const perusahaanRes = await pool.query(
        "SELECT * FROM perusahaan WHERE id = $1",
        [user.tenant_id]
      );

      const perusahaan = perusahaanRes.rows[0];
      if (!perusahaan)
        return res.status(403).json({ error: "Perusahaan tidak ditemukan" });

      if (
        perusahaan.masa_berlaku &&
        new Date(perusahaan.masa_berlaku) < new Date()
      )
        return res.status(403).json({ error: "Masa berlaku perusahaan habis" });

      const match = await bcrypt.compare(password, user.password);
      if (!match)
        return res.status(401).json({ error: "Password admin salah" });

      const token = jwt.sign(
        {
          id: user.id,
          role: user.role || "admin",
          tenant_id: user.tenant_id,
        },
        process.env.JWT_SECRET || "supersecret123",
        { expiresIn: "3h" }
      );

      return res.json({
        success: true,
        role: user.role || "admin",
        token,
        user: {
          id: user.id,
          username: user.username,
          tenant_id: user.tenant_id,
          aktif: user.aktif,
          is_online: user.is_online,
          last_login: user.last_login,
        },
      });
    }

    // =====================================================================
    // 4. USER TIDAK DITEMUKAN
    // =====================================================================
    return res.status(404).json({ error: "User tidak ditemukan" });

  } catch (err) {
    console.error("❌ Error login:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});


// ===============================================
// ROUTES MODULAR
// ===============================================
app.use("/superadmin", superadminRoutes(pool));
app.use("/admin", adminRoutes(pool));
app.use("/subadmin", subadminRoutes(pool));
app.use("/api/subadmin", subadminRoutes(pool));
app.use("/auth/admin", authAdminRoutes(pool));
app.use("/", guestRoutes(pool));

// ===============================================
// ROUTES UTAMA
// ===============================================
app.get("/", (req, res) =>
  res.send("🚀 Buku Tamu API Aktif - Multi Tenant Mode")
);

app.get("/health", async (req, res) => {
  try {
    const now = await pingDB();
    res.json({ ok: true, db_now: now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================================
// CRONJOB
// ===============================================
cron.schedule("0 0 * * *", async () => {
  console.log("🕛 [CRON] Cek masa berlaku perusahaan...");
  try {
    const expired = await pool.query(`
      SELECT id FROM public.perusahaan
      WHERE masa_berlaku < NOW()
    `);

    for (const p of expired.rows) {
      await pool.query(
        "UPDATE public.admin SET aktif = false WHERE tenant_id = $1",
        [p.id]
      );
    }
  } catch (err) {
    console.error("❌ [CRON] Error:", err.message);
  }
});

// ===============================================
// ERROR HANDLER
// ===============================================
app.use((err, req, res, next) => {
  console.error("💥 Uncaught error:", err);
  res.status(500).json({ error: "Server error" });
});

// ===============================================
// START SERVER
// ===============================================
const server = app.listen(port, async () => {
  console.log(`✅ Server berjalan di http://localhost:${port}`);
  try {
    const now = await pingDB();
    console.log("📡 Koneksi Supabase OK:", now);
  } catch (err) {
    console.error("⚠️ Gagal konek:", err.message);
  }
});

// ===============================================
// SHUTDOWN HANDLER
// ===============================================
function shutdown(sig) {
  console.log(`\n🔻 Received ${sig}. Menutup server...`);
  server.close(() =>
    pool.end(() => {
      console.log("✅ Pool PostgreSQL ditutup. Bye!");
      process.exit(0);
    })
  );
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
