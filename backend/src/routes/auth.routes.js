// src/routes/auth.routes.js
const express = require("express");
const router = express.Router();
const { login, register, me, logout, listUsers, deleteUser } = require("../controllers/auth.controller");
const { authMiddleware, requireAdmin } = require("../middleware/auth.middleware");

// login
router.post("/login", login);

// buat user baru (hanya admin)
router.post("/register", authMiddleware, requireAdmin, register);

// cek user yang sedang login
router.get("/me", authMiddleware, me);

// list all users (admin only)
router.get("/users", authMiddleware, requireAdmin, listUsers);

// delete user (admin only)
router.delete("/users/:id", authMiddleware, requireAdmin, deleteUser);

// logout
router.post("/logout", authMiddleware, logout);

module.exports = router;
