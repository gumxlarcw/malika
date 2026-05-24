const sequelize = require("../config/db");
const { QueryTypes } = require("sequelize");

const User = {
  async findByEmail(email) {
    const rows = await sequelize.query(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      {
        replacements: [email],
        type: QueryTypes.SELECT,
      }
    );

    return rows[0] || null;
  },

  async findById(id) {
    const rows = await sequelize.query(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
      {
        replacements: [id],
        type: QueryTypes.SELECT,
      }
    );
    return rows[0] || null;
  },

  async create({ name, email, password_hash, role = "admin" }) {
    const result = await sequelize.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
      {
        replacements: [name, email, password_hash, role],
      }
    );

    const insertId = result[0].insertId;
    return this.findById(insertId);
  },

  async listAll() {
    const rows = await sequelize.query(
      "SELECT id, name, email, role, created_at FROM users ORDER BY id",
      {
        type: QueryTypes.SELECT,
      }
    );
    return rows;
  },

  async delete(id) {
    await sequelize.query("DELETE FROM users WHERE id = ?", {
      replacements: [id],
    });
  },

  async updatePasswordHash(id, password_hash) {
    await sequelize.query(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      { replacements: [password_hash, id] }
    );
  },
};

module.exports = User;
