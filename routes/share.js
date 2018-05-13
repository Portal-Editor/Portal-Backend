let express = require('express');
let ShareDB = require('sharedb');
let otText = require('ot-text');
let WebSocket = require('ws');
let WebSocketStream = require('../public/javascripts/WebSocketStream');
let Constant = require("../public/javascripts/DataConstants");

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
            // Other options settable:
            clientNoContextTakeover: true, // Defaults to negotiated value.
            serverNoContextTakeover: true, // Defaults to negotiated value.
            clientMaxWindowBits: 10, // Defaults to negotiated value.
            serverMaxWindowBits: 10, // Defaults to negotiated value.
            // Below options specified as default values.
            concurrencyLimit: 10, // Limits zlib concurrency for perf.
            threshold: 1024, // Size (in bytes) below which messages should not be compressed.
        }
    }, () => {
        console.log('WebSocket Server Created.');
    });

    wss.on('connection', function (ws) {
        const stream = new WebSocketStream(ws);

        ws.on('message', function (msg) { // receive text data
            try {
                console.log("Message received: " + msg);
                judgeType(ws, msg);
            } catch (err) {
                console.log("Errors occur:" + err);
            }
        });

        ws.on('close', (code, reason) => {
            // socket client closed due to server closed, do not broadcast
            if (code === 1006) {
                return;
            }
            if (portals[ws.portalId].users[ws.userId]) {
                portals[ws.portalId].users[ws.userId] = null;
                console.log('We just lost one connection: ' + ws.userId + ' from ' + ws.portalId);
                console.log('Now ' + ws.portalId + ' has ' + portals[ws.portalId].users.length + ' connection(s)');
                console.log('\n');
                let msg = {
                    a: Constant.META,
                    type: Constant.TYPE_CLOSE_SOCKET,
                    clientId: ws.userId
                };
                broadcastMsg(JSON.stringify(msg), ws);
            }
        });

        share.listen(stream);
        console.log('Got one connection...\n');
    });

    process.on('SIGINT', () => {
        wss.close(() => {
            process.exit();
        });
    });
}

function logFiles(files) {
    console.log('current files: ');
    console.log(files);
    console.log('\n');
}

