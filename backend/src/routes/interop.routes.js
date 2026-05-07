const router = require("express").Router();
const { getInterop } = require("../controllers/interop.controller");

router.get("/:id", getInterop);

module.exports = router;
