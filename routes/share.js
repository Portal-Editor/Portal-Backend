let express = require('express');
let ShareDB = require('sharedb');
let otText = require('ot-text');
let WebSocket = require('ws');
let WebSocketStream = require('../public/javascripts/WebSocketStream');
const Constant = require("../public/javascripts/DataConstants");
const Config = require("../public/javascripts/Config");
let tinycolor = require("tinycolor2");
let unzip = require("unzip");
let JSZip = require("jszip");
let streamifier = require('streamifier/lib');
const fs = require('fs-extra');
const klawSync = require('klaw-sync');
const uuid = require('uuid/v1');

'use strict';

ShareDB.types.register(otText.type);

let portals = [];
let share = new ShareDB();

(function startServer() {
    // Create a WebSocket Server
    // and connect any incoming WebSocket connection to ShareDB
    const wss = new WebSocket.Server(Config.WebSocketServerConfigurations,
        () => console.log('WebSocket Server Created.'));

    wss.on('connection', ws => {
        const stream = new WebSocketStream(ws);

        ws.on('message', msg => { // receive text data
            // try {
            judgeType(ws, msg, stream);
            // } catch (err) {
            //     console.log("Errors occur:" + err);
            // }
        });

        ws.on('close', (code, reason) => {
            // socket client closed due to server closed, do not broadcast
            if (code === 1006) {
                return;
            }
            if (portals[ws.portalId] && portals[ws.portalId].users[ws.userId]) {
                portals[ws.portalId].users[ws.userId] = null;
                console.log('We just lost one connection: ' + ws.userId + ' from ' + ws.portalId);
                console.log('Now ' + ws.portalId + ' has ' + portals[ws.portalId].users.length + ' connection(s)');
                console.log('\n');
                let msg = {
                    a: Constant.META,
                    type: Constant.TYPE_CLOSE_SOCKET,
                    userId: ws.userId
                };
                broadcastMsg(JSON.stringify(msg), ws);
            }
        });

        share.listen(stream);
        console.log('Got one connection...\n');
    });

    process.on('SIGINT', () => {
        wss.close(() => process.exit());
    });
})();

function logFiles(files) {
    console.log('current files: ');
    console.log(files);
    console.log('\n');
}

