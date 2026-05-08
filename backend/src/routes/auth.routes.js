// src/routes/auth.routes.js
const express = require("express");
const router = express.Router();
const { login, register, me, logout, listUsers, deleteUser } = require("../controllers/auth.controller");
const { authMiddleware, requireAdmin } = require("../middleware/auth.middleware");
const { createAuditLogMiddleware } = require("../middleware/auditLog.middleware");

const auditAuth = createAuditLogMiddleware({ resource: 'auth' });

// login
router.post("/login", auditAuth, login);

// buat user baru (hanya admin)
router.post("/register", authMiddleware, requireAdmin, auditAuth, register);

// cek user yang sedang login
router.get("/me", authMiddleware, me);

// list all users (admin only)
router.get("/users", authMiddleware, requireAdmin, listUsers);

// delete user (admin only)
router.delete("/users/:id", authMiddleware, requireAdmin, auditAuth, deleteUser);

// logout
router.post("/logout", authMiddleware, auditAuth, logout);

module.exports = router;
