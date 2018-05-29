let config = {
    GithubConfigurations: {
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
        GITHUB_REDIRECT_URL: "http://127.0.0.1:3000/auth/callback",
        GITHUB_GET_USERINFO_URL: "http://127.0.0.1:3000/auth/user"
    },
    WebSocketServerConfigurations: {
        port: 9090,
        perMessageDeflate: {
            zlibDeflateOptions: {
                chunkSize: 1024,
                memLevel: 7,
                level: 3
            },
            zlibInflateOptions: {
                chunkSize: 10 * 1024
            },
            concurrencyLimit: 10,
            threshold: 1024
        }
    }
};

module.exports = config;