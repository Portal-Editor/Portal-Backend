var WebSocketJSONStream = require('websocket-json-stream');
var express = require('express');
var ShareDB = require('sharedb');
var router = express.Router();

var stream = new WebSocketJSONStream(ws);
share.listen(stream);

router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

module.exports = router;