function judgeType(ws, msg, stream) {
    let data = JSON.parse(msg);
    if (data.a === Constant.META) {
        console.log('Received meta data:' + JSON.stringify(data) + '\n');
        let users = portals[ws.portalId] ? portals[ws.portalId].users : null;
        let files = portals[ws.portalId] ? portals[ws.portalId].files : null;
        let file = data.path ? files[data.path] : null;
        let root = Constant.DIR_PORTAL_ROOT + ws.portalId + '/';
        let willBroadcastToAll = false;

        switch (data.type) {

            /* ===============================================================
            *
            *   Init
            *   Dealing when someone's creating or joining a portal project
            *
            *   Needed:
            *   { userId, portalId, name }
            *
            =============================================================== */

            case Constant.TYPE_INIT:
                let isCreate = ws.createOrJoinSession(data);

                if (isCreate === -1) {
                    ws.send(Constant.ERROR_USERID_DUPLICATION);
                    return;
                }

                let tempUsers = {};
                Object.keys(portals[ws.portalId].users).forEach(userId => {
                    tempUsers[userId] = {
                        id: userId,
                        name: portals[ws.portalId].users[userId].name,
                        color: portals[ws.portalId].users[userId].color
                    };
                });

                let res = {
                    a: Constant.META,
                    type: Constant.TYPE_INIT,
                    files: portals[ws.portalId].files,
                    users: tempUsers,
                    portalId: ws.portalId
                };

                if (isCreate) {
                    ws.send(JSON.stringify(res));
                } else {
                    makeZipAndSend(ws, res);
                }

                return;

            /* ===============================================================
            *
            *   Move Cursor
            *   - dealing after the user moving cursor -
            *
            *   Needed:
            *   { path, cursor: {row, column} }
            *
            =============================================================== */

            case Constant.TYPE_MOVE_CURSOR:
                let cursor = file.cursors[ws.userId];
                cursor.row = data.cursor.row;
                cursor.column = data.cursor.column;
                console.log('Ready to broadcast ' + ws.userId + '\'s cursor');

                data.userId = ws.userId;
                file.occupier.forEach(userId => {
                    if (userId !== ws.userId) {
                        console.log('Broadcasting ' + JSON.stringify(cursor) + ' to ' + userId);
                        broadcastMsgToSpecificClient(msg, ws, ws.userId);
                    }
                });
                return;

            /* ===============================================================
            *
            *   Change Active Status
            *   - change status to record if user is focusing on the file -
            *
            *   Needed:
            *   { path }
            *
            =============================================================== */

            case Constant.TYPE_CHANGE_ACTIVE_STATUS:
                changeActivationStatus(ws, users[ws.userId].focusOn, false);
                changeActivationStatus(ws, data.path, true);
                break;

            /* ===============================================================
            *
            *   Change Grammar
            *   - change grammar of specific file -
            *
            *   Needed:
            *   { path, grammar }
            *
            =============================================================== */

            case Constant.TYPE_CHANGE_GRAMMAR:
                if (file.grammar !== data.grammar) {
                    file.grammar = data.grammar;
                    console.log('User ' + ws.userId + ' has changed grammar to ' + data.grammar);
                }
                break;

            /* ===============================================================
            *
            *   Open file
            *   - record that the user is opening a file -
            *
            *   Needed:
            *   { path }
            *
            =============================================================== */

            case Constant.TYPE_OPEN_FILE:
                let shouldChoke = false;
                fs.pathExists(root + data.path).then(exists => {
                    if (!exists) {
                        portals[ws.portalId].pendings[data.path] = {
                            grammar: data.grammar
                        };
                        shouldChoke = true;
                    }
                });
                if (shouldChoke) return;
                else {
                    updateFileStatus(data.path, data.grammar);
                    break;
                }

            /* ===============================================================
            *
            *   Close file
            *   - process after the user closing the file -
            *
            *   Needed:
            *   { path }
            *
            =============================================================== */

            case Constant.TYPE_CLOSE_FILE:
                if (!file.path) {
                    console.log(data.path + ' is not an allowed path.');
                    return;
                }

                let index = file.activeUser.indexOf(ws.userId);
                if (index !== -1) {
                    file.activeUser.splice(index, 1);
                }
                file.occupier.splice(file.occupier.indexOf(ws.userId), 1);
                file.cursors[ws.userId] = null;
                data.userId = ws.userId;

                broadcastMsg(JSON.stringify(data), ws); // broadcast close info first

                if (!file.occupier.length) {
                    file = null;
                    console.log(data.path + ' removed.');
                    data = {
                        a: "meta",
                        type: Constant.TYPE_OCCUPIER_CLEARED,
                        path: data.path
                    };
                    willBroadcastToAll = true;
                    logFiles(files);
                    break;
                } else {
                    logFiles(files);
                    return;
                }

            /* ===============================================================
            *
            *   Create file
            *   - process after the user creating a new file -
            *
            *   Needed:
            *   { path, data, isFolder, isOpen }
            *
            =============================================================== */

            case Constant.TYPE_CREATE_FILE:
                if (data.isFolder && !data.buffer) {
                    fs.ensureDir(root + data.path, err => {
                        console.log(err);
                    });
                } else if (!data.isFolder) {
                    if (data.isOpen && portals[ws.portalId].pendings[data.path]) {
                        data.grammar = portals[ws.portalId].pendings[data.path].grammar;
                        updateFileStatus(data.path, data.grammar);
                        portals[ws.portalId].pendings[data.path] = null;
                    }
                    fs.outputFile(root + data.path,
                        typeof data.buffer ? (data.buffer === "string" ? data.buffer : Buffer.from(data.buffer)) : "",
                        {'flag': 'wx'}, err => {
                            if (err && err.code !== 'EEXIST') console.log(err);
                        });
                }
                data.userId = ws.userId;
                break;

            /* ===============================================================
            *
            *   Delete file
            *   - process after the user deleting the file -
            *
            *   Needed:
            *   { path }
            *
            =============================================================== */

            case Constant.TYPE_DELETE_FILE:
                data.userId = ws.userId;
                break;

            /* ===============================================================
            *
            *   Save file
            *   - process after the user creating a new file -
            *
            *   Needed:
            *   { path, data, isFolder }
            *
            =============================================================== */

            case Constant.TYPE_SAVE_FILE:
                data.userId = ws.userId;
                break;
        }
        // other meta changes: cursor position, text selection
        // and open/save/close file
        broadcastMsg(JSON.stringify(data), ws, willBroadcastToAll);

    } else if (data.type === 'Buffer') {
        if (!ws.portalId) {
            console.log("No portal created.");
        }
        try {
            streamifier.createReadStream(Buffer.from(data.data))
                .pipe(unzip.Extract({path: Constant.DIR_PORTAL_ROOT + ws.portalId}));
        } catch (err) {
            console.log("Errors occur:" + err);
        }
    } else if (data.a === Constant.DEBUG) {
        if (data.type === 'rc') { // random color
            ws.send(createRandomColor());
        }
    } else {
        // OT
        console.log(JSON.stringify(data));
        stream.push(data);
    }
}

