var express = require('express');
var config = require('public/javascripts/Config');
var router = express.Router();

router.use(3000);

/* Dealing with authorization processes. */
router.get('/', function(req, res, next) {
  res.send('Test: get authorization status');
});

router.get('/login', function(req, res) {
    var dataStr = (new Date()).valueOf();
    //重定向到认证接口,并配置参数
    //注意这里使用的是node的https模块发起的请求
    var path = "https://github.com/login/OAuth/authorize";
    path += '?client_id=' + config.GITHUB_CLIENT_ID;
    path += '&scope=' + config.GITHUB_CLIENT_SCOPE;
    path += '&state=' + dataStr;
    //转发到授权服务器
    res.redirect(path);
});

router.get("/callback", function(req, res){
    let code = req.query.code;
    let state = req.query.state;
    let headers = req.headers;
    let path = "/login/OAuth/access_token";
    headers.host = 'github.com';

    path += '?client_id=' + config.GITHUB_CLIENT_ID;
    path += '&client_secret='+ config.GITHUB_CLIENT_SECRET;
    path += '&code='+ code;
    console.log(path);
    var opts = {
        hostname:'github.com',
        port:'443',
        path:path,
        headers:headers,
        method:'POST'
    };
    // 注意这里使用的是node的https模块发起的请求
    https.request(opts, function(res){
        res.setEncoding('utf8');
        console.log(opts);
        //解析返回数据
        res.on('data', function(data){
            let args = data.split('&');
            let tokenInfo = args[0].split("=");
            let token = tokenInfo[1];
            console.log(data);
            //利用access_token向资源服务器请求用户授权数据
            let url = "https://api.github.com/user?access_token="+token+"&scope=user";
            https.get(url, function(res){
                res.on('data', function(userInfo){
                    console.log(userInfo);
                });
            });

        })
    });

});

module.exports = router;
