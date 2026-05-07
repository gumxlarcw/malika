const router = require("express").Router();
const controller = require("../controllers/pressrelease.controller");

// GET /pressrelease/:id?keyword=inflasi
router.get("/:id", controller.getPressRelease);

module.exports = router;
