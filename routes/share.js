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
const path = require('path');

'use strict';

ShareDB.types.register(otText.type);

let portals = [];
let share = new ShareDB();

(function startServer() {

    /* Create a WebSocket Server and connect any incoming WebSocket connection to ShareDB. */

    const wss = new WebSocket.Server(Config.WebSocketServerConfigurations,
        () => console.log('INFO: WebSocket Server is created.\n'));

    wss.on('connection', ws => {
        const stream = new WebSocketStream(ws);

        ws.on('message', msg => {
            // TODO: Try/catch
            judgeType(ws, msg, stream);
        });

        ws.on('close', (code, reason) => {

            /* Socket client closed due to server closed, which shouldn't be broadcast. */

            if (code === 1006) return;

            /* Remove left user from logic structure and broadcast to others. */

            if (portals[ws.portalId] && portals[ws.portalId].users[ws.userId]) {
                portals[ws.portalId].users[ws.userId] = null;
                console.log(`INFO: User ${ws.userId} has left from ${ws.portalId}.`);
                console.log(`INFO: Now ${ws.portalId} has ${portals[ws.portalId].users.length} connection(s).\n`);
                let msg = {
                    a: Constant.META,
                    type: Constant.TYPE_CLOSE_SOCKET,
                    userId: ws.userId,
                    detail: {
                        code: code,
                        reason: reason
                    }
                };
                broadcastMsg(JSON.stringify(msg), ws);
            }
        });

        share.listen(stream);
        console.log('INFO: Got a new connection...\n');
    });

    process.on('SIGINT', () => {
        wss.close(() => process.exit());
    });
})();

function logFiles(files) {
    console.log(`INFO: Current files structure - ${files}\n`);
}

function logTypeLogo(type) {
    let l = type.length + 6;
    console.log('\n' + "-".repeat(l));
    console.log(`|  ${type}  |`);
    console.log("-".repeat(l) + '\n');
}

