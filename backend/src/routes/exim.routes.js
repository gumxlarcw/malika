const router = require("express").Router();
const controller = require("../controllers/exim.controller");

router.get("/hs2", controller.searchHs2);
router.get("/:id", controller.getExim);

module.exports = router;
