import bcrypt from "bcrypt";
import { supabase } from "../supabaseClient.js";

// ==========================
// BUAT SUB ADMIN
// ==========================
export const createSubAdmin = async (req, res) => {
  try {
    const { username, password, nama_lengkap } = req.body;
    const perusahaan_id = req.tenant_id; // dari token admin

    if (!username || !password || !nama_lengkap) {
      return res.status(400).json({ error: "Semua field wajib diisi" });
    }

    // cek sudah dipakai?
    const { data: existing } = await supabase
      .from("subadmin")
      .select("id")
      .eq("username", username)
      .eq("perusahaan_id", perusahaan_id)
      .maybeSingle();

    if (existing) {
      return res
        .status(400)
        .json({ error: "Username sudah digunakan di perusahaan ini" });
    }

    const hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase.from("subadmin").insert([
      {
        username,
        password: hash,
        nama_lengkap,
        perusahaan_id,
        status: "active",
      },
    ]);

    if (error) throw error;

    res.json({ success: true, message: "Subadmin dibuat", subadmin: data });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================
// LIST SUB ADMIN
// ==========================
export const listSubAdmin = async (req, res) => {
  try {
    const perusahaan_id = req.tenant_id;

    const { data, error } = await supabase
      .from("subadmin")
      .select("*")
      .eq("perusahaan_id", perusahaan_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Gagal load subadmin" });
  }
};

// ==========================
// UPDATE STATUS
// ==========================
export const updateSubAdminStatus = async (req, res) => {
  try {
    const perusahaan_id = req.tenant_id;
    const { id } = req.params;
    const { status } = req.body;

    const { data, error } = await supabase
      .from("subadmin")
      .update({ status })
      .eq("id", id)
      .eq("perusahaan_id", perusahaan_id)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Subadmin tidak ditemukan" });
    }

    res.json({ success: true, subadmin: data });
  } catch (err) {
    res.status(500).json({ error: "Gagal update status" });
  }
};

// ==========================
// HAPUS SUB ADMIN
// ==========================
export const deleteSubAdmin = async (req, res) => {
  try {
    const perusahaan_id = req.tenant_id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from("subadmin")
      .delete()
      .eq("id", id)
      .eq("perusahaan_id", perusahaan_id)
      .select();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Subadmin tidak ditemukan" });
    }

    res.json({ success: true, message: "Subadmin dihapus" });
  } catch (err) {
    res.status(500).json({ error: "Gagal hapus subadmin" });
  }
};
