const strings = require('node-strings');

let Constants = {
    META: "meta",
    DEBUG: "DEBUG",
    TYPE_INIT: "init",
    TYPE_CLOSE_FILE: "closeFile",
    TYPE_OPEN_FILE: "openFile",
    TYPE_MOVE_CURSOR: "moveCursor",
    TYPE_CHANGE_GRAMMAR: "changeGrammar",
    TYPE_CLOSE_SOCKET: "userLeft",
    TYPE_CHANGE_ACTIVE_STATUS: "changeActiveStatus",
    TYPE_CHANGE_FILE: "changeFile",
    TYPE_CREATE_FILE: "createFile",
    TYPE_DELETE_FILE: "deleteFile",
    TYPE_DISPLAY_STRUCTURE: "displayPortalStructure",
    TYPE_OCCUPIER_CLEARED: "occupierCleared",
    TYPE_FILE_DELETED: "fileDeleted",
    TYPE_USER_JOINED: "userJoined",

    STRING_INFO: strings.green('[INFO] '),
    STRING_ERROR: strings.red('[ERROR] '),

    DIR_PORTAL_ROOT: "./portals/",

    GOLDEN_RATIO_CONJUGATE: 0.618033988749895,

    ERROR_USERID_DUPLICATION: {
        a: "meta",
        eid: "0001",
        error: "USER_ID_DUPLICATION",
        type: "initFailed",
        msg: "There are several users with same userId."
    },
    ERROR_FILE_OCCUPIED: {
        a: "meta",
        eid: "0002",
        error: "FILE_IS_OCCUPIED",
        msg: "This file is used by multiple users."
    },
    ERROR_FOLDER_OCCUPIED: {
        a: "meta",
        eid: "0003",
        error: "FOLDER_IS_OCCUPIED",
        msg: "This folder has files which are used by multiple users."
    },
    ERROR_INVALID_INIT: {
        a: "meta",
        eid: "0004",
        error: "INVALID_INIT",
        type: "initFailed",
        msg: "This portal name has already exist."
    },
    ERROR_INVALID_JOIN: {
        a: "meta",
        eid: "0005",
        error: "INVALID_JOIN",
        type: "initFailed",
        msg: "This portal has not been created yet."
    }
};

module.exports = Constants;

