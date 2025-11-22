ace.define("ace/mode/solidity_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var SolidityHighlightRules = function() {

    var keywords = (
        "pragma|solidity|import|contract|library|interface|is|using|" +
        "struct|enum|event|modifier|constructor|function|returns|return|" +
        "if|else|for|while|do|break|continue|throw|revert|require|assert|" +
        "new|delete|var|constant|immutable|" +
        "public|private|internal|external|pure|view|payable|" +
        "memory|storage|calldata|indexed|anonymous|virtual|override|" +
        "abstract|try|catch|emit|as|unchecked|assembly"
    );

    var storageTypes = (
        "bool|string|address|bytes|byte|" +
        "int|int8|int16|int24|int32|int40|int48|int56|int64|int72|int80|int88|int96|int104|int112|int120|int128|int136|int144|int152|int160|int168|int176|int184|int192|int200|int208|int216|int224|int232|int240|int248|int256|" +
        "uint|uint8|uint16|uint24|uint32|uint40|uint48|uint56|uint64|uint72|uint80|uint88|uint96|uint104|uint112|uint120|uint128|uint136|uint144|uint152|uint160|uint168|uint176|uint184|uint192|uint200|uint208|uint216|uint224|uint232|uint240|uint248|uint256|" +
        "bytes1|bytes2|bytes3|bytes4|bytes5|bytes6|bytes7|bytes8|bytes9|bytes10|bytes11|bytes12|bytes13|bytes14|bytes15|bytes16|bytes17|bytes18|bytes19|bytes20|bytes21|bytes22|bytes23|bytes24|bytes25|bytes26|bytes27|bytes28|bytes29|bytes30|bytes31|bytes32|" +
        "fixed|ufixed|mapping"
    );

    var constants = (
        "true|false|wei|gwei|ether|seconds|minutes|hours|days|weeks|years|" +
        "now|this|super|selfdestruct|suicide"
    );

    var globalVariables = (
        "msg|tx|block|abi|blockhash|gasleft|keccak256|sha256|ripemd160|ecrecover|addmod|mulmod"
    );

    var keywordMapper = this.createKeywordMapper({
        "keyword": keywords,
        "storage.type": storageTypes,
        "constant.language": constants,
        "variable.language": globalVariables
    }, "identifier", true);

    this.$rules = {
        "start" : [ {
            token : "comment",
            regex : "//.*$"
        },  {
            token : "comment",
            start : "/\\*",
            end : "\\*/"
        }, {
            token : "comment.doc",
            start : "///",
            end : "$"
        }, {
            token : "string",           // " string
            regex : '"(?:\\\\.|[^"\\\\])*?"'
        }, {
            token : "string",           // ' string
            regex : "'(?:\\\\.|[^'\\\\])*?'"
        }, {
            token : "constant.numeric", // hex
            regex : "0[xX][0-9a-fA-F]+"
        }, {
            token : "constant.numeric", // hex with underscores
            regex : "0[xX][0-9a-fA-F_]+"
        }, {
            token : "constant.numeric", // float
            regex : "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"
        }, {
            token : "constant.numeric", // scientific notation
            regex : "\\d+[eE][+-]?\\d+"
        }, {
            token : "constant.language", // units (wei, ether, etc.)
            regex : "\\b\\d+\\s*(wei|gwei|ether|seconds|minutes|hours|days|weeks|years)\\b"
        }, {
            token : "support.function",  // special functions
            regex : "\\b(msg|tx|block|abi)\\.(sender|value|data|gas|origin|gasprice|coinbase|difficulty|gaslimit|number|timestamp|encode|encodePacked|encodeWithSelector|encodeWithSignature|decode)\\b"
        }, {
            token : "support.function",  // built-in functions
            regex : "\\b(blockhash|gasleft|keccak256|sha256|ripemd160|ecrecover|addmod|mulmod)\\s*\\("
        }, {
            token : "keyword.operator",  // address payable casting
            regex : "\\bpayable\\s*\\("
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
        }, {
            token : "keyword.operator",
            regex : "\\+\\+|--|=>|==|!=|<=|>=|<|>|&&|\\|\\||!|\\+|-|\\*|\\/|%|=|\\+=|-=|\\*=|\\/=|%=|&|\\||\\^|~|<<|>>|\\?|:"
        }, {
            token : "paren.lparen",
            regex : "[\\(\\[\\{]"
        }, {
            token : "paren.rparen",
            regex : "[\\)\\]\\}]"
        }, {
            token : "punctuation.operator",
            regex : "[,;:\\.]"
        }, {
            token : "text",
            regex : "\\s+"
        } ]
    };
    this.normalizeRules();
};

oop.inherits(SolidityHighlightRules, TextHighlightRules);

exports.SolidityHighlightRules = SolidityHighlightRules;
});

ace.define("ace/mode/solidity",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/solidity_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var SolidityHighlightRules = require("./solidity_highlight_rules").SolidityHighlightRules;

var Mode = function() {
    this.HighlightRules = SolidityHighlightRules;
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, TextMode);

(function() {
    this.lineCommentStart = "//";
    this.blockComment = {start: "/*", end: "*/"};
    this.$id = "ace/mode/solidity";
}).call(Mode.prototype);

exports.Mode = Mode;
});

(function() {
    ace.require(["ace/mode/solidity"], function(m) {
        if (typeof module == "object" && typeof exports == "object" && module) {
            module.exports = m;
        }
    });
})();
