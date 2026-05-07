const express = require("express");
const router = express.Router();

const { getStatic } = require("../controllers/static.controller");

router.get("/:id", getStatic);

module.exports = router;