function broadcastMsg(msg, ws, isToAll = false) {
    let sockets = portals[ws.portalId].users;
    Object.keys(sockets).forEach(userId => {
        if (isToAll || userId !== ws.userId) {
            broadcastMsgToSpecificClient(msg, portals[ws.portalId].users[userId].ws);
        }
    });
}

function broadcastMsgToSpecificClient(msg, socket) {
    if (socket.readyState === WebSocket.OPEN) {
        console.log('Broadcasting msg to ' + socket.userId + '\n' + msg + '\n');
        setTimeout(() => socket.send(msg), 0);
    }
}

function updateFileStatus(path, grammar) {
    let files = portals[ws.portalId].files;
    let focus = portals[ws.portalId].users[ws.userId].focusOn;
    if (focus) {
        let i = portals[ws.portalId].files[focus].activeUser.indexOf(ws.userId);
        portals[ws.portalId].files[focus].activeUser.splice(i, 1);
    }
    portals[ws.portalId].users[ws.userId].focusOn = path;

    if (!files[path]) {
        files[path] = {
            path: path,
            grammar: grammar,
            occupier: [],
            activeUser: [],
            cursors: {}
        };
    }

    files[path].occupier.push(ws.userId);
    files[path].activeUser.push(ws.userId);

    files[path].cursors[ws.userId] = {
        row: 0,
        column: 0,
        color: portals[ws.portalId].users[ws.userId].color
    };
    console.log(path + ' added\n');
    logFiles(files);
}

function makeZipAndSend(ws, data) {
    let zip = new JSZip();
    let root = Constant.DIR_PORTAL_ROOT + ws.portalId; // NOTICE: No slash in the end
    const paths = klawSync(root);

    paths.forEach(item =>
        zip.file(item.path.replace(root, ""), fs.readFileSync(item.path)));

    zip.generateAsync({type: 'array', streamFiles: false}).then((arr) => {
        data.data = arr;
        ws.send(JSON.stringify(data));
    });
}

function changeActivationStatus(ws, path, isActive) {
    if (isActive) {
        if (portals[ws.portalId].files[path].activeUser.includes(ws.userId)) {
            portals[ws.portalId].files[path].activeUser.push(ws.userId);
            portals[ws.portalId].users[ws.userId].focusOn = path;
        } else {
            console.log("User " + ws.userId + " is not active on file " + path + ".");
            return;
        }
    } else {
        portals[ws.portalId].files[path].activeUser
            .splice(portals[ws.portalId].files[path].activeUser.indexOf(ws.userId), 1);
        portals[ws.portalId].users[ws.userId].focusOn = null;
    }
    console.log('Occupier' + ws.userId + ' has changed status to ' + isActive ?
        "active" : "inactive" + " of " + path);
}

function createRandomColor() {
    let h = (Math.random() + Constant.GOLDEN_RATIO_CONJUGATE) % 1;
    let color = `hsl(${Math.floor(h * 360)}, 50%, 60%`;
    return tinycolor(color).toHexString();
}

WebSocket.prototype.createOrJoinSession = function (data) {
    let isCreate = false;
    this.portalId = data.portalId || uuid();
    this.userId = data.userId;
    if (typeof portals[this.portalId] === 'undefined') { // create
        isCreate = true;
        portals[this.portalId] = {
            id: this.portalId,
            files: {},
            users: {},
            pendings: {}
        };
    } else {
        Object.keys(portals[this.portalId].users).forEach((userId) => {
            if (userId === this.userId) return -1;
        });
    }
    portals[this.portalId].users[this.userId] = {
        id: this.userId,
        name: data.name || this.userId,
        color: createRandomColor()
    };
    broadcastMsg(JSON.stringify({
        a: Constant.META,
        type: Constant.TYPE_USER_JOINED,
        user: portals[this.portalId].users[this.userId]
    }), this);
    portals[this.portalId].users[this.userId].ws = this;
    console.log('Session ' + this.portalId + ' adds ' + this.userId + '\n');
    return isCreate;
};

WebSocket.prototype.getId = function () {
    return this.upgradeReq.headers['sec-websocket-key'];
};

const router = express.Router();

module.exports = router;
