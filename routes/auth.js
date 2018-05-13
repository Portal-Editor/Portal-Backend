var express = require('express');
var router = express.Router();

router.use(3000);

/* Dealing with authorization processes. */
router.get('/', function(req, res, next) {
  res.send('Test: get authorization status');
});

module.exports = router;
