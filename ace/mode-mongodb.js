ace.define("ace/mode/mongodb_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var MongoDBHighlightRules = function() {

    var keywords = (
        "db|use|show|exit|quit|help|it|load|enabletelemetry|disabletelemetry|clear|cls|connect|disconnect|" +
        "print|printjson|printjsononeline|sleep|cat|pwd|ls|copyto|launchmongoshell|version|rs|sh"
    );

    var bsonTypes = (
        "objectid|isodate|numberint|numberlong|numberdecimal|bindata|binary|dbref|timestamp|uuid|code|" +
        "date|regexp|minkey|maxkey|long|decimal128"
    );

    var shellFunctions = (
        "aggregate|bulkwrite|clonedatabase|copydatabase|count|countdocuments|createcollection|createindex|" +
        "createindexes|deleteone|deletemany|distinct|drop|dropdatabase|dropindex|dropindexes|" +
        "estimateddocumentcount|explain|find|findone|findandmodify|findoneanddelete|findoneandreplace|" +
        "findoneandup date|getcollection|getcollectionnames|getsiblingdb|insert|insertone|insertmany|" +
        "iscapped|listcollections|listdatabases|mapreduce|remove|renamecollection|replaceone|save|stats|" +
        "update|updateone|updatemany|watch|runcommand|getdb|getmongo|validate|reindex"
    );

    var pipelineStages = (
        "$addfields|$bucket|$bucketauto|$changestreamsplitlargeevent|$collstats|$count|$densify|$facet|" +
        "$fill|$geonear|$graphlookup|$group|$indexstats|$limit|$lookup|$match|$merge|$out|$plancachestats|" +
        "$project|$redact|$replaceroot|$replacewith|$sample|$set|$setwindowfields|$skip|$sort|$sortbycount|" +
        "$unionwith|$unset|$unwind"
    );

    var queryOperators = (
        "$and|$nor|$not|$or|$expr|$jsonschema|$mod|$regex|$text|$where|$geointersects|$geowithin|$near|" +
        "$nearsphere|$eq|$gt|$gte|$in|$lt|$lte|$ne|$nin|$exists|$type|$all|$elemmatch|$size|" +
        "$bitsallclear|$bitsallset|$bitsanyclear|$bitsanyset"
    );

    var updateOperators = (
        "$currentdate|$inc|$min|$max|$mul|$rename|$set|$setoninsert|$unset|$addtoset|$pop|$pull|$push|" +
        "$pullall|$each|$position|$slice|$sort|$bit"
    );

    var aggregationOperators = (
        "$accumulator|$documents|$function|$rand|$setdifference|$setequals|$setintersection|$setissubset|$setunion"
    );

    var cursorMethods = (
        "sort|limit|skip|pretty|toarray|foreach|next|hasnext"
    );

    var replicaSetMethods = (
        "status|initiate|conf|reconfig|stepdown|freeze|printreplicationinfo|printsecondar yreplicationinfo|" +
        "printslavereplicationinfo|syncfrom"
    );

    var shardingMethods = (
        "status|addshard|enablesharding|disablebalancing|movechunk|removeshard|shardcollection|split|" +
        "splitchunk|splitfind"
    );

    var keywordMapper = this.createKeywordMapper({
        "support.function": shellFunctions + "|" + cursorMethods + "|" + replicaSetMethods + "|" + shardingMethods,
        "keyword": keywords,
        "storage.type": bsonTypes,
        "constant.language": pipelineStages + "|" + queryOperators + "|" + updateOperators + "|" + aggregationOperators
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
            token : "string",           // ` string (template literal)
            start : "`",
            end : "`"
        }, {
            token : "constant.numeric", // hex
            regex : "0[xX][0-9a-fA-F]+"
        }, {
            token : "constant.numeric", // octal
            regex : "0[oO][0-7]+"
        }, {
            token : "constant.numeric", // binary
            regex : "0[bB][0-1]+"
        }, {
            token : "constant.numeric", // float
            regex : "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"
        }, {
            token : "constant.language", // MongoDB operators starting with $
            regex : "\\$[a-zA-Z_][\\w]*"
        }, {
            token : "support.function",  // cursor/rs/sh methods
            regex : "\\.(sort|limit|skip|pretty|toarray|foreach|next|hasnext)\\b"
        }, {
            token : "support.function",  // rs. methods
            regex : "rs\\.(status|initiate|conf|reconfig|stepdown|freeze|printreplicationinfo|" +
                    "printsecondaryreplicationinfo|printslavereplicationinfo|syncfrom)\\b"
        }, {
            token : "support.function",  // sh. methods
            regex : "sh\\.(status|addshard|enablesharding|disablebalancing|movechunk|removeshard|" +
                    "shardcollection|split|splitchunk|splitfind)\\b"
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_$][a-zA-Z0-9_$]*\\b"
        }, {
            token : "keyword.operator",
            regex : "\\+|\\-|\\*|\\/|%|=|&|\\||\\^|!|<|>|<=|>=|==|!=|<>|~"
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

oop.inherits(MongoDBHighlightRules, TextHighlightRules);

exports.MongoDBHighlightRules = MongoDBHighlightRules;
});

ace.define("ace/mode/mongodb",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/mongodb_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var MongoDBHighlightRules = require("./mongodb_highlight_rules").MongoDBHighlightRules;

var Mode = function() {
    this.HighlightRules = MongoDBHighlightRules;
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, TextMode);

(function() {
    this.lineCommentStart = "//";
    this.blockComment = {start: "/*", end: "*/"};
    this.$id = "ace/mode/mongodb";
}).call(Mode.prototype);

exports.Mode = Mode;
});

(function() {
    ace.require(["ace/mode/mongodb"], function(m) {
        if (typeof module == "object" && typeof exports == "object" && module) {
            module.exports = m;
        }
    });
})();
