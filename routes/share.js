let express = require('express');
let ShareDB = require('sharedb');
let otText = require('ot-text');
let WebSocket = require('ws');
let WebSocketStream = require('../public/javascripts/WebSocketStream');
let Constant = require("../public/javascripts/DataConstants");
let tinycolor = require("tinycolor2");
let yauzl = require("yauzl");
let JSZip = require("jszip");
const fs = require('fs-extra');
const klawSync = require('klaw-sync')

'use strict';

ShareDB.types.register(otText.type);

var portals = [];

const share = new ShareDB();

startServer();

function startServer() {
    // Create a WebSocket Server
    // and connect any incoming WebSocket connection to ShareDB
    const wss = new WebSocket.Server({
        port: 9090,
        perMessageDeflate: {
            zlibDeflateOptions: { // See zlib defaults.
                chunkSize: 1024,
                memLevel: 7,
                level: 3,
            },
            zlibInflateOptions: {
                chunkSize: 10 * 1024
            },
            concurrencyLimit: 10,
            threshold: 1024
        }
    }, () => console.log('WebSocket Server Created.'));

    wss.on('connection', (ws) => {
        const stream = new WebSocketStream(ws);

        ws.on('message', (msg) => { // receive text data
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
}

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
        var willBroadcastToAll = false;

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
                // create or join a session
                let isCreate = ws.createOrJoinSession(data);
                if (!isCreate) {
                    makeZip(ws);
                }
                let tempUsers = {};
                Object.keys(portals[ws.portalId].users).forEach((userId) => {
                    tempUsers[userId] = {
                        id: userId,
                        name: portals[ws.portalId].users[userId].name,
                        color: portals[ws.portalId].users[userId].color
                    };
                });
                ws.send(JSON.stringify({
                    a: Constant.META,
                    type: Constant.TYPE_INIT,
                    files: portals[ws.portalId].files,
                    users: tempUsers,
                    data: isCreate ? null : portals[ws.portalId].data
                }));
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
                file.occupier.forEach((userId) => {
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
                let focus = portals[ws.portalId].users[ws.userId].focusOn;
                if (focus) {
                    let i = portals[ws.portalId].files[focus].activeUser.indexOf(ws.userId);
                    portals[ws.portalId].files[focus].activeUser.splice(i, 1);
                }
                portals[ws.portalId].users[ws.userId].focusOn = data.path;

                if (!files[data.path]) {
                    files[data.path] = {
                        path: data.path,
                        grammar: data.grammar,
                        occupier: [],
                        activeUser: [],
                        cursors: {}
                    };
                }

                files[data.path].occupier.push(ws.userId);
                files[data.path].activeUser.push(ws.userId);

                files[data.path].cursors[ws.userId] = {
                    row: 0,
                    column: 0,
                    // TODO: random color
                    color: users[ws.userId].color
                };
                console.log(data.path + ' added\n');
                logFiles(files);
                break;

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

                // TODO: Refactor
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

            case Constant.TYPE_SAVE_FILE:
                break;
        }
        // other meta changes: cursor position, text selection
        // and open/save/close file
        broadcastMsg(JSON.stringify(data), ws, willBroadcastToAll);

    } else if (data.type === 'Buffer') {
        let yauzlFromBuffer = promisify(yauzl.fromBuffer);
        try {
            (async () => {
                let zipfile = await yauzlFromBuffer(Buffer.from(data.data), {lazyEntries: true});
                console.log("Number of entries: ", zipfile.entryCount);
                let openReadStream = promisify(zipfile.openReadStream.bind(zipfile));
                let portalDir = Constant.DIR_PORTAL_ROOT + ws.portalId;
                zipfile.readEntry();
                zipfile.on("entry", async (entry) => {
                    console.log("Found file: ", entry.fileName);
                    let stream = await openReadStream(entry);
                    stream.on("data", (data) => {
                        fs.outputFile(portalDir + "/" + entry.fileName, data)
                            .then(() => console.log("Write file to specific portal folder.\n"));
                    }).on("end", () => {
                        zipfile.readEntry();
                    });
                }).on("end", () => console.log("Finish unzip process."));
            })();
        } catch (err) {
            console.log("Errors occur:" + err);
        }
    } else {
        // OT
        console.log(JSON.stringify(data));
        stream.push(data);
    }
}

function broadcastMsg(msg, ws, isToAll = false) {
    let sockets = portals[ws.portalId].users;
    Object.keys(sockets).forEach((userId) => {
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

function makeZip(ws) {
    let zip = new JSZip();

    (async () => {
        let root = Constant.DIR_PORTAL_ROOT + ws.portalId;

        console.log("before klaw");
        const paths = klawSync(root);
        paths.forEach(item => {
            zip.file(item.path.replace(Constant.DIR_PORTAL_ROOT + ws.portalId, ""), fs.readFileSync(item.path));
        });
        console.log("Finished zip process.");

        let stream = zip.generateNodeStream({type: 'nodebuffer', streamFiles: true});
        stream.pipe(fs.createWriteStream(Constant.DIR_PORTAL_ROOT + ws.portalId + "_" + ws.userId + ".zip"))
        (await stream.on('finish')).then(() => console.log("Out zip is written."));
        console.log("ready to return");


        let read = await fs.readFile(Constant.DIR_PORTAL_ROOT + ws.portalId + "_" + ws.userId + ".zip");
        let buffer = await read.then((err, buffer) => {
            if (err) throw err;
            console.log("Return buffer.");
            return buffer;
        });
        console.log(JSON.stringify(buffer));
        portals[ws.portalId].data = buffer;
    })();
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
        portals[ws.portalId].files[path].activeUser.splice(portals[ws.portalId].files[path].activeUser.indexOf(ws.userId), 1);
        portals[ws.portalId].users[ws.userId].focusOn = null;
    }
    console.log('Occupier' + ws.userId + ' has changed status to ' + isActive ?
        "active" : "inactive" + " of " + path);
}

function createRandomColor() {
    let h = (Math.random() + Constant.GOLDEN_RATIO_CONJUGATE) % 1;
    let color = tinycolor("hsl(" + Math.floor(h * 360) + ", 5%, 95%)");
    return color.toHexString();
}

WebSocket.prototype.createOrJoinSession = function (data) {
    let isCreate = false;
    this.portalId = data.portalId;
    this.userId = data.userId;
    if (typeof portals[this.portalId] === 'undefined') { // create
        isCreate = true;
        portals[this.portalId] = {
            id: this.portalId,
            files: {},
            users: {},
            data: {}
        };
    }
    portals[this.portalId].users[this.userId] = {
        id: this.userId,
        name: data.name,
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

function promisify(api) {
    return (...args) => {
        return new Promise((resolve, reject) => {
            api(...args, (err, response) => {
                if (err) return reject(err);
                resolve(response);
            });
        });
    };
}

const router = express.Router();

module.exports = router;
