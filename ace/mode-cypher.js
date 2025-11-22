ace.define("ace/mode/cypher_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var CypherHighlightRules = function() {

    var keywords = (
        "all|and|as|asc|ascending|by|call|case|contains|create|delete|desc|descending|detach|distinct|" +
        "else|end|ends|exists|in|is|limit|mandatory|match|merge|not|on|optional|or|order|remove|return|" +
        "set|skip|starts|then|union|unwind|when|where|with|xor|yield"
    );

    var builtinConstants = (
        "true|false|null"
    );

    var builtinFunctions = (
        "abs|acos|asin|atan|atan2|avg|ceil|coalesce|collect|cos|cot|count|degrees|e|endnode|exists|exp|" +
        "floor|head|id|keys|labels|last|left|length|log|log10|ltrim|max|min|nodes|percentilecont|" +
        "percentiledisc|pi|properties|radians|rand|range|relationships|replace|reverse|right|round|rtrim|" +
        "sign|sin|size|split|sqrt|startnode|stdev|stdevp|substring|sum|tail|tan|timestamp|toboolean|" +
        "tofloat|tointeger|tolower|tostring|toupper|trim|type"
    );

    var keywordMapper = this.createKeywordMapper({
        "support.function": builtinFunctions,
        "keyword": keywords,
        "constant.language": builtinConstants
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
            token : "string",           // " string
            regex : '"(?:\\\\.|[^"\\\\])*?"'
        }, {
            token : "string",           // ' string
            regex : "'(?:\\\\.|[^'\\\\])*?'"
        }, {
            token : "string",           // ` identifier
            regex : "`(?:\\\\.|[^`\\\\])*?`"
        }, {
            token : "constant.numeric", // hex
            regex : "-?0x[0-9a-fA-F]+"
        }, {
            token : "constant.numeric", // octal
            regex : "-?0[0-7]+"
        }, {
            token : "constant.numeric", // float
            regex : "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"
        }, {
            token : "variable.language",  // :Label or :RelType
            regex : ":[a-zA-Z_][\\w]*"
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
        }, {
            token : "keyword.operator",
            regex : "\\+|\\-|\\*|\\/|%|\\^|=|<>|<|>|<=|>=|->|<-|-->|<--"
        }, {
            token : "paren.lparen",
            regex : "[\\(\\[\\{]"
        }, {
            token : "paren.rparen",
            regex : "[\\)\\]\\}]"
        }, {
            token : "punctuation.operator",
            regex : "[;,\\.:|]"
        }, {
            token : "text",
            regex : "\\s+"
        } ]
    };
    this.normalizeRules();
};

oop.inherits(CypherHighlightRules, TextHighlightRules);

exports.CypherHighlightRules = CypherHighlightRules;
});

ace.define("ace/mode/cypher",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/cypher_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var CypherHighlightRules = require("./cypher_highlight_rules").CypherHighlightRules;

var Mode = function() {
    this.HighlightRules = CypherHighlightRules;
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, TextMode);

(function() {
    this.lineCommentStart = "//";
    this.blockComment = {start: "/*", end: "*/"};
    this.$id = "ace/mode/cypher";
}).call(Mode.prototype);

exports.Mode = Mode;
});

(function() {
    ace.require(["ace/mode/cypher"], function(m) {
        if (typeof module == "object" && typeof exports == "object" && module) {
            module.exports = m;
        }
    });
})();
