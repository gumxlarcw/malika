const express = require("express");
const router = express.Router();
const { getAvailablePeriods } = require("../controllers/periodAvailability.controller");

// GET /period/available/:id
router.get("/:id", getAvailablePeriods);

module.exports = router;
