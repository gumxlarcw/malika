const sequelize = require("./src/config/db");

(async () => {
    try {
        await sequelize.authenticate();
        console.log("✅ Koneksi ke database BERHASIL!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Koneksi ke database GAGAL!");
        console.error(error);
        process.exit(1);
    }
})();
