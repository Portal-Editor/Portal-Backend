let express = require('express');
let Config = require('../public/javascripts/Config.js');
var request = require("request");
let router = express.Router();

router.get('/', function (req, res) {
    let dataStr = (new Date()).valueOf();
    let path = "https://github.com/login/oauth/authorize";
    path += '?client_id=' + Config.GITHUB_CLIENT_ID;
    path += '&redirect_url=' + Config.GITHUB_REDIRECT_URL;
    path += '&state=' + dataStr;
    res.redirect(path);
});

router.get("/callback", (req, res) => {
    let code = req.query.code;
    let options = {
        method: 'GET',
        url: 'https://github.com/login/oauth/access_token',
        qs: {
            client_id: Config.GITHUB_CLIENT_ID,
            client_secret: Config.GITHUB_CLIENT_SECRET,
            code: code
        },
        headers: {
            'host': 'github.com',
            'cache-control': 'no-cache',
            'Accept': 'application/json'
        }
    };
    request(options, (_err, _res, _body) => {
        if (_err) throw new Error(_err);
        let token = JSON.parse(_body).access_token;
        let options = {
            method: 'GET',
            url: 'https://api.github.com/user',
            qs: {
                access_token: token
            },
            headers: {
                'cache-control': 'no-cache',
                'User-Agent': 'Portal'
            }
        };
        request(options, (__err, __res, __body) => {
            console.log(JSON.parse(__body));
            res.send(__body);
        })
    });

});


module.exports = router;
