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
    TYPE_OCCUPIER_CLEARED: "occupierCleared",
    TYPE_USER_JOINED: "userJoined",

    DIR_PORTAL_ROOT: "/root/kevinz/portals/",

    GOLDEN_RATIO_CONJUGATE: 0.618033988749895,

    ERROR_USERID_DUPLICATION: {
        eid: "0001",
        error: "USER_ID_DUPLICATION",
        msg: "There are several users with same userId."
    },
    ERROR_FILE_OCCUPIED: {
        eid: "0002",
        error: "FILE_IS_OCCUPIED",
        msg: "This file is used by multiple users."
    },
    ERROR_FOLDER_OCCUPIED: {
        eid: "0003",
        error: "FOLDER_IS_OCCUPIED",
        msg: "This folder has files which are used by multiple users."
    }
};

module.exports = Constants;

