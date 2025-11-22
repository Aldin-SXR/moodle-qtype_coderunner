ace.define("ace/mode/hbase_highlight_rules",["require","exports","module","ace/lib/oop","ace/mode/text_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;

var HBaseHighlightRules = function() {

    var keywords = (
        "abort|alter|append|assign|balance_switch|balancer|balancer_enabled|catalogjanitor_enabled|" +
        "catalogjanitor_run|catalogjanitor_switch|clone_table_schema|close_region|compact|compact_rs|" +
        "compaction_state|count|create|delete|deleteall|describe|disable|disable_all|disable_peer|" +
        "drop|drop_all|enable|enable_all|enable_peer|exists|exit|flush|get|get_auths|get_counter|" +
        "get_peer_config|get_splits|get_table|grant|help|incr|is_disabled|is_enabled|list|" +
        "list_deadservers|list_namespace|list_namespace_tables|list_peers|list_procedures|" +
        "list_quotas|list_regionserver_groups|list_snapshot_sizes|list_snapshots|list_tablegroups|" +
        "list_tables|locate_region|major_compact|merge_region|move|namespace|normalize|normalizer_enabled|" +
        "normalizer_switch|put|quit|quota|regioninfo|remove_peer|remove_rsgroup_table|revoke|" +
        "rit|scan|set_auths|set_peer_bandwidth|set_peer_replicate_all|set_peer_serial|set_quota|" +
        "set_visibility|show_filters|show_peer_tableCFs|shutdown|snapshot|split|status|stop|" +
        "trace|truncate|truncate_preserve|unassign|update_all_config|update_config|user_permission|" +
        "version|whoami|zk_dump"
    );

    var shellCommands = (
        "alter_async|alter_namespace|alter_status|append|balance_rsgroup|clear|clone_snapshot|" +
        "compaction_switch|create_namespace|delete_all_snapshot|delete_namespace|delete_snapshot|" +
        "delete_table_snapshots|disable_table_replication|enable_replication|enable_table_replication|" +
        "get_rsgroup|get_server_rsgroup|get_table_rsgroup|isInMaintenanceMode|list_labels|" +
        "list_security_capabilities|restore_snapshot|set_peer_exclude_namespaces|" +
        "set_peer_exclude_tableCFs|set_peer_namespaces|set_peer_tableCFs|snapshot_cleanup_enabled|" +
        "snapshot_cleanup_switch|splitormerge_enabled|splitormerge_switch|update_peer_config"
    );

    var dataTypes = (
        "BINARY|BOOLEAN|BYTE|CHAR|DATE|DECIMAL|DOUBLE|FLOAT|INT|INTEGER|LONG|SHORT|STRING|TIMESTAMP|VARCHAR"
    );

    var tableAttributes = (
        "NAME|FAMILIES|BLOOMFILTER|VERSIONS|MIN_VERSIONS|TTL|KEEP_DELETED_CELLS|BLOCKSIZE|" +
        "IN_MEMORY|BLOCKCACHE|COMPRESSION|ENCODE_ON_DISK|DATA_BLOCK_ENCODING|CACHE_DATA_ON_WRITE|" +
        "CACHE_INDEX_ON_WRITE|CACHE_BLOOMS_ON_WRITE|EVICT_BLOCKS_ON_CLOSE|PREFETCH_BLOCKS_ON_OPEN|" +
        "COMPRESSION_COMPACT|REPLICATION_SCOPE|MAX_FILESIZE|MEMSTORE_FLUSHSIZE|DURABILITY|" +
        "PRIORITY|READONLY|COMPACTION_ENABLED|SPLIT_POLICY|MERGE_ENABLED|NORMALIZATION_ENABLED|" +
        "NORMALIZER_TARGET_REGION_COUNT|NORMALIZER_TARGET_REGION_SIZE"
    );

    var options = (
        "STARTROW|STOPROW|TIMESTAMP|TIMERANGE|VERSIONS|LIMIT|MAXLENGTH|COLUMNS|COLUMN|CACHE|" +
        "RAW|ALL_METRICS|FILTER|REVERSED|ROWPREFIXFILTER|OFFSET|ATTRIBUTES|AUTHORIZATIONS|" +
        "CONSISTENCY|ISOLATION_LEVEL|REGION_REPLICATION|VISIBILITY"
    );

    var compressionTypes = (
        "NONE|GZ|LZO|LZ4|SNAPPY|ZSTD"
    );

    var constants = (
        "true|false|nil"
    );

    var keywordMapper = this.createKeywordMapper({
        "support.function": shellCommands,
        "keyword": keywords,
        "storage.type": dataTypes,
        "variable.language": tableAttributes + "|" + options,
        "constant.language.compression": compressionTypes,
        "constant.language.boolean": constants
    }, "identifier", true);

    this.$rules = {
        "start" : [ {
            token : "comment",
            regex : "#.*$"
        }, {
            token : "string",           // single-quoted string
            regex : "'(?:\\\\.|[^'\\\\])*?'"
        }, {
            token : "string",           // double-quoted string
            regex : '"(?:\\\\.|[^"\\\\])*?"'
        }, {
            token : "constant.numeric", // hex
            regex : "0[xX][0-9a-fA-F]+"
        }, {
            token : "constant.numeric", // float
            regex : "-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?"
        }, {
            token : "keyword.operator",
            regex : "=>|==|!=|<=|>=|<|>|=~|!~"
        }, {
            token : "support.function.filter",
            regex : "\\b(SingleColumnValueFilter|PrefixFilter|PageFilter|KeyOnlyFilter|FirstKeyOnlyFilter|" +
                    "ColumnPaginationFilter|ColumnPrefixFilter|ColumnRangeFilter|QualifierFilter|" +
                    "RowFilter|FamilyFilter|ValueFilter|DependentColumnFilter|TimestampsFilter|" +
                    "ColumnCountGetFilter|MultipleColumnPrefixFilter|RandomRowFilter|InclusiveStopFilter|" +
                    "WhileMatchFilter|FilterList|SkipFilter)\\b"
        }, {
            token : "support.function.comparator",
            regex : "\\b(BinaryComparator|BinaryPrefixComparator|RegexStringComparator|SubstringComparator)\\b"
        }, {
            token : "support.function.operator",
            regex : "\\b(LESS|LESS_OR_EQUAL|EQUAL|NOT_EQUAL|GREATER_OR_EQUAL|GREATER|NO_OP|MUST_PASS_ALL|MUST_PASS_ONE)\\b"
        }, {
            token : keywordMapper,
            regex : "[a-zA-Z_$][a-zA-Z0-9_$:]*\\b"
        }, {
            token : "keyword.operator",
            regex : "\\+|\\-|\\*|\\/|%|\\|\\||&&|\\^|&|\\||!|~"
        }, {
            token : "paren.lparen",
            regex : "[\\(\\[\\{]"
        }, {
            token : "paren.rparen",
            regex : "[\\)\\]\\}]"
        }, {
            token : "punctuation.operator",
            regex : "[,;:]"
        }, {
            token : "text",
            regex : "\\s+"
        } ]
    };
    this.normalizeRules();
};

oop.inherits(HBaseHighlightRules, TextHighlightRules);

exports.HBaseHighlightRules = HBaseHighlightRules;
});

ace.define("ace/mode/hbase",["require","exports","module","ace/lib/oop","ace/mode/text","ace/mode/hbase_highlight_rules"], function(require, exports, module) {
"use strict";

var oop = require("../lib/oop");
var TextMode = require("./text").Mode;
var HBaseHighlightRules = require("./hbase_highlight_rules").HBaseHighlightRules;

var Mode = function() {
    this.HighlightRules = HBaseHighlightRules;
    this.$behaviour = this.$defaultBehaviour;
};
oop.inherits(Mode, TextMode);

(function() {
    this.lineCommentStart = "#";
    this.$id = "ace/mode/hbase";
}).call(Mode.prototype);

exports.Mode = Mode;
});

(function() {
    ace.require(["ace/mode/hbase"], function(m) {
        if (typeof module == "object" && typeof exports == "object" && module) {
            module.exports = m;
        }
    });
})();
