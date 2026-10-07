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
 * JavaScript UI wrapper for the Monaco editor within CodeRunner.
 *
 * Provides an implementation of the interface required by
 * {@link qtype_coderunner/userinterfacewrapper}.
 *
 * @module qtype_coderunner/ui_monaco
 * @copyright Richard Lobb
 * @license http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define(['qtype_coderunner/monaco_coderunner_adapter', 'core/str'], function(adapter, Str) {
    'use strict';

    const DEFAULTS = {
        import_from_scratchpad: true,
        font_size: 14,
        theme: '',
        auto_switch_light_dark: true,
        minimap: false,
        word_wrap: 'off',
        tab_size: 4,
        lsp_enabled: true,
        lsp_language: '',
        lsp_prefix_code: '',
        lsp_url: '',
        lsp_base_url: '',
        use_simple_lsp: true,
        rich_features: true,
        semantic_highlighting: false,
        disable_lsp_prefixes: false,
        lsp_workspace_config: ''
    };

    const MODEL_EXTENSION_MAP = {
        python: 'py',
        java: 'java',
        javascript: 'js',
        typescript: 'ts',
        c: 'c',
        cpp: 'cpp',
        csharp: 'cs',
        php: 'php',
        ruby: 'rb',
        go: 'go',
        kotlin: 'kt',
        swift: 'swift',
        scala: 'scala',
        rust: 'rs',
        haskell: 'hs',
        perl: 'pl',
        pascal: 'pas',
        r: 'r',
        lua: 'lua',
        dart: 'dart',
        shell: 'sh',
        'objective-c': 'm',
        sql: 'sql',
        mongodb: 'mongodb',
        cypher: 'cypher',
        hbase: 'hbase',
        solidity: 'sol',
        sol: 'sol',  // Monaco language ID for Solidity
        html: 'html',
        css: 'css',
        json: 'json',
        xml: 'xml',
        yaml: 'yaml',
        markdown: 'md',
        plaintext: 'txt'
    };

    const MONACO_THEME_DEFS = [
        {name: 'one-dark', path: '/question/type/coderunner/thirdparty/onedark-theme/OneDark.json', base: 'vs-dark'},
        {name: 'one-light', path: '/question/type/coderunner/thirdparty/onedark-theme/OneLight.json', base: 'vs'}
    ];

    let monacoThemePromise = null;
    let monacoThemesAvailable = false;

    /**
     * Interpret a boolean-ish UI parameter value.
     *
     * @param {*} value A boolean, 'true'/'1' string, or number.
     * @param {boolean} fallback Value to use for any other type.
     * @returns {boolean}
     */
    function normaliseBoolean(value, fallback) {
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
     * Parse an integer UI parameter value.
     *
     * @param {*} value The value to parse.
     * @param {number} fallback Value to use if it is not a number.
     * @returns {number}
     */
    function parseNumber(value, fallback) {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? fallback : parsed;
    }

    /**
     * Build the virtual workspace root URI for a language.
     *
     * @param {string} language Monaco language id.
     * @returns {string}
     */
    function buildWorkspaceRootUri(language) {
        return 'file:///coderunner/' + language;
    }

    /**
     * Build a model URI that is unique per textarea, since Monaco refuses to create two models
     * with the same URI (e.g. two questions of the same language on one quiz page).
     * Student Java answers keep the fixed file name id_student_answer.java (as before) but each
     * lives in its own per-textarea directory under the shared Java workspace root.
     *
     * @param {string} textareaId
     * @param {string} language Monaco language id.
     * @returns {string}
     */
    function buildModelUri(textareaId, language) {
        const safeId = String(textareaId || 'answer').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const ext = MODEL_EXTENSION_MAP[language] || 'txt';
        const root = buildWorkspaceRootUri(language);
        if (language === 'java') {
            if (/^id_answer(preload)?/.test(safeId)) {
                return root + '/' + safeId + '.' + ext;
            }
            return root + '/' + safeId + '/id_student_answer.' + ext;
        }
        return root + '/' + safeId + '.' + ext;
    }

    /**
     * Convert a VS Code (TextMate) theme JSON into a Monaco theme definition.
     *
     * @param {object} data The VS Code theme data.
     * @param {string} base The Monaco base theme ('vs' or 'vs-dark').
     * @returns {object} Monaco theme definition.
     */
    function convertTheme(data, base) {
        const rules = [];
        const tokenColors = data.tokenColors || [];
        const hexPattern = /^#([0-9a-fA-F]{3,8})$/;
        /**
         * Strip the '#' from a valid hex colour.
         *
         * @param {string} value The colour string.
         * @returns {string|undefined} Hex digits, or undefined if not a valid hex colour.
         */
        function normaliseColor(value) {
            if (typeof value !== 'string') {
                return undefined;
            }
            const trimmed = value.trim();
            if (!hexPattern.test(trimmed)) {
                return undefined;
            }
            return trimmed.replace('#', '');
        }

        for (let i = 0; i < tokenColors.length; i++) {
            const item = tokenColors[i] || {};
            let scopes = item.scope;
            if (!scopes) {
                continue;
            }
            if (!Array.isArray(scopes)) {
                scopes = [scopes];
            }
            const settings = item.settings || {};
            for (let j = 0; j < scopes.length; j++) {
                const scope = scopes[j];
                if (!scope) {
                    continue;
                }
                const rule = { token: scope };
                const fg = normaliseColor(settings.foreground);
                if (fg) {
                    rule.foreground = fg;
                }
                const bg = normaliseColor(settings.background);
                if (bg) {
                    rule.background = bg;
                }
                if (settings.fontStyle) {
                    rule.fontStyle = settings.fontStyle;
                }
                if (rule.foreground || rule.background || rule.fontStyle) {
                    rules.push(rule);
                }
            }
        }
        return {
            base: base,
            inherit: true,
            rules: rules,
            colors: data.colors || {}
        };
    }

    /**
     * Fetch a theme JSON file.
     *
     * @param {string} url The theme URL.
     * @returns {Promise} Resolves with the parsed JSON.
     */
    function fetchTheme(url) {
        if (typeof fetch !== 'function') {
            return Promise.reject(new Error('fetch unavailable'));
        }
        return fetch(url, { credentials: 'same-origin' }).then(function(response) {
            if (!response.ok) {
                throw new Error('Theme request failed');
            }
            return response.json();
        });
    }

    /**
     * Fetch and define the extra Monaco themes (once).
     *
     * @param {object} monaco The monaco namespace.
     * @returns {Promise} Resolves with true if the themes were defined, else false.
     */
    function loadMonacoThemes(monaco) {
        if (!monaco || !monaco.editor || typeof monaco.editor.defineTheme !== 'function') {
            monacoThemesAvailable = false;
            return Promise.resolve(false);
        }
        if (monacoThemePromise) {
            return monacoThemePromise;
        }
        const wwwroot = (window.M && M.cfg && M.cfg.wwwroot) ? M.cfg.wwwroot : '';
        monacoThemePromise = Promise.all(MONACO_THEME_DEFS.map(function(def) {
            return fetchTheme(wwwroot + def.path).then(function(data) {
                return { name: def.name, theme: convertTheme(data, def.base) };
            });
        })).then(function(themes) {
            for (let i = 0; i < themes.length; i++) {
                const entry = themes[i];
                if (entry && entry.theme) {
                    monaco.editor.defineTheme(entry.name, entry.theme);
                }
            }
            monacoThemesAvailable = true;
            return true;
        }).catch(function() {
            monacoThemesAvailable = false;
            return false;
        });
        return monacoThemePromise;
    }

    /**
     * If the code is Scratchpad UI JSON, extract its answer code; otherwise return it unchanged.
     *
     * @param {string} code The textarea contents.
     * @returns {string}
     */
    function extractFromScratchpadMaybe(code) {
        if (!code) {
            return '';
        }
        try {
            const parsed = JSON.parse(code);
            if (parsed && parsed.answer_code && parsed.answer_code.length) {
                return parsed.answer_code[0];
            }
        } catch (err) {
            // Not scratchpad JSON; ignore.
        }
        return code;
    }

    /**
     * Build the language server configuration from the UI parameters.
     *
     * @param {object} params The UI parameters.
     * @param {string} lang Monaco language id.
     * @returns {object} Config with 'enabled' and, if enabled, lspUrl, lspBaseUrl and useSimple.
     */
    function buildLspConfig(params, lang) {
        const base = params.lsp_base_url || '';
        const url = params.lsp_url || '';
        const enabled = normaliseBoolean(params.lsp_enabled, DEFAULTS.lsp_enabled);

        if (!enabled) {
            return { enabled: false };
        }

        if (!base && !url) {
            return { enabled: false };
        }

        const cleanedBase = base ? base.replace(/\/$/, '') : '';
        const resolvedUrl = url || (cleanedBase ? cleanedBase + '/' + lang : '');
        const useSimple = normaliseBoolean(params.use_simple_lsp, DEFAULTS.use_simple_lsp);

        return {
            enabled: true,
            lspUrl: resolvedUrl,
            lspBaseUrl: cleanedBase || '',
            useSimple: useSimple
        };
    }

    /**
     * Log a failure to initialise the editor.
     *
     * @param {*} error
     */
    function logInitFailure(error) {
        if (window.console && window.console.error) {
            window.console.error('Failed to initialise Monaco UI', error);
        }
    }

    /**
     * Constructor for the Monaco UI wrapper.
     *
     * @param {string} textareaId The id of the textarea the editor replaces.
     * @param {number} width The width in pixels (unused; the editor fills its container).
     * @param {number} height The height in pixels.
     * @param {object} params The UI parameters.
     */
    function MonacoWrapper(textareaId, width, height, params) {
        this.textarea = document.getElementById(textareaId);
        this.failKey = 'monaco_ui_notready';
        this.failedFlag = false;
        this.destroyed = false;
        this.monaco = null;
        this.model = null;
        this.editorApi = null;
        this.editor = null;
        this.readyPromise = null;
        this.contentsChanged = false;
        this.allowFullscreen = true;

        const appliedParams = Object.assign({}, DEFAULTS, params || {});
        const initialValue = appliedParams.import_from_scratchpad ?
            extractFromScratchpadMaybe(this.textarea.value) :
            (this.textarea.value || '');
        this.textarea.value = initialValue;

        this.container = document.createElement('div');
        this.container.classList.add('coderunner-monaco-container');
        this.container.style.width = '100%';
        this.container.style.height = (height || this.textarea.clientHeight || 200) + 'px';
        this.container.setAttribute('role', 'application');

        const semanticHighlighting = normaliseBoolean(appliedParams.semantic_highlighting, DEFAULTS.semantic_highlighting || false);
        const readOnly = !!this.textarea.readOnly;

        this.textareaId = textareaId;
        this.appliedParams = appliedParams;
        this.readOnly = readOnly;
        this.initialValue = initialValue;
        this.configureLanguage(appliedParams.lsp_language || appliedParams.lang);
        this.editorOptions = {
            readOnly: readOnly,
            fontSize: parseNumber(appliedParams.font_size, DEFAULTS.font_size),
            minimap: { enabled: normaliseBoolean(appliedParams.minimap, DEFAULTS.minimap) },
            wordWrap: appliedParams.word_wrap || DEFAULTS.word_wrap,
            tabSize: parseNumber(appliedParams.tab_size, DEFAULTS.tab_size),
            insertSpaces: true,
            renderWhitespace: 'none',
            fixedOverflowWidgets: true,
            scrollBeyondLastLine: false,
            scrollBeyondLastColumn: 0,
            'semanticHighlighting.enabled': semanticHighlighting,
            links: true,
            codeLens: true,
            lightbulb: {
                enabled: true
            },
            stickyScroll: { enabled: false },
            inlayHints: {
                enabled: !readOnly
            }
        };
    }

    /**
     * Set up everything that depends on the language: the Monaco language id, the model URI
     * and the adapter (LSP) options used when the editor is created.
     *
     * @param {string} languageHint A CodeRunner or Monaco language name.
     */
    MonacoWrapper.prototype.configureLanguage = function(languageHint) {
        const params = this.appliedParams;
        const monacoLang = adapter.mapMonacoLanguage(languageHint);
        const builtinWorkerLanguages = ['css', 'javascript', 'typescript'];
        const useBuiltinServices = builtinWorkerLanguages.indexOf(monacoLang) !== -1;
        const lspConfig = useBuiltinServices ? { enabled: false } : buildLspConfig(params, monacoLang);
        const useSimple = useBuiltinServices ? false : normaliseBoolean(params.use_simple_lsp, DEFAULTS.use_simple_lsp);
        const disableLspPrefixes = normaliseBoolean(params.disable_lsp_prefixes, DEFAULTS.disable_lsp_prefixes);

        this.monacoLang = monacoLang;
        this.modelPath = buildModelUri(this.textareaId, monacoLang);
        this.adapterOptions = {
            language: monacoLang,
            value: this.initialValue,
            prefixCode: disableLspPrefixes ? '' : (params.lsp_prefix_code || ''),
            lspUrl: lspConfig.enabled ? lspConfig.lspUrl : null,
            lspBaseUrl: lspConfig.enabled ? lspConfig.lspBaseUrl : null,
            useSimpleLsp: lspConfig.enabled ? lspConfig.useSimple : useSimple,
            lspEnabled: lspConfig.enabled,
            richFeatures: normaliseBoolean(params.rich_features, DEFAULTS.rich_features),
            semanticHighlighting: normaliseBoolean(params.semantic_highlighting, DEFAULTS.semantic_highlighting || false),
            workspaceConfig: params.lsp_workspace_config || DEFAULTS.lsp_workspace_config,
            path: this.modelPath,
            workspaceRootUri: buildWorkspaceRootUri(monacoLang),
            enableInlayHints: !this.readOnly
        };
    };

    /**
     * Optional UI plugin API, called by multi-language questions when the student picks a
     * language. Rebuilds the editor (keeping its text) so that highlighting and the language
     * server follow the new language.
     *
     * @param {string} language The CodeRunner language name, e.g. 'python3' or 'java'.
     */
    MonacoWrapper.prototype.setLanguage = function(language) {
        if (!language || this.destroyed || adapter.mapMonacoLanguage(language) === this.monacoLang) {
            return;
        }
        this.sync();
        this.initialValue = this.textarea.value;
        this.configureLanguage(language);
        if (!this.monaco || !this.model) {
            return; // Still loading: ready() creates the model for the new language.
        }
        const hadFocus = this.hasFocus();
        this.disposeEditor();
        try {
            this.model = adapter.createMonacoModel(this.monaco, this.monacoLang, this.initialValue, this.modelPath);
            this.postInsert();
            if (hadFocus && this.editor) {
                this.editor.focus();
            }
        } catch (error) {
            // postInsert() has already logged it and marked the UI failed; the text is safe
            // in the textarea.
        }
    };

    /**
     * Load Monaco (plus themes) and create the editor model. The editor itself is created in
     * postInsert(), once the container is in the live DOM and can be measured.
     *
     * @returns {Promise} Resolves when the model exists; rejects on any failure or if destroyed.
     */
    MonacoWrapper.prototype.ready = function() {
        if (this.readyPromise) {
            return this.readyPromise;
        }
        const self = this;
        const bailIfDestroyed = function() {
            if (self.destroyed) {
                throw new Error('Monaco UI destroyed during initialisation');
            }
        };
        this.readyPromise = adapter.loadMonaco().then(function(monaco) {
            bailIfDestroyed();
            return loadMonacoThemes(monaco).catch(function() {
                // Theme loading is best-effort.
            }).then(function() {
                return monaco;
            });
        }).then(function(monaco) {
            bailIfDestroyed();
            if (typeof adapter.createMonacoModel !== 'function') {
                throw new Error('Monaco adapter cannot create models');
            }
            const model = adapter.createMonacoModel(monaco, self.monacoLang, self.initialValue, self.modelPath);
            if (!model) {
                throw new Error('Monaco adapter did not return a model');
            }
            self.monaco = monaco;
            self.model = model;
        }).catch(function(error) {
            self.failedFlag = true;
            if (!self.destroyed) {
                logInitFailure(error);
            }
            throw error;
        });
        return this.readyPromise;
    };

    /**
     * Create the editor now that the container is in the live DOM. Throws (so the wrapper
     * falls back to the raw textarea) if the editor can't be created.
     */
    MonacoWrapper.prototype.postInsert = function() {
        if (this.destroyed || !this.model) {
            return;
        }
        const self = this;
        try {
            this.editorApi = adapter.createMonacoLspEditor(this.container,
                Object.assign({}, this.adapterOptions, { monaco: this.monaco, model: this.model }));
            if (!this.editorApi || !this.editorApi.editor) {
                throw new Error('Monaco adapter did not return an editor instance');
            }
            const editor = this.editorApi.editor;
            editor.updateOptions(this.editorOptions);
            // Monaco themes are page-wide: the first Monaco UI on the page picks the theme.
            adapter.applyInitialMonacoTheme(this.monaco, this.appliedParams,
                {customThemesAvailable: monacoThemesAvailable});
            this.editor = editor;
        } catch (error) {
            // The adapter may have built an editor before throwing; don't leak it.
            const knownEditor = this.editorApi ? this.editorApi.editor : null;
            const container = this.container;
            try {
                this.monaco.editor.getEditors().forEach(function(ed) {
                    const node = ed.getContainerDomNode ? ed.getContainerDomNode() : null;
                    if (ed !== knownEditor && node && container.contains(node)) {
                        ed.dispose();
                    }
                });
            } catch (err) {
                // Ignore disposal errors.
            }
            // Don't let sync()/destroy() copy a half-built editor into the textarea.
            this.disposeEditor();
            this.failedFlag = true;
            logInitFailure(error);
            throw error;
        }

        if (!this.readOnly) {
            this.editor.onDidChangeModelContent(function() {
                if (self.editor) {
                    self.textarea.value = self.editor.getValue();
                    self.contentsChanged = true;
                }
            });

            this.editor.onDidBlurEditorText(function() {
                if (self.contentsChanged) {
                    const changeEvent = new Event('change', { bubbles: true });
                    self.textarea.dispatchEvent(changeEvent);
                    self.contentsChanged = false;
                }
            });
        }

        Str.get_string('monaco_aria_label', 'qtype_coderunner').then(function(label) {
            self.container.setAttribute('aria-label', label);
        }).catch(function() {
            self.container.setAttribute('aria-label', 'Monaco editor');
        });
    };

    MonacoWrapper.prototype.getElement = function() {
        return this.container;
    };

    MonacoWrapper.prototype.failed = function() {
        return this.failedFlag;
    };

    MonacoWrapper.prototype.failMessage = function() {
        return this.failKey;
    };

    MonacoWrapper.prototype.sync = function() {
        if (this.editor && !this.destroyed) {
            this.textarea.value = this.editor.getValue();
        }
    };

    /**
     * Dispose the editor, its LSP binding and the model (whichever exist).
     */
    MonacoWrapper.prototype.disposeEditor = function() {
        if (this.editorApi && this.editorApi.dispose) {
            try {
                this.editorApi.dispose();
            } catch (err) {
                // Ignore disposal errors.
            }
        }
        if (this.model) {
            try {
                this.model.dispose();
            } catch (err) {
                // Ignore disposal errors.
            }
        }
        this.editor = null;
        this.editorApi = null;
        this.model = null;
    };

    MonacoWrapper.prototype.destroy = function() {
        this.sync();
        this.destroyed = true;
        this.disposeEditor();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.textarea.style.display = '';
    };

    MonacoWrapper.prototype.resize = function(width, height) {
        if (typeof width === 'number') {
            this.container.style.width = width + 'px';
        }
        if (typeof height === 'number') {
            this.container.style.height = height + 'px';
        }
        if (this.editor) {
            this.editor.layout();
        }
    };

    MonacoWrapper.prototype.hasFocus = function() {
        return !!(this.editor && this.editor.hasTextFocus && this.editor.hasTextFocus());
    };

    MonacoWrapper.prototype.syncIntervalSecs = function() {
        return 2;
    };

    MonacoWrapper.prototype.allowFullScreen = function() {
        return this.allowFullscreen;
    };

    MonacoWrapper.prototype.setAllowFullScreen = function(allow) {
        this.allowFullscreen = !!allow;
    };

    return {
        Constructor: MonacoWrapper
    };
});
