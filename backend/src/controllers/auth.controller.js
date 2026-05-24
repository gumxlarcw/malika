// src/controllers/auth.controller.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");
const { jwtSecret } = require("../config/env");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    jwtSecret,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// POST /auth/login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Email atau password salah" });
    }

    const token = generateToken(user);

    // bisa pakai header Authorization di frontend,
    // atau simpan sebagai httpOnly cookie:
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production", // auto-enable untuk HTTPS di production
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /auth/register  (hanya admin yang boleh pakai)
async function register(req, res) {
  try {
    const { name, email, password, role = "admin" } = req.body;

    const exist = await User.findByEmail(email);
    if (exist) {
      return res.status(400).json({ error: "Email sudah digunakan" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const user = await User.create({ name, email, password_hash, role });

    return res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /auth/me
async function me(req, res) {
  return res.json({ user: req.user });
}

// POST /auth/logout
async function logout(req, res) {
  res.clearCookie("token", { path: "/" });
  return res.json({ message: "Logged out" });
}

// GET /auth/users (admin only)
async function listUsers(req, res) {
  try {
    const users = await User.listAll();
    return res.json({ users });
  } catch (err) {
    console.error("List users error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /auth/change-password (any authenticated user — changes own password)
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      return res.status(400).json({ error: "currentPassword dan newPassword wajib diisi" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password baru minimal 8 karakter" });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Password baru harus berbeda dari yang lama" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User tidak ditemukan" });
    }

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Password saat ini salah" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await User.updatePasswordHash(user.id, newHash);

    // Invalidate current session — force re-login with new password
    res.clearCookie("token", { path: "/" });

    return res.json({ message: "Password berhasil diganti" });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// DELETE /auth/users/:id (admin only)
async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    
    // Prevent self-deletion
    if (Number(id) === req.user.id) {
      return res.status(400).json({ error: "Tidak bisa menghapus diri sendiri" });
    }
    
    await User.delete(id);
    return res.json({ message: "User deleted", id: Number(id) });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = { login, register, me, logout, listUsers, deleteUser, changePassword };
