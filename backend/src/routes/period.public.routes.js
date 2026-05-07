const express = require("express");
const router = express.Router();
const { getPublicAvailablePeriods } = require("../controllers/periodPublic.controller");

// GET /period/public/:id
router.get("/:id", getPublicAvailablePeriods);

module.exports = router;
