let express = require('express');
let config = require('../public/javascripts/Config.js');
var https = require('https');
let router = express.Router();

/* Dealing with authorization processes. */
router.get('/', function(req, res, next) {
  res.send('Test: get authorization status');
});

router.get('/login', function(req, res) {
    let dataStr = (new Date()).valueOf();
    let path = "https://github.com/login/oauth/authorize";
    path += '?client_id=' + config.GITHUB_CLIENT_ID;
    path += '&redirect_url=' + config.GITHUB_REDIRECT_URL;
    path += '&state=' + dataStr;
    res.redirect(path);
});

router.get("/callback", function(req, res){
    let code = req.query.code;
    let state = req.query.state;
    let headers = req.headers;
    let path = "/login/oauth/access_token";
    headers.host = 'github.com';

    path += '?client_id=' + config.GITHUB_CLIENT_ID;
    path += '&client_secret='+ config.GITHUB_CLIENT_SECRET;
    path += '&code='+ code;
    console.log(path);
    let opts = {
        hostname: 'github.com',
        port: '443',
        path: path,
        headers: headers,
        method:'POST'
    };
    https.request(opts, (res) => {
        res.setEncoding('utf8');
        console.log(opts);
        res.on('data', (data) => {
            let args = data.split('&');
            let tokenInfo = args[0].split("=");
            let token = tokenInfo[1];
            console.log(data);
            let url = "https://api.github.com/user?access_token=" + token + "&scope=user";
            https.get(url, (res) => {
                res.on('data', (userInfo) => {
                    console.log(userInfo);
                });
            });

        })
    });

});

module.exports = router;
