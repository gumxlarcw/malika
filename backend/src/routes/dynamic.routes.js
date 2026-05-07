const router = require("express").Router();
const controller = require("../controllers/dynamic.controller");

router.get("/:id", controller.getDynamic);

module.exports = router;
