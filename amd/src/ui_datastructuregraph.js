// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Visual tree/graph builder UI for data structure questions.
 *
 * @module qtype_coderunner/ui_datastructuregraph
 * @copyright  2026
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define(['jquery', 'core/str'], function($, Str) {

    const SERIALISATION_TYPE = 'coderunner-datastructure-graph';
    const SERIALISATION_VERSION = 1;
    const NODE_RADIUS = 30;
    const RECORD_CELL_WIDTH = 58;
    const RECORD_HEIGHT = 48;
    const HIT_PADDING = 8;
    const DEFAULT_NODE_COLOR = 'black';
    const DEFAULT_EDGE_COLOR = 'black';
    const NODE_FILL = '#ffffff';
    const SELECTED = '#2454c6';
    const LINK_SOURCE = '#1b7f4c';
    const RED = '#b42318';
    const BLACK = '#111827';
    const MAX_HISTORY = 100;
    const DOUBLE_TAP_MS = 300;
    const DOUBLE_TAP_DISTANCE = 24;
    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 4;
    const ZOOM_STEP = 1.2;
    const VIRTUAL_MARGIN = 3000;
    // Keyboard movement steps (world pixels) for arrow-key node nudging and
    // canvas panning, used by the accessible keyboard controls.
    const NUDGE_STEP = 8;
    const NUDGE_STEP_LARGE = 32;
    const PAN_STEP = 40;
    // Linear structures. A linked-list node is drawn as a box-and-pointer
    // record [prev | data | next]; stack and queue elements are plain cells.
    const MODES = ['tree', 'graph', 'list', 'stack', 'queue'];
    const LINEAR_MODES = ['list', 'stack', 'queue'];
    const SEQUENCE_MODES = ['stack', 'queue'];
    const LIST_DATA_WIDTH = 64;
    const LIST_POINTER_WIDTH = 24;
    const LIST_HEIGHT = 44;
    const LIST_GAP = 56;
    const LIST_LANE = 8;
    const STACK_CELL_WIDTH = 120;
    const STACK_CELL_HEIGHT = 40;
    const QUEUE_CELL_WIDTH = 72;
    const QUEUE_CELL_HEIGHT = 52;
    const SEQUENCE_ORIGIN = 90;
    const MARKER = '#475467';

    // English fallbacks for the editor chrome, keyed by the short name used in
    // s(). The matching language strings are 'datastructuregraph_ui_' + name in
    // qtype_coderunner and replace these once core/str resolves.
    const STRING_PREFIX = 'datastructuregraph_ui_';
    const UI_STRING_DEFAULTS = {
        addnode: 'Add node',
        connect: 'Connect',
        'delete': 'Delete',
        undo: 'Undo',
        redo: 'Redo',
        layout: 'Layout',
        resetview: 'Reset view',
        zoomin: 'Zoom in',
        zoomout: 'Zoom out',
        zoomlevel: 'Zoom level (click to reset to 100%)',
        clear: 'Clear',
        clearconfirm: 'Clear diagram?',
        properties: 'Properties',
        none: 'None',
        key: 'Key',
        value: 'Value',
        color: 'Color',
        cost: 'Cost',
        childslot: 'Child slot',
        connectchild: 'Connect child',
        keysvalues: 'Keys / values',
        keys: 'Keys',
        addkey: 'Add key',
        remove: 'Remove',
        keylabel: 'Key {$a}',
        valuelabel: 'Value {$a}',
        shiftprefix: 'Shift: ',
        slotchild: '{$a} child: ',
        clicktarget: 'from {$a} - click target',
        clicksource: 'click source node',
        a11yeditor: 'Data structure graph editor',
        a11yinstructions: 'Press N to add a node. Use Tab and Shift+Tab to move between nodes and edges. ' +
            'Use the arrow keys to reposition the selected node, or to pan when nothing is selected. ' +
            'Press C to connect the selected node to another node. Press Delete to remove the selection. ' +
            'Press Escape to cancel.',
        a11yempty: 'The graph is currently empty.',
        a11ynodes: 'Nodes',
        a11yedges: 'Edges',
        a11yselection: 'Selected',
        a11yto: 'to',
        a11yslot: 'slot {$a}',
        a11ycost: 'cost {$a}',
        a11yadded: 'Added node {$a}',
        a11ydeleted: 'Deleted {$a}',
        a11yselnode: 'Selected node {$a}',
        a11yseledge: 'Selected edge {$a}',
        a11ycleared: 'Selection cleared',
        a11yselectfirst: 'Select a node first, then press C to connect it.',
        a11yconnectstart: 'Connecting from node {$a}. Move to another node and press C or Enter to connect, ' +
            'or Escape to cancel.',
        a11yconnected: 'Connected {$a}',
        a11yconnectcancel: 'Connection cancelled',
        help: 'Help',
        helptitle: 'Keyboard & mouse controls',
        helpclose: 'Close',
        helpmouseheading: 'Mouse',
        helpkeyboardheading: 'Keyboard',
        helpmouseselectg: 'Click',
        helpmouseselect: 'a node or edge to select it.',
        helpmousemoveg: 'Drag',
        helpmousemove: 'a node to move it.',
        helpmousepang: 'Drag',
        helpmousepan: 'an empty part of the canvas to pan the view.',
        helpmouseaddg: 'Double-click',
        helpmouseadd: 'an empty spot to add a node.',
        helpmouseconnectg: 'Click',
        helpmouseconnectmid: 'a node, then',
        helpmouseconnectg2: 'Shift-click',
        helpmouseconnectend: 'another to connect them.',
        helpmousezoomg: 'Mouse wheel',
        helpmousezoom: 'to zoom in and out.',
        helpkeyadd: 'Add a node',
        helpkeymove: 'Move the selection between nodes and edges',
        helpkeynudge: 'Move the selected node (hold Shift for larger steps), or pan when nothing is selected',
        helpkeyconnect: 'Connect the selected node to another (press again on the target)',
        helpkeydelete: 'Delete the selection',
        helpkeycancel: 'Cancel a connection or clear the selection',
        helpkeyundo: 'Undo or redo the last change',
        push: 'Push',
        pop: 'Pop',
        enqueue: 'Enqueue',
        dequeue: 'Dequeue',
        head: 'head',
        tail: 'tail',
        top: 'top',
        empty: '(empty)',
        linkslot: 'Link',
        connectlink: 'Connect link',
        position: 'Position {$a}',
        a11ylist: 'Linked list',
        a11ystack: 'Stack, from top to bottom',
        a11yqueue: 'Queue, from head to tail',
        a11ynull: 'null',
        a11yunlinked: 'Unlinked nodes',
        a11yemptystack: 'The stack is currently empty.',
        a11yemptyqueue: 'The queue is currently empty.',
        a11ypushed: 'Pushed {$a}',
        a11ypopped: 'Popped {$a}',
        a11yenqueued: 'Enqueued {$a}',
        a11ydequeued: 'Dequeued {$a}',
        a11ymoved: 'Moved {$a}',
        a11ystackinstructions: 'Press N to push a new element. Use Tab and Shift+Tab to move between elements. ' +
            'Use the Up and Down arrow keys to move the selected element within the stack. ' +
            'Press Delete to remove the selected element. Press Escape to clear the selection.',
        a11yqueueinstructions: 'Press N to enqueue a new element. Use Tab and Shift+Tab to move between elements. ' +
            'Use the Left and Right arrow keys to move the selected element within the queue. ' +
            'Press Delete to remove the selected element. Press Escape to clear the selection.',
        helpmousereorderg: 'Drag',
        helpmousereorder: 'an element to move it to a different position.',
        helpmousepushg: 'Double-click',
        helpmousepush: 'the canvas to push or enqueue a new element.',
        helpkeypush: 'Push or enqueue a new element',
        helpkeyelements: 'Move the selection between elements',
        helpkeyreorder: 'Move the selected element one position, or pan when nothing is selected',
        helpkeydeleteelement: 'Delete the selected element'
    };

    // Inline SVG glyphs (Feather-style, 24x24 stroke) for the toolbar buttons,
    // keyed by the same short names used for labels. Self-contained so the UI
    // does not depend on an icon font being present in the active theme.
    const ICONS = {
        addnode: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        connect: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/>' +
            '<line x1="8" y1="12" x2="16" y2="12"/>',
        'delete': '<polyline points="3 6 5 6 21 6"/>' +
            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
            '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
        undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
        redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>',
        layout: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/>' +
            '<rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v5M5 13h14M5 13v3M19 13v3"/>',
        resetview: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3' +
            'M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
        zoomin: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
            '<line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>',
        zoomout: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
            '<line x1="8" y1="11" x2="14" y2="11"/>',
        clear: '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
            '<line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>',
        push: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
        pop: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
        enqueue: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
        dequeue: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>' +
            '<line x1="2" y1="5" x2="2" y2="19"/>',
        help: '<circle cx="12" cy="12" r="10"/>' +
            '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>' +
            '<line x1="12" y1="17" x2="12.01" y2="17"/>'
    };

    /**
     * Wrap an icon's inner markup in a standard inline SVG element.
     *
     * @param {string} name Icon name (key of ICONS).
     * @returns {string}
     */
    function svgIcon(name) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            (ICONS[name] || '') + '</svg>';
    }

    /**
     * Convert a UI parameter to a boolean.
     *
     * @param {*} value Parameter value.
     * @param {boolean} fallback Fallback value.
     * @returns {boolean}
     */
    function boolParam(value, fallback) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            return value === 'true' || value === '1';
        }
        if (typeof value === 'number') {
            return value !== 0;
        }
        return fallback;
    }

    /**
     * Convert a nullable value to a string.
     *
     * @param {*} value Value to clean.
     * @returns {string}
     */
    function cleanString(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }

    /**
     * Convert a UI parameter to a non-negative integer.
     *
     * @param {*} value Parameter value.
     * @param {number} fallback Fallback value.
     * @returns {number}
     */
    function intParam(value, fallback) {
        const parsed = parseInt(value, 10);
        if (!isNaN(parsed) && parsed >= 0) {
            return parsed;
        }
        return fallback;
    }

    /**
     * Escape text for HTML.
     *
     * @param {*} value Value to escape.
     * @returns {string}
     */
    function escapeHtml(value) {
        return cleanString(value).replace(/[&<>"']/g, function(ch) {
            switch (ch) {
                case '&':
                    return '&amp;';
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                case "'":
                    return '&#39;';
                default:
                    return ch;
            }
        });
    }

    /**
     * Compute the distance between two points.
     *
     * @param {object} a First point.
     * @param {object} b Second point.
     * @returns {number}
     */
    function distance(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Compute the distance from a point to a line segment.
     *
     * @param {object} point Point.
     * @param {object} a Segment start.
     * @param {object} b Segment end.
     * @returns {number}
     */
    function distanceToSegment(point, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            return distance(point, a);
        }
        let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return distance(point, {x: a.x + t * dx, y: a.y + t * dy});
    }

    /**
     * Return a point on a quadratic Bezier curve.
     *
     * @param {object} start Curve start.
     * @param {object} control Control point.
     * @param {object} end Curve end.
     * @param {number} t Position on the curve from 0 to 1.
     * @returns {object}
     */
    function pointOnQuadratic(start, control, end, t) {
        const mt = 1 - t;
        return {
            x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
            y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y
        };
    }

    /**
     * Return a point on a cubic Bezier curve (used for self-loop edges).
     *
     * @param {object} start Curve start.
     * @param {object} c1 First control point.
     * @param {object} c2 Second control point.
     * @param {object} end Curve end.
     * @param {number} t Position on the curve from 0 to 1.
     * @returns {object}
     */
    function pointOnCubic(start, c1, c2, end, t) {
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const d = 3 * mt * t * t;
        const e = t * t * t;
        return {
            x: a * start.x + b * c1.x + d * c2.x + e * end.x,
            y: a * start.y + b * c1.y + d * c2.y + e * end.y
        };
    }

    /**
     * Get the stroke colour for a red/black graph item.
     *
     * @param {string} color Colour name.
     * @returns {string}
     */
    function edgeStroke(color) {
        return color === 'red' ? RED : BLACK;
    }

    /**
     * Constructor for the DataStructureGraph UI.
     *
     * @param {string} textareaId Textarea id.
     * @param {number} width Initial width.
     * @param {number} height Initial height.
     * @param {object} uiParams UI parameters.
     */
    function DataStructureGraph(textareaId, width, height, uiParams) {
        this.textArea = $(document.getElementById(textareaId));
        this.readOnly = this.textArea.prop('readonly');
        this.uiParams = uiParams || {};
        this.mode = MODES.indexOf(this.uiParams.mode) !== -1 ? this.uiParams.mode : 'tree';
        this.isLinear = LINEAR_MODES.indexOf(this.mode) !== -1;
        this.isSequence = SEQUENCE_MODES.indexOf(this.mode) !== -1;
        this.listKind = this.uiParams.listkind === 'doubly' ? 'doubly' : 'singly';
        // Links in a linked list always point from one node to the next.
        this.isDirected = this.isLinear || boolParam(this.uiParams.isdirected, false);
        this.nodeFields = this.normaliseNodeFields(this.uiParams.nodefields);
        this.multiKeyNodes = this.nodeFields === 'keys' || this.nodeFields === 'keys_values';
        this.showNodeValues = this.nodeFields === 'key_value' || this.nodeFields === 'keys_values';
        this.maxNodeKeys = intParam(this.uiParams.maxnodekeys, this.multiKeyNodes ? 3 : 0);
        this.allowEdgeCosts = boolParam(this.uiParams.allowedgecosts, true);
        this.allowNodeColors = boolParam(this.uiParams.allownodecolors, false);
        this.allowEdgeColors = boolParam(this.uiParams.allowedgecolors, false);
        this.lockNodeSet = boolParam(this.uiParams.locknodeset, false);
        this.lockEdgeSet = boolParam(this.uiParams.lockedgeset, false);
        this.lockNodePositions = boolParam(this.uiParams.locknodepositions, false);
        this.lockNodeFields = boolParam(this.uiParams.locknodefields, false);
        this.lockEdgeFields = boolParam(this.uiParams.lockedgefields, false);
        this.showHeadTail = boolParam(this.uiParams.showheadtail, true);
        this.showNull = boolParam(this.uiParams.shownull, true);
        this.autoPrev = boolParam(this.uiParams.autoprev, true);
        if (this.isSequence) {
            // Stack and queue elements are ordered cells with implicit links, so
            // there are no edges to cost or colour.
            this.allowEdgeCosts = false;
            this.allowEdgeColors = false;
        }
        this.childSlots = this.getChildSlots();

        this.nodes = [];
        this.edges = [];
        this.nextNodeNumber = 1;
        this.nextEdgeNumber = 1;
        this.selected = null;
        this.draggingNode = null;
        this.dragOffset = {x: 0, y: 0};
        this.linkSource = null;
        this.linkPreview = null;
        this.linkStart = null;
        this.linkDragging = false;
        this.armedChildSlot = '';
        this.connectMode = false;
        this.isShiftDown = false;
        this.hoverWorld = null;
        this.viewOffset = {x: 0, y: 0};
        this.zoom = 1;
        this.strings = Object.assign({}, UI_STRING_DEFAULTS);
        this.panningCanvas = false;
        this.panStart = null;
        this.panOrigin = null;
        this.eventNamespace = '.datastructuregraph' + Math.random().toString(36).substring(2);
        this.undoStack = [];
        this.redoStack = [];
        this.lastHistoryToken = null;
        this.dragHistory = null;
        this.lastTapTime = 0;
        this.lastTapPos = null;
        this.lastTouch = null;
        this.fail = false;
        this.failString = null;
        this.announceTimer = null;
        this.helpOverlay = null;
        this.helpReturnFocus = null;
        this.isInitialising = true;

        this.buildUi(width, height);
        this.reload();
        this.isInitialising = false;
        if (!this.fail) {
            this.updateProperties();
            this.draw();
            this.sync();
        }
        this.loadStrings();
    }

    /**
     * Look up an editor-chrome string by its short name, falling back to the
     * English default and substituting a {$a} placeholder when given.
     *
     * @param {string} name Short string name (see UI_STRING_DEFAULTS).
     * @param {string|number} [a] Optional placeholder replacement.
     * @returns {string}
     */
    DataStructureGraph.prototype.s = function(name, a) {
        let str = this.strings[name];
        if (str === undefined) {
            str = name;
        }
        if (a !== undefined) {
            str = str.replace('{$a}', a);
        }
        return str;
    };

    /**
     * Load the localised editor strings and refresh the chrome once resolved.
     */
    DataStructureGraph.prototype.loadStrings = function() {
        const t = this;
        const names = Object.keys(UI_STRING_DEFAULTS);
        const requests = names.map(function(name) {
            return {key: STRING_PREFIX + name, component: 'qtype_coderunner'};
        });
        Str.get_strings(requests).then(function(values) {
            names.forEach(function(name, index) {
                const value = values[index];
                if (typeof value === 'string' && value.indexOf('[[') !== 0) {
                    t.strings[name] = value;
                }
            });
            t.relabelChrome();
            return null;
        }).catch(function() {
            return null;
        });
    };

    /**
     * Re-apply localised strings to the persistent toolbar and panels.
     */
    DataStructureGraph.prototype.relabelChrome = function() {
        const buttons = [
            [this.addNodeButton, this.addActionName()],
            [this.popButton, this.removeActionName()],
            [this.connectButton, 'connect'],
            [this.deleteButton, 'delete'],
            [this.undoButton, 'undo'],
            [this.redoButton, 'redo'],
            [this.layoutButton, 'layout'],
            [this.resetViewButton, 'resetview'],
            [this.zoomInButton, 'zoomin'],
            [this.zoomOutButton, 'zoomout'],
            [this.clearButton, 'clear'],
            [this.helpButton, 'help']
        ];
        buttons.forEach(function(pair) {
            if (pair[0]) {
                const label = this.s(pair[1]);
                pair[0].attr('aria-label', label).find('.dsg-tool-label').text(label);
            }
        }, this);
        if (this.zoomLevel) {
            this.zoomLevel.attr('title', this.s('zoomlevel'));
        }
        if (this.canvas) {
            this.canvas.attr('aria-label', this.s('a11yeditor'));
        }
        this.updateConnectionUi();
        this.updateProperties();
        this.updateAccessibility();
    };

    DataStructureGraph.prototype.getChildSlots = function() {
        if (this.mode === 'list') {
            return this.listKind === 'doubly' ? ['next', 'prev'] : ['next'];
        }
        if (this.mode !== 'tree') {
            return [];
        }
        const configured = Array.isArray(this.uiParams.childslots) ? this.uiParams.childslots : [];
        const slots = configured.map(function(slot) {
            return cleanString(slot).trim();
        }).filter(function(slot) {
            return slot !== '';
        });
        // Setting childslots to ["none"] gives a tree with an arbitrary number of
        // unlabelled children. An empty list keeps the binary left/right default.
        if (slots.length === 1 && slots[0].toLowerCase() === 'none') {
            return [];
        }
        if (slots.length === 0) {
            return ['left', 'right'];
        }
        return slots;
    };

    DataStructureGraph.prototype.normaliseNodeFields = function(nodeFields) {
        const allowed = ['key', 'key_value', 'keys', 'keys_values'];
        const fields = allowed.indexOf(nodeFields) !== -1 ? nodeFields : 'key_value';
        if (this.isLinear) {
            // Linked-list, stack and queue elements hold a single key.
            return 'key';
        }
        return fields;
    };

    /**
     * Whether the user may draw edges in the current mode.
     *
     * @returns {boolean}
     */
    DataStructureGraph.prototype.canConnect = function() {
        return !this.readOnly && !this.lockEdgeSet && !this.isSequence;
    };

    /**
     * Whether nodes are drawn as circles (trees and graphs with single keys).
     *
     * @returns {boolean}
     */
    DataStructureGraph.prototype.usesCircleNodes = function() {
        return !this.multiKeyNodes && !this.isLinear;
    };

    /**
     * Pick a value by structure: stack, queue or anything else.
     *
     * @param {*} stackValue Value for stack mode.
     * @param {*} queueValue Value for queue mode.
     * @param {*} otherValue Value for every other mode.
     * @returns {*}
     */
    DataStructureGraph.prototype.byMode = function(stackValue, queueValue, otherValue) {
        if (this.mode === 'stack') {
            return stackValue;
        }
        return this.mode === 'queue' ? queueValue : otherValue;
    };

    /**
     * Short string name for the "add" toolbar action in the current mode.
     *
     * @returns {string}
     */
    DataStructureGraph.prototype.addActionName = function() {
        return this.byMode('push', 'enqueue', 'addnode');
    };

    /**
     * Short string name for the "remove" toolbar action of a stack or queue.
     *
     * @returns {string}
     */
    DataStructureGraph.prototype.removeActionName = function() {
        return this.mode === 'queue' ? 'dequeue' : 'pop';
    };

    DataStructureGraph.prototype.buildUi = function(width, height) {
        const t = this;
        this.root = $('<div class="coderunner-datastructuregraph"></div>');
        this.toolbar = $('<div class="coderunner-datastructuregraph-toolbar"></div>');
        this.canvasWrap = $('<div class="coderunner-datastructuregraph-canvaswrap"></div>');
        this.properties = $('<div class="coderunner-datastructuregraph-properties"></div>');
        this.canvas = $('<canvas class="coderunner-datastructuregraph-canvas" tabindex="0"></canvas>');
        this.connectionStatus = $('<span class="coderunner-datastructuregraph-status"></span>');

        this.addNodeButton = this.iconButton(this.addActionName(), function() {
            if (!t.lockNodeSet) {
                const centre = t.visibleCentre();
                const node = t.addNode(centre.x, centre.y);
                if (node && t.isSequence) {
                    // Put the cursor straight into the new element's key.
                    t.properties.find('input').first().trigger('focus');
                }
            }
        });
        this.popButton = null;
        if (this.isSequence) {
            this.popButton = this.iconButton(this.removeActionName(), function() {
                t.popElement();
            });
        }
        this.connectButton = this.iconButton('connect', function() {
            if (!t.lockEdgeSet) {
                if (t.connectMode || t.linkSource) {
                    t.clearConnection();
                } else {
                    t.connectMode = true;
                    t.armedChildSlot = '';
                    t.updateConnectionUi();
                }
                t.draw();
            }
        });
        this.deleteButton = this.iconButton('delete', function() {
            t.deleteSelected();
        }).addClass('dsg-tool--danger');
        this.undoButton = this.iconButton('undo', function() {
            t.undo();
        });
        this.redoButton = this.iconButton('redo', function() {
            t.redo();
        });
        this.zoomOutButton = this.iconButton('zoomout', function() {
            t.zoomBy(1 / ZOOM_STEP);
        });
        this.zoomInButton = this.iconButton('zoomin', function() {
            t.zoomBy(ZOOM_STEP);
        });
        this.zoomLevel = $('<button type="button" class="dsg-zoomlevel"></button>')
            .attr('title', this.s('zoomlevel'))
            .on('click', function() {
                t.resetZoom();
            });
        this.resetViewButton = this.iconButton('resetview', function() {
            t.resetView();
        });
        this.layoutButton = this.iconButton('layout', function() {
            t.autoLayout();
        });
        this.clearButton = this.iconButton('clear', function() {
            if (!t.readOnly && !t.lockNodeSet && !t.lockEdgeSet && confirm(t.s('clearconfirm'))) {
                t.recordHistory();
                t.nodes = [];
                t.edges = [];
                t.selected = null;
                t.clearConnection();
                t.updateProperties();
                t.draw();
            }
        }).addClass('dsg-tool--danger');
        this.helpButton = this.iconButton('help', function() {
            t.showHelp();
        });
        this.toolbar.append(
            this.isSequence ?
                this.toolGroup(this.addNodeButton, this.popButton, this.deleteButton) :
                this.toolGroup(this.addNodeButton, this.connectButton, this.deleteButton),
            this.toolGroup(this.undoButton, this.redoButton),
            this.toolGroup(this.zoomOutButton, this.zoomLevel, this.zoomInButton, this.resetViewButton, this.layoutButton),
            this.toolGroup(this.clearButton),
            this.connectionStatus,
            this.toolGroup(this.helpButton)
        );
        this.canvasWrap.append(this.canvas);

        // Off-screen text alternative and polite live region so keyboard and
        // screen-reader users can perceive and edit the graph. The description
        // holds a full listing of the current nodes and edges; the live region
        // announces individual actions as they happen.
        const descId = 'dsg-desc-' + Math.random().toString(36).substring(2);
        this.description = $('<div class="coderunner-datastructuregraph-a11y"></div>').attr('id', descId);
        this.liveRegion = $('<div class="coderunner-datastructuregraph-a11y"></div>')
            .attr({'aria-live': 'polite', 'aria-atomic': 'true'});
        this.canvas.attr({
            'role': this.readOnly ? 'img' : 'application',
            'aria-label': this.s('a11yeditor'),
            'aria-describedby': descId
        });
        this.root.append(this.toolbar, this.canvasWrap, this.properties, this.description, this.liveRegion);

        this.canvas.on('mousedown', function(e) {
            t.mouseDown(e);
        });
        this.canvas.on('mousemove', function(e) {
            t.mouseMove(e);
        });
        this.canvas.on('mouseup mouseleave', function(e) {
            t.mouseUp(e);
        });
        this.canvas.on('dblclick', function(e) {
            t.doubleClick(e);
        });
        this.canvas.on('keydown', function(e) {
            t.keyDown(e);
        });
        this.canvas.on('touchstart', function(e) {
            t.handleTouch(e, 'down');
        });
        this.canvas.on('touchmove', function(e) {
            t.handleTouch(e, 'move');
        });
        this.canvas.on('touchend touchcancel', function(e) {
            t.handleTouch(e, 'up');
        });
        this.canvas.on('wheel', function(e) {
            t.wheelZoom(e);
        });
        $(document)
            .on('keydown' + this.eventNamespace, function(e) {
                if (e.key === 'Shift' && !t.isShiftDown) {
                    t.isShiftDown = true;
                    t.updateConnectionUi();
                    t.draw();
                }
            })
            .on('keyup' + this.eventNamespace, function(e) {
                if (e.key === 'Shift') {
                    t.isShiftDown = false;
                    t.updateConnectionUi();
                    t.draw();
                }
            });
        $(window).on('blur' + this.eventNamespace, function() {
            if (t.isShiftDown) {
                t.isShiftDown = false;
                t.updateConnectionUi();
                t.draw();
            }
        });

        this.resize(width, height);
        if (this.readOnly) {
            this.root.addClass('readonly');
            this.root.find('button').prop('disabled', true);
            // Navigation and help stay usable so reviewers can pan, zoom and
            // read the controls.
            this.zoomInButton.prop('disabled', false);
            this.zoomOutButton.prop('disabled', false);
            this.zoomLevel.prop('disabled', false);
            this.resetViewButton.prop('disabled', false);
            this.helpButton.prop('disabled', false);
        }
        this.updateConnectionUi();
        this.updateHistoryButtons();
        this.updateZoomLabel();
    };

    /**
     * Build a compact icon toolbar button labelled (via tooltip and aria-label)
     * from the localised string of the given short name.
     *
     * @param {string} name Short string/icon name.
     * @param {Function} handler Click handler.
     * @returns {jQuery}
     */
    DataStructureGraph.prototype.iconButton = function(name, handler) {
        const label = this.s(name);
        const button = $('<button type="button" class="dsg-tool"></button>')
            .attr('aria-label', label)
            .on('click', handler);
        $('<span class="dsg-tool-icon"></span>').html(svgIcon(name)).appendTo(button);
        $('<span class="dsg-tool-label"></span>').text(label).appendTo(button);
        return button;
    };

    /**
     * Wrap one or more toolbar buttons in a divided group.
     *
     * @returns {jQuery}
     */
    DataStructureGraph.prototype.toolGroup = function() {
        const group = $('<div class="dsg-toolgroup"></div>');
        Array.prototype.forEach.call(arguments, function(button) {
            group.append(button);
        });
        return group;
    };

    /**
     * Open a modal dialog listing every mouse and keyboard control. Built fresh
     * each time so it always reflects the current language strings.
     */
    DataStructureGraph.prototype.showHelp = function() {
        const t = this;
        if (this.helpOverlay) {
            return;
        }
        // Each mouse row is a list of segments; a `b` segment is a bold gesture
        // and a `t` segment is plain text, joined with spaces when rendered.
        let mouse = [
            [{b: 'helpmouseselectg'}, {t: 'helpmouseselect'}],
            [{b: 'helpmousemoveg'}, {t: 'helpmousemove'}],
            [{b: 'helpmousepang'}, {t: 'helpmousepan'}],
            [{b: 'helpmouseaddg'}, {t: 'helpmouseadd'}],
            [{b: 'helpmouseconnectg'}, {t: 'helpmouseconnectmid'}, {b: 'helpmouseconnectg2'}, {t: 'helpmouseconnectend'}],
            [{b: 'helpmousezoomg'}, {t: 'helpmousezoom'}]
        ];
        let keys = [
            {keys: ['N', 'Insert'], desc: 'helpkeyadd'},
            {keys: ['Tab', 'Shift + Tab'], desc: 'helpkeymove'},
            {keys: ['←', '↑', '→', '↓'], desc: 'helpkeynudge'},
            {keys: ['C', 'Enter'], desc: 'helpkeyconnect'},
            {keys: ['Delete', 'Backspace'], desc: 'helpkeydelete'},
            {keys: ['Esc'], desc: 'helpkeycancel'},
            {keys: ['Ctrl + Z', 'Ctrl + Y'], desc: 'helpkeyundo'}
        ];
        if (this.isSequence) {
            mouse = [
                [{b: 'helpmouseselectg'}, {t: 'helpmouseselect'}],
                [{b: 'helpmousereorderg'}, {t: 'helpmousereorder'}],
                [{b: 'helpmousepang'}, {t: 'helpmousepan'}],
                [{b: 'helpmousepushg'}, {t: 'helpmousepush'}],
                [{b: 'helpmousezoomg'}, {t: 'helpmousezoom'}]
            ];
            keys = [
                {keys: ['N', 'Insert'], desc: 'helpkeypush'},
                {keys: ['Tab', 'Shift + Tab'], desc: 'helpkeyelements'},
                {keys: this.mode === 'stack' ? ['↑', '↓'] : ['←', '→'], desc: 'helpkeyreorder'},
                {keys: ['Delete', 'Backspace'], desc: 'helpkeydeleteelement'},
                {keys: ['Esc'], desc: 'helpkeycancel'},
                {keys: ['Ctrl + Z', 'Ctrl + Y'], desc: 'helpkeyundo'}
            ];
        }

        const overlay = $('<div class="coderunner-datastructuregraph-help-overlay"></div>');
        const titleId = 'dsg-help-title-' + Math.random().toString(36).substring(2);
        const dialog = $('<div class="dsg-help" role="dialog" aria-modal="true"></div>')
            .attr('aria-labelledby', titleId);
        const head = $('<div class="dsg-help-head"></div>');
        $('<h3 class="dsg-help-title"></h3>').attr('id', titleId).text(this.s('helptitle')).appendTo(head);
        const closeButton = $('<button type="button" class="dsg-help-close" aria-label=""></button>')
            .attr('aria-label', this.s('helpclose'))
            .html('×')
            .on('click', function() {
                t.closeHelp();
            });
        head.append(closeButton);
        dialog.append(head);

        const body = $('<div class="dsg-help-body"></div>');
        const mouseSection = $('<section class="dsg-help-section"></section>');
        $('<h4></h4>').text(this.s('helpmouseheading')).appendTo(mouseSection);
        const mouseList = $('<ul class="dsg-help-list"></ul>');
        mouse.forEach(function(segments) {
            const item = $('<li></li>');
            segments.forEach(function(seg, i) {
                if (i > 0) {
                    item.append(document.createTextNode(' '));
                }
                if (seg.b) {
                    $('<strong></strong>').text(t.s(seg.b)).appendTo(item);
                } else {
                    $('<span></span>').text(t.s(seg.t)).appendTo(item);
                }
            });
            mouseList.append(item);
        });
        mouseSection.append(mouseList);

        const keySection = $('<section class="dsg-help-section"></section>');
        $('<h4></h4>').text(this.s('helpkeyboardheading')).appendTo(keySection);
        keys.forEach(function(row) {
            const rowEl = $('<div class="dsg-help-row"></div>');
            const keyBox = $('<span class="dsg-help-keys"></span>');
            row.keys.forEach(function(key, i) {
                if (i > 0) {
                    $('<span class="dsg-help-sep"></span>').text('/').appendTo(keyBox);
                }
                $('<kbd></kbd>').text(key).appendTo(keyBox);
            });
            rowEl.append(keyBox);
            $('<span class="dsg-help-desc"></span>').text(t.s(row.desc)).appendTo(rowEl);
            keySection.append(rowEl);
        });

        body.append(mouseSection, keySection);
        dialog.append(body);
        overlay.append(dialog);

        // Close on backdrop click or Escape; keep other keys inside the dialog.
        overlay.on('mousedown', function(e) {
            if (e.target === overlay[0]) {
                t.closeHelp();
            }
        });
        overlay.on('keydown', function(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                t.closeHelp();
            }
        });

        this.helpOverlay = overlay;
        this.helpReturnFocus = document.activeElement;
        this.root.append(overlay);
        closeButton.focus();
    };

    /**
     * Close the controls help dialog and restore focus to the opener.
     */
    DataStructureGraph.prototype.closeHelp = function() {
        if (!this.helpOverlay) {
            return;
        }
        this.helpOverlay.remove();
        this.helpOverlay = null;
        if (this.helpReturnFocus && typeof this.helpReturnFocus.focus === 'function') {
            this.helpReturnFocus.focus();
        } else if (this.helpButton) {
            this.helpButton.focus();
        }
        this.helpReturnFocus = null;
    };

    DataStructureGraph.prototype.updateConnectionUi = function() {
        if (!this.connectButton || !this.connectionStatus) {
            return;
        }
        const shiftActive = this.isShiftDown && this.canConnect();
        const active = this.connectMode || !!this.linkSource || shiftActive;
        this.connectButton.toggleClass('active', active);
        if (!active) {
            this.connectionStatus.text('');
            this.connectionStatus.removeClass('active');
            return;
        }
        const source = this.linkSource ? this.getNode(this.linkSource) : this.shiftConnectSource();
        const prefix = shiftActive && !this.connectMode && !this.linkSource ? this.s('shiftprefix') : '';
        const slotText = this.armedChildSlot ? this.s('slotchild', this.armedChildSlot) : '';
        const sourceText = source ? this.s('clicktarget', this.nodeTitle(source)) : this.s('clicksource');
        this.connectionStatus.text(prefix + slotText + sourceText);
        this.connectionStatus.addClass('active');
    };

    DataStructureGraph.prototype.shiftConnectSource = function() {
        if (!this.isShiftDown || !this.canConnect() || !this.selected || this.selected.type !== 'node') {
            return null;
        }
        return this.getNode(this.selected.id);
    };

    DataStructureGraph.prototype.clearConnection = function() {
        this.linkSource = null;
        this.linkPreview = null;
        this.linkStart = null;
        this.linkDragging = false;
        this.armedChildSlot = '';
        this.connectMode = false;
        this.updateConnectionUi();
    };

    DataStructureGraph.prototype.startConnection = function(node, pos, childSlot) {
        this.linkSource = node.id;
        this.linkPreview = pos || null;
        this.linkStart = pos || null;
        this.linkDragging = false;
        this.armedChildSlot = childSlot || '';
        this.selected = {type: 'node', id: node.id};
        this.updateConnectionUi();
        this.updateProperties();
    };

    DataStructureGraph.prototype.visibleWorldBounds = function() {
        return {
            left: -this.viewOffset.x / this.zoom,
            right: (this.canvas[0].width - this.viewOffset.x) / this.zoom,
            top: -this.viewOffset.y / this.zoom,
            bottom: (this.canvas[0].height - this.viewOffset.y) / this.zoom
        };
    };

    DataStructureGraph.prototype.visibleCentre = function() {
        const bounds = this.visibleWorldBounds();
        return {
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2
        };
    };

    DataStructureGraph.prototype.resetView = function(redraw) {
        this.viewOffset = {x: 0, y: 0};
        this.zoom = 1;
        this.updateZoomLabel();
        if (redraw !== false) {
            this.draw();
        }
    };

    /**
     * Update the toolbar zoom-level readout to the current zoom percentage.
     */
    DataStructureGraph.prototype.updateZoomLabel = function() {
        if (this.zoomLevel) {
            this.zoomLevel.text(Math.round(this.zoom * 100) + '%');
        }
    };

    /**
     * Reset the zoom to 100% about the centre of the canvas, keeping pan.
     */
    DataStructureGraph.prototype.resetZoom = function() {
        this.zoomAt({x: this.canvas[0].width / 2, y: this.canvas[0].height / 2}, 1 / this.zoom);
    };

    /**
     * Zoom by a factor about a fixed screen point, keeping the world point under
     * that screen position stationary.
     *
     * @param {object} screenPoint Canvas-relative point with x and y.
     * @param {number} factor Multiplicative zoom factor.
     */
    DataStructureGraph.prototype.zoomAt = function(screenPoint, factor) {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
        if (newZoom === this.zoom) {
            return;
        }
        const worldX = (screenPoint.x - this.viewOffset.x) / this.zoom;
        const worldY = (screenPoint.y - this.viewOffset.y) / this.zoom;
        this.zoom = newZoom;
        this.viewOffset.x = screenPoint.x - worldX * newZoom;
        this.viewOffset.y = screenPoint.y - worldY * newZoom;
        this.updateZoomLabel();
        this.draw();
    };

    /**
     * Zoom by a factor about the centre of the canvas (used by the buttons).
     *
     * @param {number} factor Multiplicative zoom factor.
     */
    DataStructureGraph.prototype.zoomBy = function(factor) {
        this.zoomAt({x: this.canvas[0].width / 2, y: this.canvas[0].height / 2}, factor);
    };

    /**
     * Handle a mouse-wheel event as a zoom about the cursor.
     *
     * @param {object} e jQuery wheel event.
     */
    DataStructureGraph.prototype.wheelZoom = function(e) {
        const oe = e.originalEvent || e;
        if (oe.cancelable) {
            e.preventDefault();
        }
        const factor = oe.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this.zoomAt(this.screenPosition(oe), factor);
    };

    DataStructureGraph.prototype.startPanning = function(pos) {
        this.panningCanvas = true;
        this.panStart = pos;
        this.panOrigin = {x: this.viewOffset.x, y: this.viewOffset.y};
        this.canvas.addClass('is-panning');
    };

    DataStructureGraph.prototype.stopPanning = function() {
        this.panningCanvas = false;
        this.panStart = null;
        this.panOrigin = null;
        this.canvas.removeClass('is-panning');
    };

    DataStructureGraph.prototype.updateCanvasCursor = function(pos) {
        if (!this.canvas || this.panningCanvas) {
            return;
        }
        const overItem = !!(this.findNodeAt(pos) || this.findEdgeAt(pos));
        this.canvas.toggleClass('over-graph-item', overItem);
    };

    DataStructureGraph.prototype.failed = function() {
        return this.fail;
    };

    DataStructureGraph.prototype.failMessage = function() {
        return this.failString;
    };

    DataStructureGraph.prototype.getElement = function() {
        return this.root;
    };

    DataStructureGraph.prototype.hasFocus = function() {
        return this.canvas[0] === document.activeElement ||
            this.properties.find(':focus').length > 0;
    };

    DataStructureGraph.prototype.syncIntervalSecs = function() {
        return 0;
    };

    DataStructureGraph.prototype.allowFullScreen = function() {
        return true;
    };

    DataStructureGraph.prototype.resize = function(width, height) {
        const safeWidth = Math.max(320, width || 320);
        const safeHeight = Math.max(220, height || 220);
        const propertyWidth = safeWidth >= 720 ? 240 : 0;
        const toolbarHeight = 38;
        this.root.css({
            width: safeWidth + 'px',
            height: safeHeight + 'px'
        });
        this.canvas.attr({
            width: Math.max(300, safeWidth - propertyWidth - 4),
            height: Math.max(160, safeHeight - toolbarHeight)
        });
        if (this.isSequence && this.nodes) {
            this.layoutSequence();
        }
        this.draw();
    };

    DataStructureGraph.prototype.destroy = function() {
        this.sync();
        if (this.announceTimer) {
            window.clearTimeout(this.announceTimer);
            this.announceTimer = null;
        }
        if (this.helpOverlay) {
            this.helpOverlay.remove();
            this.helpOverlay = null;
        }
        this.canvas.off();
        $(document).off(this.eventNamespace);
        $(window).off(this.eventNamespace);
        this.root.remove();
    };

    /**
     * Capture the current editable state as a JSON snapshot.
     *
     * @returns {string}
     */
    DataStructureGraph.prototype.snapshot = function() {
        return JSON.stringify({
            nodes: this.nodes,
            edges: this.edges,
            nextNodeNumber: this.nextNodeNumber,
            nextEdgeNumber: this.nextEdgeNumber
        });
    };

    /**
     * Record the current state on the undo stack before a mutating action.
     *
     * A non-null token coalesces consecutive edits to the same field (for
     * example successive keystrokes) into a single undo entry, capturing the
     * state from before the editing session began.
     *
     * @param {string} [token] Coalescing token, or omitted for a discrete action.
     */
    DataStructureGraph.prototype.recordHistory = function(token) {
        if (this.readOnly) {
            return;
        }
        token = token || null;
        if (token !== null && token === this.lastHistoryToken) {
            return;
        }
        this.commitHistory(this.snapshot(), token);
    };

    /**
     * Push a snapshot onto the undo stack, capping its length and clearing redo.
     *
     * @param {string} snap Serialised state to store.
     * @param {string|null} token Coalescing token to remember.
     */
    DataStructureGraph.prototype.commitHistory = function(snap, token) {
        this.undoStack.push(snap);
        if (this.undoStack.length > MAX_HISTORY) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.lastHistoryToken = token || null;
        this.updateHistoryButtons();
    };

    /**
     * Undo the most recent change.
     */
    DataStructureGraph.prototype.undo = function() {
        if (this.readOnly || this.undoStack.length === 0) {
            return;
        }
        this.redoStack.push(this.snapshot());
        this.applySnapshot(this.undoStack.pop());
        this.lastHistoryToken = null;
        this.updateHistoryButtons();
    };

    /**
     * Redo the most recently undone change.
     */
    DataStructureGraph.prototype.redo = function() {
        if (this.readOnly || this.redoStack.length === 0) {
            return;
        }
        this.undoStack.push(this.snapshot());
        this.applySnapshot(this.redoStack.pop());
        this.lastHistoryToken = null;
        this.updateHistoryButtons();
    };

    /**
     * Replace the editable state with a stored snapshot.
     *
     * @param {string} snap Serialised state to restore.
     */
    DataStructureGraph.prototype.applySnapshot = function(snap) {
        let data;
        try {
            data = JSON.parse(snap);
        } catch (error) {
            return;
        }
        this.nodes = Array.isArray(data.nodes) ? data.nodes : [];
        this.edges = Array.isArray(data.edges) ? data.edges : [];
        this.nextNodeNumber = data.nextNodeNumber || this.computeNextNumber(this.nodes, 'n');
        this.nextEdgeNumber = data.nextEdgeNumber || this.computeNextNumber(this.edges, 'e');
        // Stack/queue positions follow from the order alone, and the snapshot's
        // positions may predate a resize of the canvas.
        this.layoutSequence();
        this.draggingNode = null;
        this.dragHistory = null;
        this.clearConnection();
        if (this.selected) {
            const exists = this.selected.type === 'node' ?
                this.getNode(this.selected.id) : this.getEdge(this.selected.id);
            if (!exists) {
                this.selected = null;
            }
        }
        this.updateProperties();
        this.draw();
    };

    /**
     * Enable or disable the undo/redo buttons to match the history state.
     */
    DataStructureGraph.prototype.updateHistoryButtons = function() {
        if (this.undoButton) {
            this.undoButton.prop('disabled', this.readOnly || this.undoStack.length === 0);
        }
        if (this.redoButton) {
            this.redoButton.prop('disabled', this.readOnly || this.redoStack.length === 0);
        }
    };

    /**
     * Translate a touch event into the equivalent mouse interaction.
     *
     * @param {object} e jQuery touch event.
     * @param {string} phase One of 'down', 'move' or 'up'.
     */
    DataStructureGraph.prototype.handleTouch = function(e, phase) {
        const oe = e.originalEvent || e;
        if (oe.touches && oe.touches.length > 1) {
            // Leave multi-touch gestures (such as pinch) to the browser.
            return;
        }
        const touch = (oe.touches && oe.touches[0]) ||
            (oe.changedTouches && oe.changedTouches[0]) || null;
        if (!touch && phase !== 'up') {
            return;
        }
        if (oe.cancelable) {
            e.preventDefault();
        }
        if (touch) {
            this.lastTouch = {clientX: touch.clientX, clientY: touch.clientY};
        }
        const point = touch || this.lastTouch || {clientX: 0, clientY: 0};
        const synthetic = {
            clientX: point.clientX,
            clientY: point.clientY,
            button: 0,
            shiftKey: false,
            preventDefault: function() {
                return undefined;
            }
        };
        if (phase === 'move') {
            synthetic.type = 'mousemove';
            this.mouseMove(synthetic);
            return;
        }
        if (phase === 'up') {
            synthetic.type = 'mouseup';
            this.mouseUp(synthetic);
            return;
        }
        if (this.isDoubleTap(point)) {
            this.lastTapTime = 0;
            this.lastTapPos = null;
            synthetic.type = 'dblclick';
            this.doubleClick(synthetic);
            return;
        }
        this.lastTapTime = Date.now();
        this.lastTapPos = {clientX: point.clientX, clientY: point.clientY};
        synthetic.type = 'mousedown';
        this.mouseDown(synthetic);
    };

    /**
     * Decide whether a tap at the given point continues a recent first tap.
     *
     * @param {object} point Object with clientX and clientY.
     * @returns {boolean}
     */
    DataStructureGraph.prototype.isDoubleTap = function(point) {
        if (!this.lastTapTime || !this.lastTapPos) {
            return false;
        }
        if (Date.now() - this.lastTapTime >= DOUBLE_TAP_MS) {
            return false;
        }
        return Math.abs(point.clientX - this.lastTapPos.clientX) < DOUBLE_TAP_DISTANCE &&
            Math.abs(point.clientY - this.lastTapPos.clientY) < DOUBLE_TAP_DISTANCE;
    };

    DataStructureGraph.prototype.reload = function() {
        const content = this.textArea.val();
        if (!content || content.trim() === '') {
            return;
        }
        try {
            const parsed = JSON.parse(content);
            if (!parsed || parsed.type !== SERIALISATION_TYPE || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
                throw new Error('Invalid serialisation');
            }
            this.nodes = parsed.nodes.map(this.normaliseNode.bind(this));
            const nodeIds = {};
            this.nodes.forEach(function(node) {
                nodeIds[node.id] = true;
            });
            // Drop edges that reference a node that isn't present: they can't be
            // drawn, selected or deleted, so they'd only linger in the data.
            this.edges = parsed.edges.map(this.normaliseEdge.bind(this)).filter(function(edge) {
                return edge.from && edge.to && nodeIds[edge.from] && nodeIds[edge.to];
            });
            this.assignMissingTreeSlots();
            if (this.isSequence) {
                // Stack/queue order is the node order (top or head first); the
                // links between neighbouring cells are implicit.
                this.edges = [];
                this.layoutSequence();
            }
            this.nextNodeNumber = this.computeNextNumber(this.nodes, 'n');
            this.nextEdgeNumber = this.computeNextNumber(this.edges, 'e');
        } catch (error) {
            this.fail = true;
            this.failString = 'datastructuregraph_ui_invalidserialisation';
        }
    };

    DataStructureGraph.prototype.normaliseNode = function(node) {
        const layout = node.layout || {};
        const id = cleanString(node.id) || this.newNodeId();
        const keys = this.normaliseNodeKeys(node);
        const first = keys[0] || {key: '', value: ''};
        return {
            id: id,
            key: first.key,
            value: first.value,
            keys: keys,
            color: node.color === 'red' ? 'red' : DEFAULT_NODE_COLOR,
            x: Number(layout.x || node.x || 120),
            y: Number(layout.y || node.y || 120)
        };
    };

    DataStructureGraph.prototype.normaliseNodeKeys = function(node) {
        let keys = [];
        if (Array.isArray(node.keys)) {
            keys = node.keys.map(function(item) {
                if (typeof item === 'object' && item !== null) {
                    return {key: cleanString(item.key), value: this.cleanNodeValue(item.value)};
                }
                return {key: cleanString(item), value: ''};
            }, this);
        }
        if (keys.length === 0) {
            keys = [{key: cleanString(node.key), value: this.cleanNodeValue(node.value)}];
        }
        keys = keys.filter(function(item, index) {
            return index === 0 || item.key !== '' || item.value !== '';
        });
        if (keys.length === 0) {
            keys = [{key: '', value: ''}];
        }
        if (this.maxNodeKeys > 0) {
            keys = keys.slice(0, this.maxNodeKeys);
        }
        return keys;
    };

    DataStructureGraph.prototype.normaliseEdge = function(edge) {
        const id = cleanString(edge.id) || this.newEdgeId();
        const slot = cleanString(edge.slot);
        return {
            id: id,
            from: cleanString(edge.from),
            to: cleanString(edge.to),
            cost: cleanString(edge.cost),
            color: edge.color === 'red' ? 'red' : DEFAULT_EDGE_COLOR,
            slot: this.childSlots.indexOf(slot) !== -1 ? slot : ''
        };
    };

    DataStructureGraph.prototype.assignMissingTreeSlots = function() {
        if ((this.mode !== 'tree' && this.mode !== 'list') || this.childSlots.length === 0) {
            return;
        }
        for (let i = 0; i < this.edges.length; i++) {
            if (!this.edges[i].slot) {
                this.edges[i].slot = this.slotForNewEdge(this.edges[i].from, this.edges[i].to, '');
            }
        }
    };

    DataStructureGraph.prototype.computeNextNumber = function(items, prefix) {
        let max = 0;
        items.forEach(function(item) {
            const id = cleanString(item.id);
            if (id.indexOf(prefix) === 0) {
                const value = parseInt(id.substring(prefix.length), 10);
                if (!isNaN(value)) {
                    max = Math.max(max, value);
                }
            }
        });
        return max + 1;
    };

    DataStructureGraph.prototype.sync = function() {
        if (this.nodes.length === 0 && this.edges.length === 0 && this.textArea.val().trim() === '') {
            return;
        }
        if (this.nodes.length === 0 && this.edges.length === 0) {
            this.textArea.val('');
            return;
        }
        this.textArea.val(JSON.stringify(this.serialise()));
    };

    DataStructureGraph.prototype.serialise = function() {
        const t = this;
        const settings = {
            mode: this.mode,
            isdirected: this.isDirected,
            childslots: this.childSlots.slice(),
            nodefields: this.nodeFields,
            maxnodekeys: this.maxNodeKeys
        };
        if (this.mode === 'list') {
            settings.listkind = this.listKind;
        }
        return {
            type: SERIALISATION_TYPE,
            version: SERIALISATION_VERSION,
            settings: settings,
            nodes: this.nodes.map(function(node) {
                const keys = t.nodeKeys(node);
                const first = keys[0] || {key: '', value: ''};
                const result = {
                    id: node.id,
                    key: first.key,
                    layout: {x: Math.round(node.x), y: Math.round(node.y)}
                };
                if (t.showNodeValues) {
                    result.value = first.value;
                }
                if (t.multiKeyNodes || keys.length > 1) {
                    result.keys = keys.map(function(item) {
                        const result = {key: item.key};
                        if (t.showNodeValues) {
                            result.value = item.value;
                        }
                        return result;
                    });
                }
                if (t.allowNodeColors || node.color === 'red') {
                    result.color = node.color;
                }
                return result;
            }),
            edges: this.edges.map(function(edge) {
                const result = {
                    id: edge.id,
                    from: edge.from,
                    to: edge.to
                };
                if (t.allowEdgeCosts || edge.cost !== '') {
                    result.cost = edge.cost;
                }
                if (t.allowEdgeColors || edge.color === 'red') {
                    result.color = edge.color;
                }
                if (t.childSlots.length > 0 || edge.slot !== '') {
                    result.slot = edge.slot;
                }
                return result;
            })
        };
    };

    DataStructureGraph.prototype.newNodeId = function() {
        return 'n' + this.nextNodeNumber++;
    };

    DataStructureGraph.prototype.newEdgeId = function() {
        return 'e' + this.nextEdgeNumber++;
    };

    /**
     * Add a node. In stack mode the new element is pushed on top and in queue
     * mode it joins the tail, ignoring the requested position.
     *
     * @param {number} x World x position.
     * @param {number} y World y position.
     * @returns {object|null} The new node, or null when adding is not allowed.
     */
    DataStructureGraph.prototype.addNode = function(x, y) {
        if (this.readOnly || this.lockNodeSet) {
            return null;
        }
        this.recordHistory();
        const node = {
            id: this.newNodeId(),
            key: '',
            value: '',
            keys: [{key: '', value: ''}],
            color: DEFAULT_NODE_COLOR,
            x: x,
            y: y
        };
        if (this.mode === 'stack') {
            this.nodes.unshift(node);
        } else {
            this.nodes.push(node);
        }
        if (this.isSequence) {
            this.layoutSequence();
            this.ensureVisible(node);
        }
        this.selected = {type: 'node', id: node.id};
        this.updateProperties();
        this.draw();
        return node;
    };

    /**
     * Remove the top of a stack or the head of a queue.
     */
    DataStructureGraph.prototype.popElement = function() {
        if (this.readOnly || this.lockNodeSet || !this.isSequence || this.nodes.length === 0) {
            return;
        }
        this.recordHistory();
        const removed = this.nodes.shift();
        if (this.selected && this.selected.type === 'node' && this.selected.id === removed.id) {
            this.selected = null;
        }
        this.layoutSequence();
        this.updateProperties();
        this.announce(this.s(this.mode === 'queue' ? 'a11ydequeued' : 'a11ypopped', this.nodeTitle(removed)));
        this.draw();
    };

    /**
     * Move a stack/queue element to a new position in the order.
     *
     * @param {string} id Node id.
     * @param {number} newIndex Target index (0 is the top of a stack or head of a queue).
     * @param {boolean} [record] False when history has already been captured.
     * @returns {boolean} True if the order changed.
     */
    DataStructureGraph.prototype.moveElement = function(id, newIndex, record) {
        let index = -1;
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i].id === id) {
                index = i;
                break;
            }
        }
        newIndex = Math.max(0, Math.min(this.nodes.length - 1, newIndex));
        if (index === -1 || index === newIndex) {
            return false;
        }
        if (record !== false) {
            this.recordHistory();
        }
        const node = this.nodes.splice(index, 1)[0];
        this.nodes.splice(newIndex, 0, node);
        return true;
    };

    /**
     * After a stack/queue element has been dragged, slot it into the position
     * nearest to where it was dropped.
     *
     * @param {object} node The dragged node.
     */
    DataStructureGraph.prototype.dropElement = function(node) {
        const vertical = this.mode === 'stack';
        const pitch = vertical ? STACK_CELL_HEIGHT : QUEUE_CELL_WIDTH;
        const first = this.sequencePosition(0);
        const offset = vertical ? node.y - first.y : node.x - first.x;
        this.moveElement(node.id, Math.round(offset / pitch), false);
        this.layoutSequence();
    };

    /**
     * World-space centre of the stack/queue cell at a given index.
     *
     * @param {number} index Element index (0 is the top of a stack or head of a queue).
     * @returns {object} Point with x and y.
     */
    DataStructureGraph.prototype.sequencePosition = function(index) {
        const height = this.canvas ? this.canvas[0].height : 300;
        if (this.mode === 'stack') {
            // The bottom of the stack stays put and the top grows upwards.
            const base = Math.max(STACK_CELL_HEIGHT * 2, height - 44) - STACK_CELL_HEIGHT / 2;
            const count = Math.max(1, this.nodes.length);
            return {
                x: SEQUENCE_ORIGIN + STACK_CELL_WIDTH / 2,
                y: base - (count - 1 - index) * STACK_CELL_HEIGHT
            };
        }
        return {
            x: SEQUENCE_ORIGIN + QUEUE_CELL_WIDTH / 2 + index * QUEUE_CELL_WIDTH,
            y: Math.round(height / 2)
        };
    };

    /**
     * Snap every stack/queue element into its cell.
     */
    DataStructureGraph.prototype.layoutSequence = function() {
        if (!this.isSequence) {
            return;
        }
        for (let i = 0; i < this.nodes.length; i++) {
            const pos = this.sequencePosition(i);
            this.nodes[i].x = pos.x;
            this.nodes[i].y = pos.y;
        }
    };

    /**
     * Pan the view just enough to bring a node fully into sight.
     *
     * @param {object} node The node.
     */
    DataStructureGraph.prototype.ensureVisible = function(node) {
        if (!this.canvas) {
            return;
        }
        const bounds = this.nodeBounds(node);
        const visible = this.visibleWorldBounds();
        const margin = 36;
        let dx = 0;
        let dy = 0;
        if (bounds.left - margin < visible.left) {
            dx = visible.left - (bounds.left - margin);
        } else if (bounds.right + margin > visible.right) {
            dx = visible.right - (bounds.right + margin);
        }
        if (bounds.top - margin < visible.top) {
            dy = visible.top - (bounds.top - margin);
        } else if (bounds.bottom + margin > visible.bottom) {
            dy = visible.bottom - (bounds.bottom + margin);
        }
        this.viewOffset = {x: this.viewOffset.x + dx * this.zoom, y: this.viewOffset.y + dy * this.zoom};
    };

    /**
     * Zoom out (never in beyond 100%) and pan so every node is visible.
     */
    DataStructureGraph.prototype.fitView = function() {
        if (!this.canvas || this.nodes.length === 0) {
            return;
        }
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        this.nodes.forEach(function(node) {
            const b = this.nodeBounds(node);
            left = Math.min(left, b.left);
            right = Math.max(right, b.right);
            top = Math.min(top, b.top);
            bottom = Math.max(bottom, b.bottom);
        }, this);
        const pad = 50;
        const width = this.canvas[0].width;
        const height = this.canvas[0].height;
        const zoom = Math.max(MIN_ZOOM, Math.min(1, width / (right - left + 2 * pad), height / (bottom - top + 2 * pad)));
        this.zoom = zoom;
        this.viewOffset = {
            x: width / 2 - ((left + right) / 2) * zoom,
            y: height / 2 - ((top + bottom) / 2) * zoom
        };
        this.updateZoomLabel();
    };

    DataStructureGraph.prototype.addEdge = function(fromId, toId, slot) {
        if (this.readOnly || this.lockEdgeSet || this.isSequence || !fromId || !toId) {
            return;
        }
        if (this.mode === 'list') {
            this.addListLink(fromId, toId, slot);
            return;
        }
        // Self-loops are meaningful for graphs (automata, state machines) but not
        // for trees, where a node cannot be its own child.
        if (fromId === toId && this.mode === 'tree') {
            return;
        }
        this.recordHistory();
        const endpoints = this.normaliseTreeEndpoints(fromId, toId);
        const edgeFrom = endpoints.from;
        const edgeTo = endpoints.to;
        const requestedSlot = endpoints.reversed ? '' : slot;
        const existing = this.findExistingTreeEdge(edgeFrom, edgeTo);
        if (existing) {
            existing.from = edgeFrom;
            existing.to = edgeTo;
            existing.slot = this.slotForNewEdge(edgeFrom, edgeTo, requestedSlot || existing.slot);
            this.selected = {type: 'edge', id: existing.id};
            this.updateProperties();
            this.draw();
            return;
        }
        const edge = {
            id: this.newEdgeId(),
            from: edgeFrom,
            to: edgeTo,
            cost: '',
            color: DEFAULT_EDGE_COLOR,
            slot: this.slotForNewEdge(edgeFrom, edgeTo, requestedSlot || '')
        };
        this.edges.push(edge);
        this.selected = {type: 'edge', id: edge.id};
        this.updateProperties();
        this.draw();
    };

    /**
     * Set a linked-list pointer. Each node has at most one link per slot, so
     * pointing a slot somewhere new replaces its old target - just like
     * assigning node.next in code. In a doubly linked list with autoprev on,
     * setting A.next = B also sets B.prev = A.
     *
     * @param {string} fromId Source node id.
     * @param {string} toId Target node id.
     * @param {string} slot 'next' or 'prev' (defaults to 'next').
     */
    DataStructureGraph.prototype.addListLink = function(fromId, toId, slot) {
        if (fromId === toId) {
            return;
        }
        slot = this.childSlots.indexOf(slot) !== -1 ? slot : 'next';
        const current = this.findLink(fromId, slot);
        if (current && current.to === toId) {
            this.selected = {type: 'edge', id: current.id};
            this.updateProperties();
            this.draw();
            return;
        }
        this.recordHistory();
        if (current) {
            this.removeEdges([current.id]);
        }
        const edge = {
            id: this.newEdgeId(),
            from: fromId,
            to: toId,
            cost: '',
            color: DEFAULT_EDGE_COLOR,
            slot: slot
        };
        this.edges.push(edge);
        if (slot === 'next' && this.pairsPrevLinks()) {
            const oldPrev = this.findLink(toId, 'prev');
            if (oldPrev) {
                this.edges = this.edges.filter(function(candidate) {
                    return candidate.id !== oldPrev.id;
                });
            }
            this.edges.push({
                id: this.newEdgeId(),
                from: toId,
                to: fromId,
                cost: '',
                color: DEFAULT_EDGE_COLOR,
                slot: 'prev'
            });
        }
        this.selected = {type: 'edge', id: edge.id};
        this.updateProperties();
        this.draw();
    };

    /**
     * Whether next links automatically maintain the matching prev links.
     *
     * @returns {boolean}
     */
    DataStructureGraph.prototype.pairsPrevLinks = function() {
        return this.mode === 'list' && this.listKind === 'doubly' && this.autoPrev;
    };

    /**
     * Find the link leaving a node through a given slot.
     *
     * @param {string} fromId Node id.
     * @param {string} slot Slot name.
     * @returns {object|null}
     */
    DataStructureGraph.prototype.findLink = function(fromId, slot) {
        for (let i = 0; i < this.edges.length; i++) {
            const edge = this.edges[i];
            if (edge.from === fromId && (edge.slot || 'next') === slot) {
                return edge;
            }
        }
        return null;
    };

    /**
     * Remove edges by id, also dropping the prev link paired with any removed
     * next link when prev links are maintained automatically.
     *
     * @param {Array<string>} ids Edge ids.
     */
    DataStructureGraph.prototype.removeEdges = function(ids) {
        const doomed = {};
        ids.forEach(function(id) {
            doomed[id] = true;
        });
        if (this.pairsPrevLinks()) {
            const pairs = [];
            this.edges.forEach(function(edge) {
                if (doomed[edge.id] && edge.slot === 'next') {
                    pairs.push(edge);
                }
            });
            this.edges.forEach(function(edge) {
                pairs.forEach(function(next) {
                    if (edge.slot === 'prev' && edge.from === next.to && edge.to === next.from) {
                        doomed[edge.id] = true;
                    }
                });
            });
        }
        this.edges = this.edges.filter(function(edge) {
            return !doomed[edge.id];
        });
    };

    DataStructureGraph.prototype.normaliseTreeEndpoints = function(fromId, toId) {
        const result = {
            from: fromId,
            to: toId,
            reversed: false
        };
        if (this.mode !== 'tree') {
            return result;
        }
        const from = this.getNode(fromId);
        const to = this.getNode(toId);
        if (!from || !to) {
            return result;
        }
        if (from.y > to.y + 8) {
            result.from = toId;
            result.to = fromId;
            result.reversed = true;
        }
        return result;
    };

    DataStructureGraph.prototype.findExistingTreeEdge = function(fromId, toId) {
        if (this.mode !== 'tree') {
            return null;
        }
        for (let i = 0; i < this.edges.length; i++) {
            if ((this.edges[i].from === fromId && this.edges[i].to === toId) ||
                    (this.edges[i].from === toId && this.edges[i].to === fromId)) {
                return this.edges[i];
            }
        }
        return null;
    };

    DataStructureGraph.prototype.slotForNewEdge = function(fromId, toId, requestedSlot) {
        if (this.childSlots.length === 0) {
            return '';
        }
        if (this.childSlots.indexOf(requestedSlot) !== -1) {
            return requestedSlot;
        }
        if (this.mode === 'list') {
            return 'next';
        }
        const used = {};
        this.edges.forEach(function(edge) {
            if (edge.from === fromId && edge.slot) {
                used[edge.slot] = true;
            }
        });
        const from = this.getNode(fromId);
        const to = this.getNode(toId);
        let preferred = '';
        if (from && to && this.childSlots.indexOf('left') !== -1 && this.childSlots.indexOf('right') !== -1) {
            preferred = to.x < from.x ? 'left' : 'right';
        }
        if (preferred && !used[preferred]) {
            return preferred;
        }
        for (let i = 0; i < this.childSlots.length; i++) {
            if (!used[this.childSlots[i]]) {
                return this.childSlots[i];
            }
        }
        return preferred || this.childSlots[0];
    };

    DataStructureGraph.prototype.deleteSelected = function() {
        if (this.readOnly || !this.selected) {
            return;
        }
        if (this.selected.type === 'node' && !this.lockNodeSet) {
            this.recordHistory();
            const id = this.selected.id;
            this.nodes = this.nodes.filter(function(node) {
                return node.id !== id;
            });
            this.edges = this.edges.filter(function(edge) {
                return edge.from !== id && edge.to !== id;
            });
            this.selected = null;
            this.layoutSequence();
        } else if (this.selected.type === 'edge' && !this.lockEdgeSet) {
            this.recordHistory();
            this.removeEdges([this.selected.id]);
            this.selected = null;
        }
        this.updateProperties();
        this.draw();
    };

    DataStructureGraph.prototype.getNode = function(id) {
        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i].id === id) {
                return this.nodes[i];
            }
        }
        return null;
    };

    DataStructureGraph.prototype.getEdge = function(id) {
        for (let i = 0; i < this.edges.length; i++) {
            if (this.edges[i].id === id) {
                return this.edges[i];
            }
        }
        return null;
    };

    DataStructureGraph.prototype.selectedObject = function() {
        if (!this.selected) {
            return null;
        }
        return this.selected.type === 'node' ? this.getNode(this.selected.id) : this.getEdge(this.selected.id);
    };

    DataStructureGraph.prototype.mousePosition = function(e) {
        const screen = this.screenPosition(e);
        return {
            x: (screen.x - this.viewOffset.x) / this.zoom,
            y: (screen.y - this.viewOffset.y) / this.zoom
        };
    };

    DataStructureGraph.prototype.screenPosition = function(e) {
        const rect = this.canvas[0].getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    DataStructureGraph.prototype.doubleClick = function(e) {
        if (this.readOnly || this.lockNodeSet) {
            return;
        }
        const pos = this.mousePosition(e);
        if (!this.findNodeAt(pos) && !this.findEdgeAt(pos)) {
            this.addNode(pos.x, pos.y);
        }
    };

    DataStructureGraph.prototype.mouseDown = function(e) {
        if (e.button !== undefined && e.button !== 0) {
            return;
        }
        this.canvas[0].focus();
        this.lastHistoryToken = null;
        const screenPos = this.screenPosition(e);
        const pos = this.mousePosition(e);
        const node = this.findNodeAt(pos);
        const edge = node ? null : this.findEdgeAt(pos);

        if (this.readOnly) {
            if (!node && !edge) {
                this.startPanning(screenPos);
                e.preventDefault();
            }
            return;
        }

        if ((this.connectMode || this.linkSource) && node && !e.shiftKey) {
            if (!this.linkSource) {
                this.startConnection(node, null, this.armedChildSlot);
            } else {
                // Completing on any node adds the link; the same node again forms
                // a self-loop (addEdge rejects self-loops in tree mode).
                this.addEdge(this.linkSource, node.id, this.armedChildSlot);
                this.clearConnection();
            }
            this.draw();
            return;
        }

        if (e.shiftKey && node && this.canConnect()) {
            const selectedNode = this.selected && this.selected.type === 'node' ? this.getNode(this.selected.id) : null;
            const selectedSource = selectedNode && selectedNode.id !== node.id ? selectedNode.id : null;
            const source = this.linkSource || selectedSource;
            if (source && !this.linkDragging) {
                this.addEdge(source, node.id, this.armedChildSlot);
                this.clearConnection();
            } else {
                this.startConnection(node, pos, this.armedChildSlot);
            }
            this.draw();
            return;
        }

        if (node) {
            this.selected = {type: 'node', id: node.id};
            if (!this.lockNodePositions && !(this.isSequence && this.lockNodeSet)) {
                this.draggingNode = node;
                this.dragOffset = {x: node.x - pos.x, y: node.y - pos.y};
                this.dragHistory = {snapshot: this.snapshot(), x: node.x, y: node.y};
            }
        } else if (edge) {
            this.selected = {type: 'edge', id: edge.id};
        } else {
            this.selected = null;
            if (!this.connectMode && !this.linkSource) {
                this.startPanning(screenPos);
                e.preventDefault();
            }
        }
        this.updateProperties();
        this.draw();
    };

    DataStructureGraph.prototype.mouseMove = function(e) {
        const screenPos = this.screenPosition(e);
        const pos = this.mousePosition(e);
        this.hoverWorld = pos;
        this.updateCanvasCursor(pos);
        if (this.panningCanvas && this.panStart && this.panOrigin) {
            this.viewOffset = {
                x: this.panOrigin.x + screenPos.x - this.panStart.x,
                y: this.panOrigin.y + screenPos.y - this.panStart.y
            };
            this.draw();
        } else if (this.draggingNode) {
            this.draggingNode.x = pos.x + this.dragOffset.x;
            this.draggingNode.y = pos.y + this.dragOffset.y;
            this.clampNode(this.draggingNode);
            this.draw();
        } else if (this.linkSource && this.linkStart) {
            if (distance(pos, this.linkStart) > 4) {
                this.linkDragging = true;
            }
            this.linkPreview = pos;
            this.draw();
        } else if (this.linkSource) {
            this.linkPreview = pos;
            this.draw();
        } else if (this.isShiftDown && this.shiftConnectSource()) {
            this.draw();
        }
    };

    DataStructureGraph.prototype.mouseUp = function(e) {
        if (e.type === 'mouseleave') {
            this.canvas.removeClass('over-graph-item');
        }
        if (this.panningCanvas) {
            this.stopPanning();
            this.updateCanvasCursor(this.mousePosition(e));
            this.draw();
            return;
        }
        if (this.readOnly) {
            return;
        }
        const pos = this.mousePosition(e);
        if (this.linkSource && this.linkStart) {
            const target = this.findNodeAt(pos);
            if (this.linkDragging && target && target.id !== this.linkSource) {
                // A drag onto a different node creates the link. Self-loops are
                // made deliberately (connect mode or C twice on the same node),
                // not by a drag that happens to end back on the source.
                this.addEdge(this.linkSource, target.id, this.armedChildSlot);
                this.clearConnection();
            } else if (this.linkDragging && !this.connectMode) {
                this.linkPreview = null;
                this.linkStart = null;
                this.linkDragging = false;
                this.updateConnectionUi();
            }
        }
        if (this.draggingNode && this.isSequence) {
            this.dropElement(this.draggingNode);
        }
        if (this.draggingNode && this.dragHistory) {
            if (this.draggingNode.x !== this.dragHistory.x || this.draggingNode.y !== this.dragHistory.y) {
                this.commitHistory(this.dragHistory.snapshot, null);
            }
            this.dragHistory = null;
        }
        this.draggingNode = null;
        this.draw();
    };

    DataStructureGraph.prototype.keyDown = function(e) {
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !this.readOnly && (e.key === 'z' || e.key === 'Z')) {
            if (e.shiftKey) {
                this.redo();
            } else {
                this.undo();
            }
            e.preventDefault();
            return;
        }
        if (ctrl && !this.readOnly && (e.key === 'y' || e.key === 'Y')) {
            this.redo();
            e.preventDefault();
            return;
        }
        if (ctrl) {
            // Leave other Ctrl/Cmd combinations to the browser.
            return;
        }
        switch (e.key) {
            case 'Tab':
                // Move the selection between nodes, releasing focus (no
                // preventDefault) when stepping past either end so Tab is never
                // trapped inside the canvas.
                if (this.cycleSelection(e.shiftKey ? -1 : 1)) {
                    e.preventDefault();
                }
                return;
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                this.handleArrowKey(e);
                return;
            case 'Enter':
            case 'c':
            case 'C':
                if (!this.readOnly) {
                    this.keyboardConnect();
                    e.preventDefault();
                }
                return;
            case 'n':
            case 'N':
            case 'Insert':
                if (!this.readOnly && !this.lockNodeSet) {
                    this.addNodeViaKeyboard();
                    e.preventDefault();
                }
                return;
            case 'Delete':
            case 'Backspace':
                if (!this.readOnly) {
                    this.deleteSelectedViaKeyboard();
                    e.preventDefault();
                }
                return;
            case 'Escape':
                if (this.linkSource || this.connectMode) {
                    this.clearConnection();
                    this.announce(this.s('a11yconnectcancel'));
                } else if (this.selected) {
                    this.selected = null;
                    this.updateProperties();
                    this.announce(this.s('a11ycleared'));
                }
                this.draw();
                return;
            default:
                // Other keys are left to the browser.
        }
    };

    /**
     * The ordered list of things Tab can land on: every node, then every edge.
     *
     * @returns {Array<object>} List of {type, id} references.
     */
    DataStructureGraph.prototype.selectableObjects = function() {
        const list = [];
        const nodes = this.mode === 'list' ? this.listOrder().ordered : this.nodes;
        nodes.forEach(function(node) {
            list.push({type: 'node', id: node.id});
        });
        this.edges.forEach(function(edge) {
            list.push({type: 'edge', id: edge.id});
        });
        return list;
    };

    /**
     * Move the selection forward (dir 1) or backward (dir -1) through the nodes
     * and then the edges, so keyboard users can reach edges as well as nodes.
     *
     * @param {number} dir Direction: 1 for next, -1 for previous.
     * @returns {boolean} True if the selection changed (caller should consume
     *     the key); false when there is nowhere to go so focus may move on.
     */
    DataStructureGraph.prototype.cycleSelection = function(dir) {
        const list = this.selectableObjects();
        if (list.length === 0) {
            return false;
        }
        let index = -1;
        if (this.selected) {
            for (let i = 0; i < list.length; i++) {
                if (list[i].type === this.selected.type && list[i].id === this.selected.id) {
                    index = i;
                    break;
                }
            }
        }
        let next;
        if (index === -1) {
            next = dir > 0 ? 0 : list.length - 1;
        } else {
            next = index + dir;
            if (next < 0 || next >= list.length) {
                return false;
            }
        }
        this.selectObject(list[next]);
        return true;
    };

    /**
     * Select the given node or edge reference (or clear when null) and announce
     * it for screen-reader users.
     *
     * @param {object|null} ref A {type, id} reference, or null to clear.
     */
    DataStructureGraph.prototype.selectObject = function(ref) {
        this.selected = ref ? {type: ref.type, id: ref.id} : null;
        this.updateProperties();
        if (!ref) {
            this.announce(this.s('a11ycleared'));
        } else if (ref.type === 'node') {
            const node = this.getNode(ref.id);
            this.announce(this.s('a11yselnode', node ? this.nodeTitle(node) : ref.id));
        } else {
            const edge = this.getEdge(ref.id);
            this.announce(this.s('a11yseledge', edge ? this.edgeTitle(edge) : ref.id));
        }
        this.draw();
    };

    /**
     * Handle an arrow key: nudge the selected node when one is selected and
     * editable, otherwise pan the view. Always consumes the key so the page does
     * not scroll.
     *
     * @param {KeyboardEvent} e The keydown event.
     */
    DataStructureGraph.prototype.handleArrowKey = function(e) {
        const dirs = {
            ArrowUp: {x: 0, y: -1},
            ArrowDown: {x: 0, y: 1},
            ArrowLeft: {x: -1, y: 0},
            ArrowRight: {x: 1, y: 0}
        };
        const dir = dirs[e.key];
        const canNudge = !this.readOnly && !this.lockNodePositions &&
            !(this.isSequence && this.lockNodeSet) &&
            this.selected && this.selected.type === 'node';
        const along = this.mode === 'stack' ? dir.y : dir.x;
        if (canNudge && this.isSequence) {
            // Arrow keys move the element through the stack/queue order.
            if (along !== 0) {
                this.moveSelectedElement(along);
            }
        } else if (canNudge) {
            const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
            this.nudgeSelected(dir.x * step, dir.y * step);
        } else {
            this.viewOffset = {
                x: this.viewOffset.x - dir.x * PAN_STEP,
                y: this.viewOffset.y - dir.y * PAN_STEP
            };
            this.draw();
        }
        e.preventDefault();
    };

    /**
     * Move the selected stack/queue element one step towards the bottom/tail
     * (dir 1) or towards the top/head (dir -1).
     *
     * @param {number} dir Direction.
     */
    DataStructureGraph.prototype.moveSelectedElement = function(dir) {
        const node = this.selectedObject();
        if (!node || this.selected.type !== 'node') {
            return;
        }
        const index = this.nodes.indexOf(node);
        if (this.moveElement(node.id, index + dir)) {
            this.layoutSequence();
            this.ensureVisible(node);
            this.updateProperties();
            this.announce(this.s('a11ymoved', this.nodeTitle(node)) + ', ' +
                this.s('position', this.nodes.indexOf(node) + 1));
            this.draw();
        }
    };

    /**
     * Move the selected node by the given world-pixel delta, coalescing runs of
     * arrow-key presses into a single undo step.
     *
     * @param {number} dx Horizontal delta.
     * @param {number} dy Vertical delta.
     */
    DataStructureGraph.prototype.nudgeSelected = function(dx, dy) {
        if (!this.selected || this.selected.type !== 'node') {
            return;
        }
        const node = this.getNode(this.selected.id);
        if (!node) {
            return;
        }
        this.recordHistory('nudge:' + node.id);
        node.x += dx;
        node.y += dy;
        this.clampNode(node);
        this.draw();
    };

    /**
     * Add a node at the centre of the visible area via the keyboard and announce
     * it.
     */
    DataStructureGraph.prototype.addNodeViaKeyboard = function() {
        const centre = this.visibleCentre();
        const node = this.addNode(centre.x, centre.y);
        if (node) {
            const name = this.byMode('a11ypushed', 'a11yenqueued', 'a11yadded');
            this.announce(this.s(name, this.nodeTitle(node)));
        }
    };

    /**
     * Delete the current selection via the keyboard, announcing what was removed
     * only when a deletion actually happened (it may be blocked by a lock).
     */
    DataStructureGraph.prototype.deleteSelectedViaKeyboard = function() {
        if (!this.selected) {
            return;
        }
        const object = this.selectedObject();
        const label = object
            ? (this.selected.type === 'node' ? this.nodeTitle(object) : this.edgeTitle(object))
            : '';
        this.deleteSelected();
        if (label && !this.selected) {
            this.announce(this.s('a11ydeleted', label));
        }
    };

    /**
     * Keyboard connection flow: the first press arms a link from the selected
     * node; a second press on a different node creates the edge. Pressing it on
     * the source again cancels.
     */
    DataStructureGraph.prototype.keyboardConnect = function() {
        if (!this.canConnect()) {
            return;
        }
        if (!this.selected || this.selected.type !== 'node') {
            this.announce(this.s('a11yselectfirst'));
            return;
        }
        const current = this.getNode(this.selected.id);
        if (!current) {
            return;
        }
        if (!this.linkSource) {
            this.startConnection(current, null, this.armedChildSlot);
            this.announce(this.s('a11yconnectstart', this.nodeTitle(current)));
            this.draw();
            return;
        }
        if (this.linkSource === current.id && this.mode !== 'graph') {
            // A node can't be its own child, so re-selecting the source cancels.
            this.clearConnection();
            this.announce(this.s('a11yconnectcancel'));
            this.draw();
            return;
        }
        const source = this.getNode(this.linkSource);
        const pair = (source ? this.nodeTitle(source) : this.linkSource) +
            ' ' + this.s('a11yto') + ' ' + this.nodeTitle(current);
        this.addEdge(this.linkSource, current.id, this.armedChildSlot);
        this.clearConnection();
        this.announce(this.s('a11yconnected', pair));
        this.draw();
    };

    /**
     * Speak a transient message through the polite live region. The text is
     * cleared first so that identical consecutive messages are re-announced.
     *
     * @param {string} message Message to announce.
     */
    DataStructureGraph.prototype.announce = function(message) {
        if (!this.liveRegion || !message) {
            return;
        }
        const region = this.liveRegion;
        region.text('');
        if (this.announceTimer) {
            window.clearTimeout(this.announceTimer);
        }
        this.announceTimer = window.setTimeout(function() {
            region.text(message);
        }, 30);
    };

    /**
     * Rebuild the off-screen textual description of the whole graph that backs
     * the canvas's aria-describedby.
     */
    DataStructureGraph.prototype.updateAccessibility = function() {
        if (this.description) {
            this.description.text(this.describeGraph());
        }
    };

    /**
     * Build a readable sentence describing the current nodes, edges and
     * selection for screen-reader users.
     *
     * @returns {string}
     */
    DataStructureGraph.prototype.describeGraph = function() {
        if (this.isLinear) {
            return this.describeLinear();
        }
        const label = this.s('a11yeditor');
        if (this.nodes.length === 0 && this.edges.length === 0) {
            return label + '. ' + this.s('a11yempty') + ' ' + this.s('a11yinstructions');
        }
        const t = this;
        const nodeList = this.nodes.map(function(node) {
            return t.nodeTitle(node);
        }).join(', ');
        let desc = label + '. ' + this.s('a11ynodes') + ': ' + (nodeList || this.s('none')) + '.';
        if (this.edges.length) {
            const edgeList = this.edges.map(function(edge) {
                return t.edgeTitle(edge);
            }).join('; ');
            desc += ' ' + this.s('a11yedges') + ': ' + edgeList + '.';
        } else {
            desc += ' ' + this.s('a11yedges') + ': ' + this.s('none') + '.';
        }
        const object = this.selectedObject();
        if (object) {
            const selText = this.selected.type === 'node' ? this.nodeTitle(object) : this.edgeTitle(object);
            desc += ' ' + this.s('a11yselection') + ': ' + selText + '.';
        }
        desc += ' ' + this.s('a11yinstructions');
        return desc;
    };

    /**
     * Describe a linked list, stack or queue in reading order, for example
     * "Linked list: head, 3, 1, 4, null."
     *
     * @returns {string}
     */
    DataStructureGraph.prototype.describeLinear = function() {
        const t = this;
        const label = this.s('a11yeditor');
        const instructions = this.s(this.byMode('a11ystackinstructions', 'a11yqueueinstructions', 'a11yinstructions'));
        if (this.nodes.length === 0) {
            const empty = this.byMode('a11yemptystack', 'a11yemptyqueue', 'a11yempty');
            return label + '. ' + this.s(empty) + ' ' + instructions;
        }
        const title = function(node) {
            return t.nodeTitle(node);
        };
        let desc = label + '. ';
        if (this.isSequence) {
            desc += this.s(this.mode === 'stack' ? 'a11ystack' : 'a11yqueue') + ': ' +
                this.nodes.map(title).join(', ') + '.';
        } else {
            const order = this.listOrder();
            desc += this.s('a11ylist') + ': ' + this.s('head') + ', ' + order.chain.map(title).join(', ') +
                (order.cyclic ? '' : ', ' + this.s('a11ynull')) + '.';
            if (order.detached.length) {
                desc += ' ' + this.s('a11yunlinked') + ': ' + order.detached.map(title).join(', ') + '.';
            }
            if (this.edges.length) {
                desc += ' ' + this.s('a11yedges') + ': ' + this.edges.map(function(edge) {
                    return t.edgeTitle(edge);
                }).join('; ') + '.';
            }
        }
        const object = this.selectedObject();
        if (object) {
            const selText = this.selected.type === 'node' ? this.nodeTitle(object) : this.edgeTitle(object);
            desc += ' ' + this.s('a11yselection') + ': ' + selText + '.';
        }
        return desc + ' ' + instructions;
    };

    /**
     * Work out the reading order of a linked list by following next links from
     * its head. The head is the first node (in drawing order) that no next link
     * points at; if every node has a predecessor (a cycle) the first node is
     * used. Nodes not reached from the head are returned as detached.
     *
     * @returns {object} {chain, detached, ordered, heads, tails, cyclic}
     */
    DataStructureGraph.prototype.listOrder = function() {
        const incoming = {};
        const nextOf = {};
        this.edges.forEach(function(edge) {
            if ((edge.slot || 'next') === 'next') {
                incoming[edge.to] = (incoming[edge.to] || 0) + 1;
                if (!nextOf[edge.from]) {
                    nextOf[edge.from] = edge.to;
                }
            }
        }, this);
        const heads = this.nodes.filter(function(node) {
            return !incoming[node.id];
        });
        const tails = this.nodes.filter(function(node) {
            return !nextOf[node.id];
        });
        const chain = [];
        const seen = {};
        let cyclic = false;
        let current = heads.length ? heads[0] : (this.nodes[0] || null);
        while (current) {
            if (seen[current.id]) {
                cyclic = true;
                break;
            }
            seen[current.id] = true;
            chain.push(current);
            current = nextOf[current.id] ? this.getNode(nextOf[current.id]) : null;
        }
        const detached = this.nodes.filter(function(node) {
            return !seen[node.id];
        });
        return {
            chain: chain,
            detached: detached,
            ordered: chain.concat(detached),
            heads: heads,
            tails: tails,
            cyclic: cyclic
        };
    };

    /**
     * A readable label for an edge, including direction, child slot and cost
     * when present.
     *
     * @param {object} edge The edge.
     * @returns {string}
     */
    DataStructureGraph.prototype.edgeTitle = function(edge) {
        const from = this.getNode(edge.from);
        const to = this.getNode(edge.to);
        const arrow = this.isDirected ? ' ' + this.s('a11yto') + ' ' : ' — ';
        let text = (from ? this.nodeTitle(from) : edge.from) + arrow + (to ? this.nodeTitle(to) : edge.to);
        const extras = [];
        if (edge.slot) {
            extras.push(this.s('a11yslot', edge.slot));
        }
        if (this.allowEdgeCosts && edge.cost !== undefined && String(edge.cost).trim() !== '') {
            extras.push(this.s('a11ycost', edge.cost));
        }
        if (extras.length) {
            text += ' (' + extras.join(', ') + ')';
        }
        return text;
    };

    DataStructureGraph.prototype.findNodeAt = function(pos) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            if (this.pointInNode(pos, this.nodes[i])) {
                return this.nodes[i];
            }
        }
        return null;
    };

    DataStructureGraph.prototype.pointInNode = function(pos, node) {
        if (this.usesCircleNodes()) {
            return distance(pos, node) <= NODE_RADIUS;
        }
        const bounds = this.nodeBounds(node);
        return pos.x >= bounds.left && pos.x <= bounds.right && pos.y >= bounds.top && pos.y <= bounds.bottom;
    };

    DataStructureGraph.prototype.nodeBounds = function(node) {
        if (this.isLinear) {
            let width = STACK_CELL_WIDTH;
            let height = STACK_CELL_HEIGHT;
            if (this.mode === 'list') {
                width = this.listNodeWidth();
                height = LIST_HEIGHT;
            } else if (this.mode === 'queue') {
                width = QUEUE_CELL_WIDTH;
                height = QUEUE_CELL_HEIGHT;
            }
            return {
                left: node.x - width / 2,
                right: node.x + width / 2,
                top: node.y - height / 2,
                bottom: node.y + height / 2,
                width: width,
                height: height
            };
        }
        if (!this.multiKeyNodes) {
            return {
                left: node.x - NODE_RADIUS,
                right: node.x + NODE_RADIUS,
                top: node.y - NODE_RADIUS,
                bottom: node.y + NODE_RADIUS,
                width: NODE_RADIUS * 2,
                height: NODE_RADIUS * 2
            };
        }
        const count = Math.max(1, this.nodeKeys(node).length);
        const width = Math.max(RECORD_CELL_WIDTH, count * RECORD_CELL_WIDTH);
        return {
            left: node.x - width / 2,
            right: node.x + width / 2,
            top: node.y - RECORD_HEIGHT / 2,
            bottom: node.y + RECORD_HEIGHT / 2,
            width: width,
            height: RECORD_HEIGHT
        };
    };

    /**
     * Width of a box-and-pointer list node: data plus one pointer cell per slot.
     *
     * @returns {number}
     */
    DataStructureGraph.prototype.listNodeWidth = function() {
        return LIST_DATA_WIDTH + this.childSlots.length * LIST_POINTER_WIDTH;
    };

    /**
     * Centre of the pointer cell a list link leaves from: next on the right of
     * the node, prev on the left.
     *
     * @param {object} node List node.
     * @param {string} slot 'next' or 'prev'.
     * @returns {object} Point.
     */
    DataStructureGraph.prototype.listPointerCentre = function(node, slot) {
        const bounds = this.nodeBounds(node);
        if (slot === 'prev') {
            return {x: bounds.left + LIST_POINTER_WIDTH / 2, y: node.y};
        }
        return {x: bounds.right - LIST_POINTER_WIDTH / 2, y: node.y};
    };

    DataStructureGraph.prototype.findEdgeAt = function(pos) {
        for (let i = this.edges.length - 1; i >= 0; i--) {
            const edge = this.edges[i];
            const geometry = this.edgeGeometry(edge);
            if (geometry && this.distanceToEdge(pos, geometry) <= HIT_PADDING) {
                return edge;
            }
        }
        return null;
    };

    DataStructureGraph.prototype.distanceToEdge = function(pos, geometry) {
        if (geometry.loop) {
            let bestLoop = Infinity;
            let prevLoop = geometry.start;
            for (let i = 1; i <= 24; i++) {
                const point = pointOnCubic(
                    geometry.start, geometry.control1, geometry.control2, geometry.end, i / 24
                );
                bestLoop = Math.min(bestLoop, distanceToSegment(pos, prevLoop, point));
                prevLoop = point;
            }
            return bestLoop;
        }
        if (Math.abs(geometry.curve) < 0.1) {
            return distanceToSegment(pos, geometry.start, geometry.end);
        }
        let best = Infinity;
        let previous = geometry.start;
        for (let i = 1; i <= 24; i++) {
            const point = pointOnQuadratic(geometry.start, geometry.control, geometry.end, i / 24);
            best = Math.min(best, distanceToSegment(pos, previous, point));
            previous = point;
        }
        return best;
    };

    DataStructureGraph.prototype.virtualBounds = function() {
        return {
            left: -VIRTUAL_MARGIN,
            top: -VIRTUAL_MARGIN,
            right: this.canvas[0].width + VIRTUAL_MARGIN,
            bottom: this.canvas[0].height + VIRTUAL_MARGIN
        };
    };

    DataStructureGraph.prototype.clampNode = function(node) {
        const bounds = this.nodeBounds(node);
        const halfWidth = bounds.width / 2;
        const halfHeight = bounds.height / 2;
        const limits = this.virtualBounds();
        node.x = Math.max(limits.left + halfWidth, Math.min(limits.right - halfWidth, node.x));
        node.y = Math.max(limits.top + halfHeight, Math.min(limits.bottom - halfHeight, node.y));
    };

    DataStructureGraph.prototype.updateProperties = function() {
        const selected = this.selectedObject();
        this.properties.empty();
        this.properties.append($('<h4></h4>').text(this.s('properties')));
        this.deleteButton.prop('disabled', this.readOnly || !this.selected);
        if (this.popButton) {
            this.popButton.prop('disabled', this.readOnly || this.lockNodeSet || this.nodes.length === 0);
        }
        if (!selected) {
            this.properties.append($('<div class="coderunner-datastructuregraph-empty"></div>').text(this.s('none')));
            return;
        }
        if (this.selected.type === 'node') {
            this.renderNodeProperties(selected);
        } else {
            this.renderEdgeProperties(selected);
        }
    };

    DataStructureGraph.prototype.renderNodeProperties = function(node) {
        const t = this;
        if (this.multiKeyNodes) {
            this.properties.append(this.multiKeyEditor(node));
        } else {
            this.properties.append(this.propertyInput(this.s('key'), node.key, this.lockNodeFields, function(value) {
                t.recordHistory('node-key:' + node.id);
                node.key = value;
                node.keys = [{key: value, value: t.cleanNodeValue(node.value)}];
                t.draw();
            }));
            if (this.showNodeValues) {
                this.properties.append(this.propertyInput(this.s('value'), node.value, this.lockNodeFields, function(value) {
                    t.recordHistory('node-value:' + node.id);
                    node.value = t.cleanNodeValue(value);
                    node.keys = [{key: node.key, value: node.value}];
                    t.draw();
                }));
            }
        }
        if (this.childSlots.length > 0 && !this.lockEdgeSet) {
            const title = this.mode === 'list' ? this.s('connectlink') : this.s('connectchild');
            this.properties.append(this.slotButtonRow(title, '', function(slot) {
                t.connectMode = true;
                t.startConnection(node, null, slot);
                t.draw();
            }));
        }
        if (this.allowNodeColors) {
            this.properties.append(this.propertySelect(this.s('color'), node.color, ['black', 'red'], this.lockNodeFields,
                function(value) {
                    t.recordHistory('node-color:' + node.id);
                    node.color = value;
                    t.draw();
                }));
        }
        if (this.isSequence) {
            const index = this.nodes.indexOf(node);
            const last = this.nodes.length - 1;
            let role = '';
            if (index === 0) {
                role = this.s(this.mode === 'stack' ? 'top' : 'head');
            } else if (index === last && this.mode === 'queue') {
                role = this.s('tail');
            }
            this.properties.append($('<div class="coderunner-datastructuregraph-endpoints"></div>')
                .text(this.s('position', index + 1) + ' / ' + (last + 1) + (role ? ' (' + role + ')' : '')));
        }
        this.properties.append($('<div class="coderunner-datastructuregraph-id"></div>').text(node.id));
    };

    DataStructureGraph.prototype.renderEdgeProperties = function(edge) {
        const t = this;
        const from = this.getNode(edge.from);
        const to = this.getNode(edge.to);
        const endpointText = (from ? this.nodeTitle(from) : edge.from) + ' -> ' + (to ? this.nodeTitle(to) : edge.to);
        this.properties.append($('<div class="coderunner-datastructuregraph-endpoints"></div>').text(endpointText));
        if (this.allowEdgeCosts) {
            this.properties.append(this.propertyInput(this.s('cost'), edge.cost, this.lockEdgeFields, function(value) {
                t.recordHistory('edge-cost:' + edge.id);
                edge.cost = value;
                t.draw();
            }));
        }
        if (this.childSlots.length > 0) {
            const title = this.mode === 'list' ? this.s('linkslot') : this.s('childslot');
            this.properties.append(this.slotButtonRow(title, edge.slot, function(value) {
                if (t.mode === 'list') {
                    if (value !== edge.slot) {
                        // Re-point through the other slot, which replaces any
                        // link that slot already had.
                        t.recordHistory();
                        const other = t.findLink(edge.from, value);
                        t.edges = t.edges.filter(function(candidate) {
                            return !other || candidate.id !== other.id;
                        });
                        edge.slot = value;
                        t.updateProperties();
                    }
                } else {
                    t.recordHistory();
                    edge.slot = value;
                }
                t.draw();
            }, this.lockEdgeFields));
        }
        if (this.allowEdgeColors) {
            this.properties.append(this.propertySelect(this.s('color'), edge.color, ['black', 'red'], this.lockEdgeFields,
                function(value) {
                    t.recordHistory('edge-color:' + edge.id);
                    edge.color = value;
                    t.draw();
                }));
        }
        this.properties.append($('<div class="coderunner-datastructuregraph-id"></div>').text(edge.id));
    };

    DataStructureGraph.prototype.multiKeyEditor = function(node) {
        const t = this;
        const panel = $('<div class="coderunner-datastructuregraph-multikey"></div>');
        const keys = this.nodeKeys(node);
        panel.append(
            $('<div class="coderunner-datastructuregraph-fieldtitle"></div>').text(
                this.showNodeValues ? this.s('keysvalues') : this.s('keys')
            )
        );
        keys.forEach(function(item, index) {
            const row = $('<div class="coderunner-datastructuregraph-keyrow"></div>');
            row.toggleClass('no-value', !t.showNodeValues);
            const keyInput = $('<input type="text" class="form-control form-control-sm">')
                .attr('aria-label', t.s('keylabel', index + 1))
                .val(item.key)
                .prop('disabled', t.readOnly || t.lockNodeFields)
                .on('input', function() {
                    t.recordHistory('node-keys:' + node.id + ':' + index + ':key');
                    item.key = $(this).val();
                    t.applyNodeKeys(node, keys);
                    t.draw();
                });
            const remove = $('<button type="button" class="btn btn-secondary btn-sm"></button>')
                .text(t.s('remove'))
                .prop('disabled', t.readOnly || t.lockNodeFields || keys.length <= 1)
                .on('click', function() {
                    t.recordHistory();
                    keys.splice(index, 1);
                    t.applyNodeKeys(node, keys);
                    t.updateProperties();
                    t.draw();
                });
            row.append(keyInput);
            if (t.showNodeValues) {
                const valueInput = $('<input type="text" class="form-control form-control-sm">')
                    .attr('aria-label', t.s('valuelabel', index + 1))
                    .val(item.value)
                    .prop('disabled', t.readOnly || t.lockNodeFields)
                    .on('input', function() {
                        t.recordHistory('node-keys:' + node.id + ':' + index + ':value');
                        item.value = $(this).val();
                        t.applyNodeKeys(node, keys);
                        t.draw();
                    });
                row.append(valueInput);
            }
            row.append(remove);
            panel.append(row);
        });
        const canAdd = this.maxNodeKeys === 0 || keys.length < this.maxNodeKeys;
        const add = $('<button type="button" class="btn btn-secondary btn-sm"></button>')
            .text(this.s('addkey'))
            .prop('disabled', this.readOnly || this.lockNodeFields || !canAdd)
            .on('click', function() {
                t.recordHistory();
                keys.push({key: '', value: ''});
                t.applyNodeKeys(node, keys);
                t.updateProperties();
                t.draw();
            });
        panel.append(add);
        return panel;
    };

    DataStructureGraph.prototype.slotButtonRow = function(label, value, onChange, disabled) {
        const row = $('<div class="coderunner-datastructuregraph-slotrow"></div>');
        row.append($('<div class="coderunner-datastructuregraph-fieldtitle"></div>').text(label));
        const buttons = $('<div class="coderunner-datastructuregraph-slotbuttons"></div>');
        this.childSlots.forEach(function(slot) {
            const button = $('<button type="button" class="btn btn-secondary btn-sm"></button>')
                .text(slot)
                .toggleClass('active', slot === value)
                .prop('disabled', this.readOnly || disabled)
                .on('click', function() {
                    onChange(slot);
                });
            buttons.append(button);
        });
        row.append(buttons);
        return row;
    };

    DataStructureGraph.prototype.propertyInput = function(label, value, disabled, onChange) {
        const fieldId = 'dsgraph_' + Math.random().toString(36).substring(2);
        const row = $('<label class="coderunner-datastructuregraph-field"></label>').attr('for', fieldId);
        const input = $('<input type="text" class="form-control form-control-sm">')
            .attr('id', fieldId)
            .val(value)
            .prop('disabled', this.readOnly || disabled)
            .on('input', function() {
                onChange($(this).val());
            });
        row.append($('<span></span>').text(label), input);
        return row;
    };

    DataStructureGraph.prototype.propertySelect = function(label, value, options, disabled, onChange) {
        const fieldId = 'dsgraph_' + Math.random().toString(36).substring(2);
        const row = $('<label class="coderunner-datastructuregraph-field"></label>').attr('for', fieldId);
        const select = $('<select class="form-select form-control form-control-sm"></select>')
            .attr('id', fieldId)
            .prop('disabled', this.readOnly || disabled)
            .on('change', function() {
                onChange($(this).val());
            });
        options.forEach(function(option) {
            select.append($('<option></option>').attr('value', option).text(option || '-'));
        });
        select.val(value);
        row.append($('<span></span>').text(label), select);
        return row;
    };

    DataStructureGraph.prototype.nodeTitle = function(node) {
        const keys = this.nodeKeys(node).map(function(item) {
            return item.key.trim();
        }).filter(function(key) {
            return key !== '';
        });
        return keys.join('|') || node.id;
    };

    DataStructureGraph.prototype.nodeKeys = function(node) {
        if (Array.isArray(node.keys) && node.keys.length > 0) {
            return node.keys.map(function(item) {
                return {key: cleanString(item.key), value: this.cleanNodeValue(item.value)};
            }, this);
        }
        return [{key: cleanString(node.key), value: this.cleanNodeValue(node.value)}];
    };

    DataStructureGraph.prototype.cleanNodeValue = function(value) {
        return this.showNodeValues ? cleanString(value) : '';
    };

    DataStructureGraph.prototype.applyNodeKeys = function(node, keys) {
        let cleaned = keys.map(function(item) {
            return {key: cleanString(item.key), value: this.cleanNodeValue(item.value)};
        }, this);
        if (this.maxNodeKeys > 0) {
            cleaned = cleaned.slice(0, this.maxNodeKeys);
        }
        node.keys = cleaned.length ? cleaned : [{key: '', value: ''}];
        node.key = node.keys[0].key;
        node.value = node.keys[0].value;
    };

    DataStructureGraph.prototype.draw = function() {
        if (!this.canvas) {
            return;
        }
        const canvas = this.canvas[0];
        const c = canvas.getContext('2d');
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, canvas.width, canvas.height);

        c.save();
        c.translate(this.viewOffset.x, this.viewOffset.y);
        c.scale(this.zoom, this.zoom);
        // List pointers are drawn over the boxes so each arrow visibly starts
        // at the dot in its pointer cell.
        const edgesOnTop = this.mode === 'list';
        this.drawStructureChrome(c, true);
        if (!edgesOnTop) {
            this.drawEdges(c);
        }
        for (let j = 0; j < this.nodes.length; j++) {
            if (this.nodes[j] !== this.draggingNode) {
                this.drawNode(c, this.nodes[j]);
            }
        }
        if (this.draggingNode) {
            // Keep the node being dragged on top of the others.
            this.drawNode(c, this.draggingNode);
        }
        if (edgesOnTop) {
            this.drawEdges(c);
        }
        this.drawStructureChrome(c, false);
        this.drawLinkPreview(c);
        c.restore();
        // Skip the JSON.stringify + textarea write (and the text-alternative
        // rebuild) while a drag or pan is in flight: those fire draw() on every
        // mouse-move frame. The final draw() once the interaction ends - and
        // destroy() - persist the settled state.
        if (!this.isInitialising && !this.isInteracting()) {
            this.sync();
            this.updateAccessibility();
        }
    };

    /**
     * Draw every edge.
     *
     * @param {CanvasRenderingContext2D} c Context.
     */
    DataStructureGraph.prototype.drawEdges = function(c) {
        for (let i = 0; i < this.edges.length; i++) {
            this.drawEdge(c, this.edges[i]);
        }
    };

    /**
     * Whether a continuous pointer interaction (node drag, canvas pan or link
     * drag) is currently in progress. Used to throttle expensive per-frame work.
     *
     * @returns {boolean}
     */
    DataStructureGraph.prototype.isInteracting = function() {
        return !!(this.draggingNode || this.panningCanvas || this.linkDragging);
    };

    DataStructureGraph.prototype.drawLinkPreview = function(c) {
        let source = this.linkSource ? this.getNode(this.linkSource) : null;
        let target = this.linkPreview;
        if (!source && this.isShiftDown) {
            source = this.shiftConnectSource();
            target = this.hoverWorld;
        }
        if (!source) {
            return;
        }
        target = this.previewPointForNode(source, target);
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const start = this.edgeEndpoint(source, dx / len, dy / len);
        c.save();
        c.setLineDash([6, 4]);
        c.strokeStyle = LINK_SOURCE;
        c.fillStyle = LINK_SOURCE;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(start.x, start.y);
        c.lineTo(target.x, target.y);
        c.stroke();
        c.beginPath();
        c.arc(target.x, target.y, 3, 0, Math.PI * 2);
        c.fill();
        c.restore();
    };

    DataStructureGraph.prototype.previewPointForNode = function(node, point) {
        if (point && !this.pointInNode(point, node) && distance(point, node) > 12) {
            return point;
        }
        const bounds = this.nodeBounds(node);
        const visible = this.visibleWorldBounds();
        if (bounds.right + 64 <= visible.right) {
            return {x: bounds.right + 48, y: node.y};
        }
        if (bounds.left - 64 >= visible.left) {
            return {x: bounds.left - 48, y: node.y};
        }
        return {x: node.x, y: bounds.bottom + 48};
    };

    DataStructureGraph.prototype.drawNode = function(c, node) {
        const selected = this.selected && this.selected.type === 'node' && this.selected.id === node.id;
        if (this.mode === 'list') {
            this.drawListNode(c, node, selected);
            return;
        }
        if (this.isSequence) {
            this.drawCellNode(c, node, selected);
            return;
        }
        if (this.multiKeyNodes) {
            this.drawRecordNode(c, node, selected);
            return;
        }
        const isLinkSource = this.linkSource === node.id;
        const colored = this.allowNodeColors || node.color === 'red';
        c.save();
        c.beginPath();
        c.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2);
        c.fillStyle = colored ? edgeStroke(node.color) : NODE_FILL;
        c.strokeStyle = isLinkSource ? LINK_SOURCE : selected ? SELECTED : BLACK;
        c.lineWidth = isLinkSource || selected ? 3 : 1.5;
        c.fill();
        c.stroke();

        c.fillStyle = colored && node.color === 'black' ? '#ffffff' : BLACK;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = 'bold 14px Arial';
        const key = node.key.trim() || node.id;
        const value = this.cleanNodeValue(node.value);
        c.fillText(this.truncateText(c, key, NODE_RADIUS * 1.6), node.x, value ? node.y - 7 : node.y);
        if (value) {
            c.font = '12px Arial';
            c.fillText(this.truncateText(c, value, NODE_RADIUS * 1.6), node.x, node.y + 11);
        }
        c.restore();
    };

    /**
     * Draw the key (and value, when enabled) of a node centred in a box.
     *
     * @param {CanvasRenderingContext2D} c Context.
     * @param {object} node Node.
     * @param {number} cx Centre x.
     * @param {number} maxWidth Maximum text width.
     */
    DataStructureGraph.prototype.drawBoxText = function(c, node, cx, maxWidth) {
        const key = node.key.trim();
        const value = this.cleanNodeValue(node.value);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = 'bold 14px Arial';
        if (!key) {
            c.fillStyle = '#98a2b3';
        }
        c.fillText(this.truncateText(c, key || '?', maxWidth), cx, value ? node.y - 8 : node.y);
        if (value) {
            c.font = '12px Arial';
            c.fillText(this.truncateText(c, value, maxWidth), cx, node.y + 10);
        }
    };

    /**
     * Fill and outline a node box, honouring colours, selection and link source.
     *
     * @param {CanvasRenderingContext2D} c Context.
     * @param {object} node Node.
     * @param {object} bounds Node bounds.
     * @param {boolean} selected Whether the node is selected.
     */
    DataStructureGraph.prototype.drawNodeBox = function(c, node, bounds, selected) {
        const isLinkSource = this.linkSource === node.id;
        const colored = this.allowNodeColors || node.color === 'red';
        c.fillStyle = colored ? edgeStroke(node.color) : NODE_FILL;
        c.strokeStyle = BLACK;
        if (isLinkSource || selected) {
            c.strokeStyle = isLinkSource ? LINK_SOURCE : SELECTED;
        }
        c.lineWidth = isLinkSource || selected ? 3 : 1.5;
        c.beginPath();
        c.rect(bounds.left, bounds.top, bounds.width, bounds.height);
        c.fill();
        c.stroke();
        c.fillStyle = colored && node.color === 'black' ? '#ffffff' : BLACK;
    };

    /**
     * Draw a box-and-pointer linked-list node: [prev |] data | next. A pointer
     * cell holds a dot when its link is set, or a diagonal slash for null.
     *
     * @param {CanvasRenderingContext2D} c Context.
     * @param {object} node Node.
     * @param {boolean} selected Whether the node is selected.
     */
    DataStructureGraph.prototype.drawListNode = function(c, node, selected) {
        const bounds = this.nodeBounds(node);
        const doubly = this.childSlots.indexOf('prev') !== -1;
        c.save();
        this.drawNodeBox(c, node, bounds, selected);
        const textColor = c.fillStyle;
        const dataLeft = bounds.left + (doubly ? LIST_POINTER_WIDTH : 0);
        this.drawBoxText(c, node, dataLeft + LIST_DATA_WIDTH / 2, LIST_DATA_WIDTH - 8);
        const cells = [{slot: 'next', left: bounds.right - LIST_POINTER_WIDTH}];
        if (doubly) {
            cells.push({slot: 'prev', left: bounds.left});
        }
        cells.forEach(function(cell) {
            const divider = cell.slot === 'next' ? cell.left : cell.left + LIST_POINTER_WIDTH;
            c.strokeStyle = BLACK;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(divider, bounds.top);
            c.lineTo(divider, bounds.bottom);
            c.stroke();
            c.strokeStyle = textColor;
            c.fillStyle = textColor;
            if (this.findLink(node.id, cell.slot)) {
                c.beginPath();
                c.arc(cell.left + LIST_POINTER_WIDTH / 2, node.y, 3.5, 0, Math.PI * 2);
                c.fill();
            } else if (this.showNull) {
                c.beginPath();
                c.moveTo(cell.left + 4, bounds.bottom - 4);
                c.lineTo(cell.left + LIST_POINTER_WIDTH - 4, bounds.top + 4);
                c.stroke();
            }
        }, this);
        c.restore();
    };

    /**
     * Draw a stack or queue element as a plain cell.
     *
     * @param {CanvasRenderingContext2D} c Context.
     * @param {object} node Node.
     * @param {boolean} selected Whether the node is selected.
     */
    DataStructureGraph.prototype.drawCellNode = function(c, node, selected) {
        const bounds = this.nodeBounds(node);
        c.save();
        if (this.draggingNode === node) {
            c.shadowColor = 'rgba(16, 24, 40, 0.25)';
            c.shadowBlur = 10;
        }
        this.drawNodeBox(c, node, bounds, selected);
        c.shadowBlur = 0;
        this.drawBoxText(c, node, node.x, bounds.width - 12);
        c.restore();
    };

    /**
     * Draw a small text label with an arrow pointing at a node, used for the
     * head/tail/top markers.
     *
     * @param {CanvasRenderingContext2D} c Context.
     * @param {string} text Label.
     * @param {object} from Where the label sits.
     * @param {object} to Arrow tip.
     */
    DataStructureGraph.prototype.drawMarker = function(c, text, from, to) {
        c.save();
        c.strokeStyle = MARKER;
        c.fillStyle = MARKER;
        c.lineWidth = 1.5;
        c.font = 'italic 12px Arial';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const gap = Math.abs(dx) > Math.abs(dy) ? c.measureText(text).width / 2 + 4 : 9;
        c.fillText(text, from.x, from.y);
        c.beginPath();
        c.moveTo(from.x + dx / len * gap, from.y + dy / len * gap);
        c.lineTo(to.x, to.y);
        c.stroke();
        this.drawArrow(c, to, Math.atan2(dy, dx));
        c.restore();
    };

    /**
     * Draw the structure-specific decorations: head/tail markers for linked
     * lists, the container of a stack and the rails of a queue.
     *
     * @param {CanvasRenderingContext2D} c Context.
     * @param {boolean} beforeNodes True for the pass drawn beneath the nodes.
     */
    DataStructureGraph.prototype.drawStructureChrome = function(c, beforeNodes) {
        if (this.mode === 'list') {
            if (!beforeNodes && this.showHeadTail && this.nodes.length) {
                const order = this.listOrder();
                if (order.heads.length === 1) {
                    const head = this.nodeBounds(order.heads[0]);
                    const x = order.heads[0].x;
                    this.drawMarker(c, this.s('head'), {x: x, y: head.top - 30}, {x: x, y: head.top - 2});
                }
                if (order.tails.length === 1) {
                    const tail = this.nodeBounds(order.tails[0]);
                    const x = order.tails[0].x;
                    this.drawMarker(c, this.s('tail'), {x: x, y: tail.bottom + 30}, {x: x, y: tail.bottom + 2});
                }
            }
            return;
        }
        if (!this.isSequence) {
            return;
        }
        const count = this.nodes.length;
        const first = this.sequencePosition(0);
        const last = this.sequencePosition(Math.max(0, count - 1));
        c.save();
        c.strokeStyle = MARKER;
        c.fillStyle = MARKER;
        c.lineWidth = 3;
        c.lineCap = 'round';
        if (this.mode === 'stack') {
            // An open-topped container around the cells, a little taller than
            // its contents so the top of the stack is visibly open.
            const half = STACK_CELL_WIDTH / 2 + 6;
            const bottom = last.y + STACK_CELL_HEIGHT / 2 + 5;
            const top = (count ? first.y : last.y) - STACK_CELL_HEIGHT / 2 - STACK_CELL_HEIGHT * 0.6;
            if (beforeNodes) {
                c.beginPath();
                c.moveTo(last.x - half, top);
                c.lineTo(last.x - half, bottom);
                c.lineTo(last.x + half, bottom);
                c.lineTo(last.x + half, top);
                c.stroke();
                if (!count) {
                    c.font = 'italic 12px Arial';
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.fillText(this.s('empty'), last.x, last.y);
                }
            } else if (this.showHeadTail && count) {
                const tipX = first.x - half - 6;
                this.drawMarker(c, this.s('top'), {x: tipX - 50, y: first.y}, {x: tipX, y: first.y});
            }
        } else {
            // Rails above and below the cells, open at both ends like a pipe.
            const left = first.x - QUEUE_CELL_WIDTH / 2 - 14;
            const right = last.x + QUEUE_CELL_WIDTH / 2 + 14;
            const railTop = first.y - QUEUE_CELL_HEIGHT / 2 - 5;
            const railBottom = first.y + QUEUE_CELL_HEIGHT / 2 + 5;
            if (beforeNodes) {
                c.beginPath();
                c.moveTo(left, railTop);
                c.lineTo(right, railTop);
                c.moveTo(left, railBottom);
                c.lineTo(right, railBottom);
                c.stroke();
                if (!count) {
                    c.font = 'italic 12px Arial';
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.fillText(this.s('empty'), first.x, first.y);
                }
            } else if (this.showHeadTail && count) {
                const markerY = railBottom + 34;
                this.drawMarker(c, this.s('head'), {x: first.x, y: markerY}, {x: first.x, y: railBottom + 3});
                if (count > 1) {
                    this.drawMarker(c, this.s('tail'), {x: last.x, y: markerY}, {x: last.x, y: railBottom + 3});
                } else {
                    c.font = 'italic 12px Arial';
                    c.textAlign = 'center';
                    c.fillText('/ ' + this.s('tail'), first.x, markerY + 14);
                }
            }
        }
        c.restore();
    };

    DataStructureGraph.prototype.drawRecordNode = function(c, node, selected) {
        const keys = this.nodeKeys(node);
        const bounds = this.nodeBounds(node);
        const isLinkSource = this.linkSource === node.id;
        const colored = this.allowNodeColors || node.color === 'red';
        c.save();
        c.fillStyle = colored ? edgeStroke(node.color) : NODE_FILL;
        c.strokeStyle = isLinkSource ? LINK_SOURCE : selected ? SELECTED : BLACK;
        c.lineWidth = isLinkSource || selected ? 3 : 1.5;
        c.beginPath();
        c.rect(bounds.left, bounds.top, bounds.width, bounds.height);
        c.fill();
        c.stroke();
        c.fillStyle = colored && node.color === 'black' ? '#ffffff' : BLACK;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (let i = 0; i < keys.length; i++) {
            const x = bounds.left + i * RECORD_CELL_WIDTH;
            if (i > 0) {
                c.beginPath();
                c.moveTo(x, bounds.top);
                c.lineTo(x, bounds.bottom);
                c.strokeStyle = '#d0d5dd';
                c.lineWidth = 1;
                c.stroke();
            }
            c.font = 'bold 13px Arial';
            const value = this.cleanNodeValue(keys[i].value);
            c.fillText(
                this.truncateText(c, keys[i].key || '-', RECORD_CELL_WIDTH - 8),
                x + RECORD_CELL_WIDTH / 2,
                value ? node.y - 8 : node.y
            );
            if (value) {
                c.font = '11px Arial';
                c.fillText(this.truncateText(c, value, RECORD_CELL_WIDTH - 8), x + RECORD_CELL_WIDTH / 2, node.y + 10);
            }
        }
        c.restore();
    };

    DataStructureGraph.prototype.drawEdge = function(c, edge) {
        const geometry = this.edgeGeometry(edge);
        if (!geometry) {
            return;
        }
        const selected = this.selected && this.selected.type === 'edge' && this.selected.id === edge.id;

        c.save();
        c.strokeStyle = selected ? SELECTED : edgeStroke(edge.color);
        c.fillStyle = c.strokeStyle;
        c.lineWidth = selected ? 3 : 2;
        c.beginPath();
        c.moveTo(geometry.start.x, geometry.start.y);
        if (geometry.loop) {
            c.bezierCurveTo(
                geometry.control1.x, geometry.control1.y,
                geometry.control2.x, geometry.control2.y,
                geometry.end.x, geometry.end.y
            );
        } else if (Math.abs(geometry.curve) < 0.1) {
            c.lineTo(geometry.end.x, geometry.end.y);
        } else {
            c.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.end.x, geometry.end.y);
        }
        c.stroke();
        if (this.isDirected) {
            this.drawArrow(c, geometry.end, geometry.endAngle);
        }
        this.drawEdgeLabel(c, edge, geometry);
        c.restore();
    };

    DataStructureGraph.prototype.edgeGeometry = function(edge) {
        const from = this.getNode(edge.from);
        const to = this.getNode(edge.to);
        if (!from || !to) {
            return null;
        }
        if (this.mode === 'list') {
            return edge.from === edge.to ? null : this.listEdgeGeometry(edge, from, to);
        }
        if (edge.from === edge.to) {
            // Self-loops are a graph concept; a tree can't have one, so don't
            // render a stray loop that slipped in through imported data.
            return this.mode === 'tree' ? null : this.selfLoopGeometry(from, edge);
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ux = dx / len;
        const uy = dy / len;
        const start = this.edgeEndpoint(from, ux, uy);
        const end = this.edgeEndpoint(to, -ux, -uy);
        const curve = this.edgeCurveOffset(edge);
        const mid = {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2};
        const normal = {x: -uy, y: ux};
        const control = {
            x: mid.x + normal.x * curve,
            y: mid.y + normal.y * curve
        };
        const endAngle = Math.atan2(end.y - control.y, end.x - control.x);
        return {
            start: start,
            end: end,
            control: control,
            curve: curve,
            endAngle: endAngle
        };
    };

    /**
     * Geometry for a linked-list pointer: a straight arrow from the dot in the
     * source's pointer cell to the edge of the target box. In a doubly linked
     * list next arrows arrive slightly above centre and prev arrows slightly
     * below, so a pair of links between neighbours reads as two lanes.
     *
     * @param {object} edge The link.
     * @param {object} from Source node.
     * @param {object} to Target node.
     * @returns {object}
     */
    DataStructureGraph.prototype.listEdgeGeometry = function(edge, from, to) {
        const slot = edge.slot || 'next';
        const start = this.listPointerCentre(from, slot);
        let lane = 0;
        if (this.listKind === 'doubly') {
            lane = slot === 'prev' ? LIST_LANE : -LIST_LANE;
        }
        const aim = {x: to.x, y: to.y + lane};
        const dx = aim.x - start.x;
        const dy = aim.y - start.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ux = dx / len;
        const uy = dy / len;
        // Walk back from the aim point (inside the target box) to where the
        // arrow crosses the box outline.
        const bounds = this.nodeBounds(to);
        const sx = ux === 0 ? Infinity : Math.abs((ux > 0 ? aim.x - bounds.left : bounds.right - aim.x) / ux);
        const sy = uy === 0 ? Infinity : Math.abs((uy > 0 ? aim.y - bounds.top : bounds.bottom - aim.y) / uy);
        const back = Math.min(sx, sy, len);
        const end = {x: aim.x - ux * back, y: aim.y - uy * back};
        return {
            start: start,
            end: end,
            control: {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2},
            curve: 0,
            endAngle: Math.atan2(uy, ux)
        };
    };

    /**
     * Geometry for a self-loop edge: a cubic Bezier that leaves the node and
     * returns to it. Multiple loops on the same node are fanned out around it.
     *
     * @param {object} node The node the loop belongs to.
     * @param {object} edge The self-loop edge.
     * @returns {object} Geometry with a loop flag and both cubic control points.
     */
    DataStructureGraph.prototype.selfLoopGeometry = function(node, edge) {
        const loops = this.edges.filter(function(candidate) {
            return candidate.from === node.id && candidate.to === node.id;
        });
        let index = 0;
        for (let i = 0; i < loops.length; i++) {
            if (loops[i].id === edge.id) {
                index = i;
                break;
            }
        }
        // Fan successive loops around the node, the first pointing straight up.
        const baseAngle = -Math.PI / 2 + (index - (loops.length - 1) / 2) * (Math.PI / 3);
        // Narrow anchors and control points that reach well out (rather than
        // splaying sideways) give a round loop, as tall as it is wide, instead of
        // a flat ellipse hugging the node.
        const anchorSpread = 0.35;
        const cpSpread = 0.6;
        const loopSize = NODE_RADIUS * 4.0;
        const dir = function(angle) {
            return {x: Math.cos(angle), y: Math.sin(angle)};
        };
        const a1 = dir(baseAngle - anchorSpread);
        const a2 = dir(baseAngle + anchorSpread);
        const start = this.edgeEndpoint(node, a1.x, a1.y);
        const end = this.edgeEndpoint(node, a2.x, a2.y);
        const control1 = {
            x: node.x + Math.cos(baseAngle - cpSpread) * loopSize,
            y: node.y + Math.sin(baseAngle - cpSpread) * loopSize
        };
        const control2 = {
            x: node.x + Math.cos(baseAngle + cpSpread) * loopSize,
            y: node.y + Math.sin(baseAngle + cpSpread) * loopSize
        };
        return {
            loop: true,
            start: start,
            end: end,
            control1: control1,
            control2: control2,
            curve: 1,
            labelPoint: pointOnCubic(start, control1, control2, end, 0.5),
            endAngle: Math.atan2(end.y - control2.y, end.x - control2.x)
        };
    };

    DataStructureGraph.prototype.edgeCurveOffset = function(edge) {
        if (this.mode === 'tree') {
            return 0;
        }
        // Every edge joining the same unordered pair of nodes, in either
        // direction, shares one fan of curves.
        const low = edge.from < edge.to ? edge.from : edge.to;
        const high = edge.from < edge.to ? edge.to : edge.from;
        const group = this.edges.filter(function(candidate) {
            const clow = candidate.from < candidate.to ? candidate.from : candidate.to;
            const chigh = candidate.from < candidate.to ? candidate.to : candidate.from;
            return clow === low && chigh === high;
        });
        if (group.length <= 1) {
            return 0;
        }
        let index = 0;
        for (let i = 0; i < group.length; i++) {
            if (group[i].id === edge.id) {
                index = i;
                break;
            }
        }
        // Spread the edges into symmetric lanes. A quadratic curve bulges by half
        // its control offset, so the lane width is doubled to keep neighbouring
        // edges clearly apart rather than merged into one thick curve.
        const LANE = 44;
        const visual = (index - (group.length - 1) / 2) * LANE;
        // The draw step multiplies this by a normal that flips with the edge's
        // direction, so reversed edges are negated to keep each lane on the same
        // visual side of the pair.
        return edge.from < edge.to ? visual : -visual;
    };

    DataStructureGraph.prototype.edgeEndpoint = function(node, ux, uy) {
        if (this.usesCircleNodes()) {
            return {
                x: node.x + ux * NODE_RADIUS,
                y: node.y + uy * NODE_RADIUS
            };
        }
        const bounds = this.nodeBounds(node);
        const halfWidth = bounds.width / 2;
        const halfHeight = bounds.height / 2;
        const scale = Math.min(
            ux === 0 ? Infinity : Math.abs(halfWidth / ux),
            uy === 0 ? Infinity : Math.abs(halfHeight / uy)
        );
        return {
            x: node.x + ux * scale,
            y: node.y + uy * scale
        };
    };

    DataStructureGraph.prototype.drawArrow = function(c, point, angle) {
        const size = 10;
        c.beginPath();
        c.moveTo(point.x, point.y);
        c.lineTo(point.x - size * Math.cos(angle - Math.PI / 6), point.y - size * Math.sin(angle - Math.PI / 6));
        c.lineTo(point.x - size * Math.cos(angle + Math.PI / 6), point.y - size * Math.sin(angle + Math.PI / 6));
        c.closePath();
        c.fill();
    };

    DataStructureGraph.prototype.drawEdgeLabel = function(c, edge, geometry) {
        const parts = [];
        // List links are identified by the pointer cell they leave from, so
        // their next/prev slot needs no label.
        if (edge.slot && this.mode !== 'list') {
            parts.push(edge.slot);
        }
        if (edge.cost) {
            parts.push(edge.cost);
        }
        if (parts.length === 0) {
            return;
        }
        const text = parts.join(': ');
        let point;
        if (geometry.loop) {
            point = geometry.labelPoint;
        } else if (Math.abs(geometry.curve) < 0.1) {
            point = {x: (geometry.start.x + geometry.end.x) / 2, y: (geometry.start.y + geometry.end.y) / 2};
        } else {
            point = pointOnQuadratic(geometry.start, geometry.control, geometry.end, 0.5);
        }
        const x = point.x;
        const y = point.y;
        c.font = '12px Arial';
        const width = c.measureText(text).width + 8;
        c.fillStyle = 'rgba(255, 255, 255, 0.85)';
        c.fillRect(x - width / 2, y - 11, width, 18);
        c.strokeStyle = '#d0d5dd';
        c.lineWidth = 1;
        c.strokeRect(x - width / 2, y - 11, width, 18);
        c.fillStyle = BLACK;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(text, x, y - 1);
    };

    DataStructureGraph.prototype.truncateText = function(c, text, maxWidth) {
        text = cleanString(text);
        if (c.measureText(text).width <= maxWidth) {
            return text;
        }
        let result = text;
        while (result.length > 1 && c.measureText(result + '...').width > maxWidth) {
            result = result.substring(0, result.length - 1);
        }
        return result + '...';
    };

    DataStructureGraph.prototype.autoLayout = function() {
        if (this.readOnly || this.lockNodePositions || this.nodes.length === 0) {
            return;
        }
        this.recordHistory();
        if (this.isSequence) {
            this.layoutSequence();
        } else if (this.mode === 'list') {
            this.autoLayoutList();
        } else if (this.mode === 'tree') {
            this.autoLayoutTree();
        } else {
            this.autoLayoutCircle();
        }
        this.resetView(false);
        if (this.isLinear) {
            this.fitView();
        }
        this.draw();
    };

    /**
     * Lay a linked list out left to right in reading order, starting from the
     * head. Nodes that are not reachable from the head follow on a second row.
     */
    DataStructureGraph.prototype.autoLayoutList = function() {
        const order = this.listOrder();
        const pitch = this.listNodeWidth() + LIST_GAP;
        const originX = 40 + this.listNodeWidth() / 2;
        const originY = Math.max(90, Math.round(this.canvas[0].height / 2) - (order.detached.length ? 50 : 0));
        order.chain.forEach(function(node, index) {
            node.x = originX + index * pitch;
            node.y = originY;
        });
        order.detached.forEach(function(node, index) {
            node.x = originX + index * pitch;
            node.y = originY + LIST_HEIGHT + 90;
        });
    };

    DataStructureGraph.prototype.autoLayoutCircle = function() {
        const width = this.canvas[0].width;
        const height = this.canvas[0].height;
        const cx = width / 2;
        const cy = height / 2;
        const r = Math.max(40, Math.min(width, height) / 2 - NODE_RADIUS - 12);
        for (let i = 0; i < this.nodes.length; i++) {
            const angle = -Math.PI / 2 + (Math.PI * 2 * i / this.nodes.length);
            this.nodes[i].x = cx + r * Math.cos(angle);
            this.nodes[i].y = cy + r * Math.sin(angle);
        }
    };

    /**
     * Tidy tree layout (Reingold-Tilford). Each subtree is allocated horizontal
     * space proportional to its own width using left/right contours, and every
     * parent is centred over its children. This keeps children beneath their
     * parents and avoids the edge crossings produced by a plain level-by-level
     * spread. Forests (multiple roots, disconnected pieces or cycles) are packed
     * side by side.
     */
    DataStructureGraph.prototype.autoLayoutTree = function() {
        const t = this;
        const nodeById = {};
        this.nodes.forEach(function(node) {
            nodeById[node.id] = node;
        });

        // Order the edges leaving each node by child slot (e.g. left before
        // right) when the tree defines slots, then by target id for stability.
        const slotOrder = {};
        this.childSlots.forEach(function(slot, index) {
            slotOrder[slot] = index;
        });
        const outEdges = {};
        this.edges.forEach(function(edge) {
            (outEdges[edge.from] = outEdges[edge.from] || []).push(edge);
        });

        // Build an ordered child list per node, visiting each node at most once
        // so cycles or shared children can't cause infinite recursion. The slot
        // ('left'/'right'/...) of the connecting edge is remembered per child so
        // the layout can keep labelled children on their side of the parent.
        const visited = {};
        const childrenOf = {};
        const childSlotOf = {};
        const buildChildren = function(node) {
            const edges = (outEdges[node.id] || []).slice();
            edges.sort(function(a, b) {
                const sa = slotOrder.hasOwnProperty(a.slot) ? slotOrder[a.slot] : (a.slot ? 900 : 999);
                const sb = slotOrder.hasOwnProperty(b.slot) ? slotOrder[b.slot] : (b.slot ? 900 : 999);
                if (sa !== sb) {
                    return sa - sb;
                }
                return String(a.to).localeCompare(String(b.to));
            });
            const kids = [];
            edges.forEach(function(edge) {
                const child = nodeById[edge.to];
                if (child && !visited[child.id]) {
                    visited[child.id] = true;
                    childSlotOf[child.id] = edge.slot;
                    kids.push(child);
                }
            });
            childrenOf[node.id] = kids;
            kids.forEach(buildChildren);
        };

        // Roots are nodes with no parent; any node still unvisited afterwards
        // (a disconnected piece or a member of a cycle) becomes its own root so
        // that every node is placed exactly once.
        const orderedRoots = [];
        const takeRoot = function(node) {
            if (!visited[node.id]) {
                visited[node.id] = true;
                orderedRoots.push(node);
                buildChildren(node);
            }
        };
        this.findTreeRoots().sort(function(a, b) {
            return String(a.id).localeCompare(String(b.id));
        }).forEach(takeRoot);
        this.nodes.forEach(takeRoot);

        // First walk: compute each child's horizontal offset from its parent and
        // return the subtree's contour (root at x = 0). Index d of a contour is
        // the min (left) or max (right) x found at relative depth d.
        const SEP = 1;
        const layout = function(node, depth) {
            node._depth = depth;
            const kids = childrenOf[node.id];
            if (kids.length === 0) {
                return {left: [0], right: [0]};
            }
            const kidContours = [];
            const positions = [];
            let accLeft = null;
            let accRight = null;
            for (let i = 0; i < kids.length; i++) {
                const c = layout(kids[i], depth + 1);
                kidContours.push(c);
                // Shift this child right until its left contour clears the right
                // contour of everything already placed, keeping SEP between them.
                let pos = 0;
                if (accRight) {
                    const overlap = Math.min(accRight.length, c.left.length);
                    for (let d = 0; d < overlap; d++) {
                        pos = Math.max(pos, accRight[d] - c.left[d] + SEP);
                    }
                }
                positions.push(pos);
                if (!accLeft) {
                    accLeft = c.left.map(function(v) {
                        return v + pos;
                    });
                    accRight = c.right.map(function(v) {
                        return v + pos;
                    });
                } else {
                    for (let d = 0; d < c.left.length; d++) {
                        const l = c.left[d] + pos;
                        const r = c.right[d] + pos;
                        if (d < accLeft.length) {
                            accLeft[d] = Math.min(accLeft[d], l);
                            accRight[d] = Math.max(accRight[d], r);
                        } else {
                            accLeft[d] = l;
                            accRight[d] = r;
                        }
                    }
                }
            }
            // Position the parent over its children. Children whose connecting
            // link is labelled 'left'/'right' are kept on that side: with only a
            // left child the parent sits to its right (and vice versa) rather
            // than directly above it, so the side is still legible. Unlabelled
            // children fall back to centring over the span of the child roots.
            let leftMax = null;
            let rightMin = null;
            for (let i = 0; i < kids.length; i++) {
                const slot = childSlotOf[kids[i].id];
                if (slot === 'left') {
                    leftMax = leftMax === null ? positions[i] : Math.max(leftMax, positions[i]);
                } else if (slot === 'right') {
                    rightMin = rightMin === null ? positions[i] : Math.min(rightMin, positions[i]);
                }
            }
            let mid;
            if (leftMax !== null && rightMin !== null) {
                mid = (leftMax + rightMin) / 2;
            } else if (leftMax !== null) {
                mid = leftMax + SEP / 2;
            } else if (rightMin !== null) {
                mid = rightMin - SEP / 2;
            } else {
                mid = (positions[0] + positions[positions.length - 1]) / 2;
            }
            const left = [0];
            const right = [0];
            for (let i = 0; i < kids.length; i++) {
                const off = positions[i] - mid;
                kids[i]._rel = off;
                const c = kidContours[i];
                for (let d = 0; d < c.left.length; d++) {
                    const depthIndex = d + 1;
                    const l = c.left[d] + off;
                    const r = c.right[d] + off;
                    if (depthIndex < left.length) {
                        left[depthIndex] = Math.min(left[depthIndex], l);
                        right[depthIndex] = Math.max(right[depthIndex], r);
                    } else {
                        left[depthIndex] = l;
                        right[depthIndex] = r;
                    }
                }
            }
            return {left: left, right: right};
        };

        // Second walk: turn relative offsets into absolute column positions and
        // pack the trees of the forest left-to-right with a gap between them.
        const TREE_GAP = 1.5;
        let cursor = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        const assign = function(node, x) {
            node._absX = x;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            childrenOf[node.id].forEach(function(child) {
                assign(child, x + child._rel);
            });
        };
        orderedRoots.forEach(function(root) {
            const contour = layout(root, 0);
            let treeMin = Infinity;
            let treeMax = -Infinity;
            for (let d = 0; d < contour.left.length; d++) {
                treeMin = Math.min(treeMin, contour.left[d]);
                treeMax = Math.max(treeMax, contour.right[d]);
            }
            const shift = cursor - treeMin;
            assign(root, shift);
            cursor = treeMax + shift + TREE_GAP;
        });

        // Convert column units into canvas pixels, centred horizontally.
        let maxNodeWidth = 0;
        let maxNodeHeight = 0;
        this.nodes.forEach(function(node) {
            const bounds = t.nodeBounds(node);
            maxNodeWidth = Math.max(maxNodeWidth, bounds.width);
            maxNodeHeight = Math.max(maxNodeHeight, bounds.height);
        });
        const hSpacing = Math.max(70, maxNodeWidth + 26);
        const vSpacing = Math.max(84, maxNodeHeight + 46);
        const contentWidth = (maxX - minX) * hSpacing;
        const originX = Math.max(hSpacing / 2 + 8, (this.canvas[0].width - contentWidth) / 2);
        const originY = 55;
        this.nodes.forEach(function(node) {
            if (node._absX === undefined) {
                return;
            }
            node.x = originX + (node._absX - minX) * hSpacing;
            node.y = originY + node._depth * vSpacing;
            delete node._depth;
            delete node._rel;
            delete node._absX;
        });
    };

    DataStructureGraph.prototype.findTreeRoots = function() {
        const incoming = {};
        this.edges.forEach(function(edge) {
            incoming[edge.to] = true;
        });
        return this.nodes.filter(function(node) {
            return !incoming[node.id];
        });
    };

    return {
        Constructor: DataStructureGraph,
        escapeHtml: escapeHtml
    };
});
