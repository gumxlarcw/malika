const express = require("express");
const { getDashboardEmbed } = require("../controllers/metabase.controller");

const router = express.Router();

router.get("/embed/dashboard/:id", getDashboardEmbed);

module.exports = router;
