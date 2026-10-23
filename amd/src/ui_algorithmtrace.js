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
 * Algorithm trace UI: the student shows the state of an array (and, for some
 * algorithms, pointers or variables) after each step of an algorithm.
 *
 * The question's UI parameters name the algorithm, its input data and which
 * steps to ask for. The UI shows the input, then one editable row of cells per
 * step. Students drag a cell onto another to swap them, drag it onto the gap
 * between two cells to move it there, or type values. Pointers such as lo, mid
 * and hi are chips placed under the array.
 *
 * The answer is serialised as
 * {"type": "coderunner-algorithm-trace", "version": 1, "algorithm": "quick_sort",
 *  "steps": [{"array": ["1", "4", ...], "lo": 0, "pivot": "5"}, ...]}
 * holding, for each step, the components being graded. The algorithm lets the
 * question editor spot an answer written for a different algorithm. An
 * untouched answer serialises as the empty string.
 *
 * The expected answer is computed by the algorithm_trace prototype's grader,
 * which has the matching algorithm schemas (see builtinSchema below).
 *
 * @module qtype_coderunner/ui_algorithmtrace
 * @copyright  2026
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define(['core/str', 'core/ajax'], function(Str, Ajax) {

    const SERIALISATION_TYPE = 'coderunner-algorithm-trace';
    const SERIALISATION_VERSION = 1;
    // Both must match the constants in the prototype's grader.
    const MAX_ITEMS = 200;
    const MAX_STEPS = 500;
    // Plain decimal numbers only, as NUMBER_PATTERN in the prototype's grader.
    const NUMBER_PATTERN = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/;
    const MAX_HISTORY = 100;
    const DRAG_THRESHOLD = 5;
    // Drops within this fraction of a cell's width from either edge move the
    // value into the gap there, rather than swapping with the cell.
    const EDGE_FRACTION = 0.25;

    const STRING_PREFIX = 'algorithmtrace_ui_';
    // The question editor's answer fields, where teachers can fill in the correct answer.
    const EDITOR_FIELDS = ['id_answer', 'id_answerpreload'];

    const STRING_DEFAULTS = {
        fillall: 'all',
        fillhelp: 'Teachers only: works out the correct steps from the algorithm and data. Leave Steps empty for all of ' +
            'them, or give a number to fill in only the first steps (for example, to give students a head start in the ' +
            'answer preload). If the data are randomised, students get different data, so leave the sample answer empty.',
        filling: 'Working it out...',
        filled: 'Filled in {$a} steps.',
        fillfailed: 'Could not fill in the answer: {$a}',
        cleared: 'The algorithm has changed, so the answer for {$a} was cleared.',
        randomisetitle: 'Give each student different data',
        randomisestep1: '1. Tick "Twig all" (next to the template parameters).',
        randomisestep2: '2. Paste this into Template parameters:',
        randomisestep3: '3. Paste this into UI parameters, replacing what is there:',
        randomisenote: 'Template parameters may not use UI parameter names, so the random values are called randomdata ' +
            'and randomtarget, and the UI parameters insert them. Students see the target above their answer; you can ' +
            'also put it in the question text with {{ randomtarget }}. If the template parameters already hold other ' +
            'settings, such as feedbackdetail, ' +
            'merge them into the same JSON object. Leave the sample answer empty, because each student gets different data.',
        randomisepreset: 'Data',
        randomisesize: 'Values',
        presetdistinct: 'Distinct numbers 1-99',
        presetrepeats: 'Numbers 1-20 with repeats',
        presetletters: 'Letters A-Z',
        presetcounting: 'Small numbers 0-9 (counting sort)',
        presetradix: 'Three-digit numbers (radix sort)',
        presetsearchsorted: 'Sorted numbers and a target from them (binary search)',
        presetsearchany: 'Numbers and a target from them (linear search)',
        presettargetonly: 'Keep this data, random target from it',
        tptitle: 'Template parameters for grading and feedback',
        tpintro: 'Put these in the Template parameters field as one JSON object. Leave out any you don\'t need: the ' +
            'defaults below apply. If the template parameters also make random data, put everything in the same ' +
            'object, for example {"randomdata": ..., "feedbackdetail": "summary"}.',
        tpname: 'Name',
        tpdefault: 'Default',
        tpmeaning: 'What it does',
        tpfeedbackdetail: '"detailed" marks each step right or wrong and highlights the wrong cells, "summary" marks ' +
            'each step only, and "minimal" only says whether the trace is correct. None of them show the correct values.',
        tpshowmodelanswer: 'true shows students the full correct trace in the feedback. Teachers always see it.',
        tpcellcredit: 'true gives a partly right row credit for its right cells. false counts a row only if every ' +
            'cell is right.',
        tpomitunchanged: 'true leaves out of the expected trace any step that changes nothing graded.',
        tpstepmatching: '"strict" compares the student\'s steps with the correct ones in order, position by position, ' +
            'so a missing or extra step makes every later step wrong. "aligned" pairs each step with the correct step ' +
            'it matches best, in order, so a missing or extra step costs only that step. Only used when all the steps ' +
            'are asked for.',
        tpexample: 'All of them with their defaults, to copy and edit:',
        copy: 'Copy',
        copydone: 'Copied',
        close: 'Close',
        removestep: 'Remove this step',
        copyprevious: 'Copy previous',
        remove: 'Remove',
        resetsteptitle: 'Make this step the same as the one before it',
        undo: 'Undo',
        redo: 'Redo',
        initial: 'Initial',
        input: 'Input',
        final: 'Final',
        nosteps: 'No steps yet.',
        configerror: 'This question is not set up correctly: {$a}',
        checkfailed: 'Checking the question found a problem: {$a}',
        target: 'Target: {$a}',
        noalgorithm: 'no algorithm was chosen (set the algorithm UI parameter)',
        cell: '{$a->step}, {$a->row}, position {$a->index}',
        pointer: 'Pointer {$a->name}: {$a->place}',
        notplaced: 'not placed',
        position: 'position {$a}',
        swapped: 'Swapped positions {$a->from} and {$a->to}',
        moved: 'Moved position {$a->from} to {$a->to}',
        copied: 'Copied {$a}',
        removed: 'Removed {$a}',
        added: 'Added {$a}',
        variable: '{$a->step}, {$a->name}',
        addtool: 'Add {$a}',
        addcard: '+ Add {$a}',
        filltool: 'Fill in correct answer',
        fillstepslabel: 'Steps to fill in (empty for all)',
        randomisetool: 'Randomise data',
        tptool: 'Template parameters',
        algotool: 'Algorithm settings',
        helptool: 'Help',
        helptitle: 'How to answer',
        helpmouse: 'Mouse',
        helpkeyboard: 'Keyboard',
        helpteacherheading: 'Teacher tools',
        helpswap: 'Drag a value onto another cell to swap them.',
        helpmove: 'Drag a value onto the edge between two cells to move it there.',
        helpcopy: 'Drag a value from the top row into a cell to copy it.',
        helptype: 'Click a cell to type a value.',
        helppointers: 'Drag a pointer under the array to place it, or onto the dashed tray to remove it.',
        helpkeyswap: 'Swap a cell with its neighbour',
        helpkeytab: 'Move between cells',
        helpkeypointer: 'Move the selected pointer',
        helpkeyremove: 'Remove the selected pointer',
        helpteacher: 'In the question editor the toolbar also fills in the correct answer, makes random data for each ' +
            'student, and lists the template parameters and the algorithm\'s settings.',
        algotitle: 'Algorithm settings: {$a}',
        algostep: 'One step:',
        algooptions: 'Options, set in the options UI parameter:',
        algooption: 'Option',
        algoallowed: 'Allowed',
        algocurrent: 'This question',
        algousingdefault: 'default',
        algonooptions: 'This algorithm has no options.',
        algoparts: 'Parts of each step:',
        algogradeddefault: 'Graded by default: {$a}.',
        algogradednow: 'Graded in this question: {$a}. Change this with the grade UI parameter.',
        algoexample: 'All options with their defaults, for the options UI parameter:',
        algocustom: 'A custom algorithm\'s steps come from its algorithm.py support file, and their parts from the schema ' +
            'UI parameter.',
        partrow: '{$a} (row of cells)',
        partpointer: '{$a} (pointer)',
        partvar: '{$a} (value)',
        hintnumber: 'a whole number',
        hintnumberordata: 'a whole number, or "data" for the data\'s smallest or largest value',
        hintnumberorauto: 'a whole number, or "auto"',
        hintgaps: '"knuth", "shell", "hibbard", "sedgewick", "ciura", or a list such as [5, 3, 1]',
        hintbase: 'a whole number, 2 or more',
        step_linear_search: 'one comparison with the target. Pointer i is the element compared.',
        step_binary_search: 'one probe. Pointers lo, mid and hi are as they are when mid is computed.',
        step_bubble_sort: 'one pass from left to right, swapping neighbours that are out of order.',
        step_selection_sort: 'one position filled by swapping in the smallest (or largest) remaining value: n - 1 steps.',
        step_insertion_sort: 'one element inserted into the sorted part on its left (i = 1 to n - 1).',
        step_shell_sort: 'one h-sort, for each gap h in turn.',
        step_merge_sort: 'one merge of two sorted halves, in the order the recursion does them (left first).',
        step_merge_sort_bottom_up: 'one pass merging runs of width 1, then 2, 4, and so on.',
        step_timsort: 'natural variant: one run found (and extended to minrun), or one merge. Simplified variant: see ' +
            'granularity.',
        step_quick_sort: 'one partition, in the order the recursion does them (left part first). No shuffle.',
        step_dual_pivot_quick_sort: 'one partition around two pivots, in recursion order. No shuffle.',
        step_radix_sort: 'one pass sorting by one digit (or character), least significant first.',
        step_counting_sort: 'clrs: the counts, then the cumulative counts, then the output. simple: the counts, then the output. ' +
            'keyindexed: as clrs, with count[r + 1] counting key r.',
        opt_linear_search_stopwhengreater: 'Stop at the first element greater than the target (for sorted data).',
        opt_binary_search_bounds:
            'inclusive: hi starts at n - 1 and the search runs while lo <= hi. exclusive: hi starts at n, runs ' +
            'while lo < hi, and hi becomes mid.',
        opt_binary_search_midpoint: 'mid = (lo + hi) / 2 rounded down or up. Exclusive bounds need floor.',
        opt_bubble_sort_earlyexit: 'Stop after a pass that makes no swaps.',
        opt_bubble_sort_showcheckpass: 'With earlyexit, count that last pass (which only confirms the array is sorted) as a step.',
        opt_bubble_sort_granularity: 'swap: a step after every swap instead of every pass.',
        opt_selection_sort_select: 'min fills positions from the left with the smallest value; max fills from the right with the ' +
            'largest.',
        opt_selection_sort_granularity: 'swap: a step only when a swap actually moves values.',
        opt_insertion_sort_granularity: 'swap: a step after every swap of neighbours.',
        opt_shell_sort_gaps: 'The gap sequence. knuth is 1, 4, 13, 40, ... starting below n/3, as in Sedgewick and Wayne.',
        opt_shell_sort_granularity: 'swap: a step after every swap.',
        opt_merge_sort_split: 'leftlarger: mid = lo + (hi - lo) / 2, so the left half gets the extra element. rightlarger: the ' +
            'right half does.',
        opt_merge_sort_bottom_up_granularity: 'merge: a step after every merge instead of every pass.',
        opt_timsort_variant: 'natural: natural runs, reversing descending ones, merged by Timsort\'s stack rules (no galloping). ' +
            'simplified: insertion sort blocks of minrun, then bottom-up merges.',
        opt_timsort_minrun: 'The shortest run. "auto" uses CPython\'s rule, which for fewer than 64 values makes one run.',
        opt_timsort_granularity:
            'Simplified variant only. iteration: a step for the sorted blocks, then one per merge pass. merge: a ' +
            'step per block and per merge.',
        opt_quick_sort_partition: 'sedgewick (Quick.java), hoare (CLRS Hoare partition), lomuto (CLRS) or threeway (Dijkstra, ' +
            'Quick3way.java).',
        opt_quick_sort_pivot: 'Which element is the pivot. It is swapped into place first. The default is first, or last for ' +
            'lomuto.',
        opt_quick_sort_granularity: 'swap: a step after every swap.',
        opt_dual_pivot_quick_sort_granularity: 'swap: a step after every swap.',
        opt_radix_sort_base: 'The number base for the digits.',
        opt_radix_sort_digits: 'How many digits to sort by. "auto" uses as many as the largest value has.',
        opt_counting_sort_variant: 'Which counting sort: clrs, simple or keyindexed (see One step).',
        opt_counting_sort_granularity: 'element: a step after each element is placed in the output.',
        opt_counting_sort_min: 'The smallest key counted.',
        opt_counting_sort_max: 'The largest key counted.',
    };

    // The algorithm each editor answer field showed when the page loaded. An answer
    // for another algorithm is cleared only if the author changes the algorithm
    // while editing, not because the page loaded with one (for example a
    // randomised algorithm, or an answer saved for an earlier version).
    const pageAlgorithms = new Map();

    // Localised strings, fetched once per page and shared by every instance.
    let pageStrings = null;
    let pageStringsPromise = null;

    /**
     * Fetch the localised strings (once per page).
     * @return {Promise} Resolves to a map of short name to string, or null on failure.
     */
    function loadPageStrings() {
        if (!pageStringsPromise) {
            const names = Object.keys(STRING_DEFAULTS);
            const requests = names.map((name) => ({key: STRING_PREFIX + name, component: 'qtype_coderunner'}));
            pageStringsPromise = Str.get_strings(requests).then((values) => {
                const strings = {};
                names.forEach((name, index) => {
                    if (typeof values[index] === 'string' && values[index].indexOf('[[') !== 0) {
                        strings[name] = values[index];
                    }
                });
                pageStrings = strings;
                return strings;
            }).catch(() => null);
        }
        return pageStringsPromise;
    }

    // UI parameter names, kept when building the UI parameters snippet for randomised data.
    const UI_PARAMETER_NAMES = ['algorithm', 'data', 'target', 'options', 'schema', 'ask', 'grade', 'stepname'];

    // The grading and feedback settings, which are template parameters, with their defaults.
    // Must match TEMPLATE_DEFAULTS in the prototype's grader.
    const TEMPLATE_PARAMETERS = [
        ['feedbackdetail', 'detailed'],
        ['showmodelanswer', false],
        ['cellcredit', false],
        ['omitunchanged', false],
        ['stepmatching', 'strict'],
    ];

    // Inline SVG glyphs (Feather style, 24x24 stroke), as in the data-structure graph UI.
    const ICONS = {
        add: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
        redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/>',
        wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
        shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>' +
            '<polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>' +
            '<line x1="4" y1="4" x2="9" y2="9"/>',
        sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>' +
            '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>' +
            '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>' +
            '<line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>' +
            '<line x1="17" y1="16" x2="23" y2="16"/>',
        info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/>' +
            '<line x1="12" y1="8" x2="12.01" y2="8"/>',
        help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>' +
            '<line x1="12" y1="17" x2="12.01" y2="17"/>',
        copy: '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        trash: '<polyline points="3 6 5 6 21 6"/>' +
            '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    };

    // Each built-in algorithm's options, for the "Algorithm settings" panel. An option has
    // either a list of allowed values or a hint string. Must match the prototype's grader.
    const ALGORITHM_OPTIONS = {
        linear_search: [
            {name: 'stopwhengreater', def: false, values: [true, false]},
        ],
        binary_search: [
            {name: 'bounds', def: 'inclusive', values: ['inclusive', 'exclusive']},
            {name: 'midpoint', def: 'floor', values: ['floor', 'ceil']},
        ],
        bubble_sort: [
            {name: 'earlyexit', def: true, values: [true, false]},
            {name: 'showcheckpass', def: false, values: [true, false]},
            {name: 'granularity', def: 'iteration', values: ['iteration', 'swap']},
        ],
        selection_sort: [
            {name: 'select', def: 'min', values: ['min', 'max']},
            {name: 'granularity', def: 'iteration', values: ['iteration', 'swap']},
        ],
        insertion_sort: [
            {name: 'granularity', def: 'iteration', values: ['iteration', 'swap']},
        ],
        shell_sort: [
            {name: 'gaps', def: 'knuth', hint: 'hintgaps'},
            {name: 'granularity', def: 'iteration', values: ['iteration', 'swap']},
        ],
        merge_sort: [
            {name: 'split', def: 'leftlarger', values: ['leftlarger', 'rightlarger']},
        ],
        merge_sort_bottom_up: [
            {name: 'granularity', def: 'iteration', values: ['iteration', 'merge']},
        ],
        timsort: [
            {name: 'variant', def: 'natural', values: ['natural', 'simplified']},
            {name: 'minrun', def: 4, hint: 'hintnumberorauto'},
            {name: 'granularity', def: 'iteration', values: ['iteration', 'merge']},
        ],
        quick_sort: [
            {name: 'partition', def: 'sedgewick', values: ['sedgewick', 'hoare', 'lomuto', 'threeway']},
            {name: 'pivot', def: 'first', values: ['first', 'last', 'middle', 'median3']},
            {name: 'granularity', def: 'iteration', values: ['iteration', 'swap']},
        ],
        dual_pivot_quick_sort: [
            {name: 'granularity', def: 'iteration', values: ['iteration', 'swap']},
        ],
        radix_sort: [
            {name: 'base', def: 10, hint: 'hintbase'},
            {name: 'digits', def: 'auto', hint: 'hintnumberorauto'},
        ],
        counting_sort: [
            {name: 'variant', def: 'clrs', values: ['clrs', 'simple', 'keyindexed']},
            {name: 'granularity', def: 'iteration', values: ['iteration', 'element']},
            {name: 'min', def: 0, hint: 'hintnumberordata'},
            {name: 'max', def: 'data', hint: 'hintnumberordata'},
        ],
    };

    // Twig template parameters that make random data, for the "Randomise data" panel.
    // Each gives the template parameters for n values; target presets also set randomtarget.
    const RANDOM_PRESETS = {
        distinct: {twig: (n) => '{"randomdata": {{ range(1, 99)|shuffle|slice(0, ' + n + ')|json_encode }}}'},
        repeats: {twig: (n) => '{"randomdata": [{% for i in 1..' + n +
            ' %}{{ random(1, 20) }}{{ loop.last ? "" : ", " }}{% endfor %}]}'},
        letters: {twig: (n) => '{"randomdata": {{ range("A", "Z")|shuffle|slice(0, ' + Math.min(n, 26) + ')|json_encode }}}'},
        counting: {twig: (n) => '{"randomdata": [{% for i in 1..' + n +
            ' %}{{ random(0, 9) }}{{ loop.last ? "" : ", " }}{% endfor %}]}'},
        radix: {twig: (n) => '{"randomdata": {{ range(100, 999)|shuffle|slice(0, ' + n + ')|json_encode }}}'},
        searchsorted: {target: true, twig: (n) => '{% set a = range(1, 99)|shuffle|slice(0, ' + n +
            ')|sort|merge([]) %}{"randomdata": {{ a|json_encode }}, "randomtarget": {{ random(a)|json_encode }}}'},
        searchany: {target: true, twig: (n) => '{% set a = range(1, 99)|shuffle|slice(0, ' + n +
            ') %}{"randomdata": {{ a|json_encode }}, "randomtarget": {{ random(a)|json_encode }}}'},
        targetonly: {target: true, keepdata: true,
            twig: (n, data) => '{"randomtarget": {{ random(' + JSON.stringify(data) + ')|json_encode }}}'},
    };

    /**
     * The random-data presets that suit an algorithm, best first.
     * @param {string} algorithm The algorithm name.
     * @return {string[]}
     */
    function presetsFor(algorithm) {
        switch (algorithm) {
            case 'binary_search':
                return ['searchsorted', 'targetonly'];
            case 'linear_search':
                return ['searchany', 'searchsorted', 'targetonly'];
            case 'counting_sort':
                return ['counting', 'repeats', 'distinct'];
            case 'radix_sort':
                return ['radix', 'distinct', 'repeats', 'letters'];
            case 'custom':
                return Object.keys(RANDOM_PRESETS);
            default:
                return ['distinct', 'repeats', 'letters', 'counting', 'radix'];
        }
    }

    // ---------- Data and configuration (mirrors the prototype's grader) ----------

    /**
     * Return a number for a numeric value or string, else null.
     * @param {*} value The value.
     * @return {number|null}
     */
    function toNumber(value) {
        if (typeof value === 'number') {
            return isFinite(value) ? value : null;
        }
        if (typeof value === 'string' && NUMBER_PATTERN.test(value.trim()) && isFinite(Number(value.trim()))) {
            return Number(value.trim());
        }
        return null;
    }

    /**
     * A list of component names, given as a list or as a string separated by
     * commas or spaces. Must match name_list in the prototype's grader.
     * @param {*} value The list or string.
     * @return {string[]}
     */
    function nameList(value) {
        if (typeof value === 'string') {
            return value.replace(/,/g, ' ').split(/\s+/).filter((item) => item !== '');
        }
        return Array.isArray(value) ? value.map(String) : [];
    }

    /**
     * The text shown for a value.
     * @param {*} value The value.
     * @return {string}
     */
    function show(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    /**
     * Parse the data parameter: a list, a JSON list, or a string of values
     * separated by spaces or commas. Numeric strings become numbers when all
     * the values are numeric.
     * @param {*} raw The data parameter.
     * @return {Array} The values.
     */
    function parseData(raw) {
        if (raw === null || raw === undefined) {
            return [];
        }
        if (typeof raw === 'string') {
            const text = raw.trim();
            if (text.charAt(0) === '[') {
                try {
                    raw = JSON.parse(text);
                } catch (e) {
                    throw new Error('data is not a valid JSON list');
                }
            } else {
                raw = text.replace(/,/g, ' ').split(/\s+/).filter((item) => item !== '');
            }
        }
        if (!Array.isArray(raw)) {
            throw new Error('data must be a list of values');
        }
        if (raw.length > MAX_ITEMS) {
            throw new Error('data has more than ' + MAX_ITEMS + ' items');
        }
        const numbers = raw.map(toNumber);
        if (numbers.every((number) => number !== null)) {
            return numbers;
        }
        if (raw.some((item) => item === null || item === undefined || typeof item === 'object')) {
            throw new Error('data items must be numbers or strings');
        }
        return raw.map((item) => String(item).trim());
    }

    /**
     * Return an integer option, or the default.
     * @param {object} opts The options.
     * @param {string} name The option name.
     * @param {*} fallback The default.
     * @return {*}
     */
    function opt(opts, name, fallback) {
        return opts[name] === undefined || opts[name] === null ? fallback : opts[name];
    }

    /**
     * The smallest key and number of keys for counting sort.
     * @param {Array} data The data.
     * @param {object} opts The algorithm options.
     * @return {Array} [low, keys].
     */
    function countingRange(data, opts) {
        let low = opt(opts, 'min', 0);
        if (low === 'data') {
            low = data.length ? Math.min.apply(null, data) : 0;
        }
        low = toNumber(low);
        let high = opt(opts, 'max', 'data');
        high = high === 'data' ? (data.length ? Math.max.apply(null, data) : low) : toNumber(high);
        if (!Number.isInteger(low) || !Number.isInteger(high) || !data.every(Number.isInteger)) {
            throw new Error('counting_sort needs whole numbers');
        }
        if (high - low + 1 > MAX_ITEMS || high < low) {
            throw new Error('counting_sort counts too many keys');
        }
        return [low, high - low + 1];
    }

    /**
     * Describe one row of cells.
     * @param {string} name Row name.
     * @param {number} length Number of cells.
     * @param {string} init How a first step fills it: data, zeros or blank.
     * @param {boolean} editable Whether the student edits it.
     * @param {string} labels Cell labels: index or key.
     * @param {number} base The first key, for key labels.
     * @return {object}
     */
    function row(name, length, init, editable, labels, base) {
        return {name: name, length: length, init: init || 'data', editable: editable !== false,
            labels: labels || 'index', labelbase: base || 0};
    }

    /**
     * Describe one pointer into the array row.
     * @param {string} name Pointer name.
     * @param {number} slots Number of places it can point to.
     * @return {object}
     */
    function pointer(name, slots) {
        return {name: name, row: 'array', slots: slots};
    }

    /**
     * The rows, pointers, vars and default graded components of a built-in
     * algorithm. Must match builtin_schema in the prototype's grader.
     * @param {string} algorithm The algorithm name.
     * @param {object} opts The algorithm options.
     * @param {Array} data The input data.
     * @return {object}
     */
    function builtinSchema(algorithm, opts, data) {
        const n = data.length;
        const array = row('array', n);
        const pointers = (names, slots) => names.map((name) => pointer(name, slots === undefined ? n : slots));
        switch (algorithm) {
            case 'linear_search':
                return {rows: [row('array', n, 'data', false)], pointers: pointers(['i']), vars: [], grade: ['i']};
            case 'binary_search':
                return {rows: [row('array', n, 'data', false)],
                    pointers: pointers(['lo', 'mid', 'hi'], opts.bounds === 'exclusive' ? n + 1 : n),
                    vars: [], grade: ['lo', 'mid', 'hi']};
            case 'bubble_sort':
            case 'selection_sort':
            case 'insertion_sort':
                return {rows: [array], pointers: [], vars: [], grade: ['array']};
            case 'shell_sort':
                return {rows: [array], pointers: [], vars: ['h'], grade: ['array']};
            case 'merge_sort':
            case 'merge_sort_bottom_up':
                return {rows: [array], pointers: pointers(['lo', 'mid', 'hi']),
                    vars: algorithm === 'merge_sort_bottom_up' ? ['size'] : [], grade: ['array']};
            case 'timsort':
                return {rows: [array], pointers: pointers(['lo', 'hi']), vars: [], grade: ['array']};
            case 'quick_sort':
                return {rows: [array], pointers: pointers(['lo', 'hi']), vars: ['pivot'], grade: ['array']};
            case 'dual_pivot_quick_sort':
                return {rows: [array], pointers: pointers(['lo', 'hi', 'lt', 'gt']), vars: ['p1', 'p2'],
                    grade: ['array']};
            case 'radix_sort':
                return {rows: [array], pointers: [], vars: ['digit'], grade: ['array']};
            case 'counting_sort': {
                const range = countingRange(data, opts);
                const keyIndexed = opts.variant === 'keyindexed';
                return {rows: [row('count', keyIndexed ? range[1] + 1 : range[1], 'zeros', true,
                    keyIndexed ? 'index' : 'key', range[0]), row('output', n, 'blank')],
                    pointers: [], vars: [], grade: ['count', 'output']};
            }
            default:
                throw new Error('unknown algorithm "' + algorithm + '"');
        }
    }

    /**
     * The schema an author gave for a custom algorithm. Must match
     * custom_schema in the prototype's grader.
     * @param {*} raw The schema UI parameter.
     * @param {Array} data The input data.
     * @return {object}
     */
    function customSchema(raw, data) {
        const n = data.length;
        raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
        const name = (item) => String(item && typeof item === 'object' ? item.name : item);
        const rows = (Array.isArray(raw.rows) && raw.rows.length ? raw.rows : [{name: 'array'}]).map(function(item) {
            item = item && typeof item === 'object' ? item : {name: String(item)};
            const length = item.length === undefined || item.length === 'n' ? n : toNumber(item.length);
            if (!Number.isInteger(length) || length < 0 || length > MAX_ITEMS) {
                throw new Error('each schema row length must be "n" or a whole number');
            }
            return row(String(item.name === undefined ? 'array' : item.name), length, item.init || 'data',
                item.editable !== false, 'index', 0);
        });
        const pointers = (Array.isArray(raw.pointers) ? raw.pointers : []).map((item) => pointer(name(item), n));
        const vars = (Array.isArray(raw.vars) ? raw.vars : []).map(name);
        const chosen = nameList(raw.grade);
        const grade = chosen.length ? chosen :
            rows.filter((r) => r.editable).map((r) => r.name).concat(pointers.map((p) => p.name), vars);
        return {rows: rows, pointers: pointers, vars: vars, grade: grade};
    }

    /**
     * The schema for the question's algorithm.
     * @param {string} algorithm The algorithm name.
     * @param {object} opts The options.
     * @param {Array} data The data.
     * @param {*} rawSchema The schema UI parameter (custom algorithms only).
     * @return {object}
     */
    function schemaFor(algorithm, opts, data, rawSchema) {
        return algorithm === 'custom' ? customSchema(rawSchema, data) : builtinSchema(algorithm, opts, data);
    }

    /**
     * Parse the ask parameter.
     * @param {*} ask The parameter.
     * @return {string|Array} 'all', 'final' or a list of step numbers.
     */
    function parseAsk(ask) {
        if (ask === null || ask === undefined || (typeof ask === 'string' && ['', 'all'].includes(ask.trim().toLowerCase()))) {
            return 'all';
        }
        if (typeof ask === 'string' && ['final', 'last'].includes(ask.trim().toLowerCase())) {
            return 'final';
        }
        const items = Array.isArray(ask) ? ask : typeof ask === 'string' ? ask.replace(/,/g, ' ').split(/\s+/) : [ask];
        const steps = items.filter((item) => item !== '').map(toNumber);
        if (!steps.length || steps.some((step) => !Number.isInteger(step) || step < 1)) {
            throw new Error('ask must be "all", "final", a step number or a list of step numbers');
        }
        return steps;
    }

    /**
     * Deep copy of a JSON-compatible value.
     * @param {*} value The value.
     * @return {*}
     */
    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    // ---------- The UI ----------

    /**
     * Constructor for the algorithm trace UI.
     * @param {string} textareaId The answer textarea's id.
     * @param {number} width Initial width.
     * @param {number} height Initial height.
     * @param {object} uiParams The UI parameters.
     */
    function AlgorithmTrace(textareaId, width, height, uiParams) {
        this.textArea = document.getElementById(textareaId);
        this.readOnly = this.textArea.readOnly;
        this.inEditor = EDITOR_FIELDS.includes(textareaId);
        this.discardedAlgorithm = null; // Set when an editor answer for another algorithm is cleared.
        this.uiParams = uiParams || {};
        this.strings = Object.assign({}, STRING_DEFAULTS, pageStrings || {});
        this.fail = false;
        this.failString = null;
        this.root = null;
        this.configError = null;
        this.steps = [];
        this.touched = false;
        this.undoStack = [];
        this.redoStack = [];
        this.drag = null;
        this.selectedChip = null;
        this.typingSnapshot = false;
        this.listeners = [];
        this.width = width;
        this.height = height;
        this.status = null;
        this.serviceCalls = 0;
        this.configure();
        if (this.inEditor && !pageAlgorithms.has(textareaId)) {
            pageAlgorithms.set(textareaId, this.algorithm || '');
        }
        this.pageAlgorithm = this.inEditor ? pageAlgorithms.get(textareaId) : null;
        if (!this.configError) {
            this.load();
        }
    }

    /**
     * Work out the schema, input data and steps asked for from the UI parameters.
     */
    AlgorithmTrace.prototype.configure = function() {
        const p = this.uiParams;
        try {
            this.algorithm = String(p.algorithm || '').trim();
            this.target = null;
            if (!this.algorithm) {
                throw new Error(STRING_DEFAULTS.noalgorithm);
            }
            this.options = p.options && typeof p.options === 'object' && !Array.isArray(p.options) ? p.options : {};
            this.data = parseData(p.data);
            if (this.algorithm !== 'custom' && !this.data.length) {
                throw new Error('data must not be empty');
            }
            this.schema = schemaFor(this.algorithm, this.options, this.data, p.schema);
            const chosen = nameList(p.grade);
            const grade = chosen.length ? chosen : this.schema.grade;
            this.checkGraded(grade);
            this.graded = new Set(grade);
            const target = p.target === null || p.target === undefined ? '' : String(p.target).trim();
            this.target = target === '' ? null : toNumber(target) === null ? target : String(toNumber(target));
            this.ask = parseAsk(p.ask);
            this.stepName = String(p.stepname || 'Iteration').trim() || 'Iteration';
        } catch (e) {
            this.configError = e.message;
            return;
        }
        // Rows the student sees: graded rows, and locked rows that graded pointers point into.
        const pointedInto = new Set(this.schema.pointers.filter((ptr) => this.graded.has(ptr.name)).map((ptr) => ptr.row));
        this.rows = this.schema.rows.filter((r) => this.graded.has(r.name) || pointedInto.has(r.name));
        this.pointers = this.schema.pointers.filter((ptr) => this.graded.has(ptr.name));
        this.vars = this.schema.vars.filter((name) => this.graded.has(name));
        this.fixedLabels = this.ask === 'all' ? null :
            this.ask === 'final' ? [null] : this.ask.map((number) => number);
    };

    /**
     * Check the graded components, as graded_components in the prototype's grader does.
     * @param {string[]} grade The names of the graded components.
     */
    AlgorithmTrace.prototype.checkGraded = function(grade) {
        const names = this.schema.rows.map((r) => r.name).concat(this.schema.pointers.map((ptr) => ptr.name),
            this.schema.vars);
        grade.forEach((name) => {
            if (!names.includes(name)) {
                throw new Error('cannot grade "' + name + '"; this algorithm has ' + names.join(', '));
            }
            // A locked row is never sent, so grading it would make full marks impossible.
            if (this.schema.rows.some((r) => r.name === name && !r.editable)) {
                throw new Error('cannot grade "' + name + '", because students cannot change it');
            }
        });
    };

    /**
     * Load the student's answer from the textarea.
     */
    AlgorithmTrace.prototype.load = function() {
        const text = this.textArea.value.trim();
        let steps = null;
        if (text !== '') {
            let answer;
            try {
                answer = JSON.parse(text);
            } catch (e) {
                answer = null;
            }
            if (!answer || answer.type !== SERIALISATION_TYPE || !Array.isArray(answer.steps)) {
                this.fail = true;
                this.failString = 'algorithmtrace_ui_invalidserialisation';
                return;
            }
            if (this.inEditor && answer.algorithm && answer.algorithm !== this.algorithm &&
                    this.algorithm !== this.pageAlgorithm) {
                // The author has changed the algorithm, so this answer is for a different question.
                // Start afresh. Students' answers are never discarded.
                this.discardedAlgorithm = String(answer.algorithm);
            } else {
                steps = answer.steps.slice(0, MAX_STEPS).map((step) => this.normaliseStep(step));
                this.touched = true;
            }
        }
        if (steps === null) {
            // Students start with one step to fill in. The question editor's answer
            // fields start empty, so a new question doesn't look as if it has an answer.
            steps = this.fixedLabels || this.inEditor ? [] : [this.newStep(this.initialStep())];
        }
        if (this.fixedLabels) {
            steps = steps.slice(0, this.fixedLabels.length);
            while (steps.length < this.fixedLabels.length) {
                steps.push(this.newStep(steps.length ? steps[steps.length - 1] : this.initialStep()));
            }
        }
        this.steps = steps;
    };

    /**
     * The state before the first step.
     * @return {object}
     */
    AlgorithmTrace.prototype.initialStep = function() {
        const step = {};
        this.schema.rows.forEach((r) => {
            const cells = [];
            for (let k = 0; k < r.length; k++) {
                cells.push(r.init === 'data' ? show(this.data[k]) : r.init === 'zeros' ? '0' : '');
            }
            step[r.name] = cells;
        });
        this.schema.pointers.forEach((ptr) => {
            step[ptr.name] = null;
        });
        this.schema.vars.forEach((name) => {
            step[name] = '';
        });
        return step;
    };

    /**
     * A new step, copied from the one before. Locked rows always show the data.
     * @param {object} previous The previous step.
     * @return {object}
     */
    AlgorithmTrace.prototype.newStep = function(previous) {
        const step = clone(previous);
        const initial = this.initialStep();
        this.schema.rows.forEach((r) => {
            if (!r.editable) {
                step[r.name] = initial[r.name];
            }
        });
        return step;
    };

    /**
     * A step read from a serialisation, fitted to the schema.
     * @param {*} raw The serialised step.
     * @return {object}
     */
    AlgorithmTrace.prototype.normaliseStep = function(raw) {
        raw = raw && typeof raw === 'object' ? raw : {};
        const step = this.initialStep();
        this.schema.rows.forEach((r) => {
            if (r.editable && Array.isArray(raw[r.name])) {
                for (let k = 0; k < r.length; k++) {
                    const value = raw[r.name][k];
                    step[r.name][k] = value === null || value === undefined || typeof value === 'object' ? '' : String(value);
                }
            }
        });
        this.schema.pointers.forEach((ptr) => {
            const value = toNumber(raw[ptr.name]);
            step[ptr.name] = Number.isInteger(value) && value >= 0 && value < ptr.slots ? value : null;
        });
        this.schema.vars.forEach((name) => {
            const value = raw[name];
            step[name] = value === null || value === undefined || typeof value === 'object' ? '' : String(value);
        });
        return step;
    };

    AlgorithmTrace.prototype.failed = function() {
        return this.fail;
    };

    AlgorithmTrace.prototype.failMessage = function() {
        return this.failString;
    };

    /**
     * Look up a string, substituting {$a} or {$a->name} placeholders.
     * @param {string} name The short string name.
     * @param {*} a The placeholder value(s).
     * @return {string}
     */
    AlgorithmTrace.prototype.s = function(name, a) {
        let text = this.strings[name] === undefined ? name : this.strings[name];
        if (a !== undefined && a !== null && typeof a === 'object') {
            Object.keys(a).forEach((key) => {
                text = text.split('{$a->' + key + '}').join(String(a[key]));
            });
        } else if (a !== undefined) {
            text = text.split('{$a}').join(String(a));
        }
        return text;
    };

    /**
     * Build the UI straight away. It must not wait for the localised strings:
     * the author form reloads the UI as the UI parameters are edited, and the
     * wrapper gives up on reloads queued behind a slow one. The English
     * defaults are shown until the strings arrive.
     * @return {Promise}
     */
    AlgorithmTrace.prototype.ready = function() {
        this.build();
        if (!pageStrings) {
            loadPageStrings().then((strings) => {
                if (strings && this.root) {
                    Object.assign(this.strings, strings);
                    this.relabel();
                }
                return null;
            }).catch(() => null);
        }
        return Promise.resolve();
    };

    /**
     * Rebuild the UI with the localised strings once they have loaded.
     */
    AlgorithmTrace.prototype.relabel = function() {
        const focus = this.focusedTarget();
        this.closeHelp();
        this.buildInner();
        this.render(focus);
    };

    /**
     * The cell, chip or variable box that has focus, if any, so it can be focused again after redrawing.
     * @return {object|null}
     */
    AlgorithmTrace.prototype.focusedTarget = function() {
        const node = document.activeElement;
        if (!this.content || !node || !this.content.contains(node)) {
            return null;
        }
        const step = parseInt(node.dataset.step);
        if (node.dataset.chip !== undefined) {
            return {step: step, chip: node.dataset.chip};
        }
        if (node.dataset.var !== undefined) {
            return {step: step, variable: node.dataset.var};
        }
        if (node.dataset.row !== undefined) {
            return {step: step, row: node.dataset.row, index: parseInt(node.dataset.index)};
        }
        return null;
    };

    AlgorithmTrace.prototype.getElement = function() {
        if (!this.root) {
            this.build();
        }
        return this.root;
    };

    /**
     * Make an element.
     * @param {string} tag Tag name.
     * @param {string} cls Class names.
     * @param {string} text Text content.
     * @return {HTMLElement}
     */
    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) {
            node.className = cls;
        }
        if (text !== undefined && text !== null) {
            node.textContent = text;
        }
        return node;
    }

    /**
     * An inline SVG icon.
     * @param {string} name The icon name (key of ICONS).
     * @return {SVGElement}
     */
    function icon(name) {
        const holder = document.createElement('span');
        holder.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
            (ICONS[name] || '') + '</svg>';
        return holder.firstChild;
    }

    /**
     * Build the outer element, attach the event listeners and render the UI.
     */
    AlgorithmTrace.prototype.build = function() {
        if (this.root) {
            return;
        }
        this.root = el('div', 'qtype-coderunner-algorithmtrace');
        this.listen(this.root, 'pointerdown', (e) => this.onPointerDown(e));
        this.listen(document, 'pointermove', (e) => this.onPointerMove(e));
        this.listen(document, 'pointerup', (e) => this.onPointerUp(e));
        this.listen(document, 'pointercancel', () => this.endDrag());
        this.listen(this.root, 'input', (e) => this.onInput(e));
        this.listen(this.root, 'keydown', (e) => this.onKeyDown(e));
        this.listen(this.root, 'focusin', () => {
            this.typingSnapshot = false;
        });
        if (this.discardedAlgorithm) {
            this.status = {text: this.s('cleared', this.discardedAlgorithm), error: false};
        }
        this.buildInner();
        this.render();
        if (this.discardedAlgorithm) {
            this.sync(); // Empties the answer field.
        }
        // Check the question in the editor once per reload (from the sample answer
        // only, not the preload too): errors only the grader finds, and warnings.
        if (this.textArea.id === EDITOR_FIELDS[0] && !this.configError && !this.readOnly && this.algorithm !== 'custom') {
            this.checkQuestion();
        }
    };

    /**
     * (Re)build everything inside the root element.
     */
    AlgorithmTrace.prototype.buildInner = function() {
        const root = this.root;
        root.textContent = '';
        this.content = null;
        this.openPanel = null;
        this.tools = {};
        if (this.configError) {
            const message = this.configError === STRING_DEFAULTS.noalgorithm ? this.s('noalgorithm') : this.configError;
            root.appendChild(el('div', 'algotrace-configerror', this.s('configerror', message)));
            return;
        }
        root.classList.toggle('algotrace-readonly', this.readOnly);
        if (!this.readOnly) {
            root.appendChild(this.buildToolbar());
        }
        this.statusBar = el('div', 'algotrace-statusbar algotrace-fillstatus');
        this.statusBar.setAttribute('role', 'status');
        root.appendChild(this.statusBar);
        this.showStatus();
        this.panels = el('div', 'algotrace-panels');
        root.appendChild(this.panels);
        this.content = el('div', 'algotrace-content');
        root.appendChild(this.content);
        this.live = el('div', 'sr-only algotrace-live');
        this.live.setAttribute('aria-live', 'polite');
        root.appendChild(this.live);
    };

    /**
     * Add an event listener that destroy() removes.
     * @param {EventTarget} target The target.
     * @param {string} type The event type.
     * @param {Function} handler The handler.
     */
    AlgorithmTrace.prototype.listen = function(target, type, handler) {
        target.addEventListener(type, handler);
        this.listeners.push([target, type, handler]);
    };

    /**
     * Make a text button.
     * @param {string} label Its label.
     * @param {string} cls Extra class.
     * @param {Function} action Click handler.
     * @return {HTMLButtonElement}
     */
    AlgorithmTrace.prototype.button = function(label, cls, action) {
        const b = el('button', 'btn btn-secondary btn-sm ' + cls, label);
        b.type = 'button';
        b.addEventListener('click', action);
        return b;
    };

    /**
     * Make an icon toolbar button with a tooltip, styled like the
     * data-structure graph UI's toolbar.
     * @param {string} iconName The icon.
     * @param {string} label The tooltip and accessible name.
     * @param {string} cls Extra class.
     * @param {Function} action Click handler.
     * @return {HTMLButtonElement}
     */
    AlgorithmTrace.prototype.tool = function(iconName, label, cls, action) {
        const b = el('button', 'dsg-tool ' + cls);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        const holder = el('span', 'dsg-tool-icon');
        holder.appendChild(icon(iconName));
        b.appendChild(holder);
        b.appendChild(el('span', 'dsg-tool-label', label));
        b.addEventListener('click', action);
        return b;
    };

    /**
     * Make a small icon-and-text button for a step card.
     * @param {string} iconName The icon.
     * @param {string} text The visible text.
     * @param {string} label The tooltip and accessible name.
     * @param {string} cls Extra class.
     * @param {Function} action Click handler.
     * @return {HTMLButtonElement}
     */
    AlgorithmTrace.prototype.iconButton = function(iconName, text, label, cls, action) {
        const b = el('button', 'algotrace-iconbtn ' + cls);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.appendChild(icon(iconName));
        b.appendChild(el('span', 'algotrace-iconbtn-text', text));
        b.addEventListener('click', action);
        return b;
    };

    /**
     * The toolbar: step and history tools, the teacher's tools in the question
     * editor, and help.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.buildToolbar = function() {
        const bar = el('div', 'coderunner-datastructuregraph-toolbar algotrace-toolbar');
        bar.setAttribute('role', 'toolbar');
        const group = () => {
            const g = el('div', 'dsg-toolgroup');
            bar.appendChild(g);
            return g;
        };
        const steps = group();
        if (!this.fixedLabels) {
            this.addButton = this.tool('add', this.s('addtool', this.stepName.toLowerCase()), 'algotrace-add',
                () => this.addStep());
            steps.appendChild(this.addButton);
        }
        this.undoButton = this.tool('undo', this.s('undo'), 'algotrace-undo', () => this.undo());
        this.redoButton = this.tool('redo', this.s('redo'), 'algotrace-redo', () => this.redo());
        steps.appendChild(this.undoButton);
        steps.appendChild(this.redoButton);

        if (this.inEditor) {
            const teacher = group();
            teacher.classList.add('algotrace-teachertools');
            this.fillButton = this.tool('wand', this.s('filltool'), 'algotrace-fill', () => this.fillAnswer());
            this.fillButton.title = this.s('fillhelp');
            teacher.appendChild(this.fillButton);
            this.fillSteps = el('input', 'algotrace-fillsteps');
            this.fillSteps.type = 'number';
            this.fillSteps.min = '1';
            this.fillSteps.size = 3;
            this.fillSteps.placeholder = this.s('fillall');
            this.fillSteps.title = this.s('fillstepslabel');
            this.fillSteps.setAttribute('aria-label', this.s('fillstepslabel'));
            teacher.appendChild(this.fillSteps);
            [['randomise', 'shuffle', 'randomisetool', 'algotrace-randomise'],
                ['template', 'sliders', 'tptool', 'algotrace-templateparams'],
                ['algorithm', 'info', 'algotool', 'algotrace-algorithm']].forEach(([name, iconName, label, cls]) => {
                const b = this.tool(iconName, this.s(label), cls, () => this.togglePanel(name));
                b.setAttribute('aria-expanded', 'false');
                this.tools[name] = b;
                teacher.appendChild(b);
            });
        }
        const help = group();
        help.classList.add('algotrace-helpgroup');
        this.helpButton = this.tool('help', this.s('helptool'), 'algotrace-helpbutton', () => this.openHelp());
        help.appendChild(this.helpButton);
        return bar;
    };

    /**
     * The label of step k.
     * @param {number} k Step index.
     * @return {string}
     */
    AlgorithmTrace.prototype.stepLabel = function(k) {
        if (this.fixedLabels) {
            const number = this.fixedLabels[k];
            return number === null ? this.s('final') : this.stepName + ' ' + number;
        }
        return this.stepName + ' ' + (k + 1);
    };

    /**
     * Redraw all the steps.
     * @param {object} focus Optional {step, row, index} or {step, chip} to focus afterwards.
     */
    AlgorithmTrace.prototype.render = function(focus) {
        if (!this.content) {
            return;
        }
        this.content.textContent = '';
        this.content.appendChild(this.renderInitial());
        if (!this.steps.length) {
            this.content.appendChild(el('div', 'algotrace-empty', this.s('nosteps')));
        }
        this.steps.forEach((step, k) => {
            this.content.appendChild(this.renderStep(step, k));
        });
        if (!this.fixedLabels && !this.readOnly) {
            const add = el('button', 'algotrace-addcard', this.s('addcard', this.stepName.toLowerCase()));
            add.type = 'button';
            add.disabled = this.steps.length >= MAX_STEPS;
            add.addEventListener('click', () => this.addStep());
            this.content.appendChild(add);
        }
        this.updateChanged();
        this.updateButtons();
        if (focus) {
            this.focusTarget(focus);
        }
        this.textArea.current_ui_wrapper?.updateHeight();
    };

    /**
     * A step card's head: its label and, optionally, its actions.
     * @param {string} label The label.
     * @param {HTMLElement|null} actions The actions.
     * @return {HTMLElement}
     */
    function stepHead(label, actions) {
        const head = el('div', 'algotrace-stephead');
        head.appendChild(el('span', 'algotrace-steplabel', label));
        if (actions) {
            head.appendChild(actions);
        }
        return head;
    }

    /**
     * The card showing the input data.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.renderInitial = function() {
        const block = el('div', 'algotrace-step algotrace-initial');
        const hasDataRow = this.schema.rows.some((r) => r.init === 'data');
        block.appendChild(stepHead(this.s(hasDataRow ? 'initial' : 'input'), null));
        const body = el('div', 'algotrace-stepbody');
        const indices = el('div', 'algotrace-cells algotrace-indices');
        indices.setAttribute('aria-hidden', 'true');
        const cells = el('div', 'algotrace-cells');
        this.data.forEach((value, k) => {
            indices.appendChild(el('span', 'algotrace-index', String(k)));
            const cell = el('span', 'algotrace-cell algotrace-locked', show(value));
            cell.dataset.step = '-1';
            cell.dataset.row = 'input';
            cell.dataset.index = String(k);
            this.markTarget(cell, value);
            cells.appendChild(cell);
        });
        body.appendChild(indices);
        body.appendChild(cells);
        // The target is highlighted where it is in the data. A target that isn't
        // there (an unsuccessful search) can't be highlighted, so it is written out.
        if (this.target !== null && !this.data.some((value) => this.isTarget(value))) {
            body.appendChild(el('div', 'algotrace-target', this.s('target', this.target)));
        }
        block.appendChild(body);
        return block;
    };

    /**
     * Whether a value is the search target. Numbers compare as numbers, as in the grader.
     * @param {*} value The value.
     * @return {boolean}
     */
    AlgorithmTrace.prototype.isTarget = function(value) {
        if (this.target === null) {
            return false;
        }
        const number = toNumber(value);
        const target = toNumber(this.target);
        return number !== null && target !== null ? number === target : show(value).trim() === this.target;
    };

    /**
     * Highlight a locked cell if it holds the target.
     * @param {HTMLElement} cell The cell.
     * @param {*} value Its value.
     */
    AlgorithmTrace.prototype.markTarget = function(cell, value) {
        if (this.isTarget(value)) {
            cell.classList.add('algotrace-targetcell');
            cell.title = this.s('target', this.target);
            cell.setAttribute('aria-label', show(value) + ', ' + this.s('target', this.target));
        }
    };

    /**
     * The card for step k.
     * @param {object} step The step.
     * @param {number} k Its index.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.renderStep = function(step, k) {
        const block = el('div', 'algotrace-step');
        block.dataset.step = String(k);
        const label = this.stepLabel(k);
        let actions = null;
        if (!this.readOnly) {
            actions = el('div', 'algotrace-stepactions');
            actions.appendChild(this.iconButton('copy', this.s('copyprevious'), this.s('resetsteptitle'), 'algotrace-reset',
                () => this.resetStep(k)));
            if (!this.fixedLabels) {
                actions.appendChild(this.iconButton('trash', this.s('remove'), this.s('removestep') + ': ' + label,
                    'algotrace-remove', () => this.removeStep(k)));
            }
        }
        block.appendChild(stepHead(label, actions));
        const body = el('div', 'algotrace-stepbody');
        const multiRow = this.rows.length > 1;
        this.rows.forEach((r) => {
            const wrap = el('div', 'algotrace-rowwrap');
            if (multiRow) {
                wrap.appendChild(el('div', 'algotrace-rowname', r.name));
            }
            const cells = el('div', 'algotrace-cells');
            cells.setAttribute('role', 'group');
            cells.setAttribute('aria-label', label + ', ' + r.name);
            const editable = r.editable && !this.readOnly;
            for (let i = 0; i < r.length; i++) {
                const value = step[r.name][i];
                let cell;
                if (editable) {
                    cell = el('input', 'algotrace-cell');
                    cell.type = 'text';
                    cell.size = 3; // Keeps the input's natural width small whatever the theme does.
                    cell.value = value;
                    cell.setAttribute('autocomplete', 'off');
                    cell.setAttribute('spellcheck', 'false');
                } else {
                    cell = el('span', 'algotrace-cell algotrace-locked', value);
                    this.markTarget(cell, value);
                }
                cell.dataset.step = String(k);
                cell.dataset.row = r.name;
                cell.dataset.index = String(i);
                cell.setAttribute('aria-label', this.s('cell', {step: label, row: r.name, index: i}) +
                    (cell.classList.contains('algotrace-targetcell') ? ', ' + this.s('target', this.target) : ''));
                cells.appendChild(cell);
            }
            wrap.appendChild(cells);
            if (r.labels === 'key' || (multiRow && r.length !== this.data.length)) {
                const keys = el('div', 'algotrace-cells algotrace-keys');
                keys.setAttribute('aria-hidden', 'true');
                for (let i = 0; i < r.length; i++) {
                    keys.appendChild(el('span', 'algotrace-index', String(r.labels === 'key' ? r.labelbase + i : i)));
                }
                wrap.appendChild(keys);
            }
            const lanePointers = this.pointers.filter((ptr) => ptr.row === r.name);
            if (lanePointers.length) {
                wrap.appendChild(this.renderLane(step, k, lanePointers));
            }
            body.appendChild(wrap);
        });
        if (this.vars.length) {
            const vars = el('div', 'algotrace-vars');
            this.vars.forEach((name) => {
                const lab = el('label', 'algotrace-var');
                lab.appendChild(el('span', 'algotrace-varname', name + ' ='));
                const input = el('input', 'algotrace-varinput');
                input.type = 'text';
                input.size = 5;
                input.value = step[name];
                input.dataset.step = String(k);
                input.dataset.var = name;
                input.disabled = this.readOnly;
                input.setAttribute('aria-label', this.s('variable', {step: label, name: name}));
                lab.appendChild(input);
                vars.appendChild(lab);
            });
            body.appendChild(vars);
        }
        block.appendChild(body);
        return block;
    };

    /**
     * The lane of pointer chips under a row.
     * @param {object} step The step.
     * @param {number} k Its index.
     * @param {Array} pointers The pointers in this lane.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.renderLane = function(step, k, pointers) {
        const lane = el('div', 'algotrace-lane');
        const slots = Math.max.apply(null, pointers.map((ptr) => ptr.slots));
        const slotEls = [];
        for (let i = 0; i < slots; i++) {
            const slot = el('div', 'algotrace-slot' + (i >= this.data.length ? ' algotrace-endslot' : ''));
            slot.dataset.step = String(k);
            slot.dataset.slot = String(i);
            lane.appendChild(slot);
            slotEls.push(slot);
        }
        const tray = el('div', 'algotrace-tray');
        tray.dataset.step = String(k);
        tray.dataset.slot = 'none';
        pointers.forEach((ptr) => {
            const chip = el('button', 'algotrace-chip', ptr.name);
            chip.type = 'button';
            chip.dataset.step = String(k);
            chip.dataset.chip = ptr.name;
            chip.disabled = this.readOnly;
            const place = step[ptr.name] === null ? this.s('notplaced') : this.s('position', step[ptr.name]);
            chip.setAttribute('aria-label', this.s('pointer', {name: ptr.name, place: place}));
            if (this.selectedChip && this.selectedChip.step === k && this.selectedChip.name === ptr.name) {
                chip.classList.add('algotrace-selected');
            }
            (step[ptr.name] === null ? tray : slotEls[step[ptr.name]]).appendChild(chip);
        });
        const wrap = el('div', 'algotrace-lanewrap');
        wrap.appendChild(lane);
        if (!this.readOnly || tray.childNodes.length) {
            wrap.appendChild(tray);
        }
        return wrap;
    };

    /**
     * Mark cells that differ from the step before.
     */
    AlgorithmTrace.prototype.updateChanged = function() {
        if (!this.content) {
            return;
        }
        const initial = this.initialStep();
        this.content.querySelectorAll('.algotrace-cell[data-step]').forEach((cell) => {
            const k = parseInt(cell.dataset.step);
            if (k < 0) {
                return;
            }
            const previous = k === 0 ? initial : this.steps[k - 1];
            const name = cell.dataset.row;
            const i = parseInt(cell.dataset.index);
            const changed = previous[name] && this.steps[k][name][i].trim() !== String(previous[name][i]).trim();
            cell.classList.toggle('algotrace-changed', Boolean(changed));
        });
    };

    AlgorithmTrace.prototype.updateButtons = function() {
        if (this.undoButton) {
            this.undoButton.disabled = !this.undoStack.length;
            this.redoButton.disabled = !this.redoStack.length;
        }
        if (this.addButton) {
            this.addButton.disabled = this.steps.length >= MAX_STEPS;
        }
    };

    /**
     * Focus a cell or chip after re-rendering.
     * @param {object} target {step, row, index}, {step, chip} or {step, variable}.
     */
    AlgorithmTrace.prototype.focusTarget = function(target) {
        let selector;
        if (target.chip !== undefined) {
            selector = '.algotrace-chip[data-step="' + target.step + '"][data-chip="' + CSS.escape(target.chip) + '"]';
        } else if (target.variable !== undefined) {
            selector = '.algotrace-varinput[data-step="' + target.step + '"][data-var="' + CSS.escape(target.variable) + '"]';
        } else {
            selector = '.algotrace-cell[data-step="' + target.step + '"][data-row="' + CSS.escape(target.row) +
                '"][data-index="' + target.index + '"]';
        }
        const node = this.content.querySelector(selector);
        if (node) {
            node.focus();
        }
    };

    /**
     * Announce a change to screen readers.
     * @param {string} message The message.
     */
    AlgorithmTrace.prototype.announce = function(message) {
        if (this.live) {
            this.live.textContent = message;
        }
    };

    // ---------- Help dialog ----------

    /**
     * Open the help dialog, styled like the data-structure graph UI's.
     */
    AlgorithmTrace.prototype.openHelp = function() {
        if (this.helpOverlay) {
            return;
        }
        const overlay = el('div', 'coderunner-datastructuregraph-help-overlay algotrace-help-overlay');
        const titleId = 'algotrace-help-' + Math.random().toString(36).substring(2);
        const dialog = el('div', 'dsg-help');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', titleId);
        const head = el('div', 'dsg-help-head');
        const title = el('h3', 'dsg-help-title', this.s('helptitle'));
        title.id = titleId;
        head.appendChild(title);
        const close = el('button', 'dsg-help-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', this.s('close'));
        close.addEventListener('click', () => this.closeHelp());
        head.appendChild(close);
        dialog.appendChild(head);

        const body = el('div', 'dsg-help-body');
        const section = (heading) => {
            const s = el('section', 'dsg-help-section');
            s.appendChild(el('h4', '', heading));
            body.appendChild(s);
            return s;
        };
        const mouse = section(this.s('helpmouse'));
        const list = el('ul', 'dsg-help-list');
        const tips = ['helpswap', 'helpmove', 'helpcopy', 'helptype'];
        if (this.pointers.length) {
            tips.push('helppointers');
        }
        tips.forEach((name) => list.appendChild(el('li', '', this.s(name))));
        mouse.appendChild(list);

        const keyboard = section(this.s('helpkeyboard'));
        const keys = [[['Alt + ←', 'Alt + →'], 'helpkeyswap'], [['Tab', 'Shift + Tab'], 'helpkeytab']];
        if (this.pointers.length) {
            keys.push([['←', '→'], 'helpkeypointer'], [['Delete'], 'helpkeyremove']);
        }
        keys.forEach(([combos, desc]) => {
            const row = el('div', 'dsg-help-row');
            const box = el('span', 'dsg-help-keys');
            combos.forEach((combo, i) => {
                if (i > 0) {
                    box.appendChild(el('span', 'dsg-help-sep', '/'));
                }
                box.appendChild(el('kbd', '', combo));
            });
            row.appendChild(box);
            row.appendChild(el('span', 'dsg-help-desc', this.s(desc)));
            keyboard.appendChild(row);
        });
        if (this.inEditor) {
            section(this.s('helpteacherheading')).appendChild(el('p', 'algotrace-help-teacher', this.s('helpteacher')));
        }
        dialog.appendChild(body);
        overlay.appendChild(dialog);
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) {
                this.closeHelp();
            }
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.closeHelp();
            }
        });
        this.helpOverlay = overlay;
        this.helpReturnFocus = document.activeElement;
        document.body.appendChild(overlay);
        close.focus();
    };

    AlgorithmTrace.prototype.closeHelp = function() {
        if (!this.helpOverlay) {
            return;
        }
        this.helpOverlay.remove();
        this.helpOverlay = null;
        if (this.helpReturnFocus && this.root && this.root.contains(this.helpReturnFocus)) {
            this.helpReturnFocus.focus();
        }
    };

    // ---------- Teacher panels (question editor only) ----------

    /**
     * Open one of the teacher's panels (closing any other), or close it if it is open.
     * @param {string} name 'randomise', 'template' or 'algorithm'.
     */
    AlgorithmTrace.prototype.togglePanel = function(name) {
        const wasOpen = this.openPanel && this.openPanel.name === name;
        if (this.openPanel) {
            this.openPanel.node.remove();
            this.tools[this.openPanel.name].setAttribute('aria-expanded', 'false');
            this.tools[this.openPanel.name].classList.remove('active');
            this.openPanel = null;
        }
        if (!wasOpen) {
            const build = {randomise: 'buildRandomisePanel', template: 'buildTemplatePanel',
                algorithm: 'buildAlgorithmPanel'}[name];
            const node = this[build]();
            this.openPanel = {name: name, node: node};
            this.panels.appendChild(node);
            this.tools[name].setAttribute('aria-expanded', 'true');
            this.tools[name].classList.add('active');
            (node.querySelector('select, .algotrace-panel-close') || node).focus();
        }
        this.textArea.current_ui_wrapper?.updateHeight();
    };

    /**
     * A panel card with a title and a close button.
     * @param {string} name The panel name.
     * @param {string} cls Extra class.
     * @param {string} title The title.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.panel = function(name, cls, title) {
        const panel = el('div', 'algotrace-panel ' + cls);
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', title);
        const head = el('div', 'algotrace-panel-head');
        head.appendChild(el('strong', '', title));
        const close = el('button', 'algotrace-panel-close algotrace-randomise-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', this.s('close'));
        close.addEventListener('click', () => this.togglePanel(name));
        head.appendChild(close);
        panel.appendChild(head);
        return panel;
    };

    /**
     * The panel describing the template parameters.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.buildTemplatePanel = function() {
        const panel = this.panel('template', 'algotrace-template-panel', this.s('tptitle'));
        panel.appendChild(el('div', 'algotrace-panel-text', this.s('tpintro')));
        const table = el('table', 'algotrace-tptable');
        const header = el('tr');
        ['tpname', 'tpdefault', 'tpmeaning'].forEach((key) => header.appendChild(el('th', '', this.s(key))));
        table.appendChild(header);
        const example = {};
        TEMPLATE_PARAMETERS.forEach(([name, value]) => {
            const tr = el('tr');
            tr.appendChild(el('td', 'algotrace-tpname', name));
            tr.appendChild(el('td', 'algotrace-tpname', JSON.stringify(value)));
            tr.appendChild(el('td', '', this.s('tp' + name)));
            table.appendChild(tr);
            example[name] = value;
        });
        panel.appendChild(table);
        const box = this.snippetBox(panel, this.s('tpexample'), 'tpexample');
        box.value = JSON.stringify(example, null, 1).replace(/\n\s*/g, ' ');
        return panel;
    };

    /**
     * The panel describing the algorithm: what a step is, its options and the parts of a step.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.buildAlgorithmPanel = function() {
        const panel = this.panel('algorithm', 'algotrace-algorithm-panel', this.s('algotitle', this.algorithm));
        if (this.algorithm === 'custom') {
            panel.appendChild(el('div', 'algotrace-panel-text', this.s('algocustom')));
        } else {
            const stepText = el('div', 'algotrace-panel-text');
            stepText.appendChild(el('strong', '', this.s('algostep') + ' '));
            stepText.appendChild(document.createTextNode(this.s('step_' + this.algorithm)));
            panel.appendChild(stepText);
        }

        const options = ALGORITHM_OPTIONS[this.algorithm] || [];
        if (options.length) {
            panel.appendChild(el('div', 'algotrace-panel-text', this.s('algooptions')));
            const table = el('table', 'algotrace-tptable');
            const header = el('tr');
            ['algooption', 'tpdefault', 'algoallowed', 'algocurrent', 'tpmeaning'].forEach((key) => {
                header.appendChild(el('th', '', this.s(key)));
            });
            table.appendChild(header);
            const example = {};
            options.forEach((option) => {
                let def = option.def;
                if (this.algorithm === 'quick_sort' && option.name === 'pivot' && this.options.partition === 'lomuto') {
                    def = 'last';
                }
                const current = this.options[option.name];
                const tr = el('tr');
                tr.appendChild(el('td', 'algotrace-tpname', option.name));
                tr.appendChild(el('td', 'algotrace-tpname', JSON.stringify(def)));
                tr.appendChild(el('td', '', option.values ?
                    option.values.map((value) => JSON.stringify(value)).join(', ') : this.s(option.hint)));
                tr.appendChild(el('td', 'algotrace-tpname',
                    current === undefined ? this.s('algousingdefault') : JSON.stringify(current)));
                tr.appendChild(el('td', '', this.s('opt_' + this.algorithm + '_' + option.name)));
                table.appendChild(tr);
                example[option.name] = def;
            });
            panel.appendChild(table);
            const box = this.snippetBox(panel, this.s('algoexample'), 'algoexample');
            box.value = '"options": ' + JSON.stringify(example, null, 1).replace(/\n\s*/g, ' ');
        } else if (this.algorithm !== 'custom') {
            panel.appendChild(el('div', 'algotrace-panel-text', this.s('algonooptions')));
        }

        const parts = this.schema.rows.map((r) => this.s('partrow', r.name))
            .concat(this.schema.pointers.map((p) => this.s('partpointer', p.name)),
                this.schema.vars.map((name) => this.s('partvar', name)));
        const partsText = el('div', 'algotrace-panel-text');
        partsText.appendChild(el('strong', '', this.s('algoparts') + ' '));
        partsText.appendChild(document.createTextNode(parts.join(', ') + '.'));
        panel.appendChild(partsText);
        panel.appendChild(el('div', 'algotrace-panel-text', this.s('algogradeddefault', this.schema.grade.join(', '))));
        panel.appendChild(el('div', 'algotrace-panel-text',
            this.s('algogradednow', Array.from(this.graded).join(', '))));
        return panel;
    };

    /**
     * The preset that suits the question's algorithm and data.
     * @return {string}
     */
    AlgorithmTrace.prototype.defaultPreset = function() {
        const presets = presetsFor(this.algorithm);
        if (presets[0] === 'distinct' && this.data.length && typeof this.data[0] === 'string') {
            return 'letters';
        }
        return presets[0];
    };

    /**
     * The template parameters and UI parameters snippets for a preset.
     * @param {string} name The preset name.
     * @param {number} n The number of values.
     * @return {object} {templateparams, uiparameters}
     */
    AlgorithmTrace.prototype.randomSnippets = function(name, n) {
        const preset = RANDOM_PRESETS[name];
        const ui = {};
        UI_PARAMETER_NAMES.forEach((key) => {
            if (this.uiParams[key] !== undefined && this.uiParams[key] !== null) {
                ui[key] = this.uiParams[key];
            }
        });
        if (!preset.keepdata) {
            ui.data = '@@DATA@@';
        }
        if (preset.target) {
            ui.target = '@@TARGET@@';
        }
        const uiparameters = JSON.stringify(ui, null, 1).replace(/\n\s*/g, ' ')
            .replace('"@@DATA@@"', '{{ randomdata|json_encode }}')
            .replace('"@@TARGET@@"', '{{ randomtarget|json_encode }}');
        return {templateparams: preset.twig(n, this.data), uiparameters: uiparameters};
    };

    /**
     * The "Randomise data" panel.
     * @return {HTMLElement}
     */
    AlgorithmTrace.prototype.buildRandomisePanel = function() {
        const panel = this.panel('randomise', 'algotrace-randomise-panel', this.s('randomisetitle'));
        const controls = el('div', 'algotrace-randomise-controls');
        const presetLabel = el('label', '', this.s('randomisepreset') + ' ');
        const preset = el('select', 'custom-select algotrace-randomise-preset');
        presetsFor(this.algorithm).forEach((name) => {
            const option = el('option', '', this.s('preset' + name));
            option.value = name;
            preset.appendChild(option);
        });
        preset.value = this.defaultPreset();
        presetLabel.appendChild(preset);
        const sizeLabel = el('label', '', this.s('randomisesize') + ' ');
        const size = el('input', 'algotrace-randomise-size');
        size.type = 'number';
        size.min = '2';
        size.max = '30';
        size.value = String(Math.min(20, Math.max(3, this.data.length || 8)));
        sizeLabel.appendChild(size);
        controls.appendChild(presetLabel);
        controls.appendChild(sizeLabel);
        panel.appendChild(controls);

        panel.appendChild(el('div', 'algotrace-panel-text', this.s('randomisestep1')));
        const templateBox = this.snippetBox(panel, this.s('randomisestep2'), 'templateparams');
        const uiBox = this.snippetBox(panel, this.s('randomisestep3'), 'uiparameters');
        panel.appendChild(el('div', 'algotrace-panel-text algotrace-panel-note', this.s('randomisenote')));

        const update = () => {
            const n = Math.min(30, Math.max(2, parseInt(size.value) || 8));
            const snippets = this.randomSnippets(preset.value, n);
            templateBox.value = snippets.templateparams;
            uiBox.value = snippets.uiparameters;
            sizeLabel.style.display = RANDOM_PRESETS[preset.value].keepdata ? 'none' : '';
        };
        preset.addEventListener('change', update);
        size.addEventListener('input', update);
        update();
        return panel;
    };

    /**
     * Add a read-only snippet box with a Copy button to a panel.
     * @param {HTMLElement} panel The panel.
     * @param {string} label The text above the box.
     * @param {string} name A name for the box.
     * @return {HTMLTextAreaElement} The box.
     */
    AlgorithmTrace.prototype.snippetBox = function(panel, label, name) {
        panel.appendChild(el('div', 'algotrace-panel-text', label));
        const row = el('div', 'algotrace-randomise-snippet');
        const box = el('textarea', 'algotrace-randomise-code algotrace-randomise-' + name);
        box.readOnly = true;
        box.rows = 2;
        box.setAttribute('aria-label', label);
        box.addEventListener('focus', () => box.select());
        const copy = this.button(this.s('copy'), 'algotrace-randomise-copy', () => {
            const done = () => {
                copy.textContent = this.s('copydone');
                setTimeout(() => {
                    copy.textContent = this.s('copy');
                }, 1500);
            };
            const fallback = () => {
                box.focus();
                box.select();
                try {
                    if (document.execCommand('copy')) {
                        done();
                    }
                } catch (e) {
                    // The text stays selected for the teacher to copy.
                }
            };
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(box.value).then(done).catch(fallback);
            } else {
                fallback();
            }
        });
        row.appendChild(box);
        row.appendChild(copy);
        panel.appendChild(row);
        return box;
    };

    /**
     * Show a message in the status bar (kept when the UI is rebuilt).
     * @param {string|null} text The message, or null for none.
     * @param {boolean} isError Whether it is an error.
     */
    AlgorithmTrace.prototype.setStatus = function(text, isError) {
        this.status = text === null ? null : {text: text, error: Boolean(isError)};
        this.showStatus();
    };

    AlgorithmTrace.prototype.showStatus = function() {
        if (this.statusBar) {
            this.statusBar.textContent = this.status ? this.status.text : '';
            this.statusBar.classList.toggle('algotrace-fillerror', Boolean(this.status && this.status.error));
        }
        this.textArea.current_ui_wrapper?.updateHeight();
    };

    /**
     * Ask the server for the correct answer.
     * @param {number} limit How many steps; 0 for all.
     * @return {Promise} Resolves to the service's result, or null if a later call has superseded this one
     *     or the UI has gone. Rejects if the call fails.
     */
    AlgorithmTrace.prototype.callService = function(limit) {
        const call = ++this.serviceCalls;
        return Ajax.call([{
            methodname: 'qtype_coderunner_algorithm_trace_answer',
            args: {
                contextid: M.cfg.contextid,
                uiparameters: JSON.stringify(this.uiParams),
                // The question's own template parameters, for settings such as omitunchanged.
                templateparams: document.getElementById('id_templateparams')?.value || '',
                steps: limit,
            },
        }])[0].then((result) => (this.root && call === this.serviceCalls ? result : null));
    };

    /**
     * Check the question's configuration with the grader, and show any problem.
     */
    AlgorithmTrace.prototype.checkQuestion = function() {
        this.callService(1).then((result) => {
            if (result && result.error) {
                this.setStatus(this.s('checkfailed', result.error), true);
            } else if (result && result.warning) {
                this.setStatus((this.status ? this.status.text + ' ' : '') + result.warning, false);
            }
            return null;
        }).catch(() => null); // Leave the status alone if the check cannot run, e.g. with no sandbox.
    };

    /**
     * Ask the server for the correct steps and load them.
     */
    AlgorithmTrace.prototype.fillAnswer = function() {
        const limit = parseInt(this.fillSteps.value);
        this.fillButton.disabled = true;
        this.setStatus(this.s('filling'), false);
        this.callService(Number.isInteger(limit) && limit > 0 ? limit : 0).then((result) => {
            if (!result) {
                return null; // Destroyed or superseded while waiting.
            }
            if (result.error) {
                throw new Error(result.error);
            }
            const answer = JSON.parse(result.answer);
            this.remember();
            let steps = answer.steps.slice(0, MAX_STEPS).map((step) => this.normaliseStep(step));
            if (this.fixedLabels) {
                while (steps.length < this.fixedLabels.length) {
                    steps.push(this.newStep(steps.length ? steps[steps.length - 1] : this.initialStep()));
                }
                steps = steps.slice(0, this.fixedLabels.length);
            }
            this.steps = steps;
            this.render();
            this.sync();
            this.setStatus(this.s('filled', result.steps) + (result.warning ? ' ' + result.warning : ''), false);
            return null;
        }).catch((error) => {
            if (this.root) {
                this.setStatus(this.s('fillfailed', error.message || error.error || String(error)), true);
            }
        }).then(() => {
            if (this.fillButton) {
                this.fillButton.disabled = false;
            }
            return null;
        });
    };

    // ---------- Changes and history ----------

    /**
     * Record the current state before a change.
     */
    AlgorithmTrace.prototype.remember = function() {
        this.undoStack.push(JSON.stringify(this.steps));
        if (this.undoStack.length > MAX_HISTORY) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.touched = true;
    };

    AlgorithmTrace.prototype.undo = function() {
        if (this.undoStack.length) {
            this.redoStack.push(JSON.stringify(this.steps));
            this.steps = JSON.parse(this.undoStack.pop());
            this.render();
            this.sync();
        }
    };

    AlgorithmTrace.prototype.redo = function() {
        if (this.redoStack.length) {
            this.undoStack.push(JSON.stringify(this.steps));
            this.steps = JSON.parse(this.redoStack.pop());
            this.render();
            this.sync();
        }
    };

    AlgorithmTrace.prototype.addStep = function() {
        if (this.steps.length >= MAX_STEPS) {
            return;
        }
        this.remember();
        const previous = this.steps.length ? this.steps[this.steps.length - 1] : this.initialStep();
        this.steps.push(this.newStep(previous));
        const k = this.steps.length - 1;
        const first = this.rows.find((r) => r.editable);
        this.render(first ? {step: k, row: first.name, index: 0} : null);
        this.announce(this.s('added', this.stepLabel(k)));
        this.sync();
    };

    /**
     * Remove step k.
     * @param {number} k The step index.
     */
    AlgorithmTrace.prototype.removeStep = function(k) {
        const label = this.stepLabel(k);
        this.remember();
        this.steps.splice(k, 1);
        this.render();
        this.announce(this.s('removed', label));
        if (this.addButton) {
            this.addButton.focus();
        }
        this.sync();
    };

    /**
     * Make step k a copy of the step before it.
     * @param {number} k The step index.
     */
    AlgorithmTrace.prototype.resetStep = function(k) {
        this.remember();
        this.steps[k] = this.newStep(k === 0 ? this.initialStep() : this.steps[k - 1]);
        this.render();
        this.sync();
    };

    /**
     * Typing in a cell or variable box.
     * @param {Event} e The input event.
     */
    AlgorithmTrace.prototype.onInput = function(e) {
        const target = e.target;
        const k = parseInt(target.dataset.step);
        if (isNaN(k) || k < 0 || !this.steps[k]) {
            return;
        }
        if (!this.typingSnapshot) {
            // One undo entry per visit to a box, not one per keystroke.
            this.remember();
            this.typingSnapshot = true;
            this.updateButtons();
        }
        this.touched = true;
        if (target.dataset.var !== undefined) {
            this.steps[k][target.dataset.var] = target.value;
        } else if (target.dataset.row) {
            this.steps[k][target.dataset.row][parseInt(target.dataset.index)] = target.value;
            this.updateChanged();
        }
        this.sync();
    };

    /**
     * Keyboard: Alt+Left/Right swap cells; Left/Right/Delete move chips.
     * @param {KeyboardEvent} e The event.
     */
    AlgorithmTrace.prototype.onKeyDown = function(e) {
        const target = e.target;
        const k = parseInt(target.dataset.step);
        if (isNaN(k) || k < 0 || this.readOnly) {
            return;
        }
        if (target.classList.contains('algotrace-cell') && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            const i = parseInt(target.dataset.index);
            const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
            const name = target.dataset.row;
            if (j >= 0 && j < this.steps[k][name].length) {
                e.preventDefault();
                this.swapCells(k, name, i, j);
                this.render({step: k, row: name, index: j});
                this.sync();
            }
        } else if (target.classList.contains('algotrace-chip')) {
            const name = target.dataset.chip;
            const ptr = this.pointers.find((p) => p.name === name);
            const current = this.steps[k][name];
            let next;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const delta = e.key === 'ArrowLeft' ? -1 : 1;
                next = current === null ? 0 : Math.min(ptr.slots - 1, Math.max(0, current + delta));
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                next = null;
            } else if (e.key === 'Escape') {
                this.selectedChip = null;
                this.render({step: k, chip: name});
                return;
            } else {
                return;
            }
            e.preventDefault();
            if (next !== current) {
                this.setPointer(k, name, next);
                this.render({step: k, chip: name});
                this.sync();
            }
        }
    };

    /**
     * Swap two cells of a row in step k.
     * @param {number} k Step index.
     * @param {string} name Row name.
     * @param {number} i First position.
     * @param {number} j Second position.
     */
    AlgorithmTrace.prototype.swapCells = function(k, name, i, j) {
        this.remember();
        const cells = this.steps[k][name];
        const value = cells[i];
        cells[i] = cells[j];
        cells[j] = value;
        this.announce(this.s('swapped', {from: i, to: j}));
    };

    /**
     * Move the value at position i to the gap before position gap.
     * @param {number} k Step index.
     * @param {string} name Row name.
     * @param {number} i Source position.
     * @param {number} gap Gap index, 0 to length.
     */
    AlgorithmTrace.prototype.moveCell = function(k, name, i, gap) {
        const cells = this.steps[k][name];
        const dest = gap > i ? gap - 1 : gap;
        if (dest === i) {
            return;
        }
        this.remember();
        const value = cells.splice(i, 1)[0];
        cells.splice(dest, 0, value);
        this.announce(this.s('moved', {from: i, to: dest}));
    };

    /**
     * Place (or remove, with null) a pointer in step k.
     * @param {number} k Step index.
     * @param {string} name Pointer name.
     * @param {number|null} slot Position.
     */
    AlgorithmTrace.prototype.setPointer = function(k, name, slot) {
        this.remember();
        this.steps[k][name] = slot;
        this.announce(this.s('pointer', {name: name,
            place: slot === null ? this.s('notplaced') : this.s('position', slot)}));
    };

    // ---------- Dragging ----------

    /**
     * Start a possible drag of a cell or pointer chip.
     * @param {PointerEvent} e The event.
     */
    AlgorithmTrace.prototype.onPointerDown = function(e) {
        if (this.readOnly || e.button !== 0) {
            return;
        }
        const chip = e.target.closest('.algotrace-chip');
        const cell = e.target.closest('.algotrace-cell');
        const slot = e.target.closest('.algotrace-slot, .algotrace-tray');
        if (chip) {
            this.drag = {kind: 'chip', node: chip, step: parseInt(chip.dataset.step), name: chip.dataset.chip,
                x: e.clientX, y: e.clientY, started: false};
        } else if (cell) {
            this.drag = {kind: 'cell', node: cell, step: parseInt(cell.dataset.step), row: cell.dataset.row,
                index: parseInt(cell.dataset.index), x: e.clientX, y: e.clientY, started: false};
        } else if (slot && this.selectedChip && parseInt(slot.dataset.step) === this.selectedChip.step) {
            // Click-to-place for a selected chip.
            const target = slot.dataset.slot === 'none' ? null : parseInt(slot.dataset.slot);
            const sel = this.selectedChip;
            this.selectedChip = null;
            this.setPointer(sel.step, sel.name, target);
            this.render({step: sel.step, chip: sel.name});
            this.sync();
            e.preventDefault();
        }
    };

    /**
     * Follow a drag.
     * @param {PointerEvent} e The event.
     */
    AlgorithmTrace.prototype.onPointerMove = function(e) {
        const drag = this.drag;
        if (!drag) {
            return;
        }
        if (!drag.started) {
            if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_THRESHOLD) {
                return;
            }
            drag.started = true;
            drag.node.blur();
            window.getSelection()?.removeAllRanges();
            this.root.classList.add('algotrace-dragging');
            drag.node.classList.add('algotrace-dragsource');
            const text = drag.kind === 'chip' ? drag.name :
                drag.node.value !== undefined ? drag.node.value : drag.node.textContent;
            drag.ghost = el('div', 'algotrace-ghost' + (drag.kind === 'chip' ? ' algotrace-chipghost' : ''), text);
            document.body.appendChild(drag.ghost);
        }
        e.preventDefault();
        drag.ghost.style.left = (e.clientX + 6) + 'px';
        drag.ghost.style.top = (e.clientY + 6) + 'px';
        this.showDropTarget(this.dropTarget(e.clientX, e.clientY));
    };

    /**
     * Where a drag would drop at a screen position.
     * @param {number} x Client x.
     * @param {number} y Client y.
     * @return {object|null}
     */
    AlgorithmTrace.prototype.dropTarget = function(x, y) {
        const drag = this.drag;
        const under = document.elementFromPoint(x, y);
        if (!under || !this.root.contains(under)) {
            return null;
        }
        if (drag.kind === 'chip') {
            const slot = under.closest('.algotrace-slot, .algotrace-tray');
            if (!slot || parseInt(slot.dataset.step) !== drag.step) {
                return null;
            }
            const ptr = this.pointers.find((p) => p.name === drag.name);
            const index = slot.dataset.slot === 'none' ? null : parseInt(slot.dataset.slot);
            return index !== null && index >= ptr.slots ? null : {node: slot, slot: index};
        }
        const cell = under.closest('input.algotrace-cell');
        if (!cell || cell === drag.node) {
            return null;
        }
        const k = parseInt(cell.dataset.step);
        const name = cell.dataset.row;
        const index = parseInt(cell.dataset.index);
        if (drag.step === k && drag.row === name) {
            const rect = cell.getBoundingClientRect();
            const frac = (x - rect.left) / rect.width;
            if (frac < EDGE_FRACTION) {
                return {node: cell, step: k, row: name, gap: index, side: 'before'};
            }
            if (frac > 1 - EDGE_FRACTION) {
                return {node: cell, step: k, row: name, gap: index + 1, side: 'after'};
            }
            return {node: cell, step: k, row: name, index: index, mode: 'swap'};
        }
        return {node: cell, step: k, row: name, index: index, mode: 'copy'};
    };

    /**
     * Highlight the current drop target.
     * @param {object|null} target The target.
     */
    AlgorithmTrace.prototype.showDropTarget = function(target) {
        this.root.querySelectorAll('.algotrace-droptarget, .algotrace-dropbefore, .algotrace-dropafter').forEach((node) => {
            node.classList.remove('algotrace-droptarget', 'algotrace-dropbefore', 'algotrace-dropafter');
        });
        if (target) {
            target.node.classList.add(target.side === 'before' ? 'algotrace-dropbefore' :
                target.side === 'after' ? 'algotrace-dropafter' : 'algotrace-droptarget');
        }
    };

    /**
     * Finish a drag (or a click on a chip).
     * @param {PointerEvent} e The event.
     */
    AlgorithmTrace.prototype.onPointerUp = function(e) {
        const drag = this.drag;
        if (!drag) {
            return;
        }
        if (!drag.started) {
            this.drag = null;
            if (drag.kind === 'chip') {
                // A click selects the chip for click-to-place or arrow keys.
                const same = this.selectedChip && this.selectedChip.step === drag.step && this.selectedChip.name === drag.name;
                this.selectedChip = same ? null : {step: drag.step, name: drag.name};
                this.render({step: drag.step, chip: drag.name});
            }
            return;
        }
        const target = this.dropTarget(e.clientX, e.clientY);
        this.endDrag();
        if (!target) {
            return;
        }
        let focus = null;
        if (drag.kind === 'chip') {
            if (target.slot !== this.steps[drag.step][drag.name]) {
                this.setPointer(drag.step, drag.name, target.slot);
            }
            this.selectedChip = null;
            focus = {step: drag.step, chip: drag.name};
        } else if (target.gap !== undefined) {
            this.moveCell(target.step, target.row, drag.index, target.gap);
            focus = {step: target.step, row: target.row, index: target.gap > drag.index ? target.gap - 1 : target.gap};
        } else if (target.mode === 'swap') {
            this.swapCells(target.step, target.row, drag.index, target.index);
            focus = {step: target.step, row: target.row, index: target.index};
        } else {
            const source = drag.step < 0 ? show(this.data[drag.index]) :
                this.steps[drag.step][drag.row][drag.index];
            this.remember();
            this.steps[target.step][target.row][target.index] = source;
            this.announce(this.s('copied', source));
            focus = {step: target.step, row: target.row, index: target.index};
        }
        this.render(focus);
        this.sync();
    };

    AlgorithmTrace.prototype.endDrag = function() {
        const drag = this.drag;
        this.drag = null;
        if (!drag || !drag.started) {
            return;
        }
        drag.ghost?.remove();
        drag.node.classList.remove('algotrace-dragsource');
        this.root.classList.remove('algotrace-dragging');
        this.showDropTarget(null);
    };

    // ---------- Wrapper interface ----------

    /**
     * The serialised answer.
     * @return {string}
     */
    AlgorithmTrace.prototype.serialise = function() {
        if (!this.touched) {
            return '';
        }
        const names = this.rows.filter((r) => r.editable).map((r) => r.name)
            .concat(this.pointers.map((ptr) => ptr.name), this.vars);
        const steps = this.steps.map((step) => {
            const out = {};
            names.forEach((name) => {
                out[name] = clone(step[name]);
            });
            return out;
        });
        return JSON.stringify({type: SERIALISATION_TYPE, version: SERIALISATION_VERSION, algorithm: this.algorithm,
            steps: steps});
    };

    AlgorithmTrace.prototype.sync = function() {
        if (this.fail || this.configError || this.readOnly) {
            return;
        }
        const value = this.serialise();
        if (this.textArea.value !== value) {
            this.textArea.value = value;
            this.textArea.dispatchEvent(new Event('change', {bubbles: true}));
        }
    };

    AlgorithmTrace.prototype.syncIntervalSecs = function() {
        return 0; // Every change syncs straight away.
    };

    AlgorithmTrace.prototype.resize = function(width, height) {
        this.width = width;
        this.height = height;
        if (this.root) {
            this.root.style.maxWidth = width + 'px';
            this.root.style.height = height + 'px';
        }
    };

    AlgorithmTrace.prototype.requiredHeight = function() {
        if (!this.root) {
            return null;
        }
        let total = 0;
        Array.from(this.root.children).forEach((child) => {
            if (child === this.content) {
                total += child.scrollHeight;
            } else {
                total += child.offsetHeight;
            }
        });
        return total + 12;
    };

    AlgorithmTrace.prototype.hasFocus = function() {
        return Boolean(this.root && this.root.contains(document.activeElement));
    };

    AlgorithmTrace.prototype.destroy = function() {
        this.sync();
        this.endDrag();
        this.closeHelp();
        this.listeners.forEach(([target, type, handler]) => target.removeEventListener(type, handler));
        this.listeners = [];
        this.root?.remove();
        this.root = null;
        this.content = null;
    };

    return {
        Constructor: AlgorithmTrace,
        // For tests: the schemas must match the prototype's grader.
        schemaFor: schemaFor,
        parseData: parseData,
        parseAsk: parseAsk,
    };
});