function judgeType(ws, msg, stream) {
    let data = JSON.parse(msg);
    if (data.a === Constant.META) {
        console.log(`INFO: Received meta data. Type - ${data.type}.`);
        console.log(`INFO: Data - ${JSON.stringify(data)}\n`);

        let users = portals[ws.portalId] ? portals[ws.portalId].users : null;
        let files = portals[ws.portalId] ? portals[ws.portalId].files : null;
        let file = data.path ? files[data.path] : null;
        let root = Constant.DIR_PORTAL_ROOT + ws.portalId + '/';
        let willBroadcastToAll = false;

        logTypeLogo(data.type);

        switch (data.type) {

            /* ===============================================================
            *
            *   Init
            *   - dealing when someone's creating or joining a portal project -
            *
            *   Needed:
            *   { userId, portalId, name }
            *
            =============================================================== */

            case Constant.TYPE_INIT:

                /* Add user to portal. If no specific portal, create one. Return if a new portal is created. */

                let isCreate = ws.createOrJoinSession(data);

                /* If return exception number, log and send it. */

                if (isCreate === -1) {
                    ws.send(Constant.ERROR_USERID_DUPLICATION);
                    console.log(`ERROR: Init failed, because user id ${ws.userId} is existed.\n`);
                    return;
                }

                /* Create a temp users list object. */
                /* NOTICE: There's a property 'ws' in user, so it will throw error if pass portal.users as parameter directly. */

                let tempUsers = {};
                Object.keys(portals[ws.portalId].users).forEach(userId => {
                    tempUsers[userId] = {
                        id: userId,
                        name: portals[ws.portalId].users[userId].name,
                        color: portals[ws.portalId].users[userId].color
                    };
                });

                /* Collect data for sending message. */

                data.users = tempUsers;
                data.files = portals[ws.portalId].files;
                data.portalId = ws.portalId;

                if (isCreate) {
                    ws.send(JSON.stringify(data));
                    console.log(`INFO: User ${ws.userId} creates a new portal and joins it successfully.\n`);
                } else {
                    makeZipAndSend(ws, data);
                    console.log(`INFO: User ${ws.userId} joins in portal ${ws.portalId}.\n`);
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

                /* Save cursor in logic (Is this necessary?) */

                file.cursors[ws.userId].row = data.cursor.row;
                file.cursors[ws.userId].column = data.cursor.column;
                console.log(`INFO: Ready to broadcast cursor of ${ws.userId}.\n`);

                /* Broadcast to others who occupy the same file */

                data.userId = ws.userId;
                file.occupier.forEach(userId => {
                    if (userId !== ws.userId) {
                        console.log(`INFO: broadcasting cursor ${userId} successfully.\n`);
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
            *   { @Nullable path }
            *
            =============================================================== */

            case Constant.TYPE_CHANGE_ACTIVE_STATUS:
                /* If the file doesn't exist yet but should be opened, jest add a flag to it in pending list.  */

                if (!fs.existsSync(root + data.path) && portals[ws.portalId].pendings[data.path]) {
                    portals[ws.portalId].pendings[data.path].shouldChangeActiveStatus = true;
                    return;
                }

                changeActivationStatus(ws, users[ws.userId].focusOn, false);
                if (data.path) changeActivationStatus(ws, data.path, true);
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
                    console.log(`INFO: User ${ws.userId} has changed grammar of file ${data.path} to ${data.grammar}.\n`);
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

                /* Edge detection */

                if (!data.path) {
                    console.log(`ERROR: A path of file is necessary but not received.\n`);
                    return;
                }

                /* If the file doesn't exist yet but should be opened, jest add it to pending list.  */

                if (!fs.existsSync(root + data.path)) {
                    portals[ws.portalId].pendings[data.path] = {
                        grammar: data.grammar
                    };
                    return;
                }

                /* If file exists, just update it's logic status and broadcast. */

                openFile(ws, data.path, data.grammar);
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

                /* Edge detection */

                if (!data.path) {
                    console.log(`ERROR: A path of file is necessary but not received.\n`);
                    return;
                } else if (!file) {
                    console.log(`ERROR: File ${data.path} can't be closed because it is not active.\n`);
                    return;
                }

                /* Remove user reference in logic file structure. */

                let index = file.activeUser.indexOf(ws.userId);
                if (index !== -1) {
                    file.activeUser.splice(index, 1);
                }
                file.occupier.splice(file.occupier.indexOf(ws.userId), 1);
                file.cursors[ws.userId] = null;

                /* Broadcast close file event to others. */

                data.userId = ws.userId;
                broadcastMsg(JSON.stringify(data), ws);
                if (file.occupier.length) return;

                /* Ready to broadcast OCCUPIER_CLEARED if occupier list is clear. */

                file = null;
                data.type = Constant.TYPE_OCCUPIER_CLEARED;
                logFiles(files);
                willBroadcastToAll = true;
                console.log(`INFO: File ${data.path} is removed from active files list.\n`);
                break;


            /* ===============================================================
            *
            *   Create file
            *   - process after the user creating a new file -
            *
            *   Needed:
            *   { path, data, [isFolder] }
            *
            =============================================================== */

            case Constant.TYPE_CREATE_FILE:

                /* Edge detection */

                if (data.isFolder && data.buffer) {
                    console.log("ERROR: A create-folder requirement can not be passed with notnull buffer data.");
                    return;
                } else if (!data.path) {
                    console.log(`ERROR: A path of file is necessary but not received.\n`);
                    return;
                }

                if (data.isFolder && !data.buffer) {

                    /* If there's no specific folder created, make one. */

                    fs.ensureDirSync(root + data.path);
                } else if (!data.isFolder) {

                    /* If a file should be created, check if this should also be opened. */
                    /* If yes, open it in logic and move it from pending list first. */

                    if (portals[ws.portalId].pendings[data.path]) {
                        data.isOpen = true;
                        data.grammar = portals[ws.portalId].pendings[data.path].grammar;
                        openFile(ws, data.path, data.grammar);
                        if (portals[ws.portalId].pendings[data.path].shouldChangeActiveStatus) {
                            changeActivationStatus(ws, users[ws.userId].focusOn, false);
                            if (data.path) changeActivationStatus(ws, data.path, true);
                        }
                        portals[ws.portalId].pendings[data.path] = null;
                    }

                    /* Create file on server. */

                    fs.outputFile(root + data.path,

                        /* Buffer message may be a Buffer, a String or null. */

                        data.buffer ?
                            (typeof data.buffer === "string" ? data.buffer : Buffer.from(data.buffer)) : "",

                        /* No need to log exist error in CREATE_FILE type because this will only happen on chains of broadcasting. */

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

                /* Edge detection */

                if (!data.path) {
                    console.log(`ERROR: A path of file is necessary but not received.\n`);
                    return;
                }

                /* Make function to judge if file is able to removed. */

                let isAbleToDelete = (file) => !(file && file.occupier.length > 1 ||
                    file && file.occupier.length === 1 && file.occupier.indexOf(ws.userId) === -1);

                if (data.isFolder) {

                    /* If it's a folder that should be removed, firstly judge if it's occupied. */

                    let paths = [];
                    let isOccupied = false;
                    if (!fs.existsSync(root + data.path)) return;

                    /* Go through it and check all files. If one of them is occupied, stop and log error. */
                    /* If not occupied, just delete the folder. */

                    klawSync(root + data.path).forEach(item => {

                        /* NOTICE: 'item' is an absolute path. */
                        console.log(path.resolve(root));
                        console.log(item.path);
                        console.log(item.path.replace(path.resolve(root) + '/', ""));

                        if (isAbleToDelete(files[item.path.replace(path.resolve(root) + '/', "")]))
                            paths.push(item.path.replace(path.resolve(root) + '/', ""));
                        else {
                            isOccupied = true;
                        }
                    });
                    if (isOccupied) {
                        ws.send(JSON.stringify(Constant.ERROR_FOLDER_OCCUPIED));
                        console.log(`ERROR: Unable to remove directory ${data.path} because it is occupied.\n`);
                        return;
                    } else {
                        fs.removeSync(root + data.path);
                        console.log(`INFO: Successfully removed directory ${data.path}.\n`);
                    }
                } else if (isAbleToDelete(file)) {

                    /*If the user who want to delete the file is the only one occupies the file, it's necessary to remove logic file first. */

                    if (file && file.occupier.length) file = null;

                    /* Remove real file. */

                    fs.removeSync(root + data.path);
                } else if (!isAbleToDelete(file)) {

                    /* If others occupy the file, it can't be removed. */

                    data.type = Constant.TYPE_CREATE_FILE;
                    data.reject = Constant.ERROR_FILE_OCCUPIED;
                    data.buffer = fs.readFileSync(root + data.path);
                    ws.send(JSON.stringify(data));
                    return;
                }
                data.userId = ws.userId;
                break;

            /* ===============================================================
            *
            *   Change file
            *   - process after the user changing the file in disc -
            *   - NOTICE: changes in sharedb won't trigger this event. -
            *
            *   Needed:
            *   { path, buffer }
            *
            =============================================================== */

            case Constant.TYPE_CHANGE_FILE:

                /* Update file content. */

                fs.outputFile(root + data.path,
                    Buffer.from(data.buffer.data), err => {
                        if (err) console.log(`ERROR: Errors occur on processing file while changing file - ${err}\n`);
                    });
                data.userId = ws.userId;
                break;
        }
        broadcastMsg(JSON.stringify(data), ws, willBroadcastToAll);

    } else if (data.type === 'Buffer') {

        /* This is triggered only after a new portal is created. */
        /* The received data is to init workspace on server. */

        console.log(`INFO: Successfully receive zip of files. Buffer length - ${data.data.length}.`);
        saveFileToServer(ws.portalId, data.data);
        console.log("INFO: Save files to server process is finished.\n");
    } else {

        /* Dealing with OT. */

        console.log(`INFO: OT is processed - ${JSON.stringify(data)}\n`);
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
        console.log(`INFO: Broadcasting message to ${socket.userId}.`);
        console.log(`INFO: The message is - \n${msg}.\n`);
        setTimeout(() => socket.send(msg), 0);
    }
}

function openFile(ws, path, grammar) {
    let files = portals[ws.portalId].files;
    let focus = portals[ws.portalId].users[ws.userId].focusOn;
    console.log(`INFO: User ${ws.userId} is ready to open file ${path}.`);
    console.log(`INFO: User's focus should be from ${focus} to ${path}.\n`);

    /* Change related occupier list. */

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
    console.log(`INFO: Status of file ${path} is updated.\n`);
    logFiles(files);
}

function makeZipAndSend(ws, data) {
    let zip = new JSZip();
    let root = Constant.DIR_PORTAL_ROOT + ws.portalId + "/";

    klawSync(root).forEach(item => {

        /* No need to take care of folders. */

        if (fs.lstatSync(item.path).isFile())
            zip.file(item.path.replace(path.resolve(root), ""), fs.readFileSync(item.path));
    });
    zip.generateAsync({type: 'array', streamFiles: false}).then((arr) => {
        data.data = arr;
        ws.send(JSON.stringify(data));
    });
}

function saveFileToServer(portalId, data) {
    if (!portalId) {
        console.log("ERROR: Files can't be uploaded because no portal is created.");
        return;
    }
    try {
        streamifier.createReadStream(Buffer.from(data))
            .pipe(unzip.Extract({path: Constant.DIR_PORTAL_ROOT + portalId}));
    } catch (err) {
        console.log(`ERROR: Errors occur during uploading files - ${err}`);
    }
}

function changeActivationStatus(ws, path, isActive) {
    let file = portals[ws.portalId].files[path];
    if (isActive)
        if (file.activeUser.includes(ws.userId))
            console.log(`ERROR: User ${ws.userId} is already an active user of file ${path}.`);
        else if (!file.occupier.includes(ws.userId))
            console.log(`ERROR: User ${ws.userId} is not occupier of file ${path}.`);
        else {
            portals[ws.portalId].files[path].activeUser.push(ws.userId);
            portals[ws.portalId].users[ws.userId].focusOn = path;
            console.log(`INFO: Occupier ${ws.userId} has become an active user of ${path}.`);
        }
    else {
        if (!file.activeUser.includes(ws.userId))
            console.log(`ERROR: User ${ws.userId} is not an active user of file ${path}.`);
        else if (!file.occupier.includes(ws.userId))
            console.log(`ERROR: User ${ws.userId} is not occupier of file ${path}.`);
        else {
            portals[ws.portalId].files[path].activeUser.splice(file.activeUser.indexOf(ws.userId), 1);
            portals[ws.portalId].users[ws.userId].focusOn = null;
            console.log(`INFO: Occupier ${ws.userId} is not active on ${path} anymore.`);
        }
    }
}

function createRandomColor() {
    let rand = (Math.random() + Constant.GOLDEN_RATIO_CONJUGATE) % 1;
    let h = Math.floor(rand * 360);
    return tinycolor(`hsl(${h}, 50%, 60%)`).toHexString();
}

WebSocket.prototype.createOrJoinSession = function (data) {
    let isCreate = false;
    this.portalId = data.portalId || uuid();
    this.userId = data.userId;

    /* Initialize a new portal if portal with specific id is not existed. */

    if (typeof portals[this.portalId] !== 'undefined')
        for (let userId in Object.keys(portals[this.portalId].users)) {
            if (userId === this.userId) return -1;
        }
    else {
        portals[this.portalId] = {
            id: this.portalId,
            files: {},
            users: {},
            pendings: {}
        };
        isCreate = true;
    }

    /* Add new user to specific portal */

    portals[this.portalId].users[this.userId] = {
        id: this.userId,
        name: data.name || this.userId,
        color: createRandomColor()
    };

    /* Broadcast USER_JOINED to other users. */
    /* NOTICE: If there's only the initializer in portal, nobody will receive message. */

    broadcastMsg(JSON.stringify({
        a: Constant.META,
        type: Constant.TYPE_USER_JOINED,
        user: portals[this.portalId].users[this.userId]
    }), this);
    portals[this.portalId].users[this.userId].ws = this;
    console.log(`INFO: Portal ${this.portalId} adds a new user ${this.userId}.\n`);
    return isCreate;
};

WebSocket.prototype.getId = function () {
    return this.upgradeReq.headers['sec-websocket-key'];
};

const router = express.Router();

module.exports = router;