function judgeType(ws, msg) {
    let data = JSON.parse(msg);
    if (data.a === Constant.META) {
        console.log('Received meta data:' + JSON.stringify(data) + '\n');
        let users = portals[ws.portalId] ? portals[ws.portalId].users : null;
        let files = portals[ws.portalId] ? portals[ws.portalId].files : null;
        let file = data.path ? files[data.path] : null;

        switch (data.type) {

            /* ===============================================================
            *
            *   Init
            *   Dealing when someone's creating or joining a portal project
            *
            *   Needed:
            *   { clientId, sessionId, name }
            *
            =============================================================== */

            case Constant.TYPE_INIT:
                // create or join a session
                ws.createOrJoinSession(data);
                ws.send(JSON.stringify(portals[ws.portalId].files));
                return;

            /* ===============================================================
            *
            *   Move Cursor
            *   - dealing after the user moving cursor -
            *
            *   Needed:
            *   { path, userId, newPosition: {row, column} }
            *
            =============================================================== */

            case Constant.TYPE_MOVE_CURSOR:
                let cursor = file.cursors[data.userId];
                cursor.row = data.newPosition.row;
                cursor.column = data.newPosition.column;
                console.log('Ready to broadcast ' + data.userId + '\'s cursor');
                file.occupier.forEach((userId) => {
                    if (userId !== data.userId) {
                        console.log('Broadcasting ' + JSON.stringify(cursor) + ' to ' + userId);
                        broadcastMsgToSpecificClient(file.cursors[data.userId], ws, data.userId);
                    }
                });
                return;

            /* ===============================================================
            *
            *   Activate
            *   - change status to record if user is focusing on the file -
            *
            *   Needed:
            *   { path, userId }
            *
            =============================================================== */

            case Constant.TYPE_ACTIVATE:
                changeActivationStatus(ws, users[userId].focusOn, data.userId, false);
                changeActivationStatus(ws, data.path, data.userId, true);
                break;

            /* ===============================================================
            *
            *   Change Grammar
            *   - change grammar of specific file -
            *
            *   Needed:
            *   { path, grammar, userId }
            *
            =============================================================== */

            case Constant.TYPE_CHANGE_GRAMMAR:
                if (file.grammar !== data.grammar) {
                    file.grammar = data.grammar;
                    console.log('User ' + data.userId + ' has changed grammar to ' + data.grammar);
                }
                break;


            /* ===============================================================
            *
            *   Open file
            *   - record that the user is opening a file -
            *
            *   Needed:
            *   { path, userId }
            *
            =============================================================== */

            case Constant.TYPE_OPEN_FILE:
                let focus = portals[ws.portalId].users[data.userId].focusOn;
                if (focus) {
                    let i = portals[ws.portalId].files[focus].activeUser.indexOf(data.userId);
                    portals[ws.portalId].files[focus].activeUser.splice(i, 1);
                }
                portals[ws.portalId].users[data.userId].focusOn = data.path;

                if (!files[data.path]) {
                    files[data.path] = {
                        path: data.path,
                        grammar: data.grammar,
                        occupier: [],
                        activeUser: [],
                        cursors: {}
                    };
                }

                files[data.path].occupier.push(data.userId);
                files[data.path].activeUser.push(data.userId);
                files[data.path].cursors[data.userId] = {
                    row: 0,
                    column: 0,
                    // TODO: random color
                    color: ""
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
            *   { path, userId, newPath, newPosition: {row, column} }
            *
            =============================================================== */

            case Constant.TYPE_CLOSE_FILE:
                if (!file.path) {
                    console.log(data.path + ' is not an allowed path.');
                    return;
                }

                // TODO: Refactor
                let index = file.activeUser.indexOf(data.userId);
                if (index !== -1) {
                    file.activeUser.splice(index, 1);
                }
                file.occupier.splice(file.occupier.indexOf(data.userId), 1);

                if (data.newPath && data.newPosition.row && data.newPosition.column) {
                    changeActivationStatus(ws, data.newPath, data.userId, true);
                }
                if (!file.occupier.length) {
                    file = null;
                    console.log(data.path + ' removed.');
                }
                logFiles(files);
        }
        // other meta changes: cursor position, text selection
        // and open/save/close file
        broadcastMsg(msg, ws);
    }
    else {
        // OT
        console.log(data);
        stream.push(data);
    }
}

function broadcastMsg(msg, ws) {
    Object.keys(portals[ws.portalId].users).forEach((userId) => broadcastMsgToSpecificClient(msg, ws, userId));
}

function broadcastMsgToSpecificClient(msg, ws, userId) {
    let sockets = portals[ws.portalId].users;
    if (sockets[userId].readyState === WebSocket.OPEN && (userId !== ws.getId())) {
        console.log('Broadcasting msg to ' + userId + '\n');
        console.log(msg);
        console.log('\n');
        setTimeout(() => {
            sockets[userId].ws.send(msg);
        }, 0);
    }
}

function changeActivationStatus(ws, path, userId, isActive) {
    if (isActive) {
        if (portals[ws.portalId].files[path].activeUser.includes(userId)) {
            portals[ws.portalId].files[path].activeUser.push(userId);
            portals[ws.portalId].users[userId].focusOn = path;
        } else {
            console.log("User " + userId + " is not active on file " + path + ".");
        }
    } else {
        portals[ws.portalId].files[path].activeUser.splice(portals[ws.portalId].files[path].activeUser.indexOf(userId), 1);
        portals[ws.portalId].users[userId].focusOn = null;
    }
    // file.activeUser.splice(file.activeUser.indexOf(userId), 1);
    console.log('Occupier' + userId + ' has changed status to ' + isActive ?
        "active" : "inactive" + " of " + path);
}

WebSocket.prototype.createOrJoinSession = function (data) {
    let portalId = data.portalId;
    let userId = data.userId;
    this.portalId = portalId;
    this.userId = userId;
    if (typeof portals[portalId] === 'undefined') {
        portals[portalId] = {
            id: portalId,
            files: {},
            users: {}
        };
    }
    portals[portalId].users[userId] = {
        id: userId,
        name: data.name,
        ws: this
    };
    console.log('Session ' + portalId + ' adds ' + userId + '\n');
};

WebSocket.prototype.getId = function () {
    return this.upgradeReq.headers['sec-websocket-key'];
};

const router = express.Router();

module.exports = router;
