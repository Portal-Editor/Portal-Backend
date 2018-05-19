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
    TYPE_SAVE_FILE: "saveFile",
    TYPE_OCCUPIER_CLEARED: "occupierCleared",
    TYPE_USER_JOINED: "userJoined",

    DIR_PORTAL_ROOT: "/root/kevinz/portals/",

    GOLDEN_RATIO_CONJUGATE: 0.618033988749895,

    ERROR_USERID_DUPLICATION: {
        eid: "0001",
        error: "USER_ID_DUPLICATION",
        msg: "There are several users with same userId."
    }
};

module.exports = Constants;

