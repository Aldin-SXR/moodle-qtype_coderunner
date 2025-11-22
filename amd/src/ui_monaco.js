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

    const STORAGE_THEME_KEY = 'qtype_coderunner.monaco.theme';
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
        disable_lsp_prefixes: false,
        lsp_workspace_config: ''
    };

    const LANGUAGE_MAP = {
        python: 'python',
        python2: 'python',
        python3: 'python',
        py: 'python',
        py2: 'python',
        py3: 'python',
        pypy3: 'python',
        java: 'java',
        javascript: 'javascript',
        nodejs: 'javascript',
        node: 'javascript',
        typescript: 'typescript',
        ts: 'typescript',
        c: 'c',
        c11: 'c',
        c99: 'c',
        c90: 'c',
        cpp: 'cpp',
        cplusplus: 'cpp',
        'c++': 'cpp',
        cxx: 'cpp',
        csharp: 'csharp',
        'c#': 'csharp',
        php: 'php',
        ruby: 'ruby',
        go: 'go',
        kotlin: 'kotlin',
        swift: 'swift',
        scala: 'scala',
        rust: 'rust',
        haskell: 'haskell',
        sql: 'sql',
        mysql: 'sql',
        postgres: 'pgsql',
        pgsql: 'pgsql',
        mongo: 'mongodb',
        mongosh: 'mongodb',
        mongodb: 'mongodb',
        cypher: 'cypher',
        neo4j: 'cypher',
        hbase: 'hbase',
        solidity: 'sol',
        sol: 'sol',
        html: 'html',
        css: 'css',
        json: 'json',
        xml: 'xml',
        plaintext: 'plaintext'
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
        sql: 'sql',
        mongodb: 'mongodb',
        cypher: 'cypher',
        hbase: 'hbase',
        solidity: 'sol',
        html: 'html',
        css: 'css',
        json: 'json',
        xml: 'xml',
        plaintext: 'txt'
    };

    const MONACO_THEME_DEFS = [
        {name: 'one-dark', path: '/question/type/coderunner/monaco/vs/themes/OneDark.json', base: 'vs-dark'},
        {name: 'one-light', path: '/question/type/coderunner/monaco/vs/themes/OneLight.json', base: 'vs'}
    ];

    let monacoLoadPromise = null;
    let monacoThemePromise = null;
    let monacoThemesAvailable = false;

    function getMonacoBasePath() {
        const root = (window.M && M.cfg && M.cfg.wwwroot) ? M.cfg.wwwroot : '';
        return root + '/question/type/coderunner/monaco/vs';
    }

    function disableHtmlCompletions(monaco) {
        try {
            const defaults = monaco && monaco.languages && monaco.languages.html && monaco.languages.html.htmlDefaults;
            if (!defaults || typeof defaults.setModeConfiguration !== 'function') {
                return;
            }
            const current = defaults.modeConfiguration || {};
            if (current.completionItems === false) {
                return;
            }
            const updated = Object.assign({}, current, { completionItems: false });
            defaults.setModeConfiguration(updated);
        } catch (err) {
            // Ignore config failures.
        }
    }

    function ensureRequireConfigured() {
        if (typeof require === 'undefined' || !require || !require.config) {
            throw new Error('RequireJS not available');
        }
        const context = require.s && require.s.contexts && require.s.contexts._;
        const paths = context && context.config && context.config.paths ? context.config.paths : {};
        if (!paths.vs) {
            require.config({
                paths: { vs: getMonacoBasePath() }
            });
        }

        if (!window.MonacoEnvironment) {
            window.MonacoEnvironment = {};
        }
        if (!window.MonacoEnvironment.baseUrl) {
            window.MonacoEnvironment.baseUrl = getMonacoBasePath();
        }
        // Worker URL: point directly to Monaco's workerMain (it loads language workers itself).
        window.MonacoEnvironment.getWorkerUrl = function() {
            const base = window.MonacoEnvironment.baseUrl || getMonacoBasePath();
            return base + '/base/worker/workerMain.js';
        };
    }

    function ensureMonacoLoaded() {
        if (window.monaco && window.monaco.editor) {
            return Promise.resolve(window.monaco);
        }

        if (!monacoLoadPromise) {
            monacoLoadPromise = new Promise(function(resolve, reject) {
                try {
                    ensureRequireConfigured();
                    require(['vs/editor/editor.main'], function(monaco) {
                        disableHtmlCompletions(monaco);
                        // Register MongoDB language
                        require(['vs/basic-languages/mongodb/mongodb'], function(mongodb) {
                            try {
                                const alreadyRegistered = monaco.languages.getLanguages()
                                    .some(function(lang) { return lang.id === 'mongodb'; });
                                if (!alreadyRegistered) {
                                    monaco.languages.register({
                                        id: 'mongodb',
                                        extensions: ['.mongodb', '.mongosh', '.mongo'],
                                        aliases: ['MongoDB', 'mongodb', 'mongosh', 'mongo'],
                                        mimetypes: ['text/mongodb']
                                    });
                                }
                                monaco.languages.setLanguageConfiguration('mongodb', mongodb.conf);
                                monaco.languages.setMonarchTokensProvider('mongodb', mongodb.language);
                            } catch (langerr) {
                                // Ignore failures to register; the editor will fall back to plain text.
                            }

                            // Note: Solidity is already auto-registered by Monaco as 'sol'
                            // MongoDB needs manual registration as it's not in Monaco's default set
                            resolve(monaco);
                        }, function() {
                            // Continue even if the highlighting module fails to load.
                            resolve(monaco);
                        });
                    }, reject);
                } catch (err) {
                    reject(err);
                }
            });
        }
        return monacoLoadPromise;
    }

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

    function parseNumber(value, fallback) {
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? fallback : parsed;
    }

    function mapLanguage(lang) {
        if (!lang) {
            return 'plaintext';
        }
        const key = String(lang).toLowerCase();
        return LANGUAGE_MAP[key] || LANGUAGE_MAP[key.replace(/\d+$/, '')] || 'plaintext';
    }

    function buildModelUri(textareaId, language) {
        const safeId = String(textareaId || 'answer').replace(/[^a-zA-Z0-9_.-]/g, '_');
        const ext = MODEL_EXTENSION_MAP[language] || 'txt';
        if (language === 'java') {
            if (/^id_answer(preload)?/.test(safeId)) {
                return 'file:///coderunner/java/' + safeId + '.' + ext;
            }
            return 'file:///coderunner/java/id_student_answer.' + ext;
        }
        return 'file:///coderunner/' + language + '/' + safeId + '.' + ext;
    }

    function convertTheme(data, base) {
        const rules = [];
        const tokenColors = data.tokenColors || [];
        const hexPattern = /^#([0-9a-fA-F]{3,8})$/;
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

    function resolveTheme(params) {
        const stored = window.localStorage ? window.localStorage.getItem(STORAGE_THEME_KEY) : null;
        if (stored) {
            return stored;
        }

        const defaultDark = 'vs-dark';
        const defaultLight = 'vs';
        const autoSwitch = normaliseBoolean(params.auto_switch_light_dark, DEFAULTS.auto_switch_light_dark);
        if (autoSwitch && window.matchMedia) {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return defaultDark;
            }
            if (window.matchMedia('(prefers-color-scheme: light)').matches) {
                return defaultLight;
            }
        }

        if (params.theme) {
            if (!monacoThemesAvailable) {
                if (params.theme === 'one-dark') {
                    return defaultDark;
                }
                if (params.theme === 'one-light') {
                    return defaultLight;
                }
            }
            return params.theme;
        }

        return defaultLight;
    }

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

    function MonacoWrapper(textareaId, width, height, params) {
        this.textarea = document.getElementById(textareaId);
        this.failKey = 'monaco_ui_notready';
        this.failedFlag = false;
        this.editorApi = null;
        this.editor = null;
        this.contentsChanged = false;
        this.allowFullscreen = true;

        const appliedParams = Object.assign({}, DEFAULTS, params || {});
        const initialValue = appliedParams.import_from_scratchpad ?
            extractFromScratchpadMaybe(this.textarea.value) :
            (this.textarea.value || '');
        this.textarea.value = initialValue;

        const languageHint = appliedParams.lsp_language ||
            appliedParams.lang;
        const monacoLang = mapLanguage(languageHint);

        this.container = document.createElement('div');
        this.container.classList.add('coderunner-monaco-container');
        this.container.style.width = '100%';
        this.container.style.height = (height || this.textarea.clientHeight || 200) + 'px';
        this.container.setAttribute('role', 'application');

        const builtinWorkerLanguages = ['css', 'javascript', 'typescript'];
        const useBuiltinServices = builtinWorkerLanguages.indexOf(monacoLang) !== -1;
        const lspConfig = useBuiltinServices ? { enabled: false } : buildLspConfig(appliedParams, monacoLang);
        const useSimple = useBuiltinServices ? false : normaliseBoolean(appliedParams.use_simple_lsp, DEFAULTS.use_simple_lsp);
        const richFeatures = normaliseBoolean(appliedParams.rich_features, DEFAULTS.rich_features || false);

        const disableLspPrefixes = normaliseBoolean(appliedParams.disable_lsp_prefixes, DEFAULTS.disable_lsp_prefixes);
        const prefixCode = disableLspPrefixes ? '' : (appliedParams.lsp_prefix_code || '');
        const workspaceConfig = appliedParams.lsp_workspace_config || DEFAULTS.lsp_workspace_config;

        const optionsForAdapter = {
            language: monacoLang,
            value: initialValue,
            prefixCode: prefixCode,
            lspUrl: lspConfig.enabled ? lspConfig.lspUrl : null,
            lspBaseUrl: lspConfig.enabled ? lspConfig.lspBaseUrl : null,
            useSimpleLsp: lspConfig.enabled ? lspConfig.useSimple : useSimple,
            lspEnabled: lspConfig.enabled,
            richFeatures: richFeatures,
            workspaceConfig: workspaceConfig,
            path: buildModelUri(textareaId, monacoLang)
        };

        const readOnly = !!this.textarea.readOnly;
        const fontSize = parseNumber(appliedParams.font_size, DEFAULTS.font_size);
        const tabSize = parseNumber(appliedParams.tab_size, DEFAULTS.tab_size);
        const minimapEnabled = normaliseBoolean(appliedParams.minimap, DEFAULTS.minimap);
        const wordWrap = appliedParams.word_wrap || DEFAULTS.word_wrap;

        const self = this;
        this.initialisationPromise = ensureMonacoLoaded().then(function(monaco) {
            return loadMonacoThemes(monaco).catch(function() {
                // Theme loading is best-effort.
            }).then(function() {
                self.editorApi = adapter.createMonacoLspEditor(self.container, optionsForAdapter);
                if (!self.editorApi || !self.editorApi.editor) {
                    throw new Error('Monaco adapter did not return an editor instance');
                }
                self.editor = self.editorApi.editor;
                const model = self.editorApi.model;

                self.editor.updateOptions({
                    readOnly: readOnly,
                    fontSize: fontSize,
                    minimap: { enabled: minimapEnabled },
                    wordWrap: wordWrap,
                    tabSize: tabSize,
                    insertSpaces: true,
                    renderWhitespace: 'none',
                    fixedOverflowWidgets: true,
                    scrollBeyondLastLine: false,
                    scrollBeyondLastColumn: 0,
                    links: true,
                    codeLens: true,
                    lightbulb: {
                        enabled: true
                    },
                    stickyScroll: { enabled: false }
                });

                const theme = resolveTheme(appliedParams);
                monaco.editor.setTheme(theme);

                if (!readOnly) {
                    self.editor.onDidChangeModelContent(function() {
                        self.textarea.value = self.editor.getValue();
                        self.contentsChanged = true;
                    });

                    self.editor.onDidBlurEditorText(function() {
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

                return { monaco: monaco, model: model };
            });
        }).catch(function(error) {
            self.failedFlag = true;
            if (window.console && console.error) {
                console.error('Failed to initialise Monaco UI', error);
            }
        });
    }

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
        if (this.editor) {
            this.textarea.value = this.editor.getValue();
        }
    };

    MonacoWrapper.prototype.destroy = function() {
        const self = this;
        const removeContainer = function(wrapper) {
            if (wrapper.container && wrapper.container.parentNode) {
                wrapper.container.parentNode.removeChild(wrapper.container);
            }
        };
        if (this.initialisationPromise) {
            this.initialisationPromise.finally(function() {
                if (self.editorApi && self.editorApi.dispose) {
                    self.editorApi.dispose();
                }
                self.editor = null;
                self.editorApi = null;
                removeContainer(self);
                self.textarea.style.display = '';
            });
        } else {
            if (this.editorApi && this.editorApi.dispose) {
                this.editorApi.dispose();
            }
            this.editor = null;
            this.editorApi = null;
            removeContainer(this);
            this.textarea.style.display = '';
        }
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
