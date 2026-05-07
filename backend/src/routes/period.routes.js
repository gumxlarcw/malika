const router = require("express").Router();
const controller = require("../controllers/period.controller");

router.get("/generate/:id", controller.generatePeriodForSource);
router.get("/generate-all", controller.generatePeriodForAll);
router.get("/list/:id", controller.listPeriodForSource);

module.exports = router;
