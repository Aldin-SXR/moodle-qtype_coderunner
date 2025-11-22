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
 * Multi-file Monaco Editor UI Plugin for CodeRunner.
 *
 * Provides a VSCode-like interface with:
 * - File tree sidebar
 * - Multiple file tabs
 * - Per-file Monaco editors with language-specific highlighting
 * - Per-file LSP support
 * - Hybrid file system (locked template files + user-creatable files)
 *
 * @module qtype_coderunner/ui_monaco_multifile
 * @copyright Richard Lobb and contributors
 * @license http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define(['qtype_coderunner/monaco_coderunner_adapter', 'jquery'], function(adapter, $) {
    'use strict';

    // Handle Monaco's internal unhandled promise rejections for "Canceled" operations
    // These occur during widget disposal, view state restoration, and model changes
    if (typeof window !== 'undefined') {
        window.addEventListener('unhandledrejection', function(event) {
            if (event && event.reason) {
                const message = typeof event.reason === 'string' ? event.reason :
                    (event.reason.message || String(event.reason));
                // Suppress Monaco's "Canceled" and "DisposableStore" errors - they're benign
                if (message === 'Canceled' || message.indexOf('Canceled') !== -1 ||
                    message.indexOf('DisposableStore that has already been disposed') !== -1) {
                    event.preventDefault();
                    return;
                }
            }
        });
    }

    const DEFAULTS = {
        import_from_scratchpad: true,
        font_size: 14,
        theme: '',
        auto_switch_light_dark: true,
        minimap: false,
        word_wrap: 'off',
        tab_size: 4,
        lsp_enabled: true,
        lsp_prefix_code: '',
        lsp_url: '',
        lsp_base_url: '',
        use_simple_lsp: true,
        rich_features: false,
        disable_lsp_prefixes: false,
        lsp_workspace_config: '',
        sidebar_width: 200,
        max_files: 20,
        allowed_extensions: ['html', 'css', 'js', 'json', 'txt'],
        disable_new_files: false,
        disable_new_folders: false,
        use_vscode_icons: true
    };

    const LANGUAGE_MAP = {
        // Web languages
        html: 'html',
        htm: 'html',
        css: 'css',
        js: 'javascript',
        javascript: 'javascript',
        ts: 'typescript',
        typescript: 'typescript',
        json: 'json',
        xml: 'xml',
        svg: 'xml',
        // Programming languages
        py: 'python',
        python: 'python',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        cc: 'cpp',
        cxx: 'cpp',
        'c++': 'cpp',
        h: 'cpp',
        hpp: 'cpp',
        ipp: 'cpp',
        tpp: 'cpp',
        cs: 'csharp',
        csharp: 'csharp',
        php: 'php',
        rb: 'ruby',
        ruby: 'ruby',
        go: 'go',
        kt: 'kotlin',
        kotlin: 'kotlin',
        swift: 'swift',
        scala: 'scala',
        rs: 'rust',
        rust: 'rust',
        hs: 'haskell',
        haskell: 'haskell',
        // Database/Query languages
        sql: 'sql',
        mongodb: 'mongodb',
        cypher: 'cypher',
        hbase: 'hbase',
        sol: 'sol',
        solidity: 'sol',
        // Markup/Data
        md: 'markdown',
        markdown: 'markdown',
        txt: 'plaintext',
        text: 'plaintext'
    };

    const STORAGE_THEME_KEY = 'qtype_coderunner.monaco.theme';
    const MONACO_THEME_DEFS = [
        {name: 'one-dark', path: '/question/type/coderunner/monaco/vs/themes/OneDark.json', base: 'vs-dark'},
        {name: 'one-light', path: '/question/type/coderunner/monaco/vs/themes/OneLight.json', base: 'vs'}
    ];

    const THEME_NAME_OVERRIDES = {
        'vs': 'Light',
        'vs-dark': 'Dark',
        'hc-black': 'High Contrast',
        'one-dark': 'One Dark',
        'one-light': 'One Light'
    };

    function readStoredThemePreference() {
        if (!window.localStorage) {
            return null;
        }
        try {
            const value = window.localStorage.getItem(STORAGE_THEME_KEY);
            return value && value.length ? value : null;
        } catch (err) {
            return null;
        }
    }

    function writeStoredThemePreference(theme) {
        if (!window.localStorage) {
            return;
        }
        try {
            if (theme) {
                window.localStorage.setItem(STORAGE_THEME_KEY, theme);
            } else {
                window.localStorage.removeItem(STORAGE_THEME_KEY);
            }
        } catch (err) {
            // Ignore write failures.
        }
    }

    const MAX_SEARCH_RESULTS = 500;
    const SNIPPET_CONTEXT = 80;
    const SEARCH_DEFAULT_MESSAGE = 'Enter a search term to search all files.';

    let monacoLoadPromise = null;
    let monacoThemePromise = null;
    let monacoThemesAvailable = false;
    const pendingLanguageModules = new Set();
    const pendingLanguageIds = new Set();
    let languagePreparationPromise = Promise.resolve();
    const registeredFoldingLanguages = new Set();

    const LANGUAGE_MODULE_MAP = {
        javascript: 'vs/basic-languages/javascript/javascript',
        typescript: 'vs/basic-languages/typescript/typescript',
        java: 'vs/basic-languages/java/java',
        c: 'vs/basic-languages/cpp/cpp',
        cpp: 'vs/basic-languages/cpp/cpp',
        csharp: 'vs/basic-languages/csharp/csharp',
        php: 'vs/basic-languages/php/php',
        go: 'vs/basic-languages/go/go',
        rust: 'vs/basic-languages/rust/rust',
        kotlin: 'vs/basic-languages/kotlin/kotlin',
        swift: 'vs/basic-languages/swift/swift',
        scala: 'vs/basic-languages/scala/scala',
        python: 'vs/basic-languages/python/python',
        html: 'vs/basic-languages/html/html',
        css: 'vs/basic-languages/css/css',
        markdown: 'vs/basic-languages/markdown/markdown',
        sql: 'vs/basic-languages/sql/sql',
        xml: 'vs/basic-languages/xml/xml',
        ruby: 'vs/basic-languages/ruby/ruby',
        perl: 'vs/basic-languages/perl/perl',
        r: 'vs/basic-languages/r/r'
    };

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
            // Best-effort; ignore failures.
        }
    }

    let initialisedLspAll = false;

    function normalisePath(path) {
        if (typeof path !== 'string') {
            return '';
        }
        const trimmed = path.replace(/^\/+/, '');
        return decodeURIComponent(trimmed);
    }

    function ensureRequireConfigured() {
        if (typeof require === 'undefined' || !require || typeof require.config !== 'function') {
            throw new Error('RequireJS not available');
        }
        const basePath = getMonacoBasePath();
        const context = require.s && require.s.contexts && require.s.contexts._;
        const paths = context && context.config && context.config.paths ? context.config.paths : {};
        if (!paths.vs) {
            require.config({
                paths: {vs: basePath}
            });
        }

        if (!window.MonacoEnvironment) {
            window.MonacoEnvironment = {};
        }
        if (!window.MonacoEnvironment.baseUrl) {
            window.MonacoEnvironment.baseUrl = basePath;
        }

    }

    function logError(message, data) {
        if (window.console && typeof window.console.error === 'function') {
            window.console.error(message, data || '');
        }
    }

    function logWarn(message, data) {
        if (window.console && typeof window.console.warn === 'function') {
            window.console.warn(message, data || '');
        }
    }

    function rebindLspForFile(file, lspOptions, monacoInstance, adapterInstance, oldUri) {
        if (!file || !monacoInstance || !adapterInstance) {
            return;
        }
        if (!lspOptions || !lspOptions.enabled) {
            return;
        }
        const model = file.model;
        if (!model) {
            return;
        }

        if (file.lspRegistration && typeof file.lspRegistration.dispose === 'function') {
            try {
                file.lspRegistration.dispose(); // Sends didClose via adapter
            } catch (e) {
                // ignore disposal errors
            }
            file.lspRegistration = null;
        }
        file.lspRegistration = adapterInstance.registerModelWithLsp(monacoInstance, model, {
            language: file.getLanguage(),
            lspUrl: lspOptions.lspUrl,
            lspBaseUrl: lspOptions.lspBaseUrl,
            prefixCode: lspOptions.prefixCode
        });

        // If oldUri is provided, notify LSP about the rename
        if (oldUri && adapterInstance.notifyFileRenamed) {
            const newUri = model.uri.toString();
            adapterInstance.notifyFileRenamed(monacoInstance, oldUri, newUri, {
                language: file.getLanguage(),
                lspUrl: lspOptions.lspUrl,
                lspBaseUrl: lspOptions.lspBaseUrl
            });
        }

        if (model) {
            model._lspRegistered = true;
        }
    }

    const generateFileId = () => 'vf_' + Math.random().toString(36).slice(2, 11);

    const DEVICON_CLASS_MAP = {
        html: 'devicon devicon-html5-plain',
        htm: 'devicon devicon-html5-plain',
        css: 'devicon devicon-css3-plain',
        js: 'devicon devicon-javascript-plain',
        javascript: 'devicon devicon-javascript-plain',
        ts: 'devicon devicon-typescript-plain',
        typescript: 'devicon devicon-typescript-plain',
        json: 'devicon devicon-json-plain',
        py: 'devicon devicon-python-plain',
        python: 'devicon devicon-python-plain',
        java: 'devicon devicon-java-plain',
        c: 'devicon devicon-c-plain',
        cpp: 'devicon devicon-cplusplus-plain',
        cc: 'devicon devicon-cplusplus-plain',
        cxx: 'devicon devicon-cplusplus-plain',
        'c++': 'devicon devicon-cplusplus-plain',
        h: 'devicon devicon-cplusplus-plain',
        hpp: 'devicon devicon-cplusplus-plain',
        ipp: 'devicon devicon-cplusplus-plain',
        tpp: 'devicon devicon-cplusplus-plain',
        cs: 'devicon devicon-csharp-plain',
        csharp: 'devicon devicon-csharp-plain',
        php: 'devicon devicon-php-plain',
        rb: 'devicon devicon-ruby-plain',
        ruby: 'devicon devicon-ruby-plain',
        go: 'devicon devicon-go-plain',
        kt: 'devicon devicon-kotlin-plain',
        kotlin: 'devicon devicon-kotlin-plain',
        swift: 'devicon devicon-swift-plain',
        scala: 'devicon devicon-scala-plain',
        rs: 'devicon devicon-rust-plain',
        rust: 'devicon devicon-rust-plain',
        hs: 'devicon devicon-haskell-plain',
        haskell: 'devicon devicon-haskell-plain',
        sql: 'devicon devicon-mysql-plain',
        mongodb: 'devicon devicon-mongodb-plain',
        cypher: 'devicon devicon-neo4j-plain',
        sol: 'devicon devicon-solidity-plain',
        solidity: 'devicon devicon-solidity-plain',
        md: 'devicon devicon-markdown-original',
        markdown: 'devicon devicon-markdown-original'
    };

    const CODICON_ICON_MAP = {
        html: 'codicon-file-code', htm: 'codicon-file-code',
        css: 'codicon-symbol-color', scss: 'codicon-symbol-color', sass: 'codicon-symbol-color', less: 'codicon-symbol-color',
        js: 'codicon-symbol-keyword', ts: 'codicon-symbol-keyword', jsx: 'codicon-symbol-keyword', tsx: 'codicon-symbol-keyword',
        py: 'codicon-symbol-variable', pyw: 'codicon-symbol-variable',
        rb: 'codicon-symbol-variable', php: 'codicon-symbol-variable',
        java: 'codicon-symbol-class', kt: 'codicon-symbol-class', kotlin: 'codicon-symbol-class',
        c: 'codicon-symbol-method', h: 'codicon-symbol-method', cpp: 'codicon-symbol-method', cxx: 'codicon-symbol-method',
        hpp: 'codicon-symbol-method', tpp: 'codicon-symbol-method', hxx: 'codicon-symbol-method', ipp: 'codicon-symbol-method',
        cs: 'codicon-symbol-class',
        go: 'codicon-symbol-interface', rs: 'codicon-symbol-interface', swift: 'codicon-symbol-interface', scala: 'codicon-symbol-interface',
        sh: 'codicon-terminal', bash: 'codicon-terminal', ps1: 'codicon-terminal', bat: 'codicon-terminal',
        json: 'codicon-symbol-structure', yaml: 'codicon-symbol-structure', yml: 'codicon-symbol-structure',
        xml: 'codicon-symbol-boolean', svg: 'codicon-symbol-boolean',
        sql: 'codicon-database', sqlite: 'codicon-database',
        md: 'codicon-book', txt: 'codicon-symbol-string', csv: 'codicon-symbol-string',
        png: 'codicon-file-media', jpg: 'codicon-file-media', jpeg: 'codicon-file-media', gif: 'codicon-file-media',
        bmp: 'codicon-file-media', webp: 'codicon-file-media',
        pdf: 'codicon-file-pdf',
        zip: 'codicon-file-zip', tar: 'codicon-file-zip', gz: 'codicon-file-zip',
        dockerfile: 'codicon-symbol-namespace'
    };

    const VSCODE_FILE_ICON_MAP = {
        html: 'file_type_html.svg',
        htm: 'file_type_html.svg',
        css: 'file_type_css.svg',
        scss: 'file_type_scss.svg',
        sass: 'file_type_scss.svg',
        less: 'file_type_less.svg',
        js: 'file_type_js.svg',
        javascript: 'file_type_js.svg',
        jsx: 'file_type_reactjs.svg',
        tsx: 'file_type_reactts.svg',
        ts: 'file_type_typescript.svg',
        typescript: 'file_type_typescript.svg',
        json: 'file_type_json.svg',
        jsonc: 'file_type_json.svg',
        xml: 'file_type_xml.svg',
        svg: 'file_type_svg.svg',
        py: 'file_type_python.svg',
        python: 'file_type_python.svg',
        java: 'file_type_java.svg',
        c: 'file_type_c.svg',
        h: 'file_type_cppheader.svg',
        cpp: 'file_type_cpp.svg',
        cc: 'file_type_cpp.svg',
        cxx: 'file_type_cpp.svg',
        'c++': 'file_type_cpp.svg',
        cs: 'file_type_csharp.svg',
        csharp: 'file_type_csharp.svg',
        php: 'file_type_php.svg',
        rb: 'file_type_ruby.svg',
        ruby: 'file_type_ruby.svg',
        go: 'file_type_go.svg',
        kt: 'file_type_kotlin.svg',
        kotlin: 'file_type_kotlin.svg',
        swift: 'file_type_swift.svg',
        scala: 'file_type_scala.svg',
        rs: 'file_type_rust.svg',
        rust: 'file_type_rust.svg',
        hs: 'file_type_haskell.svg',
        haskell: 'file_type_haskell.svg',
        sql: 'file_type_sql.svg',
        mongodb: 'file_type_mongo.svg',
        cypher: 'file_type_neo4j.svg',
        neo4j: 'file_type_neo4j.svg',
        sol: 'file_type_solidity.svg',
        solidity: 'file_type_solidity.svg',
        md: 'file_type_markdown.svg',
        markdown: 'file_type_markdown.svg',
        sh: 'file_type_shell.svg',
        bash: 'file_type_shell.svg',
        yaml: 'file_type_yaml.svg',
        yml: 'file_type_yaml.svg',
        dockerfile: 'file_type_docker.svg',
        txt: 'default_file.svg',
        text: 'default_file.svg'
    };

    const VSCODE_FILENAME_ICON_MAP = {
        'package.json': 'file_type_npm.svg',
        'package-lock.json': 'file_type_npm.svg',
        'yarn.lock': 'file_type_yarn.svg',
        'pnpm-lock.yaml': 'file_type_pnpm.svg',
        'docker-compose.yml': 'file_type_dockercompose.svg',
        'docker-compose.yaml': 'file_type_dockercompose.svg',
        dockerfile: 'file_type_docker.svg',
        '.env': 'file_type_dotenv.svg',
        '.env.local': 'file_type_dotenv.svg',
        'readme.md': 'file_type_markdown.svg',
        'readme': 'file_type_markdown.svg',
        'tsconfig.json': 'file_type_tsconfig.svg',
        'tsconfig.base.json': 'file_type_tsconfig.svg',
        'vite.config.js': 'file_type_vite.svg',
        'vite.config.ts': 'file_type_vite.svg'
    };

    const VSCODE_FOLDER_ICON_MAP = {
        closed: 'default_folder.svg',
        open: 'default_folder_opened.svg',
        rootClosed: 'default_root_folder.svg',
        rootOpen: 'default_root_folder_opened.svg'
    };

    let vscodeIconBasePath = null;
    function getVscodeIconBasePath() {
        if (vscodeIconBasePath) {
            return vscodeIconBasePath;
        }
        const root = (window.M && M.cfg && M.cfg.wwwroot) ? M.cfg.wwwroot : '';
        vscodeIconBasePath = root + '/question/type/coderunner/monaco/vs/icons';
        return vscodeIconBasePath;
    }

    function getVscodeIconUrl(iconName) {
        if (!iconName) {
            return null;
        }
        return getVscodeIconBasePath() + '/' + iconName;
    }

    function resolveVscodeFileIcon(filename, ext) {
        const lowerName = filename ? String(filename).toLowerCase() : '';
        if (lowerName && Object.prototype.hasOwnProperty.call(VSCODE_FILENAME_ICON_MAP, lowerName)) {
            return getVscodeIconUrl(VSCODE_FILENAME_ICON_MAP[lowerName]);
        }
        const lowerExt = ext ? String(ext).toLowerCase() : '';
        if (lowerExt && Object.prototype.hasOwnProperty.call(VSCODE_FILE_ICON_MAP, lowerExt)) {
            return getVscodeIconUrl(VSCODE_FILE_ICON_MAP[lowerExt]);
        }
        return null;
    }

    /**
     * Get the file extension from a filename
     * @param {string} filename - The filename to extract extension from
     * @return {string} The file extension
     */
    function getExtension(filename) {
        const parts = filename.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    }

    /**
     * Get Monaco language from file extension
     * @param {string} ext - The file extension
     * @return {string} The Monaco language ID
     */
    function getLanguageFromExtension(ext) {
        return LANGUAGE_MAP[ext] || 'plaintext';
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

    function convertTheme(data, base) {
        const rules = [];
        const tokenColors = data.tokenColors || [];
        const hexPattern = /^#([0-9a-fA-F]{3,8})$/;
        function normaliseColor(colorValue) {
            if (typeof colorValue !== 'string') {
                return undefined;
            }
            const trimmed = colorValue.trim();
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
                const rule = {token: scope};
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
        return fetch(url, {credentials: 'same-origin'}).then(response => {
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
        monacoThemePromise = Promise.all(MONACO_THEME_DEFS.map(def => {
            return fetchTheme(wwwroot + def.path).then(data => {
                return {name: def.name, theme: convertTheme(data, def.base)};
            });
        })).then(themes => {
            themes.forEach(entry => {
                if (entry && entry.theme) {
                    monaco.editor.defineTheme(entry.name, entry.theme);
                }
            });
            monacoThemesAvailable = true;
            return true;
        }).catch(() => {
            monacoThemesAvailable = false;
            return false;
        });
        return monacoThemePromise;
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).replace(/[&<>"']/g, function(ch) {
            switch (ch) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case '\'': return '&#39;';
                default: return ch;
            }
        });
    }

    function escapeRegExp(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildHighlightedSnippet(line, matchIndex, matchLength) {
        if (typeof line !== 'string') {
            return '';
        }
        let start = Math.max(0, matchIndex - SNIPPET_CONTEXT);
        let end = Math.min(line.length, matchIndex + matchLength + SNIPPET_CONTEXT);
        const prefixEllipsis = start > 0 ? '…' : '';
        const suffixEllipsis = end < line.length ? '…' : '';
        const slice = line.substring(start, end);
        const relativeIndex = Math.max(0, matchIndex - start);
        const before = escapeHtml(slice.substring(0, relativeIndex));
        const matchText = escapeHtml(slice.substr(relativeIndex, matchLength));
        const after = escapeHtml(slice.substring(relativeIndex + matchLength));
        return prefixEllipsis + before + '<span class="monaco-search-match" style="background: rgba(255,215,0,0.35); padding: 0 1px;">' + matchText + '</span>' + after + suffixEllipsis;
    }

    function normaliseExtensionList(value, fallback) {
        let list = [];
        if (Array.isArray(value)) {
            list = value;
        } else if (typeof value === 'string') {
            list = value.split(',').map(item => item.trim()).filter(item => item.length);
        } else if (Array.isArray(fallback)) {
            list = fallback.slice();
        }
        return list.map(ext => String(ext || '').replace(/^\./, '').toLowerCase()).filter(Boolean);
    }

    function queueLanguageModulesForExtensions(extensions) {
        if (!Array.isArray(extensions) || !extensions.length) {
            return;
        }
        extensions.forEach(ext => {
            const lang = LANGUAGE_MAP[ext];
            if (!lang) {
                return;
            }
            pendingLanguageIds.add(lang);
            const modulePath = LANGUAGE_MODULE_MAP[lang];
            if (modulePath) {
                pendingLanguageModules.add(modulePath);
            }
        });
        if (window.monaco && window.monaco.editor) {
            scheduleLanguagePreparation(window.monaco);
        }
    }

    function loadLanguageConfigurations(monaco, modules) {
        if (!modules.length || typeof require !== 'function') {
            return Promise.resolve();
        }
        const loads = modules.map(modulePath => {
            return new Promise(resolve => {
                require([modulePath], function(langDef) {
                    const parts = modulePath.split('/');
                    const langId = parts[parts.length - 1];
                    if (langDef && langDef.conf) {
                        try {
                            monaco.languages.setLanguageConfiguration(langId, langDef.conf);
                        } catch (err) {
                            // Ignore configuration errors (likely already registered)
                        }
                    }
                    resolve();
                }, () => resolve());
            });
        });
        return Promise.all(loads);
    }

    function getFallbackBrackets(languageId) {
        if (!languageId) {
            return null;
        }
        if (languageId === 'python') {
            return [['(', ')'], ['[', ']'], ['{', '}']];
        }
        return [['{', '}'], ['[', ']'], ['(', ')']];
    }

    function scheduleLanguagePreparation(monaco) {
        if (!monaco) {
            return languagePreparationPromise;
        }
        if (!pendingLanguageModules.size && !pendingLanguageIds.size) {
            return languagePreparationPromise;
        }
        const modulesToLoad = Array.from(pendingLanguageModules);
        const languagesToRegister = Array.from(pendingLanguageIds);
        pendingLanguageModules.clear();
        pendingLanguageIds.clear();

        const preparation = loadLanguageConfigurations(monaco, modulesToLoad).then(() => {
            languagesToRegister.forEach(lang => {
                if (registeredFoldingLanguages.has(lang)) {
                    return;
                }
                const brackets = getFallbackBrackets(lang);
                if (brackets) {
                    registerBracketFoldingProvider(monaco, lang, brackets);
                }
            });
        });

        const chained = languagePreparationPromise.catch(() => {}).then(() => preparation);
        languagePreparationPromise = chained.catch(() => {});
        return chained;
    }

    /**
     * Register folding range provider for a language based on brackets
     * This provides brace/bracket-based code folding without needing workers
     */
    function registerBracketFoldingProvider(monaco, languageId, brackets) {
        if (!monaco || !languageId || registeredFoldingLanguages.has(languageId)) {
            return;
        }
        registeredFoldingLanguages.add(languageId);
        monaco.languages.registerFoldingRangeProvider(languageId, {
            provideFoldingRanges: function(model) {
                const ranges = [];
                const lines = model.getLinesContent();
                const stack = [];

                for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
                    const line = lines[lineNumber - 1];

                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];

                        // Check for opening brackets
                        for (const [open, close] of brackets) {
                            if (line.substr(i, open.length) === open) {
                                stack.push({ char: open, closeChar: close, line: lineNumber, column: i });
                                i += open.length - 1;
                                break;
                            } else if (line.substr(i, close.length) === close) {
                                // Found closing bracket
                                while (stack.length > 0) {
                                    const last = stack.pop();
                                    if (last.closeChar === close) {
                                        // Only create folding range if it spans multiple lines
                                        // End at lineNumber - 1 to keep the closing bracket visible
                                        if (lineNumber > last.line + 1) {
                                            ranges.push({
                                                start: last.line,
                                                end: lineNumber - 1,
                                                kind: monaco.languages.FoldingRangeKind.Region
                                            });
                                        }
                                        break;
                                    }
                                }
                                i += close.length - 1;
                                break;
                            }
                        }
                    }
                }

                return ranges;
            }
        });
    }

    function ensureMonacoLoaded() {
        if (window.monaco && window.monaco.editor) {
            return scheduleLanguagePreparation(window.monaco).then(() => window.monaco);
        }

        if (!monacoLoadPromise) {
            monacoLoadPromise = new Promise((resolve, reject) => {
                try {
                    ensureRequireConfigured();
                } catch (err) {
                    reject(err);
                    return;
                }
                require(['vs/editor/editor.main'], function(monaco) {
                    disableHtmlCompletions(monaco);
                    scheduleLanguagePreparation(monaco).then(() => {
                        resolve(monaco);
                    }).catch(() => {
                        resolve(monaco);
                    });
                }, reject);
            });
        }

        return monacoLoadPromise;
    }

    let codiconStylesLoaded = false;
    function ensureCodiconStyles() {
        // Codicon styles are already bundled in monaco/vs/editor/editor.main.css
        // No need to load a separate CSS file
        if (codiconStylesLoaded) {
            return;
        }
        codiconStylesLoaded = true;
    }

    function createIconElement(descriptor, baseClass) {
        const resolvedBase = baseClass || 'monaco-tree-icon';
        const classes = [resolvedBase];
        if (!descriptor) {
            descriptor = {className: 'codicon codicon-file'};
        }
        if (descriptor.type === 'vscode' && descriptor.src) {
            if (descriptor.className) {
                classes.push(descriptor.className);
            }
            const el = $(`<span class="${classes.join(' ')} vscode-icon"></span>`);
            el.css('backgroundImage', 'url(' + descriptor.src + ')');
            return el;
        }
        if (descriptor.className) {
            classes.push(descriptor.className);
        }
        return $(`<span class="${classes.join(' ')}"></span>`);
    }

    function modelIsAlive(model) {
        if (!model) {
            return false;
        }
        if (typeof model.isDisposed === 'function') {
            return !model.isDisposed();
        }
        return true;
    }

    function resolveTheme(params) {
        const stored = readStoredThemePreference();
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

    function isDarkTheme(theme) {
        if (!theme) {
            return false;
        }
        const lower = String(theme).toLowerCase();
        if (lower.indexOf('light') !== -1) {
            return false;
        }
        return lower.indexOf('dark') !== -1 || lower.indexOf('black') !== -1;
    }

    function describeTheme(theme) {
        if (!theme) {
            return '';
        }
        const key = String(theme).toLowerCase();
        if (THEME_NAME_OVERRIDES[key]) {
            return THEME_NAME_OVERRIDES[key];
        }
        return String(theme).split(/[-_]/).map(part => {
            if (!part.length) {
                return '';
            }
            return part.charAt(0).toUpperCase() + part.slice(1);
        }).join(' ');
    }

    /**
     * File class representing a single file in the virtual filesystem
     */
    class VirtualFile {
        constructor(path, content = '', locked = false, uid = null) {
            this.path = path;
            this.content = content;
            this.locked = locked;
            this.model = null;
            this.viewState = null;
            this.uid = uid || generateFileId();
        }

        getName() {
            const parts = this.path.split('/');
            return parts[parts.length - 1];
        }

        getDirectory() {
            const parts = this.path.split('/');
            return parts.slice(0, -1).join('/');
        }

        getExtension() {
            return getExtension(this.getName());
        }

        getLanguage() {
            return getLanguageFromExtension(this.getExtension());
        }

        getIconDescriptor(useVscodeIcons) {
            const ext = this.getExtension();
            if (useVscodeIcons) {
                const vscodeIcon = resolveVscodeFileIcon(this.getName(), ext);
                if (vscodeIcon) {
                    return {type: 'vscode', src: vscodeIcon, source: 'vscode'};
                }
            }
            const devicon = DEVICON_CLASS_MAP[ext];
            if (devicon) {
                return {className: `${devicon} devicon-icon`, source: 'devicon'};
            }
            const codicon = CODICON_ICON_MAP[ext] || 'codicon-file-code';
            return {className: `codicon ${codicon}`, source: 'codicon'};
        }

        toJSON() {
            return {
                path: this.path,
                content: this.content,
                locked: this.locked,
                uid: this.uid
            };
        }

        static fromJSON(data) {
            return new VirtualFile(
                data.path,
                data.content || '',
                normaliseBoolean(data.locked, false),
                data.uid || generateFileId()
            );
        }
    }

    /**
     * Virtual File System Manager
     */
    class VirtualFileSystem {
        constructor(allowedExtensions, maxFiles) {
            this.files = new Map();
            this.folders = new Map([['', {expanded: true}]]); // Root folder always exists and is expanded
            this.allowedExtensions = allowedExtensions;
            this.maxFiles = maxFiles;
        }

        addFile(file) {
            if (this.files.size >= this.maxFiles && !this.files.has(file.path)) {
                throw new Error(`Maximum number of files (${this.maxFiles}) reached`);
            }
            // Ensure parent folders exist
            const dir = file.getDirectory();
            if (dir) {
                this.ensureFolder(dir);
            }
            this.files.set(file.path, file);
        }

        removeFile(path, options = {}) {
            const file = this.files.get(path);
            const allowLocked = !!options.allowLocked;
            if (file && file.locked && !allowLocked) {
                throw new Error('Cannot delete locked files');
            }
            return this.files.delete(path);
        }

        renameFile(oldPath, newPath, options = {}) {
            const file = this.files.get(oldPath);
            if (!file) {
                return false;
            }
            const allowLocked = !!options.allowLocked;
            if (file.locked && !allowLocked) {
                throw new Error('Cannot rename locked files');
            }
            if (this.files.has(newPath)) {
                throw new Error('A file with that name already exists');
            }
            const newExt = getExtension(newPath);
            if (!this.isExtensionAllowed(newPath)) {
                const label = newExt ? `".${newExt}"` : '(none)';
                throw new Error(`File extension ${label} is not allowed`);
            }
            this.files.delete(oldPath);
            file.path = newPath;
            this.files.set(newPath, file);
            return true;
        }

        ensureFolder(path, expanded = false) {
            const parts = path.split('/').filter(p => p);
            let current = '';
            for (const part of parts) {
                current = current ? current + '/' + part : part;
                if (!this.folders.has(current)) {
                    this.folders.set(current, {expanded: expanded});
                }
            }
        }

        createFolder(path, expanded = true) {
            if (this.folders.has(path)) {
                throw new Error('Folder already exists');
            }
            this.ensureFolder(path, expanded);
        }

        removeFolder(path) {
            // Check if any files are in this folder
            const hasFiles = Array.from(this.files.keys()).some(filePath =>
                filePath.startsWith(path + '/')
            );
            if (hasFiles) {
                throw new Error('Cannot delete non-empty folder');
            }
            this.folders.delete(path);
        }

        setFolderExpanded(path, expanded) {
            const folder = this.folders.get(path);
            if (folder) {
                folder.expanded = expanded;
            }
        }

        isFolderExpanded(path) {
            const folder = this.folders.get(path);
            return folder ? folder.expanded : false;
        }

        getFile(path) {
            return this.files.get(path);
        }

        getAllFiles() {
            return Array.from(this.files.values());
        }

        getAllFolders() {
            return Array.from(this.folders.keys()).sort();
        }

        getFilesInFolder(folderPath) {
            const prefix = folderPath ? folderPath + '/' : '';
            return this.getAllFiles().filter(f => {
                const filePath = f.path;
                if (!filePath.startsWith(prefix)) {
                    return false;
                }
                const remainder = filePath.substring(prefix.length);
                return !remainder.includes('/');
            });
        }

        getSubfolders(folderPath) {
            const prefix = folderPath ? folderPath + '/' : '';
            const subfolders = new Set();
            this.folders.forEach((folderData, folder) => {
                if (folder.startsWith(prefix) && folder !== folderPath) {
                    const remainder = folder.substring(prefix.length);
                    const firstPart = remainder.split('/')[0];
                    if (firstPart) {
                        subfolders.add(prefix + firstPart);
                    }
                }
            });
            return Array.from(subfolders).sort();
        }

        isExtensionAllowed(filename) {
            const ext = getExtension(filename);
            return this.allowedExtensions.includes(ext);
        }

        canAddFile(filename) {
            return this.isExtensionAllowed(filename) && this.files.size < this.maxFiles;
        }

        toJSON() {
            const folders = {};
            this.folders.forEach((data, path) => {
                if (path !== '') { // Don't save root folder state
                    folders[path] = data;
                }
            });
            return {
                files: this.getAllFiles().map(f => f.toJSON()),
                folders: folders
            };
        }

        static fromJSON(data, allowedExtensions, maxFiles) {
            const vfs = new VirtualFileSystem(allowedExtensions, maxFiles);
            if (data && data.files) {
                data.files.forEach(fileData => {
                    const file = VirtualFile.fromJSON(fileData);
                    vfs.addFile(file);
                });
            }
            // Restore folder states
            if (data && data.folders) {
                Object.keys(data.folders).forEach(path => {
                    const folderData = data.folders[path];
                    if (vfs.folders.has(path)) {
                        vfs.folders.set(path, folderData);
                    }
                });
            }
            return vfs;
        }
    }

    /**
     * Monaco Multi-File Editor Wrapper
     * @param {string} textareaId - ID of the textarea element
     * @param {number} w - Width in pixels
     * @param {number} h - Height in pixels
     * @param {object} params - Configuration parameters
     */
    function MonacoMultifileWrapper(textareaId, w, h, params) {
        this.textareaId = textareaId;
        this.textarea = document.getElementById(textareaId);

        if (!this.textarea) {
            this.fail = true;
            return;
        }

        this.params = Object.assign({}, DEFAULTS, params);
        this.params.lsp_enabled = normaliseBoolean(this.params.lsp_enabled, DEFAULTS.lsp_enabled);
        this.params.use_simple_lsp = normaliseBoolean(this.params.use_simple_lsp, DEFAULTS.use_simple_lsp);
        this.params.rich_features = normaliseBoolean(this.params.rich_features, DEFAULTS.rich_features || false);
        this.params.disable_lsp_prefixes = normaliseBoolean(
            this.params.disable_lsp_prefixes,
            DEFAULTS.disable_lsp_prefixes || false
        );
        this.params.disable_new_files = normaliseBoolean(
            this.params.disable_new_files,
            DEFAULTS.disable_new_files || false
        );
        this.params.disable_new_folders = normaliseBoolean(
            this.params.disable_new_folders,
            DEFAULTS.disable_new_folders || false
        );
        this.params.use_vscode_icons = normaliseBoolean(
            this.params.use_vscode_icons,
            DEFAULTS.use_vscode_icons
        );
        this.params.allowed_extensions = normaliseExtensionList(
            this.params.allowed_extensions,
            DEFAULTS.allowed_extensions
        );
        queueLanguageModulesForExtensions(this.params.allowed_extensions);
        this.params.lsp_url = (this.params.lsp_url || '').trim();
        this.params.lsp_base_url = (this.params.lsp_base_url || '').trim();
        const hasLspEndpoint = !!this.params.lsp_url || !!this.params.lsp_base_url;
        if (hasLspEndpoint && !this.params.lsp_enabled) {
            this.params.lsp_enabled = true;
        }

        // Detect if this is answerpreload field (always author mode)
        const isAnswerPreload = textareaId && textareaId.indexOf('answerpreload') !== -1;

        const authorAttr = this.textarea.getAttribute('data-author-mode');
        this.authorMode = isAnswerPreload || authorAttr === '1' || (authorAttr && String(authorAttr).toLowerCase() === 'true');
        const lockAttr = this.textarea.getAttribute('data-lockable');
        const lockable = lockAttr === '1' || (lockAttr && String(lockAttr).toLowerCase() === 'true');
        this.lockUiEnabled = this.authorMode && lockable;
        this.lockingEnabled = !this.authorMode || lockable;
        this.allowNewFiles = this.authorMode || !this.params.disable_new_files;
        this.allowNewFolders = this.authorMode || !this.params.disable_new_folders;
        this.safeTextareaId = String(this.textareaId || 'answer').replace(/[^a-zA-Z0-9_.-]/g, '_');
        // Add an instance token so multiple editors on the same page (e.g., answer + answerpreload)
        // and concurrent student sessions never share the same workspace path.
        this.workspaceInstanceId = this.safeTextareaId + '_' +
            Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        this.workspaceRoot = 'workspace/' + this.workspaceInstanceId;
        this.fail = false;
        this.ready = false;
        this.currentFile = null;
        this.monaco = null;
        this.editor = null;
        this.currentLspBinding = null;
        this.lspInitializedLanguages = new Set(); // Track which languages have LSP initialized
        this.modelLspRegistrations = new Map(); // Track LSP registrations for cleanup
        this.lastSyncedVersions = new Map(); // Track last didChange version sent per model
        this.pendingLspModels = new Map(); // Models waiting for LSP connection: language -> [files]
        this.themeListener = null;
        this.initialUiState = null;
        this.pendingActivePath = null;

        // Initialize virtual file system
        this.vfs = null;
        this.activeFile = null;

        // UI elements
        this.container = null;
        this.sidebar = null;
        this.editorContainer = null;
        this.tabBar = null;
        this.contextMenu = null;
        this.contextMenuTarget = null;
        this.openTabs = []; // Track open tabs in the order they were opened
        this.draggedFilePath = null;
        this.form = null;
        this.searchPanel = null;
        this.searchInput = null;
        this.searchCaseSensitive = null;
        this.searchResultsContainer = null;
        this.searchStatusLabel = null;
        this.searchPanelVisible = false;
        this.userSelectedTheme = readStoredThemePreference();
        this.currentTheme = resolveTheme(this.params);
        this.themeControl = null;
        this.themeMenu = null;
        this.themeButton = null;
        this.documentEventNamespace = '.monacoMultifile-' + this.textareaId;
        this.boundKeydownHandler = (e) => this.handleGlobalKeydown(e);
        $(document).on('keydown' + this.documentEventNamespace, this.boundKeydownHandler);

        ensureCodiconStyles();

        try {
            this.init(w, h);
        } catch (err) {
            // Initialization failed
            window.console.error('MonacoMultifileWrapper initialization failed:', err);
            this.fail = true;
        }
    }

    MonacoMultifileWrapper.prototype.init = function(w, h) {
        this.debouncedSyncToLocalStorage = debounce(this.syncToLocalStorage.bind(this), 2000);
        // Load initial data from textarea
        const textareaContent = this.textarea.value;
        let initialData;

        try {
            initialData = JSON.parse(textareaContent);
        } catch (e) {
            // If not JSON, create a default single file structure
            initialData = {
                files: [{
                    path: 'index.html',
                    content: textareaContent || '<h1>Hello World</h1>',
                    locked: false
                }]
            };
        }

        // Check for and apply localStorage data if newer
        try {
            const localDataStr = window.localStorage.getItem(this.getLocalStorageKey());
            if (localDataStr) {
                const localData = JSON.parse(localDataStr);
                const serverTimestamp = (initialData && initialData.timestamp) ? initialData.timestamp : 0;
                if (localData && localData.timestamp > serverTimestamp) {
                    initialData = localData;
                    // Optional: notify user that unsaved changes were restored
                }
            }
        } catch (e) {
            logWarn('Failed to load from localStorage', e);
        }

        this.vfs = VirtualFileSystem.fromJSON(
            initialData,
            this.params.allowed_extensions,
            this.params.max_files
        );

        // If no files exist, create a default file
        if (this.vfs.getAllFiles().length === 0) {
            const defaultFile = new VirtualFile('index.html', '<h1>Hello World</h1>', false);
            this.vfs.addFile(defaultFile);
        }

        // Store UI state for restoration after Monaco loads
        this.initialUiState = initialData && typeof initialData === 'object'
            ? initialData.uiState || null
            : null;

        // Create UI structure
        try {
            this.createUI(w, h);
            if (!this.container) {
                throw new Error('Failed to create container element');
            }
        } catch (err) {
            window.console.error('Failed to create UI:', err);
            this.fail = true;
            return;
        }
        // Find parent form element
        let elem = this.textarea;
        while (elem && elem.tagName !== 'FORM') {
            elem = elem.parentElement;
        }
        this.form = elem;
        if (this.form) {
            this.form.addEventListener('submit', () => {
                this.sync(true);
            });
        }

        ensureMonacoLoaded().then(monaco => {
            this.monaco = monaco;
            return this.initialiseEditor();
        }).then(() => {
            this.ready = true;

            // Restore UI state (open tabs and active file)
            let activeFilePath = null;
            if (this.initialUiState) {
                activeFilePath = this.restoreUiState(this.initialUiState);
            }

            // If no open tabs restored, open all files by default
            if (this.openTabs.size === 0) {
                const allFiles = this.vfs.getAllFiles();
                allFiles.forEach(f => this.openTabs.add(f.path));
            }

            this.renderFileTree();
            this.renderTabs();

            // Determine which file to open
            const files = this.vfs.getAllFiles();
            let targetPath = null;

            if (this.pendingActivePath) {
                targetPath = this.pendingActivePath;
            } else if (activeFilePath && this.vfs.getFile(activeFilePath)) {
                targetPath = activeFilePath;
            } else if (this.openTabs.size > 0) {
                targetPath = Array.from(this.openTabs)[0];
            } else if (files.length > 0) {
                targetPath = files[0].path;
            }

            if (targetPath) {
                this.openFile(targetPath);
            }
            this.pendingActivePath = null;

            // LSP will be set up when each file is opened
            // We don't register all files at once to avoid rapidly switching the editor between models
        }).catch(err => {
            // Failed to load Monaco
            window.console.error('Failed to load Monaco:', err);
            this.fail = true;
        });
    };

    MonacoMultifileWrapper.prototype.createUI = function(w, h) {
        // Main container - create as raw DOM element like ui_monaco does
        this.container = document.createElement('div');
        this.container.className = 'monaco-multifile-container';
        this.container.style.display = 'flex';
        // Fix width/height for hidden fields (answerpreload)
        const width = w > 0 ? w : (this.textarea.clientWidth || 800);
        const height = h > 0 ? h : (this.textarea.clientHeight || 300);
        this.container.style.width = width + 'px';
        this.container.style.height = height + 'px';
        if (!this.currentTheme) {
            this.currentTheme = resolveTheme(this.params);
        }
        this.applyThemeClass(this.currentTheme);

        // Sidebar
        this.sidebar = $('<div class="monaco-multifile-sidebar"></div>');
        this.sidebar.css({
            width: this.params.sidebar_width + 'px'
        });

        // Sidebar header with title and actions
        const sidebarHeader = $('<div class="monaco-multifile-sidebar-header"></div>');

        const titleSpan = $('<span>Explorer</span>');
        const actionsDiv = $('<div class="monaco-sidebar-actions"></div>');

        const searchToggleBtn = $('<button type="button" class="monaco-icon-btn" title="Search in files"><span class="codicon codicon-search"></span></button>');
        searchToggleBtn.on('click', () => this.toggleSearchPanel());

        const newFileBtn = $('<button type="button" class="monaco-icon-btn" title="New File"><span class="codicon codicon-new-file"></span></button>');
        const newFolderBtn = $('<button type="button" class="monaco-icon-btn" title="New Folder"><span class="codicon codicon-new-folder"></span></button>');

        if (this.allowNewFiles) {
            newFileBtn.on('click', () => this.promptNewFile(''));
        } else {
            newFileBtn.hide();
        }
        if (this.allowNewFolders) {
            newFolderBtn.on('click', () => this.promptNewFolder(''));
        } else {
            newFolderBtn.hide();
        }

        actionsDiv.append(searchToggleBtn, newFileBtn, newFolderBtn);
        sidebarHeader.append(titleSpan, actionsDiv);
        this.sidebar.append(sidebarHeader);

        this.createSearchPanel();
        if (this.searchPanel) {
            this.sidebar.append(this.searchPanel);
        }

        // File tree container
        this.fileTree = $('<div class="monaco-multifile-tree"></div>');
        this.sidebar.append(this.fileTree);

        // Root-level context menu (blank area of the tree).
        this.fileTree.on('contextmenu', (e) => {
            const targetItem = $(e.target).closest('.monaco-file-item, .monaco-folder-item');
            if (targetItem.length === 0) {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e, 'root', '');
            }
        });

        this.sidebar.on('contextmenu', (e) => {
            const targetItem = $(e.target).closest('.monaco-file-item, .monaco-folder-item');
            if (targetItem.length === 0) {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e, 'root', '');
            }
        });

        const rootDragHandler = (e) => {
            if (!this.draggedFilePath) {
                return;
            }
            e.preventDefault();
            if (e.originalEvent && e.originalEvent.dataTransfer) {
                e.originalEvent.dataTransfer.dropEffect = 'move';
            }
            this.fileTree.addClass('drag-over-root');
        };
        this.fileTree.on('dragover', rootDragHandler);
        this.sidebar.on('dragover', rootDragHandler);

        const rootDragLeaveHandler = (e) => {
            if (!this.draggedFilePath) {
                return;
            }
            const related = e.relatedTarget;
            if (!related || (!this.fileTree[0].contains(related) && !this.sidebar[0].contains(related))) {
                this.fileTree.removeClass('drag-over-root');
            }
        };
        this.fileTree.on('dragleave', rootDragLeaveHandler);
        this.sidebar.on('dragleave', rootDragLeaveHandler);

        const rootDropHandler = (e) => {
            if (!this.draggedFilePath) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const source = this.draggedFilePath;
            this.draggedFilePath = null;
            this.clearDragIndicators();
            this.fileTree.removeClass('drag-over-root');
            this.moveFileToFolder(source, '');
        };
        this.fileTree.on('drop', (e) => {
            if (!this.draggedFilePath) {
                return;
            }
            const $target = $(e.target);
            const closestItem = $target.closest('.monaco-folder-item, .monaco-file-item');
            if (closestItem.length === 0) {
                rootDropHandler(e);
            }
        });
        this.sidebar.on('drop', rootDropHandler);

        // Right panel (tabs + editor)
        const rightPanel = $('<div class="monaco-multifile-right"></div>');
        rightPanel.css({
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'visible'
        });

        // Tab bar container with tabs and preview button
        const tabBarContainer = $('<div class="monaco-multifile-tabbar-container"></div>');
        tabBarContainer.css({
            display: 'flex',
            alignItems: 'center',
            marginBottom: '5px'
        });

        // Tab bar
        this.tabBar = $('<div class="monaco-multifile-tabs"></div>');
        this.tabBar.css({
            display: 'flex',
            overflow: 'auto',
            flexShrink: 0,
            flex: 1
        });

        const tabControls = $('<div class="monaco-tab-controls"></div>');
        tabControls.css({
            display: 'flex',
            alignItems: 'stretch',
            height: '35px'
        });

        this.themeControl = $('<div class="monaco-theme-control"></div>');
        this.themeControl.css({
            position: 'relative',
            height: '100%',
            display: 'flex',
            alignItems: 'stretch'
        });

        const themeBtn = $('<button type="button" class="monaco-preview-btn monaco-theme-btn" title="Select theme"></button>');
        const themeIcon = $('<span class="codicon codicon-color-mode"></span>');
        themeBtn.append(themeIcon);
        themeBtn.attr('aria-label', 'Select theme');
        themeBtn.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleThemeMenu();
        });
        this.themeButton = themeBtn;

        this.themeMenu = $('<div class="monaco-theme-menu" role="menu"></div>');
        this.themeMenu.hide();
        this.themeMenu.on('click', (e) => {
            e.stopPropagation();
        });

        this.themeControl.append(themeBtn);
        this.themeControl.append(this.themeMenu);

        // Preview button
        const previewBtn = $('<button type="button" class="monaco-preview-btn" title="Preview HTML"></button>');
        const previewIcon = $('<span class="codicon codicon-preview"></span>');
        const previewLabel = $('<span class="monaco-preview-label">Preview</span>');
        previewBtn.append(previewIcon, previewLabel);
        previewBtn.on('click', () => {
            this.hideThemeMenu();
            this.showPreview();
        });

        tabControls.append(previewBtn);
        tabControls.append(this.themeControl);

        tabBarContainer.append(this.tabBar);
        tabBarContainer.append(tabControls);
        this.refreshThemeMenu();
        this.updateThemeButtonState();

        // Editor container
        this.editorContainer = $('<div class="monaco-multifile-editor"></div>');
        this.editorContainer.css({
            flex: 1,
            overflow: 'visible',
            position: 'relative'
        });

        rightPanel.append(tabBarContainer);
        rightPanel.append(this.editorContainer);

        this.container.appendChild(this.sidebar[0]);
        this.container.appendChild(rightPanel[0]);

        // Create context menu
        this.createContextMenu();

        // Add global click handler to close context menu
        $(document).on('click', (e) => {
            const $target = $(e.target);
            if (this.contextMenu && !$target.closest('.monaco-multifile-context-menu').length) {
                this.hideContextMenu();
            }
            if (this.themeMenu && this.themeMenu.is(':visible') && !$target.closest('.monaco-theme-control').length) {
                this.hideThemeMenu();
            }
        });
    };

    MonacoMultifileWrapper.prototype.createSearchPanel = function() {
        if (this.searchPanel) {
            return;
        }
        const panel = $('<div class="monaco-multifile-search-panel"></div>');
        panel.css({
            padding: '8px',
            borderTop: '1px solid rgba(0,0,0,0.05)',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            display: 'none'
        });

        const controls = $('<div class="monaco-search-controls"></div>');
        controls.css({
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '6px'
        });

        const inputRow = $('<div class="monaco-search-input-row"></div>');
        inputRow.css({
            display: 'flex',
            width: '100%'
        });

        this.searchInput = $('<input type="text" class="monaco-search-input" placeholder="Search files">');
        this.searchInput.css({
            flex: 1,
            padding: '4px 6px',
            fontSize: '13px',
            border: '1px solid rgba(0,0,0,0.2)',
            borderRadius: '3px'
        });
        this.searchInput.on('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.executeSearch();
            }
        });

        inputRow.append(this.searchInput);

        const caseLabel = $('<label class="monaco-search-option" title="Case sensitive search">Aa</label>');
        caseLabel.css({
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            fontSize: '12px',
            cursor: 'pointer',
            margin: 0
        });
        this.searchCaseSensitive = $('<input type="checkbox">');
        caseLabel.prepend(this.searchCaseSensitive);

        const actionsRow = $('<div class="monaco-search-actions"></div>');
        actionsRow.css({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
        });

        const leftOptions = $('<div class="monaco-search-options"></div>');
        leftOptions.css({
            display: 'flex',
            alignItems: 'center'
        });
        leftOptions.append(caseLabel);

        const buttonsWrapper = $('<div class="monaco-search-buttons"></div>');
        buttonsWrapper.css({
            display: 'flex',
            gap: '4px'
        });

        const searchBtn = $('<button type="button" class="monaco-icon-btn" title="Search"></button>');
        searchBtn.append('<span class="codicon codicon-arrow-right"></span>');
        searchBtn.on('click', () => this.executeSearch());

        const resetBtn = $('<button type="button" class="monaco-icon-btn" title="Clear search"></button>');
        resetBtn.append('<span class="codicon codicon-clear-all"></span>');
        resetBtn.on('click', () => this.resetSearchPanel());

        const closeBtn = $('<button type="button" class="monaco-icon-btn" title="Hide search panel"></button>');
        closeBtn.append('<span class="codicon codicon-chevron-up"></span>');
        closeBtn.on('click', () => this.toggleSearchPanel(false));

        buttonsWrapper.append(searchBtn, resetBtn, closeBtn);
        actionsRow.append(leftOptions, buttonsWrapper);

        controls.append(inputRow, actionsRow);

        this.searchStatusLabel = $(`<div class="monaco-search-status">${SEARCH_DEFAULT_MESSAGE}</div>`);
        this.searchStatusLabel.css({
            fontSize: '12px',
            color: '#666',
            marginBottom: '6px'
        });

        this.searchResultsContainer = $('<div class="monaco-search-results"></div>');
        this.searchResultsContainer.css({
            maxHeight: '200px',
            overflowY: 'auto',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: '3px',
            padding: '4px'
        });

        panel.append(controls, this.searchStatusLabel, this.searchResultsContainer);
        this.searchPanel = panel;
        this.renderSearchResults([]);
        this.searchPanelVisible = false;
    };

    MonacoMultifileWrapper.prototype.createContextMenu = function() {
        this.contextMenu = $('<div class="monaco-multifile-context-menu"></div>');
        this.contextMenu.css({
            position: 'absolute',
            display: 'none',
            borderRadius: '3px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 10000,
            minWidth: '160px',
            fontSize: '13px'
        });
        $('body').append(this.contextMenu);
        this.syncContextMenuTheme();
    };

    MonacoMultifileWrapper.prototype.handleGlobalKeydown = function(event) {
        if (!event) {
            return;
        }
        if (event.defaultPrevented) {
            return;
        }
        const key = event.key || event.code;
        const isSearchShortcut = (key === 'F' || key === 'f') && event.shiftKey &&
            (event.ctrlKey || event.metaKey);
        if (!isSearchShortcut) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.toggleSearchPanel();
    };

    MonacoMultifileWrapper.prototype.toggleSearchPanel = function(forceState) {
        if (!this.searchPanel) {
            return;
        }
        const targetState = typeof forceState === 'boolean' ? forceState : !this.searchPanelVisible;
        this.searchPanelVisible = targetState;
        if (targetState) {
            this.searchPanel.stop(true, true).slideDown(120);
            if (this.searchInput) {
                setTimeout(() => {
                    this.searchInput.trigger('focus');
                    this.searchInput.select();
                }, 150);
            }
        } else {
            this.searchPanel.stop(true, true).slideUp(120);
        }
    };

    MonacoMultifileWrapper.prototype.setPreviewButtonDisabled = function(button, disabled) {
        if (!button || !button.length) {
            return;
        }
        const state = !!disabled;
        button.prop('disabled', state);
        button.toggleClass('is-disabled', state);
    };

    MonacoMultifileWrapper.prototype.updateDeviceButtonStates = function() {
        if (!this.deviceButtons) {
            return;
        }
        const activeWidth = String(this.activeDeviceWidth);
        this.deviceButtons.forEach(btn => {
            const isActive = btn.attr('data-device-width') === activeWidth;
            btn.toggleClass('is-active', isActive);
        });
    };

    MonacoMultifileWrapper.prototype.updateSearchStatus = function(message) {
        if (this.searchStatusLabel) {
            this.searchStatusLabel.text(message || '');
        }
    };

    MonacoMultifileWrapper.prototype.resetSearchPanel = function() {
        if (this.searchInput) {
            this.searchInput.val('');
        }
        if (this.searchCaseSensitive) {
            this.searchCaseSensitive.prop('checked', false);
        }
        this.updateSearchStatus(SEARCH_DEFAULT_MESSAGE);
        this.renderSearchResults([]);
    };

    MonacoMultifileWrapper.prototype.executeSearch = function() {
        if (!this.searchInput) {
            return;
        }
        const query = (this.searchInput.val() || '').trim();
        const caseSensitive = this.searchCaseSensitive && this.searchCaseSensitive.prop('checked');

        if (!query) {
            this.updateSearchStatus(SEARCH_DEFAULT_MESSAGE);
            this.renderSearchResults([]);
            return;
        }

        if (!this.vfs || !this.vfs.files || this.vfs.files.size === 0) {
            this.updateSearchStatus('There are no files available to search.');
            this.renderSearchResults([]);
            return;
        }

        const results = [];
        const queryPattern = escapeRegExp(query);

        for (const file of this.vfs.files.values()) {
            if (results.length >= MAX_SEARCH_RESULTS) {
                break;
            }
            const content = file.model ? file.model.getValue() : (file.content || '');
            if (!content) {
                continue;
            }
            const lines = content.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (results.length >= MAX_SEARCH_RESULTS) {
                    break;
                }
                const line = lines[i];
                const regex = new RegExp(queryPattern, caseSensitive ? 'g' : 'gi');
                let match;
                while ((match = regex.exec(line)) !== null) {
                    if (!match[0]) {
                        regex.lastIndex += 1;
                        continue;
                    }
                    results.push({
                        path: file.path,
                        lineNumber: i + 1,
                        column: match.index + 1,
                        matchLength: match[0].length,
                        snippet: buildHighlightedSnippet(line, match.index, match[0].length)
                    });
                    if (results.length >= MAX_SEARCH_RESULTS) {
                        break;
                    }
                    if (regex.lastIndex === match.index) {
                        regex.lastIndex++;
                    }
                }
            }
        }

        if (results.length === 0) {
            this.updateSearchStatus(`No matches found for "${query}".`);
        } else if (results.length >= MAX_SEARCH_RESULTS) {
            this.updateSearchStatus(`Showing first ${MAX_SEARCH_RESULTS} matches for "${query}".`);
        } else {
            this.updateSearchStatus(`${results.length} match${results.length === 1 ? '' : 'es'} for "${query}".`);
        }

        this.renderSearchResults(results, query);
    };

    MonacoMultifileWrapper.prototype.renderSearchResults = function(results) {
        if (!this.searchResultsContainer) {
            return;
        }
        this.searchResultsContainer.empty();
        if (!results || results.length === 0) {
            const placeholder = $('<div class="monaco-search-placeholder">No results.</div>');
            placeholder.css({
                fontSize: '12px',
                color: '#888'
            });
            this.searchResultsContainer.append(placeholder);
            return;
        }
        results.forEach(result => {
            const item = $('<div class="monaco-search-result"></div>');
            item.css({
                padding: '4px 2px',
                borderBottom: '1px solid rgba(0,0,0,0.05)',
                cursor: 'pointer'
            });
            item.on('mouseenter', () => {
                item.css('background', 'rgba(0,0,0,0.05)');
            }).on('mouseleave', () => {
                item.css('background', 'transparent');
            });

            const pathLabel = $('<div class="monaco-search-result-path"></div>');
            pathLabel.css({
                fontSize: '12px',
                fontWeight: '600'
            });
            pathLabel.text(result.path + ':' + result.lineNumber + ':' + result.column);

            const snippet = $('<div class="monaco-search-result-snippet"></div>');
            snippet.css({
                fontSize: '12px',
                color: '#444'
            });
            snippet.html(result.snippet);

            item.append(pathLabel, snippet);
            item.on('click', () => {
                this.openFile(result.path);
                setTimeout(() => {
                    if (!this.editor || !this.monaco) {
                        return;
                    }
                    const length = result.matchLength || 1;
                    const range = new this.monaco.Range(
                        result.lineNumber,
                        result.column,
                        result.lineNumber,
                        result.column + length
                    );
                    this.editor.setSelection(range);
                    this.editor.revealRangeInCenter(range);
                    this.editor.focus();
                }, 60);
            });

            this.searchResultsContainer.append(item);
        });
    };

    MonacoMultifileWrapper.prototype.initialiseEditor = function() {
        if (this.editor || !this.monaco) {
            return Promise.resolve();
        }

        return loadMonacoThemes(this.monaco).catch(() => false).then(() => {
            const fontSize = parseNumber(this.params.font_size, DEFAULTS.font_size);
            const tabSize = parseNumber(this.params.tab_size, DEFAULTS.tab_size);
            const minimapEnabled = normaliseBoolean(this.params.minimap, DEFAULTS.minimap);
            const wordWrapMode = this.params.word_wrap || DEFAULTS.word_wrap;

            this.editor = this.monaco.editor.create(this.editorContainer[0], {
                fontSize: fontSize,
                minimap: { enabled: minimapEnabled },
                wordWrap: wordWrapMode,
                tabSize: tabSize,
                automaticLayout: true,
                fixedOverflowWidgets: true,
                scrollbar: {
                    alwaysConsumeMouseWheel: false
                },
                scrollBeyondLastLine: false,
                scrollBeyondLastColumn: 0,
                folding: true,
                foldingStrategy: 'auto',
                links: true,                    // Enable document links (clickable imports/URLs)
                codeLens: true,                 // Enable code lens (inline reference counts)
                lightbulb: {                    // Enable lightbulb for code actions
                    enabled: true
                },
                'semanticHighlighting.enabled': false,
                // Disable sticky scroll to prevent crashes with LSP outline
                stickyScroll: {
                    enabled: false
                }
            });

            const theme = resolveTheme(this.params);
            this.applyResolvedTheme(theme);

            if (typeof this.monaco.editor.onDidChangeTheme === 'function') {
                this.themeListener = this.monaco.editor.onDidChangeTheme(newTheme => {
                    this.currentTheme = newTheme;
                    this.applyThemeClass(newTheme);
                    this.refreshThemeMenu();
                    this.updateThemeButtonState();
                });
            }

            // Register custom opener to handle "Go to Definition" across virtual files
            if (this.editor._codeEditorService) {
                const codeEditorService = this.editor._codeEditorService;
                const originalOpenCodeEditor = codeEditorService.openCodeEditor.bind(codeEditorService);

                codeEditorService.openCodeEditor = async (input, source, sideBySide) => {
                    // Extract the target URI and selection from the input
                    const targetUri = input.resource;
                    const selection = input.options ? input.options.selection : null;

                    if (targetUri) {
                        // Extract the file path relative to workspace root
                        // URI format: file:///{workspaceRoot}/{filePath}
                        const uriPath = targetUri.path;
                        const workspacePrefix = '/' + this.workspaceRoot + '/';

                        if (uriPath.startsWith(workspacePrefix)) {
                            const filePath = uriPath.substring(workspacePrefix.length);

                            // Check if this is one of our virtual files
                            const targetFile = this.vfs.getFile(filePath);
                            if (targetFile) {
                                // Open the file in our multifile editor
                                this.openFile(filePath);

                                // If there's a selection/position, navigate to it
                                if (selection && this.editor) {
                                    this.editor.setSelection(selection);
                                    this.editor.revealLineInCenter(selection.startLineNumber);
                                }

                                return this.editor;
                            }
                        }
                    }

                    // Fall back to default behavior for non-virtual files
                    return originalOpenCodeEditor(input, source, sideBySide);
                };
            }

            // Also react to LSP workspace edits applied via the adapter.
            if (!this.workspaceEditHook && typeof adapter.registerWorkspaceEditHook === 'function') {
                this.workspaceEditHook = adapter.registerWorkspaceEditHook(meta => {

                    // Handle file creation from LSP code actions (e.g., "Create class Foo")
                    if (meta && meta.kind === 'create' && meta.uri) {

                        // Parse the URI to get the full file path
                        const uri = this.monaco.Uri.parse(meta.uri);
                        const workspacePrefix = '/' + this.workspaceRoot + '/';
                        let filePath;

                        if (uri.path.startsWith(workspacePrefix)) {
                            // Extract path relative to workspace root
                            filePath = uri.path.substring(workspacePrefix.length);
                        } else {
                            // Fallback: extract filename only
                            const pathParts = uri.path.split('/');
                            filePath = pathParts[pathParts.length - 1];
                        }

                        // Check if file already exists
                        if (this.vfs.getFile(filePath)) {
                            return;
                        }

                        // Validate extension
                        if (!this.vfs.isExtensionAllowed(filePath)) {
                            return;
                        }

                        // Check file limit
                        if (!this.vfs.canAddFile(filePath)) {
                            return;
                        }

                        // Extract initial content from LSP text edits
                        let initialContent = '';
                        if (meta.initialContent && Array.isArray(meta.initialContent)) {
                            // LSP text edits array: [{range, newText}]
                            // For new files, should be a single edit inserting at position 0,0
                            for (let i = 0; i < meta.initialContent.length; i++) {
                                const edit = meta.initialContent[i];
                                if (edit && edit.newText) {
                                    initialContent += edit.newText;
                                }
                            }
                        }

                        // Create the file in the VFS with the extracted content
                        const newFile = new VirtualFile(filePath, initialContent, false);
                        this.vfs.addFile(newFile);

                        this.renderFileTree();
                        this.renderTabs();
                        this.openFile(filePath);

                        // Setup LSP for the new file
                        const lspOptions = this.getLspOptionsForLanguage(newFile.getLanguage());
                        rebindLspForFile(newFile, lspOptions, this.monaco, adapter);
                        this.registerWorkspaceFilesWithLsp(newFile.getLanguage(), null);

                        // Notify LSP server that file was created (after didOpen)
                        if (newFile.model && newFile.model.uri) {
                            adapter.notifyFileCreated(this.monaco, newFile.model.uri.toString(), lspOptions);
                        }

                        this.sync();

                        return;
                    }

                    // Workspace edits have been applied and commands will be executed automatically
                    // by the adapter when the edited files' content changes are synced.
                    // The LSP server (e.g., jdtls) will send updated diagnostics when it receives
                    // the refresh command (e.g., java.project.refreshDiagnostics).

                    const activeUri = this.activeFile && this.activeFile.model && this.activeFile.model.uri
                        ? this.activeFile.model.uri.toString()
                        : null;
                    const touched = Array.isArray(meta && meta.uris) ? meta.uris : [];
                    const affectedOriginFiles = Array.isArray(meta && meta.affectedOriginFiles) ? meta.affectedOriginFiles : [];

                    // If this workspace edit affected the current active file (which triggered the action),
                    // send an empty didChange to force the LSP to re-analyze it
                    if (affectedOriginFiles.length > 0 && activeUri && affectedOriginFiles.indexOf(activeUri) !== -1) {

                        // Send a content sync for the active file to trigger diagnostic refresh
                        if (this.activeFile && this.activeFile.model) {
                            const language = this.activeFile.getLanguage();
                            const lspOptions = this.getLspOptionsForLanguage(language);
                            if (lspOptions && lspOptions.enabled) {
                                // Sync the current content which will trigger LSP re-analysis
                                adapter.syncModelContent(this.monaco, this.activeFile.model, {
                                    language: language,
                                    lspUrl: lspOptions.lspUrl,
                                    lspBaseUrl: lspOptions.lspBaseUrl,
                                    prefixCode: lspOptions.prefixCode,
                                    forceVersionId: (this.activeFile.model.getVersionId() + 1)
                                });
                            }
                        }
                    }
                });
            }

            // Track content changes on any model so we can refresh the active tab when another file is modified.
            if (!this.modelChangeListener && typeof this.monaco.editor.onDidChangeModelContent === 'function') {
                this.modelChangeListener = this.monaco.editor.onDidChangeModelContent(event => {
                    const model = event && event.model;
                    
                    if (!model || !model.uri) {
                        return;
                    }
                    if (!this.activeFile || !this.activeFile.model || !this.activeFile.model.uri) {
                        return;
                    }
                    if (model.uri.toString() === this.activeFile.model.uri.toString()) {
                        return; // Ignore changes to the active model itself.
                    }
                    const changedFile = this.resolveFileForModel(model);
                    if (!changedFile || changedFile.path === this.activeFile.path) {
                        return;
                    }
                    this.fullSyncModel(this.activeFile.model, this.activeFile, null, {force: true});
                });
            }

            // Register all workspace files with LSP after editor is ready.
            if (!initialisedLspAll && this.vfs) {
                const seen = new Set();
                this.vfs.getAllFiles().forEach(f => {
                    const lang = f.getLanguage();
                    if (!lang) {
                        return;
                    }
                    if (!seen.has(lang)) {
                        seen.add(lang);
                        this.registerWorkspaceFilesWithLsp(lang, null);
                    }
                });
                initialisedLspAll = true;
            }
        });
    };

    MonacoMultifileWrapper.prototype.applyThemeClass = function(theme) {
        if (!this.container) {
            return;
        }
        const classesToRemove = [
            'monaco-multifile-theme-dark',
            'monaco-multifile-theme-light',
            'monaco-multifile-theme-one-dark',
            'monaco-multifile-theme-one-light'
        ];
        this.container.classList.remove(...classesToRemove);

        const themeClass = isDarkTheme(theme) ? 'monaco-multifile-theme-dark' : 'monaco-multifile-theme-light';
        this.container.classList.add(themeClass);

        const themeName = (theme || '').toLowerCase();
        if (themeName === 'one-dark') {
            this.container.classList.add('monaco-multifile-theme-one-dark');
        } else if (themeName === 'one-light') {
            this.container.classList.add('monaco-multifile-theme-one-light');
        }
        this.syncContextMenuTheme();
        this.updatePreviewModalTheme();
    };

    MonacoMultifileWrapper.prototype.getThemeMenuOptions = function() {
        const options = [
            {value: 'system', label: 'System default'},
            {value: 'vs', label: describeTheme('vs')},
            {value: 'vs-dark', label: describeTheme('vs-dark')}
        ];
        const seen = new Set(options.map(opt => opt.value));

        if (monacoThemesAvailable) {
            ['one-light', 'one-dark'].forEach(themeName => {
                if (!seen.has(themeName)) {
                    options.push({value: themeName, label: describeTheme(themeName)});
                    seen.add(themeName);
                }
            });
        }

        [this.params.theme, this.currentTheme, this.userSelectedTheme].forEach(themeName => {
            if (themeName && !seen.has(themeName)) {
                options.push({value: themeName, label: describeTheme(themeName)});
                seen.add(themeName);
            }
        });

        return options;
    };

    MonacoMultifileWrapper.prototype.refreshThemeMenu = function() {
        if (!this.themeMenu) {
            return;
        }
        const selection = this.userSelectedTheme || 'system';
        const options = this.getThemeMenuOptions();
        const currentThemeLabel = describeTheme(this.currentTheme);
        this.themeMenu.empty();

        options.forEach(option => {
            const button = $('<button type="button" class="monaco-theme-menu-item" role="menuitem"></button>');
            button.attr('data-theme-value', option.value);
            const label = $('<span class="monaco-theme-menu-label"></span>');
            label.text(option.label);
            button.append(label);

            if (option.value === selection) {
                button.addClass('selected');
            }

            let metaText = '';
            if (option.value === 'system') {
                metaText = this.userSelectedTheme
                    ? 'Follow system theme'
                    : (currentThemeLabel ? 'Current: ' + currentThemeLabel : 'Follow system theme');
            } else if (option.value === this.currentTheme) {
                metaText = 'Active';
            }

            if (metaText) {
                const meta = $('<span class="monaco-theme-menu-meta"></span>');
                meta.text(metaText);
                button.append(meta);
            }

            button.on('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleThemeSelection(option.value);
                this.hideThemeMenu();
            });

            this.themeMenu.append(button);
        });
    };

    MonacoMultifileWrapper.prototype.updateThemeButtonState = function() {
        if (!this.themeButton) {
            return;
        }
        const currentLabel = describeTheme(this.currentTheme);
        let title = 'Select theme';
        if (currentLabel) {
            title += ' (current: ' + currentLabel + ')';
        }
        if (!this.userSelectedTheme) {
            title += ' - following system preference';
        }
        this.themeButton.attr('title', title);
        this.themeButton.attr('aria-label', title);
    };

    MonacoMultifileWrapper.prototype.toggleThemeMenu = function() {
        if (!this.themeMenu) {
            return;
        }
        if (this.themeMenu.is(':visible')) {
            this.hideThemeMenu();
        } else {
            this.refreshThemeMenu();
            this.themeMenu.show();
            if (this.themeControl) {
                this.themeControl.addClass('open');
            }
        }
    };

    MonacoMultifileWrapper.prototype.hideThemeMenu = function() {
        if (!this.themeMenu) {
            return;
        }
        this.themeMenu.hide();
        if (this.themeControl) {
            this.themeControl.removeClass('open');
        }
    };

    MonacoMultifileWrapper.prototype.setStoredThemePreference = function(theme) {
        this.userSelectedTheme = theme || null;
        writeStoredThemePreference(this.userSelectedTheme);
    };

    MonacoMultifileWrapper.prototype.applyResolvedTheme = function(theme) {
        if (!theme) {
            return;
        }
        this.currentTheme = theme;
        if (this.monaco && this.monaco.editor && typeof this.monaco.editor.setTheme === 'function') {
            try {
                this.monaco.editor.setTheme(theme);
            } catch (err) {
                logWarn('Failed to set Monaco theme to ' + theme, err);
            }
        }
        this.applyThemeClass(theme);
        this.refreshThemeMenu();
        this.updateThemeButtonState();
    };

    MonacoMultifileWrapper.prototype.handleThemeSelection = function(value) {
        if (!value) {
            return;
        }
        if (value === 'system') {
            this.setStoredThemePreference(null);
            const theme = resolveTheme(this.params);
            this.applyResolvedTheme(theme);
            return;
        }
        this.setStoredThemePreference(value);
        this.applyResolvedTheme(value);
    };

    MonacoMultifileWrapper.prototype.syncContextMenuTheme = function() {
        if (!this.contextMenu || !this.container) {
            return;
        }

        const target = this.contextMenu[0];
        const styles = window.getComputedStyle(this.container);
        const cssVars = [
            '--mm-context-menu-bg',
            '--mm-context-menu-border',
            '--mm-context-menu-color',
            '--mm-context-menu-hover-bg',
            '--mm-context-menu-hover-color'
        ];

        cssVars.forEach(name => {
            const value = styles.getPropertyValue(name);
            if (value) {
                target.style.setProperty(name, value.trim());
            }
        });
    };

    MonacoMultifileWrapper.prototype.syncPreviewModalTheme = function() {
        if (!this.container) {
            return null;
        }

        const styles = window.getComputedStyle(this.container);
        return {
            backdrop: styles.getPropertyValue('--mm-preview-backdrop').trim() || 'rgba(0, 0, 0, 0.5)',
            modalBg: styles.getPropertyValue('--mm-preview-modal-bg').trim() || '#ffffff',
            modalBorder: styles.getPropertyValue('--mm-preview-modal-border').trim() || '#d0d0d0',
            headerBg: styles.getPropertyValue('--mm-preview-header-bg').trim() || '#f7f7f7',
            headerColor: styles.getPropertyValue('--mm-preview-header-color').trim() || '#4a4a4a',
            buttonColor: styles.getPropertyValue('--mm-preview-button-color').trim() || '#404040',
            buttonHoverBg: styles.getPropertyValue('--mm-preview-button-hover-bg').trim() || 'rgba(0, 0, 0, 0.08)',
            consoleBg: styles.getPropertyValue('--mm-preview-console-bg').trim() || '#f7f7f7',
            consoleColor: styles.getPropertyValue('--mm-preview-console-color').trim() || '#1f2329',
            consoleBorder: styles.getPropertyValue('--mm-preview-console-border').trim() || '#d0d0d0',
            consoleMuted: styles.getPropertyValue('--mm-preview-console-muted').trim() || '#6b6b6b'
        };
    };

    MonacoMultifileWrapper.prototype.updatePreviewModalTheme = function() {
        if (!this.previewModal) {
            return;
        }

        const theme = this.syncPreviewModalTheme();
        if (!theme) {
            return;
        }

        // Update modal backdrop
        this.previewModal.css('backgroundColor', theme.backdrop);

        // Update modal content
        const modalContent = this.previewModal.find('.monaco-preview-content');
        modalContent.css({
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
        });

        // Update header
        const header = this.previewModal.find('.monaco-preview-header');
        header.css({
            backgroundColor: theme.headerBg,
            color: theme.headerColor,
            borderBottomColor: theme.modalBorder
        });

        // Update title
        header.find('h3').css('color', theme.headerColor);

        // Update all buttons
        this.updateConsoleFilterButtons(theme);
        this.updateConsoleSearchTheme(theme);
        if (this.previewModal && this.previewModal.length) {
            const modalEl = this.previewModal;
            modalEl.css('--mm-preview-button-color', theme.buttonColor);
            modalEl.css('--mm-preview-button-hover-bg', theme.buttonHoverBg);
            modalEl.css('--mm-preview-button-border', theme.modalBorder);
            modalEl.css('--mm-preview-console-color', theme.consoleColor);
            modalEl.css('--mm-preview-console-muted', theme.consoleMuted || theme.buttonColor);
            modalEl.css('--mm-preview-console-bg', theme.consoleBg);
            modalEl.css('--mm-preview-console-border', theme.consoleBorder);
        }

        // Update console panel
        if (this.consolePanel) {
            this.consolePanel.css({
                backgroundColor: theme.consoleBg,
                color: theme.consoleColor,
                borderTopColor: theme.consoleBorder
            });
        }

        // Update resize handle
        if (this.consoleResizeHandle) {
            this.consoleResizeHandle.css('backgroundColor', theme.consoleBorder);
        }
    };

    MonacoMultifileWrapper.prototype.isConsoleFilterActive = function(filterKey) {
        if (!this.consoleFilters) {
            return false;
        }
        if (filterKey === 'all') {
            return !!this.consoleFilters.all;
        }
        if (this.consoleFilters.all) {
            return true;
        }
        return !!this.consoleFilters[filterKey];
    };

    MonacoMultifileWrapper.prototype.updateConsoleFilterButtons = function(theme) {
        if (!theme || !this.previewModal) {
            return;
        }
        const buttons = this.previewModal.find('.monaco-console-filter-btn');
        buttons.each((_, element) => {
            const btn = $(element);
            const filterKey = btn.data('filterKey');
            const active = this.isConsoleFilterActive(filterKey);
            btn.css({
                color: theme.buttonColor,
                borderColor: theme.consoleBorder,
                backgroundColor: active ? theme.buttonHoverBg : 'transparent'
            });
        });
    };

    MonacoMultifileWrapper.prototype.updateConsoleSearchTheme = function(theme) {
        if (!theme) {
            return;
        }
        if (this.consoleSearchInput) {
            const isFocused = this.consoleSearchInput.is(':focus');
            this.consoleSearchInput.css({
                backgroundColor: theme.consoleBg,
                color: theme.consoleColor,
                borderColor: isFocused ? theme.buttonColor : theme.consoleBorder
            });
        }
        if (this.previewModal) {
            this.previewModal.find('.monaco-console-search-icon').css('color', theme.headerColor);
            this.previewModal.find('.monaco-console-filter-label').css('color', theme.headerColor);
        }
    };

    MonacoMultifileWrapper.prototype.renderFileTree = function() {
        this.fileTree.empty();
        this.renderFolderContents('', this.fileTree, 0);
    };

    MonacoMultifileWrapper.prototype.restoreInitialUiState = function() {
        if (!this.vfs) {
            return;
        }

        this.openTabs = [];

        const allFiles = this.vfs.getAllFiles();
        const validPaths = new Set(allFiles.map(f => f.path));

        if (this.initialUiState && Array.isArray(this.initialUiState.openTabs)) {
            this.initialUiState.openTabs.forEach(path => {
                if (validPaths.has(path)) {
                    this.addOpenTab(path);
                }
            });
        }

        if (this.initialUiState && this.initialUiState.activeFile &&
                validPaths.has(this.initialUiState.activeFile)) {
            this.addOpenTab(this.initialUiState.activeFile);
            this.pendingActivePath = this.initialUiState.activeFile;
        } else {
            this.pendingActivePath = null;
        }

        if (this.openTabs.length === 0 && allFiles.length > 0) {
            const firstPath = allFiles[0].path;
            this.addOpenTab(firstPath);
            this.pendingActivePath = firstPath;
        } else if (!this.pendingActivePath && this.openTabs.length > 0) {
            let firstOpenPath = null;
            for (let i = 0; i < allFiles.length; i++) {
                if (this.isTabOpen(allFiles[i].path)) {
                    firstOpenPath = allFiles[i].path;
                    break;
                }
            }
            this.pendingActivePath = firstOpenPath;
        }
    };

    MonacoMultifileWrapper.prototype.isTabOpen = function(path) {
        return Array.isArray(this.openTabs) && this.openTabs.indexOf(path) !== -1;
    };

    MonacoMultifileWrapper.prototype.addOpenTab = function(path) {
        if (!path) {
            return;
        }
        if (!Array.isArray(this.openTabs)) {
            this.openTabs = [];
        }
        if (this.openTabs.indexOf(path) === -1) {
            this.openTabs.push(path);
        }
    };

    MonacoMultifileWrapper.prototype.removeOpenTab = function(path) {
        if (!path || !Array.isArray(this.openTabs)) {
            return;
        }
        const index = this.openTabs.indexOf(path);
        if (index !== -1) {
            this.openTabs.splice(index, 1);
        }
    };

    MonacoMultifileWrapper.prototype.replaceOpenTab = function(oldPath, newPath) {
        if (!Array.isArray(this.openTabs) || !oldPath || !newPath || oldPath === newPath) {
            return;
        }
        const index = this.openTabs.indexOf(oldPath);
        if (index !== -1) {
            if (this.openTabs.indexOf(newPath) === -1) {
                this.openTabs[index] = newPath;
            } else {
                this.openTabs.splice(index, 1);
            }
        } else {
            this.addOpenTab(newPath);
        }
    };

    MonacoMultifileWrapper.prototype.isFileLocked = function(file) {
        return this.lockingEnabled && !!(file && file.locked);
    };

    MonacoMultifileWrapper.prototype.hideContextMenu = function() {
        if (this.contextMenu) {
            this.contextMenu.hide();
        }
    };

    MonacoMultifileWrapper.prototype.getFolderIconDescriptor = function(isExpanded, folderPath) {
        if (this.params.use_vscode_icons) {
            const isRoot = !folderPath;
            const iconName = isRoot ?
                (isExpanded ? VSCODE_FOLDER_ICON_MAP.rootOpen : VSCODE_FOLDER_ICON_MAP.rootClosed) :
                (isExpanded ? VSCODE_FOLDER_ICON_MAP.open : VSCODE_FOLDER_ICON_MAP.closed);
            const iconUrl = getVscodeIconUrl(iconName);
            if (iconUrl) {
                return {type: 'vscode', src: iconUrl};
            }
        }
        const folderIconClass = isExpanded ? 'codicon-folder-opened' : 'codicon-folder';
        return {className: `codicon ${folderIconClass}`};
    };

    MonacoMultifileWrapper.prototype.getIconDescriptorForFile = function(file) {
        if (!file) {
            return null;
        }
        return file.getIconDescriptor(this.params.use_vscode_icons);
    };

    MonacoMultifileWrapper.prototype.renderFolderContents = function(folderPath, container, depth) {
        const indent = depth * 16;

        // Render subfolders
        const subfolders = this.vfs.getSubfolders(folderPath);
        subfolders.forEach(subfolder => {
            const folderName = subfolder.split('/').pop();
            const isExpanded = this.vfs.isFolderExpanded(subfolder);

            const folderItem = $('<div class="monaco-folder-item"></div>');
            folderItem.css({
                padding: '4px 8px',
                paddingLeft: (8 + indent) + 'px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                fontSize: '13px',
                userSelect: 'none',
                marginBottom: '2px'
            });

            const chevron = $(`<span class="monaco-chevron">${isExpanded ? '▼' : '▶'}</span>`);
            chevron.css({marginRight: '4px', fontSize: '10px'});

            const folderIconDescriptor = this.getFolderIconDescriptor(isExpanded, subfolder);
            const folderIcon = createIconElement(folderIconDescriptor, 'monaco-tree-icon');
            folderIcon.css({marginRight: '6px'});

            const folderLabel = $(`<span>${folderName}</span>`);

            folderItem.append(chevron, folderIcon, folderLabel);

            folderItem.on('click', (e) => {
                e.stopPropagation();
                const currentState = this.vfs.isFolderExpanded(subfolder);
                this.vfs.setFolderExpanded(subfolder, !currentState);
                this.sync();
                this.renderFileTree();
            });

            folderItem.on('contextmenu', (e) => {
                e.preventDefault();
                this.showContextMenu(e, 'folder', subfolder);
            });

            folderItem.on('dragenter', (e) => {
                if (!this.draggedFilePath) {
                    return;
                }
                // Only handle if we're directly over the folder item or its children
                const $target = $(e.target);
                const isOverFolder = e.target === folderItem[0] ||
                                   $target.hasClass('monaco-chevron') ||
                                   $target.hasClass('monaco-tree-icon') ||
                                   $target.parent()[0] === folderItem[0];

                if (isOverFolder) {
                    e.preventDefault();
                    this.fileTree.removeClass('drag-over-root');
                    folderItem.addClass('drag-over');
                }
            });

            folderItem.on('dragover', (e) => {
                if (!this.draggedFilePath) {
                    return;
                }
                // Only handle if we're directly over the folder item or its children
                const $target = $(e.target);
                const isOverFolder = e.target === folderItem[0] ||
                                   $target.hasClass('monaco-chevron') ||
                                   $target.hasClass('monaco-tree-icon') ||
                                   $target.parent()[0] === folderItem[0];

                if (isOverFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.fileTree.removeClass('drag-over-root');
                    if (e.originalEvent && e.originalEvent.dataTransfer) {
                        e.originalEvent.dataTransfer.dropEffect = 'move';
                    }
                    folderItem.addClass('drag-over');
                }
                // Otherwise let it bubble to fileTree handler
            });

            folderItem.on('dragleave', (e) => {
                const related = e.relatedTarget;
                if (!related || !folderItem[0].contains(related)) {
                    folderItem.removeClass('drag-over');
                }
            });

            folderItem.on('drop', (e) => {
                if (!this.draggedFilePath) {
                    return;
                }
                // Only handle if we're actually over this folder item
                if (folderItem.hasClass('drag-over')) {
                    e.preventDefault();
                    e.stopPropagation();
                    folderItem.removeClass('drag-over');
                    const source = this.draggedFilePath;
                    this.draggedFilePath = null;
                    this.clearDragIndicators();
                    this.moveFileToFolder(source, subfolder);
                }
                // Otherwise let it bubble up to parent/root
            });

            container.append(folderItem);

            if (isExpanded) {
                this.renderFolderContents(subfolder, container, depth + 1);
            }
        });

        // Render files in this folder
        const files = this.vfs.getFilesInFolder(folderPath);
        files.sort((a, b) => a.getName().localeCompare(b.getName()));

        files.forEach(file => {
            const fileItem = $('<div class="monaco-file-item"></div>');
            fileItem.css({
                padding: '4px 8px',
                paddingLeft: (8 + indent) + 'px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                fontSize: '13px',
                userSelect: 'none',
                marginBottom: '2px'
            });

            const locked = this.isFileLocked(file);
            if (this.activeFile && this.activeFile.path === file.path) {
                fileItem.addClass('active');
            }
            if (locked) {
                fileItem.addClass('locked');
            }

            const iconDescriptor = this.getIconDescriptorForFile(file);
            const fileIcon = createIconElement(iconDescriptor, 'monaco-tree-icon');
            fileIcon.css({marginRight: '6px'});

            const fileName = $(`<span class="monaco-file-name">${file.getName()}</span>`);
            fileName.css({flex: 1});

            fileItem.append(fileIcon, fileName);

            const draggable = this.authorMode || !locked;
            fileItem.prop('draggable', draggable);

            if (locked) {
                const lockIcon = $('<span class="monaco-lock-icon codicon codicon-lock" title="Locked file"></span>');
                fileItem.append(lockIcon);
            }

            fileItem.on('click', () => this.openFile(file.path));

            fileItem.on('contextmenu', (e) => {
                if (locked && !this.authorMode) {
                    return;
                }
                e.preventDefault();
                this.showContextMenu(e, 'file', file.path);
            });

            fileItem.on('dragstart', (e) => {
                if (locked && !this.authorMode) {
                    e.preventDefault();
                    return;
                }
                this.clearDragIndicators();
                this.draggedFilePath = file.path;
                if (e.originalEvent && e.originalEvent.dataTransfer) {
                    e.originalEvent.dataTransfer.setData('text/plain', file.path);
                    e.originalEvent.dataTransfer.effectAllowed = 'move';
                }
            });

            fileItem.on('dragend', () => {
                this.draggedFilePath = null;
                this.clearDragIndicators();
            });

            fileItem.on('dragover', (e) => {
                if (!this.draggedFilePath || this.draggedFilePath === file.path) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.originalEvent && e.originalEvent.dataTransfer) {
                    e.originalEvent.dataTransfer.dropEffect = 'move';
                }
                fileItem.addClass('drag-over');
            });

            fileItem.on('dragleave', (e) => {
                const related = e.relatedTarget;
                if (!related || !fileItem[0].contains(related)) {
                    fileItem.removeClass('drag-over');
                }
            });

            fileItem.on('drop', (e) => {
                if (!this.draggedFilePath) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                fileItem.removeClass('drag-over');
                const source = this.draggedFilePath;
                this.draggedFilePath = null;
                this.clearDragIndicators();
                const targetFolder = file.getDirectory();
                this.moveFileToFolder(source, targetFolder);
            });

            container.append(fileItem);
        });
    };

    MonacoMultifileWrapper.prototype.getOrderedOpenFiles = function() {
        if (!this.vfs) {
            return [];
        }
        const fileMap = new Map(this.vfs.getAllFiles().map(file => [file.path, file]));
        if (!Array.isArray(this.openTabs) || this.openTabs.length === 0) {
            return [];
        }
        return this.openTabs.map(path => fileMap.get(path)).filter(file => !!file);
    };

    MonacoMultifileWrapper.prototype.renderTabs = function() {
        this.tabBar.empty();

        const files = this.getOrderedOpenFiles();

        files.forEach(file => {
            const tab = $('<div class="monaco-tab"></div>');
            if (this.activeFile && this.activeFile.path === file.path) {
                tab.addClass('active');
            }

            // Add locked class for styling
            const locked = this.isFileLocked(file);
            if (locked) {
                tab.addClass('locked');
            }

            // Add file icon
            const iconDescriptor = this.getIconDescriptorForFile(file);
            const fileIcon = createIconElement(iconDescriptor, 'monaco-tab-icon');
            fileIcon.css({marginRight: '6px'});

            // Add file name
            const fileName = $(`<span class="monaco-tab-name">${file.getName()}</span>`);

            tab.append(fileIcon, fileName);

            // Add lock icon for locked files
            if (locked) {
                const lockIcon = $('<span class="monaco-tab-lock-icon codicon codicon-lock" title="Locked file"></span>');
                lockIcon.css({marginLeft: '6px', opacity: '0.7'});
                tab.append(lockIcon);
            }

            // Add close button
            const closeBtn = $('<span class="monaco-tab-close codicon codicon-close" title="Close"></span>');
            closeBtn.css({marginLeft: '6px', padding: '2px', cursor: 'pointer'});
            closeBtn.on('click', (e) => {
                e.stopPropagation();
                this.closeFile(file.path);
            });
            tab.append(closeBtn);

            tab.on('click', () => this.openFile(file.path));

            tab.on('mousedown', (e) => {
                if (e.which === 2) { // Middle mouse button
                    e.preventDefault();
                    this.closeFile(file.path);
                }
            });

            this.tabBar.append(tab);
        });
    };

    MonacoMultifileWrapper.prototype.openFile = function(path) {
        if (!this.monaco || !this.editor) {
            return;
        }

        // Save view state of current file
        if (this.activeFile && this.activeFile.model) {
            this.activeFile.viewState = this.editor.saveViewState();
            this.activeFile.content = this.activeFile.model.getValue();
        }

        const file = this.vfs.getFile(path);
        if (!file) {
            return;
        }

        // Create or retrieve Monaco model for this file
        this.ensureModelForFile(file);

        // Set model BEFORE setting up LSP
        // This prevents the adapter from calling setModel and interfering with our model management
        try {
            const setModelResult = this.editor.setModel(file.model);
            // setModel can trigger widget disposal which returns Promises that may reject with "Canceled"
            if (setModelResult && typeof setModelResult.catch === 'function') {
                setModelResult.catch(err => {
                    // Ignore "Canceled" errors from widget disposal during model changes
                    if (err && err.message !== 'Canceled' && err !== 'Canceled') {
                        // Ignore failures on optional view-state restore.
                    }
                });
            }
        } catch (e) {
            // Ignore synchronous errors from setModel
        }

        // Setup LSP for this model (adapter handles duplicate registrations via reference counting)
        // Always call setupLSPForFile to ensure binding is for the current editor instance
        if (this.params.lsp_enabled) {
            this.setupLSPForFile(file);
        }

        if (this._debouncedActiveSync) {
            clearTimeout(this._debouncedActiveSync);
        }
        this.activeFile = file;
        // Tab change - let LSP naturally handle cross-file diagnostics
        this._debouncedActiveSync = null;

        if (file.viewState) {
            try {
                const restoreResult = this.editor.restoreViewState(file.viewState);
                // restoreViewState can return a Promise that may be rejected with "Canceled"
                if (restoreResult && typeof restoreResult.catch === 'function') {
                    restoreResult.catch(err => {
                        // Ignore "Canceled" errors - these are normal when quickly switching tabs
                        if (err && err.message !== 'Canceled' && err !== 'Canceled') {
                            // Ignore failures on optional view-state restore.
                        }
                    });
                }
            } catch (e) {
                // Ignore errors from restoreViewState
            }
        }
        this.editor.focus();

        // Set read-only for students when file is locked
        const isReadOnly = this.isFileLocked(file) && !this.authorMode;
        this.editor.updateOptions({ readOnly: isReadOnly });

        this.addOpenTab(file.path); // Track tab by click order
        this.renderFileTree();
        this.renderTabs();
    };

    /**
     * Build a unique Monaco model URI for a file.
     * Includes textareaId to avoid conflicts between multiple editors on the same page.
     *
     * @param {Object} file - The file to build URI for
     * @returns {Object} Monaco URI object
     */
    MonacoMultifileWrapper.prototype.buildModelUri = function(file) {
        const path = file && file.path ? file.path.replace(/^\/+/, '') : 'untitled.txt';
        const uriString = 'file:///' + this.workspaceRoot + '/' + path;
        return this.monaco.Uri.parse(uriString);
    };

    MonacoMultifileWrapper.prototype.ensureModelForFile = function(file) {
        if (!file || !this.monaco) {
            return null;
        }

        const targetUri = this.buildModelUri(file);
        const language = file.getLanguage();

        const recreateModel = (value) => {
            if (file.model && modelIsAlive(file.model)) {
                try {
                    file.model.dispose();
                } catch (e) {
                    // Ignore dispose errors.
                }
            }
            if (file.editorBinding && typeof file.editorBinding.dispose === 'function') {
                try {
                    file.editorBinding.dispose();
                } catch (err) {
                    // Ignore.
                }
                file.editorBinding = null;
            }
            if (file.lspRegistration && typeof file.lspRegistration.dispose === 'function') {
                try {
                    file.lspRegistration.dispose();
                } catch (err) {
                    // Ignore.
                }
                file.lspRegistration = null;
            }

            file.model = this.monaco.editor.createModel(
                value,
                language,
                targetUri
            );
            file.model._lspRegistered = false;
            file.model.onWillDispose(() => { file.model._lspRegistered = false; });
            file.model.onDidChangeContent(() => {
                this.debouncedSyncToLocalStorage();
                try {
                    const uri = file.model && file.model.uri ? file.model.uri.toString() : null;
                    const ver = file.model && typeof file.model.getVersionId === 'function'
                        ? file.model.getVersionId()
                        : null;
                    if (uri && ver !== null) {
                        this.lastSyncedVersions.set(uri, ver);
                    }
                } catch (e) {}
                // Trigger cross-file diagnostics refresh
                this.refreshDependentFiles(file);
            });
            return file.model;
        };

        if (!file.model || !modelIsAlive(file.model)) {
            return recreateModel(file.content);
        }

        if (file.model.uri.toString() !== targetUri.toString()) {
            let currentValue = file.content || '';
            try {
                if (file.model && modelIsAlive(file.model)) {
                    currentValue = file.model.getValue();
                }
            } catch (e) {
                // Fallback to cached content if model is disposed.
            }
            if (file.model && typeof file.model.dispose === 'function') {
                try { file.model.dispose(); } catch (e) {}
            }
            return recreateModel(currentValue);
        }

        return file.model;
    };

    // Refresh dependent files by forcing a full-content sync
    // This nudges the LSP to re-analyse without detaching models
    MonacoMultifileWrapper.prototype.refreshDependentFiles = function(changedFile) {
        if (!changedFile || !this.vfs || !this.params.lsp_enabled || this._isSyncing) {
            return;
        }
        const language = changedFile.getLanguage();
        if (!language) {
            return;
        }

        // Debounce to avoid excessive refreshes
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
        }

        this._refreshTimer = setTimeout(() => {
            const files = this.vfs.getAllFiles().filter(f =>
                f && f.path !== changedFile.path && f.getLanguage() === language
            );
            files.forEach(f => {
                const model = this.ensureModelForFile(f);
                if (model) {
                    this.fullSyncModel(model, f, null, {force: true, adapterOnly: true});
                }
            });
        }, 300);
    };

    MonacoMultifileWrapper.prototype.disposeCurrentLspBinding = function() {
        if (this.currentLspBinding && typeof this.currentLspBinding.dispose === 'function') {
            try {
                this.currentLspBinding.dispose();
            } catch (err) {
                logWarn('Failed to dispose active LSP binding', err);
            }
        }
        if (this.activeFile && this.activeFile.editorBinding === this.currentLspBinding) {
            this.activeFile.editorBinding = null;
        }
        this.currentLspBinding = null;
    };

    MonacoMultifileWrapper.prototype.getLspOptionsForLanguage = function(language) {
        const builtinWorkerLanguages = ['css', 'javascript', 'typescript'];
        const disallowed = ['plaintext', 'text', '', null, undefined];
        if (builtinWorkerLanguages.indexOf(language) !== -1 || disallowed.indexOf(language) !== -1) {
            return {enabled: false};
        }
        const lspBaseUrl = (this.params.lsp_base_url || '').trim().replace(/\/$/, '');
        const lspUrlOverride = (this.params.lsp_url || '').trim();
        const resolvedUrl = lspUrlOverride || (lspBaseUrl ? lspBaseUrl + '/' + language : '');
        if (!resolvedUrl) {
            logWarn('No LSP endpoint configured for language ' + language);
            return {enabled: false};
        }
        const disablePrefixes = this.params.disable_lsp_prefixes;
        const prefixCode = disablePrefixes ? '' : (this.params.lsp_prefix_code || '');
        return {
            enabled: true,
            lspUrl: resolvedUrl,
            lspBaseUrl: lspBaseUrl,
            prefixCode: prefixCode,
            useSimple: this.params.use_simple_lsp,
            richFeatures: this.params.rich_features,
            workspaceConfig: this.params.lsp_workspace_config || ''
        };
    };

    /**
     * Bind the active Monaco model to the configured LSP server.
     * @param {Object} file - The file being edited
     */
    MonacoMultifileWrapper.prototype.setupLSPForFile = function(file) {
        if (!this.params.lsp_enabled || !file || !file.model || !this.editor) {
            this.currentLspBinding = null;
            return;
        }

        const language = file.getLanguage();
        const lspOptions = this.getLspOptionsForLanguage(language);
        if (!lspOptions.enabled) {
            this.currentLspBinding = null;
            return;
        }

        if (file.editorBinding) {
            // File already registered with the LSP; just record it as current.
            this.currentLspBinding = file.editorBinding;
            return;
        }

        try {
            const modelUri = file.model && file.model.uri ? file.model.uri.toString() : ('file:///' + file.path);
            this.currentLspBinding = adapter.bindEditorModelToLsp({
                editor: this.editor,
                model: file.model,
                language: language,
                prefixCode: lspOptions.prefixCode,
                lspUrl: lspOptions.lspUrl,
                lspBaseUrl: lspOptions.lspBaseUrl,
                useSimpleLsp: lspOptions.useSimple,
                richFeatures: lspOptions.richFeatures,
                workspaceConfig: lspOptions.workspaceConfig,
                path: modelUri,
                workspaceRootUri: 'file:///' + this.workspaceRoot,
                monaco: this.monaco
            });
            file.editorBinding = this.currentLspBinding;
            if (file && file.model) {
                file.model._lspRegistered = true;
            }
            this.registerWorkspaceFilesWithLsp(language, file);
        } catch (err) {
            logError('Failed to initialise LSP for ' + file.path, err);
            this.currentLspBinding = null;
        }
    };

    MonacoMultifileWrapper.prototype.registerWorkspaceFilesWithLsp = function(language, activeFile) {
        if (!this.params.lsp_enabled || !this.monaco || !this.vfs) {
            return;
        }
        const lspOptions = this.getLspOptionsForLanguage(language);
        if (!lspOptions.enabled) {
            return;
        }
        const files = this.vfs.getAllFiles().filter(f => f.getLanguage() === language);
        files.forEach(f => {
            if (activeFile && f.path === activeFile.path) {
                return;
            }
            const model = this.ensureModelForFile(f);
            if (!model) {
                return;
            }
            if (model._lspRegistered) {
                return;
            }
            if (f.lspRegistration && typeof f.lspRegistration.dispose === 'function') {
                try {
                    f.lspRegistration.dispose();
                } catch (e) {
                    // Ignore dispose errors.
                }
                f.lspRegistration = null;
            }
            const registrationOptions = {
                language: language,
                lspUrl: lspOptions.lspUrl,
                lspBaseUrl: lspOptions.lspBaseUrl,
                prefixCode: lspOptions.prefixCode
            };
            f.lspRegistration = adapter.registerModelWithLsp(this.monaco, model, registrationOptions);
            if (typeof adapter.isModelRegisteredWithLsp === 'function') {
                model._lspRegistered = adapter.isModelRegisteredWithLsp(this.monaco, model, registrationOptions);
            } else {
                model._lspRegistered = true;
            }
        });
    };

    // Refresh the active file when another file changes to update cross-file diagnostics.
    // Increments version to force LSP to re-analyze dependent files.
    MonacoMultifileWrapper.prototype.notifyFileChanged = function(changedFile) {
        if (!changedFile || !this.activeFile || !this.activeFile.model) {
            return;
        }
        if (changedFile.path === this.activeFile.path) {
            return;
        }
        // Don't use adapterOnly - let setValue run to keep Monaco and LSP versions in sync
        this.fullSyncModel(this.activeFile.model, this.activeFile, null, {force: true});
    };

    MonacoMultifileWrapper.prototype.resolveFileForModel = function(model) {
        if (!model || !model.uri || !this.vfs) {
            return null;
        }
        const uriString = model.uri.toString();
        const files = this.vfs.getAllFiles();
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (f && f.model && f.model.uri && f.model.uri.toString() === uriString) {
                return f;
            }
        }
        return null;
    };

    // Full sync helper – sends the model's own content to the LSP without mutating other models.
    /**
     * Full sync helper – sends the model's own content to the LSP without mutating other models.
     * @param {Object} model
     * @param {Object} file
     * @param {Object} lspOptionsOverride
     * @param {Object|boolean} options - boolean keeps backward compat (forceSync); object supports {force: bool, adapterOnly: bool, preserveVersion: bool}
     */

    MonacoMultifileWrapper.prototype.fullSyncModel = function(model, file, lspOptionsOverride, options) {
        const opts = typeof options === 'object' && options !== null
            ? options
            : {force: !!options, adapterOnly: false, preserveVersion: false};
        const targetPath = (file && file.path) || (this.activeFile && this.activeFile.path) || 'unknown';
        if (!model || !modelIsAlive(model) || !this.params.lsp_enabled || !this.monaco) {
            return;
        }

        const targetFile = file || (this.activeFile && this.activeFile.model === model ? this.activeFile : null);
        const language = targetFile && typeof targetFile.getLanguage === 'function'
            ? targetFile.getLanguage()
            : (typeof model.getLanguageId === 'function'
                ? model.getLanguageId()
                : (model._languageIdentifier && model._languageIdentifier.language) ||
                  (typeof model.getModeId === 'function' ? model.getModeId() : 'plaintext'));

        const lspOptions = lspOptionsOverride || this.getLspOptionsForLanguage(language);
        if (!lspOptions || !lspOptions.enabled) {
            return;
        }

        const uriKey = model.uri && typeof model.uri.toString === 'function' ? model.uri.toString() : null;
        const baseVersion = typeof model.getVersionId === 'function' ? model.getVersionId() : 0;
        const lastSynced = uriKey && this.lastSyncedVersions.has(uriKey) ? this.lastSyncedVersions.get(uriKey) : null;
        if (!opts.force && !opts.adapterOnly && lastSynced !== null && lastSynced >= baseVersion) {
            return;
        }


        // Use current version if preserveVersion is true, otherwise increment
        const targetVersion = opts.preserveVersion ? baseVersion : (baseVersion + 1);

        if (typeof adapter.syncModelContent === 'function') {
            try {
                const sent = adapter.syncModelContent(this.monaco, model, {
                    language: language,
                    lspUrl: lspOptions.lspUrl,
                    lspBaseUrl: lspOptions.lspBaseUrl,
                    prefixCode: lspOptions.prefixCode,
                    forceVersionId: targetVersion
                });
                if (sent) {
                    if (uriKey) {
                        this.lastSyncedVersions.set(uriKey, targetVersion);
                    }
                    if (opts.adapterOnly) {
                        return;
                    }
                }
                if (opts.adapterOnly && !sent) {
                    // Avoid fallback writes when adapter-only is requested.
                    return;
                }
            } catch (err) {
                logWarn('Failed to sync model content', err);
                if (opts.adapterOnly) {
                    return;
                }
            }
        }

        if (typeof model.getValue === 'function' && typeof model.setValue === 'function') {
            const current = model.getValue();
            let viewState = null;
            const isActiveModel = this.editor && this.editor.getModel && this.editor.getModel() === model;
            if (isActiveModel && typeof this.editor.saveViewState === 'function') {
                viewState = this.editor.saveViewState();
            }
            // Set flag to prevent infinite loop when setValue triggers onDidChangeContent
            this._isSyncing = true;
            try {
                model.setValue(current); // fallback when adapter helper is unavailable
            } finally {
                this._isSyncing = false;
            }
            const postVersion = typeof model.getVersionId === 'function' ? model.getVersionId() : targetVersion;
            if (uriKey) {
                this.lastSyncedVersions.set(uriKey, postVersion);
            }
            if (isActiveModel && viewState && typeof this.editor.restoreViewState === 'function') {
                this.editor.restoreViewState(viewState);
            }
        }
    };

    MonacoMultifileWrapper.prototype.fullSyncLanguageModels = function(language) {
        if (!this.params.lsp_enabled || !this.monaco || !this.vfs) {
            return;
        }
        const files = this.vfs.getAllFiles().filter(f => f.getLanguage() === language);
        files.forEach(f => {
            const model = this.ensureModelForFile(f);
            this.fullSyncModel(model, f);
        });
    };

    MonacoMultifileWrapper.prototype.fullSyncAllLanguages = function() {
        const langs = new Set(this.vfs.getAllFiles().map(f => f.getLanguage()).filter(Boolean));
        langs.forEach(lang => this.fullSyncLanguageModels(lang));
    };

    MonacoMultifileWrapper.prototype.showContextMenu = function(event, type, target) {
        this.contextMenu.empty();
        this.contextMenuTarget = {type, target};
        this.syncContextMenuTheme();

        let menuItemCount = 0;
        const addMenuItem = (icon, text, handler) => {
            const item = $(`<div class="monaco-multifile-context-menu-item">${icon} ${text}</div>`);
            item.css({
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            });
            item.on('click', () => {
                this.hideContextMenu();
                handler();
            });
            this.contextMenu.append(item);
            menuItemCount++;
        };

        if (type === 'file') {
            const file = this.vfs.getFile(target);
            if (!file) {
                return;
            }
            const locked = this.isFileLocked(file);
            const canModifyStructure = this.authorMode || !locked;
            if (canModifyStructure) {
                addMenuItem('<span class="codicon codicon-edit"></span>', 'Rename', () => this.renameFile(target));
                addMenuItem('<span class="codicon codicon-trash"></span>', 'Delete', () => this.deleteFile(target));
            }
            if (this.lockUiEnabled && this.authorMode) {
                if (locked) {
                    addMenuItem('<span class="codicon codicon-unlock"></span>', 'Unlock File', () => this.toggleFileLock(target, false));
                } else {
                    addMenuItem('<span class="codicon codicon-lock"></span>', 'Lock File', () => this.toggleFileLock(target, true));
                }
            }
        } else if (type === 'root') {
            if (this.allowNewFiles) {
                addMenuItem('<span class="codicon codicon-new-file"></span>', 'New File', () => this.promptNewFile(''));
            }
            if (this.lockUiEnabled && this.authorMode) {
                addMenuItem('<span class="codicon codicon-lock"></span>', 'New Locked File', () => this.promptNewFile('', {locked: true}));
            }
            if (this.allowNewFolders) {
                addMenuItem('<span class="codicon codicon-new-folder"></span>', 'New Folder', () => this.promptNewFolder(''));
            }
        } else if (type === 'folder') {
            if (this.allowNewFiles) {
                addMenuItem('<span class="codicon codicon-new-file"></span>', 'New File', () => this.promptNewFile(target));
            }
            if (this.lockUiEnabled && this.authorMode) {
                addMenuItem('<span class="codicon codicon-lock"></span>', 'New Locked File', () => this.promptNewFile(target, {locked: true}));
            }
            if (this.allowNewFolders) {
                addMenuItem('<span class="codicon codicon-new-folder"></span>', 'New Folder', () => this.promptNewFolder(target));
            }
            if (target !== '') {
                addMenuItem('<span class="codicon codicon-trash"></span>', 'Delete Folder', () => this.deleteFolder(target));
            }
        }

        if (menuItemCount === 0) {
            this.hideContextMenu();
            return;
        }

        this.contextMenu.css({
            left: event.pageX + 'px',
            top: event.pageY + 'px',
            display: 'block'
        });
    };

    MonacoMultifileWrapper.prototype.clearDragIndicators = function() {
        if (!this.fileTree) {
            return;
        }
        this.fileTree.find('.monaco-folder-item').removeClass('drag-over');
        this.fileTree.removeClass('drag-over-root');
    };

    MonacoMultifileWrapper.prototype.moveFileToFolder = function(filePath, targetFolder) {
        const file = this.vfs.getFile(filePath);
        if (!file) {
            return;
        }
        if (this.isFileLocked(file) && !this.authorMode) {
            this.draggedFilePath = null;
            this.clearDragIndicators();
            return;
        }

        const fileName = file.getName();
        const newPath = targetFolder ? targetFolder + '/' + fileName : fileName;

        if (newPath === file.path) {
            return;
        }

        const wasActive = this.activeFile && this.activeFile.path === file.path;
        const savedViewState = (wasActive && this.editor)
            ? this.editor.saveViewState()
            : file.viewState;
        const originalPath = file.path;
        const tabWasOpen = this.isTabOpen(originalPath);

        // Capture old URI before moving
        const oldUri = file.model ? file.model.uri.toString() : null;

        try {
            this.vfs.renameFile(file.path, newPath, {allowLocked: this.authorMode});
        } catch (err) {
            alert(err.message);
            return;
        }

        file.viewState = savedViewState;
        this.ensureModelForFile(file);
        // Re-register the moved file with LSP under its new URI (including active file)
        const lspOptions = this.getLspOptionsForLanguage(file.getLanguage());
        rebindLspForFile(file, lspOptions, this.monaco, adapter, oldUri);
        this.registerWorkspaceFilesWithLsp(file.getLanguage(), null);

        if (tabWasOpen) {
            this.replaceOpenTab(originalPath, newPath);
        }

        if (targetFolder) {
            this.vfs.setFolderExpanded(targetFolder, true);
        }

        if (wasActive) {
            this.openFile(newPath);
        } else {
            this.renderFileTree();
            this.renderTabs();
        }
        this.registerWorkspaceFilesWithLsp(file.getLanguage(), file);
        this.sync();
    };

    MonacoMultifileWrapper.prototype.toggleFileLock = function(path, locked) {
        if (!this.authorMode || !this.lockUiEnabled) {
            return;
        }
        const file = this.vfs.getFile(path);
        if (!file) {
            return;
        }
        this.hideContextMenu();
        file.locked = !!locked;
        if (this.activeFile && this.activeFile.path === path && this.editor) {
            const isReadOnly = this.isFileLocked(file) && !this.authorMode;
            this.editor.updateOptions({readOnly: isReadOnly});
        }
        this.renderFileTree();
        this.renderTabs();
        this.sync();
    };

    MonacoMultifileWrapper.prototype.promptNewFile = function(folderPath, options) {
        const settings = Object.assign({locked: false}, options || {});
        this.hideContextMenu();
        if (!this.authorMode && this.params.disable_new_files) {
            alert('Creating new files is disabled for this question.');
            return;
        }
        const filename = prompt('Enter new file name (with extension):');
        if (!filename) {
            return;
        }

        const fullPath = folderPath ? folderPath + '/' + filename : filename;

        // Validate extension
        const ext = getExtension(filename);
        const allowedList = Array.isArray(this.params.allowed_extensions) ?
            this.params.allowed_extensions.join(', ') :
            String(this.params.allowed_extensions || '');
        if (!this.vfs.isExtensionAllowed(fullPath)) {
            const label = ext ? `.${ext}` : '(none)';
            alert(`File extension ${label} is not allowed. Allowed: ${allowedList}`);
            return;
        }

        // Check if file already exists
        if (this.vfs.getFile(fullPath)) {
            alert('File already exists');
            return;
        }

        // Check file limit
        if (!this.vfs.canAddFile(filename)) {
            alert(`Cannot add more files. Maximum: ${this.params.max_files}`);
            return;
        }

        // Create new file
        const newFile = new VirtualFile(fullPath, '', this.lockUiEnabled && !!settings.locked);
        this.vfs.addFile(newFile);

        if (folderPath) {
            this.vfs.setFolderExpanded(folderPath, true);
        }

        this.renderFileTree();
        this.renderTabs();
        this.openFile(fullPath);
        const lspOptions = this.getLspOptionsForLanguage(newFile.getLanguage());
        rebindLspForFile(newFile, lspOptions, this.monaco, adapter);
        this.registerWorkspaceFilesWithLsp(newFile.getLanguage(), null);
        this.sync();
    };

    MonacoMultifileWrapper.prototype.promptNewFolder = function(parentPath) {
        this.hideContextMenu();
        if (!this.authorMode && this.params.disable_new_folders) {
            alert('Creating new folders is disabled for this question.');
            return;
        }
        const foldername = prompt('Enter new folder name:');
        if (!foldername) {
            return;
        }

        const fullPath = parentPath ? parentPath + '/' + foldername : foldername;

        try {
            this.vfs.createFolder(fullPath, true); // Create expanded
            if (parentPath) {
                this.vfs.setFolderExpanded(parentPath, true);
            }
            this.renderFileTree();
            this.sync();
        } catch (err) {
            alert(err.message);
        }
    };

    MonacoMultifileWrapper.prototype.renameFile = function(oldPath) {
        const file = this.vfs.getFile(oldPath);
        if (!file) {
            return;
        }
        if (this.isFileLocked(file) && !this.authorMode) {
            alert('Cannot rename locked files');
            return;
        }

        const oldName = file.getName();
        const newName = prompt('Rename file:', oldName);
        if (!newName || newName === oldName) {
            return;
        }

        const dir = file.getDirectory();
        const newPath = dir ? dir + '/' + newName : newName;
        const wasActive = this.activeFile && this.activeFile.path === oldPath;
        const tabWasOpen = this.isTabOpen(oldPath);

        // Capture old URI before renaming
        const oldUri = file.model ? file.model.uri.toString() : null;

        try {
            this.vfs.renameFile(oldPath, newPath, {allowLocked: this.authorMode});

            if (tabWasOpen) {
                this.replaceOpenTab(oldPath, newPath);
            }

            const renamedFile = this.vfs.getFile(newPath);
            if (renamedFile) {
                if (wasActive) {
                    this.activeFile = renamedFile;
                }
                this.ensureModelForFile(renamedFile);
                const lspOptions = this.getLspOptionsForLanguage(renamedFile.getLanguage());
                rebindLspForFile(renamedFile, lspOptions, this.monaco, adapter, oldUri);
                this.registerWorkspaceFilesWithLsp(renamedFile.getLanguage(), null);
            }

            if (wasActive) {
                this.openFile(newPath);
            } else {
                this.renderFileTree();
                this.renderTabs();
            }
            this.sync();
        } catch (err) {
            alert(err.message);
        }
    };

    MonacoMultifileWrapper.prototype.deleteFolder = function(folderPath) {
        this.hideContextMenu();
        if (!confirm(`Delete folder "${folderPath}"?`)) {
            return;
        }

        try {
            this.vfs.removeFolder(folderPath);
            this.renderFileTree();
            this.sync();
        } catch (err) {
            alert(err.message);
        }
    };

    MonacoMultifileWrapper.prototype.deleteFile = function(path) {
        this.hideContextMenu();
        const file = this.vfs.getFile(path);
        if (!file) {
            return;
        }

        if (this.isFileLocked(file) && !this.authorMode) {
            alert('Cannot delete locked files');
            return;
        }

        if (!confirm(`Delete ${file.getName()}?`)) {
            return;
        }

        this.removeOpenTab(path);
        const deletedLanguage = file.getLanguage();
        const deletedUriString = this.buildModelUri(file).toString();

        const wasActive = this.activeFile && this.activeFile.path === path;
        let nextPath = null;
        if (wasActive) {
            const remainingFiles = this.vfs.getAllFiles().filter(f => f.path !== path);
            nextPath = remainingFiles.length > 0 ? remainingFiles[0].path : null;
            if (this.editor) {
                try {
                    const setModelResult = this.editor.setModel(null);
                    // setModel can trigger widget disposal which returns Promises that may reject with "Canceled"
                    if (setModelResult && typeof setModelResult.catch === 'function') {
                        setModelResult.catch(err => {
                            // Ignore "Canceled" errors from widget disposal
                            if (err && err.message !== 'Canceled' && err !== 'Canceled') {
                            }
                        });
                    }
                } catch (e) {
                    // Ignore synchronous errors
                }
            }
            this.disposeCurrentLspBinding();
            this.activeFile = null;
        }

        if (file && file.editorBinding && typeof file.editorBinding.dispose === 'function') {
            try {
                file.editorBinding.dispose();
            } catch (err) {
                logWarn('Failed to dispose LSP binding for ' + file.path, err);
            }
            file.editorBinding = null;
        }

        if (file && file.lspRegistration && typeof file.lspRegistration.dispose === 'function') {
            try {
                file.lspRegistration.dispose();
            } catch (err) {
                // Ignore.
            }
            file.lspRegistration = null;
        }

        if (file.model) {
            try {
                file.model.dispose();
            } catch (err) {
                // Ignore.
            }
        }

        this.vfs.removeFile(path, {allowLocked: this.authorMode});

        if (wasActive) {
            if (nextPath) {
                this.openFile(nextPath);
            } else {
                this.renderFileTree();
                this.renderTabs();
                this.disposeCurrentLspBinding();
            }
        } else {
            this.renderFileTree();
            this.renderTabs();
        }

        // Notify the LSP server about the delete so it can refresh references.
        if (deletedLanguage && typeof adapter.notifyFileDeleted === 'function') {
            const deletedLspOptions = this.getLspOptionsForLanguage(deletedLanguage);
            if (deletedLspOptions && deletedLspOptions.enabled) {
                adapter.notifyFileDeleted(this.monaco, deletedUriString, {
                    language: deletedLanguage,
                    lspUrl: deletedLspOptions.lspUrl,
                    lspBaseUrl: deletedLspOptions.lspBaseUrl
                });
            }
        }

        // Trigger a full-content sync for remaining files in the same language
        // so diagnostics are recomputed after the deletion.
        if (deletedLanguage) {
            const remainingFiles = this.vfs.getAllFiles().filter(f => f.getLanguage() === deletedLanguage);
            remainingFiles.forEach(f => {
                const model = this.ensureModelForFile(f);
                if (model) {
                    this.fullSyncModel(model, f, null, {force: true, adapterOnly: true});
                }
            });
        }

        this.sync();
    };

    MonacoMultifileWrapper.prototype.closeFile = function(path) {
        const file = this.vfs.getFile(path);
        if (!file) {
            this.removeOpenTab(path);
            this.renderFileTree();
            this.renderTabs();
            this.sync();
            return;
        }

        // Save current content if this is the active file
        if (this.activeFile && this.activeFile.path === path && this.activeFile.model) {
            this.activeFile.content = this.activeFile.model.getValue();
        }

        const wasActive = this.activeFile && this.activeFile.path === path;

        const orderedPaths = this.getOrderedOpenFiles().map(f => f.path);
        const currentIndex = orderedPaths.indexOf(path);
        this.removeOpenTab(path);

        let nextPath = null;
        if (wasActive) {
            const remainingPaths = orderedPaths.filter(p => p !== path);
            if (remainingPaths.length > 0) {
                if (currentIndex >= 0 && currentIndex < remainingPaths.length) {
                    nextPath = remainingPaths[currentIndex];
                } else {
                    nextPath = remainingPaths[remainingPaths.length - 1];
                }
            }
            if (this.editor) {
                try {
                    const setModelResult = this.editor.setModel(null);
                    // setModel can trigger widget disposal which returns Promises that may reject with "Canceled"
                    if (setModelResult && typeof setModelResult.catch === 'function') {
                        setModelResult.catch(err => {
                            // Ignore "Canceled" errors from widget disposal
                            if (err && err.message !== 'Canceled' && err !== 'Canceled') {
                            }
                        });
                    }
                } catch (e) {
                    // Ignore synchronous errors
                }
            }
            this.activeFile = null;
        }

        if (nextPath) {
            this.openFile(nextPath);
        } else {
            this.renderFileTree();
            this.renderTabs();
        }
        this.sync();
    };

    MonacoMultifileWrapper.prototype.getUiState = function() {
        return {
            openTabs: this.getOrderedOpenFiles().map(f => f.path),
            activeFile: this.activeFile ? this.activeFile.path : null
        };
    };

    MonacoMultifileWrapper.prototype.resolvePath = function(basePath, relativePath) {
        // Resolve a relative path against a base file path
        // basePath: e.g., "folder/index.html"
        // relativePath: e.g., "styles.css" or "./css/main.css" or "../lib/jquery.js"

        // Get directory of base file
        const baseDir = basePath.split('/').slice(0, -1).join('/');

        // Handle absolute paths (shouldn't happen in VFS, but just in case)
        if (relativePath.startsWith('/')) {
            return relativePath.substring(1);
        }

        // Split relative path into parts
        const parts = relativePath.split('/');
        const dirParts = baseDir ? baseDir.split('/') : [];

        for (const part of parts) {
            if (part === '..') {
                // Go up one directory
                dirParts.pop();
            } else if (part === '.' || part === '') {
                // Current directory or empty, skip
                continue;
            } else {
                // Normal directory or file
                dirParts.push(part);
            }
        }

        return dirParts.join('/');
    };

    MonacoMultifileWrapper.prototype.findMainHtmlFile = function() {
        // Find the main HTML file to preview
        // Priority: index.html > main.html > first .html file
        const files = this.vfs.getAllFiles();

        // Check for index.html
        let mainFile = files.find(f => f.getName().toLowerCase() === 'index.html');
        if (mainFile) {
            return mainFile;
        }

        // Check for main.html
        mainFile = files.find(f => f.getName().toLowerCase() === 'main.html');
        if (mainFile) {
            return mainFile;
        }

        // Find first .html file
        mainFile = files.find(f => f.getExtension().toLowerCase() === 'html');
        return mainFile;
    };

    MonacoMultifileWrapper.prototype.buildPreviewHTML = function(mainFile) {
        if (!mainFile) {
            return null;
        }

        // Initialize source map for error reporting
        this.previewSourceMap = [];

        // Get current content (may be modified in editor)
        let html = modelIsAlive(mainFile.model) ? mainFile.model.getValue() : mainFile.content;

        // Inline CSS files
        html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
            try {
                const cssPath = this.resolvePath(mainFile.path, href);
                const cssFile = this.vfs.getFile(cssPath);
                if (cssFile) {
                    const cssContent = modelIsAlive(cssFile.model) ? cssFile.model.getValue() : cssFile.content;
                    return `<style>/* Inlined from ${href} */\n${cssContent}\n</style>`;
                }
            } catch (e) {
                window.console.warn('Failed to inline CSS:', href, e);
            }
            return match; // Keep original if can't inline
        });

        // Also handle href before rel (different order)
        html = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi, (match, href) => {
            try {
                const cssPath = this.resolvePath(mainFile.path, href);
                const cssFile = this.vfs.getFile(cssPath);
                if (cssFile) {
                    const cssContent = modelIsAlive(cssFile.model) ? cssFile.model.getValue() : cssFile.content;
                    return `<style>/* Inlined from ${href} */\n${cssContent}\n</style>`;
                }
            } catch (e) {
                window.console.warn('Failed to inline CSS:', href, e);
            }
            return match;
        });

        // Inline JavaScript files and build source map
        const scriptMappings = [];
        html = html.replace(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi, (match, src) => {
            try {
                const jsPath = this.resolvePath(mainFile.path, src);
                const jsFile = this.vfs.getFile(jsPath);
                if (jsFile) {
                    const jsContent = modelIsAlive(jsFile.model) ? jsFile.model.getValue() : jsFile.content;
                    scriptMappings.push({
                        file: jsPath,
                        content: jsContent,
                        originalMatch: match
                    });
                    return `<script>/* Inlined from ${src} */\n${jsContent}\n</script>`;
                }
            } catch (e) {
                window.console.warn('Failed to inline JS:', src, e);
            }
            return match;
        });

        // Build source map by analyzing the final HTML
        const lines = html.split('\n');
        let scriptStartLine = 0;
        let currentExternalScriptIndex = 0;
        let currentInlineScriptIndex = 0;
        const sourceMap = [];

        // Also track inline scripts in the main HTML file
        const mainHtmlLines = (modelIsAlive(mainFile.model) ? mainFile.model.getValue() : mainFile.content).split('\n');

        // Pre-scan original HTML to find all inline script positions
        const inlineScriptPositions = [];
        for (let j = 0; j < mainHtmlLines.length; j++) {
            if (mainHtmlLines[j].match(/<script[^>]*>/i) && !mainHtmlLines[j].match(/<script[^>]*src=/i)) {
                inlineScriptPositions.push(j + 2); // +1 for 0-index, +1 for line after <script>
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.match(/<script[^>]*>/i) && !line.match(/<script[^>]*src=/i)) {
                scriptStartLine = i + 2; // +1 for 0-index, +1 for the <script> line itself

                // Check if this is an inlined external script with our comment marker
                const nextLine = lines[i + 1];
                if (nextLine && nextLine.match(/\/\* Inlined from ([^*]+) \*\//)) {
                    // This is an inlined external script
                    if (currentExternalScriptIndex < scriptMappings.length) {
                        const mapping = scriptMappings[currentExternalScriptIndex];
                        sourceMap.push({
                            file: mapping.file,
                            startLine: scriptStartLine + 1, // +1 for the comment line
                            contentLines: mapping.content.split('\n').length
                        });
                        currentExternalScriptIndex++;
                    }
                } else {
                    // This is an inline script in the main HTML file
                    const sourceLineNumber = inlineScriptPositions[currentInlineScriptIndex] || 0;
                    currentInlineScriptIndex++;

                    // Count lines until </script>
                    let scriptContentLines = 0;
                    for (let j = i + 1; j < lines.length; j++) {
                        if (lines[j].match(/<\/script>/i)) {
                            break;
                        }
                        scriptContentLines++;
                    }

                    if (scriptContentLines > 0 && sourceLineNumber > 0) {
                        sourceMap.push({
                            file: mainFile.path,
                            startLine: scriptStartLine,
                            contentLines: scriptContentLines,
                            sourceStartLine: sourceLineNumber
                        });
                    }
                }
            }
        }

        this.previewSourceMap = sourceMap;

        // Inject console capture and error reporting with source map.
        const sourceMapJson = JSON.stringify(sourceMap);
        const mainFilePathForScript = mainFile.path;
        const runtimeScript = `(function() {
    const sourceMap = ${sourceMapJson};
    const mainFilePath = "${mainFilePathForScript}";

    function mapLineToSource(lineNo) {
        for (let i = 0; i < sourceMap.length; i++) {
            const map = sourceMap[i];
            if (!map || map.contentLines <= 0) {
                continue;
            }
            const endLine = map.startLine + map.contentLines;
            if (lineNo >= map.startLine && lineNo <= endLine) {
                const rawOffset = lineNo - map.startLine;
                const maxOffset = Math.max(map.contentLines - 1, 0);
                const offsetInScript = Math.min(Math.max(rawOffset, 0), maxOffset);
                const sourceLineNo = map.sourceStartLine ?
                    map.sourceStartLine + offsetInScript :
                    offsetInScript + 1;
                return {
                    file: map.file,
                    line: sourceLineNo
                };
            }
        }
        return null;
    }

    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
    };

    function safeStringify(arg) {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }

    function sendToParent(type, args) {
        try {
            const message = Array.from(args).map(safeStringify).join(' ');
            window.parent.postMessage({
                type: 'console',
                level: type,
                message: message,
                timestamp: new Date().toISOString()
            }, '*');
        } catch (e) {
            // Ignore errors in posting messages
        }
    }

    console.log = function(...args) {
        sendToParent('log', args);
        originalConsole.log.apply(console, args);
    };

    console.warn = function(...args) {
        sendToParent('warn', args);
        originalConsole.warn.apply(console, args);
    };

    console.error = function(...args) {
        sendToParent('error', args);
        originalConsole.error.apply(console, args);
    };

    console.info = function(...args) {
        sendToParent('info', args);
        originalConsole.info.apply(console, args);
    };

    window.addEventListener('error', function(e) {
        // --- DEBUGGING START ---
        window.parent.postMessage({
            type: 'debug',
            message: 'Error caught in iframe:',
            e_filename: e.filename,
            e_lineno: e.lineno,
            e_colno: e.colno,
            e_message: e.message,
            sourceMap_dump: JSON.stringify(sourceMap)
        }, '*');
        // --- DEBUGGING END ---

        let mappedSource = null;
        let displayFilename = e.filename;
        let displayLineno = e.lineno;

        // Check if the error is from a synthetic script or the srcdoc itself
        const isSyntheticFilename = displayFilename.startsWith('data:') ||
                                    displayFilename.startsWith('blob:') ||
                                    displayFilename.includes('_inline_script_') ||
                                    displayFilename.includes('html_inline_script_') ||
                                    displayFilename === '<anonymous>' ||
                                    displayFilename === ''; // Also handle empty filename

        if (typeof e.lineno === 'number') {
            if (isSyntheticFilename) {
                // If it's a synthetic filename, assume it's from our main HTML context
                // and try to map it.
                mappedSource = mapLineToSource(e.lineno);
                if (mappedSource) {
                    displayFilename = mappedSource.file;
                    displayLineno = mappedSource.line;
                } else {
                    // If mapping fails, at least show the main HTML file
                    displayFilename = mainFilePath;
                }
            } else {
                // If e.filename is already a real file path (e.g., from an inlined external JS file),
                // then mapLineToSource should still be able to refine the line number if needed.
                mappedSource = mapLineToSource(e.lineno);
                if (mappedSource) {
                    displayFilename = mappedSource.file;
                    displayLineno = mappedSource.line;
                }
            }
        }

        window.parent.postMessage({
            type: 'error',
            message: e.message,
            filename: displayFilename,
            lineno: displayLineno,
            colno: e.colno,
            timestamp: new Date().toISOString()
        }, '*');
    });

    window.addEventListener('unhandledrejection', function(e) {
        window.parent.postMessage({
            type: 'error',
            message: 'Unhandled Promise Rejection: ' + (e.reason || 'Unknown'),
            timestamp: new Date().toISOString()
        }, '*');
    });
})();`;

        let injectedScript = '';
        try {
            const encoded = window.btoa(unescape(encodeURIComponent(runtimeScript)));
            injectedScript = `<script src="data:text/javascript;base64,${encoded}"></script>`;
        } catch (err) {
            injectedScript = `<script>${runtimeScript}</script>`;
        }

        // Insert the script as early as possible to catch all errors
        // Try to insert right after <html> tag, or after <!DOCTYPE>, or at the very beginning
        if (html.match(/<html[^>]*>/i)) {
            html = html.replace(/(<html[^>]*>)/i, '$1' + injectedScript);
        } else if (html.match(/<!DOCTYPE[^>]*>/i)) {
            html = html.replace(/(<!DOCTYPE[^>]*>)/i, '$1' + injectedScript);
        } else {
            html = injectedScript + html;
        }

        return html;
    };

    MonacoMultifileWrapper.prototype.showPreview = function() {
        // Find main HTML file
        const mainFile = this.findMainHtmlFile();
        if (!mainFile) {
            alert('No HTML file found to preview. Please create an index.html or main.html file.');
            return;
        }

        // Build preview HTML
        const previewHTML = this.buildPreviewHTML(mainFile);
        if (!previewHTML) {
            alert('Failed to build preview.');
            return;
        }

        // Create preview modal if it doesn't exist
        if (!this.previewModal) {
            this.createPreviewModal();
        }

        // Initialize history with main file
        this.previewHistory = [mainFile.path];
        this.previewHistoryIndex = 0;
        this.updateNavigationButtons();

        // Show loading indicator
        if (this.previewLoadingOverlay) {
            this.previewLoadingOverlay.css('display', 'flex');
        }

        this.updatePreviewIframe(previewHTML);

        // Show modal using CSS instead of jQuery's show()
        this.previewModal.css('display', 'flex');
    };

    MonacoMultifileWrapper.prototype.createPreviewModal = function() {
        // Get theme colors
        const theme = this.syncPreviewModalTheme();

        // Create modal backdrop
        this.previewModal = $('<div class="monaco-preview-modal"></div>');
        this.previewModal.css({
            backgroundColor: theme.backdrop
        });

        // Create modal content
        const modalContent = $('<div class="monaco-preview-content"></div>');
        modalContent.css({
            backgroundColor: theme.modalBg,
            border: '1px solid ' + theme.modalBorder
        });

        // Create header
        const header = $('<div class="monaco-preview-header"></div>');
        header.css({
            borderBottom: '1px solid ' + theme.modalBorder,
            backgroundColor: theme.headerBg,
            color: theme.headerColor
        });

        const leftSection = $('<div class="monaco-preview-header-left"></div>');
        const title = $('<h3 class="monaco-preview-title">Preview</h3>');
        title.css({
            color: theme.headerColor
        });

        // Initialize navigation history
        if (!this.previewHistory) {
            this.previewHistory = [];
            this.previewHistoryIndex = -1;
        }

        // Add back button
        const backBtn = $('<button type="button" class="monaco-preview-btn" title="Back"></button>');
        backBtn.html('<span class="codicon codicon-arrow-left"></span>');
        this.setPreviewButtonDisabled(backBtn, true);
        backBtn.on('click', () => this.navigateBack());
        this.previewBackBtn = backBtn;

        // Add forward button
        const forwardBtn = $('<button type="button" class="monaco-preview-btn" title="Forward"></button>');
        forwardBtn.html('<span class="codicon codicon-arrow-right"></span>');
        this.setPreviewButtonDisabled(forwardBtn, true);
        forwardBtn.on('click', () => this.navigateForward());
        this.previewForwardBtn = forwardBtn;

        // Add refresh button
        const refreshBtn = $('<button type="button" class="monaco-preview-btn" title="Refresh preview"></button>');
        refreshBtn.html('<span class="codicon codicon-refresh"></span>');
        refreshBtn.on('click', () => this.refreshPreview());

        // Add console toggle button
        const consoleToggleBtn = $('<button type="button" class="monaco-preview-btn monaco-console-toggle-btn" title="Toggle console"></button>');
        consoleToggleBtn.html('<span class="codicon codicon-terminal"></span> Console');
        consoleToggleBtn.on('click', () => this.toggleConsolePanel());

        // Add clear console button
        const clearConsoleBtn = $('<button type="button" class="monaco-preview-btn" title="Clear console"></button>');
        clearConsoleBtn.html('<span class="codicon codicon-clear-all"></span>');
        clearConsoleBtn.on('click', () => this.clearConsole());

        // Add device simulation buttons
        const deviceGroup = $('<div class="monaco-device-group"></div>');
        deviceGroup.css({
            borderLeft: '1px solid ' + theme.consoleBorder
        });

        // Track active device button
        this.activeDeviceWidth = '100%';
        this.deviceButtons = [];

        const createDeviceBtn = (label, width, icon) => {
            const btn = $('<button type="button" class="monaco-device-btn" title="' + label + '"></button>');
            btn.html('<span class="codicon ' + icon + '"></span>');
            btn.attr('data-device-width', width);
            btn.on('click', () => {
                this.setPreviewWidth(width);
                this.activeDeviceWidth = width;
                this.updateDeviceButtonStates();
            });
            this.deviceButtons.push(btn);
            return btn;
        };

        deviceGroup.append(
            createDeviceBtn('Mobile (375px)', 375, 'codicon-device-mobile'),
            createDeviceBtn('Tablet (768px)', 768, 'codicon-layout-statusbar'),
            createDeviceBtn('Desktop (100%)', '100%', 'codicon-device-desktop')
        );

        // Set initial active state
        this.updateDeviceButtonStates();

        leftSection.append(title, backBtn, forwardBtn, refreshBtn, consoleToggleBtn, clearConsoleBtn, deviceGroup);

        const closeBtn = $('<button type="button" class="monaco-preview-btn" title="Close"></button>');
        closeBtn.html('<span class="codicon codicon-close"></span>');
        closeBtn.on('click', () => this.closePreview());

        header.append(leftSection, closeBtn);

        // Create main preview area (iframe + console)
        const previewArea = $('<div class="monaco-preview-area"></div>');

        // Create iframe container
        const iframeContainer = $('<div class="monaco-preview-iframe-container"></div>');

        // Create loading overlay
        this.previewLoadingOverlay = $('<div class="monaco-preview-loading"></div>');

        const spinner = $('<div class="monaco-preview-spinner"></div>');
        spinner.css({
            borderColor: theme.consoleBorder,
            borderTopColor: theme.buttonColor
        });

        this.previewLoadingOverlay.append(spinner);

        // Create sandboxed iframe
        this.previewIframe = this.buildPreviewIframeElement();
        iframeContainer.append(this.previewIframe, this.previewLoadingOverlay);

        // Create resize handle for console
        const resizeHandle = $('<div class="monaco-console-resize-handle"></div>');
        resizeHandle.css({
            backgroundColor: theme.consoleBorder
        });
        resizeHandle.on('mouseenter', function() {
            $(this).css('backgroundColor', theme.buttonColor);
        });
        resizeHandle.on('mouseleave', function() {
            $(this).css('backgroundColor', theme.consoleBorder);
        });

        // Create console panel
        this.consolePanel = $('<div class="monaco-console-panel"></div>');
        this.consolePanel.css({
            borderTop: '1px solid ' + theme.consoleBorder,
            backgroundColor: theme.consoleBg,
            color: theme.consoleColor
        });

        // Console header with filters
        const consoleHeader = $('<div class="monaco-console-header"></div>');
        consoleHeader.css({
            borderBottom: '1px solid ' + theme.consoleBorder
        });

        const filterLabel = $('<span class="monaco-console-filter-label">Filter:</span>');
        filterLabel.css({
            color: theme.headerColor
        });

        // Initialize console filters
        this.consoleFilters = {all: true, log: true, warn: true, error: true, info: true};
        this.consoleLineNumber = 0;

        const createFilterButton = (label, filterKey) => {
            const btn = $('<button type="button" class="monaco-console-filter-btn"></button>');
            btn.text(label);
            btn.attr('data-filter-key', filterKey);
            btn.css({
                border: '1px solid ' + theme.consoleBorder
            });

            btn.on('click', () => {
                const activeTheme = this.syncPreviewModalTheme() || theme;
                if (filterKey === 'all') {
                    this.consoleFilters.all = true;
                    this.consoleFilters.log = true;
                    this.consoleFilters.warn = true;
                    this.consoleFilters.error = true;
                    this.consoleFilters.info = true;
                } else {
                    this.consoleFilters.all = false;
                    this.consoleFilters[filterKey] = !this.consoleFilters[filterKey];
                }
                this.updateConsoleFilterButtons(activeTheme);
                this.filterConsoleOutput();
            });

            return btn;
        };

        // Add search input
        const searchContainer = $('<div class="monaco-console-search-container"></div>');
        const searchIcon = $('<span class="codicon codicon-search monaco-console-search-icon"></span>');
        searchIcon.css({
            color: theme.headerColor
        });

        this.consoleSearchInput = $('<input type="text" class="monaco-console-search-input" placeholder="Search console..." />');
        this.consoleSearchInput.css({
            backgroundColor: theme.consoleBg,
            color: theme.consoleColor,
            border: '1px solid ' + theme.consoleBorder
        });
        this.consoleSearchInput.on('focus', () => {
            const activeTheme = this.syncPreviewModalTheme() || theme;
            this.consoleSearchInput.css('borderColor', activeTheme.buttonColor);
        });
        this.consoleSearchInput.on('blur', () => {
            const activeTheme = this.syncPreviewModalTheme() || theme;
            this.consoleSearchInput.css('borderColor', activeTheme.consoleBorder);
        });
        this.consoleSearchInput.on('input', () => this.searchConsoleOutput());

        searchContainer.append(searchIcon, this.consoleSearchInput);

        consoleHeader.append(
            filterLabel,
            createFilterButton('All', 'all'),
            createFilterButton('Log', 'log'),
            createFilterButton('Warn', 'warn'),
            createFilterButton('Error', 'error'),
            createFilterButton('Info', 'info'),
            searchContainer
        );
        this.updateConsoleFilterButtons(theme);
        this.updateConsoleSearchTheme(theme);

        // Console output container
        this.consoleOutputContainer = $('<div class="monaco-console-output-container"></div>');

        this.consoleOutput = $('<div class="monaco-console-output"></div>');
        this.consoleOutputContainer.append(this.consoleOutput);

        this.consolePanel.append(consoleHeader, this.consoleOutputContainer);

        // Add resize functionality
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        resizeHandle.on('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = this.consolePanel.height();
            e.preventDefault();
            $('body').css('user-select', 'none');
        });

        $(document).on('mousemove', (e) => {
            if (!isResizing) {
                return;
            }
            const deltaY = startY - e.clientY;
            const newHeight = startHeight + deltaY;
            const minHeight = 100;
            const maxHeight = previewArea.height() * 0.8;

            if (newHeight >= minHeight && newHeight <= maxHeight) {
                this.consolePanel.css('height', newHeight + 'px');
            }
        });

        $(document).on('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                $('body').css('user-select', '');
            }
        });

        this.consoleResizeHandle = resizeHandle;
        previewArea.append(iframeContainer, resizeHandle, this.consolePanel);

        modalContent.append(header, previewArea);
        this.previewModal.append(modalContent);
        $('body').append(this.previewModal);

        // Close on backdrop click
        this.previewModal.on('click', (e) => {
            if (e.target === this.previewModal[0]) {
                this.closePreview();
            }
        });

        // Listen for messages from iframe
        this.messageListener = (event) => {
            if (event.data && (event.data.type === 'console' || event.data.type === 'error')) {
                this.handleConsoleMessage(event.data);
            }
        };
        window.addEventListener('message', this.messageListener);
    };

    MonacoMultifileWrapper.prototype.closePreview = function() {
        if (this.previewModal) {
            this.previewModal.css('display', 'none');
        }
    };

    MonacoMultifileWrapper.prototype.setPreviewWidth = function(width) {
        if (!this.previewIframe) {
            return;
        }

        if (width === '100%') {
            this.previewIframe.css({
                width: '100%',
                maxWidth: 'none',
                margin: '0'
            });
        } else {
            this.previewIframe.css({
                width: width + 'px',
                maxWidth: width + 'px',
                margin: '0 auto',
                display: 'block'
            });
        }
    };

    MonacoMultifileWrapper.prototype.refreshPreview = function() {
        // Find main HTML file
        const mainFile = this.findMainHtmlFile();
        if (!mainFile) {
            return;
        }

        // Reset history to main file
        this.previewHistory = [mainFile.path];
        this.previewHistoryIndex = 0;
        this.updateNavigationButtons();

        // Show loading indicator
        if (this.previewLoadingOverlay) {
            this.previewLoadingOverlay.css('display', 'flex');
        }

        // Clear console
        this.clearConsole();

        // Build and update preview
        const previewHTML = this.buildPreviewHTML(mainFile);
        if (previewHTML) {
            this.updatePreviewIframe(previewHTML);
        }
    };

    MonacoMultifileWrapper.prototype.toggleConsolePanel = function() {
        if (!this.consolePanel) {
            return;
        }

        const isVisible = this.consolePanel.css('display') !== 'none';
        this.consolePanel.css('display', isVisible ? 'none' : 'flex');
        if (this.consoleResizeHandle) {
            this.consoleResizeHandle.css('display', isVisible ? 'none' : 'block');
        }
    };

    MonacoMultifileWrapper.prototype.clearConsole = function() {
        if (this.consoleOutput) {
            this.consoleOutput.empty();
            this.consoleLineNumber = 0;
        }
    };

    MonacoMultifileWrapper.prototype.filterConsoleOutput = function() {
        if (!this.consoleOutput || !this.consoleFilters) {
            return;
        }

        const searchTerm = this.consoleSearchInput ? this.consoleSearchInput.val().toLowerCase() : '';

        const entries = this.consoleOutput.find('.console-entry');
        entries.each((_, entry) => {
            const $entry = $(entry);
            const logLevel = $entry.attr('data-log-level');
            const text = $entry.text().toLowerCase();

            const matchesFilter = this.consoleFilters.all || this.consoleFilters[logLevel];
            const matchesSearch = !searchTerm || text.includes(searchTerm);

            if (matchesFilter && matchesSearch) {
                $entry.show();
            } else {
                $entry.hide();
            }
        });
    };

    MonacoMultifileWrapper.prototype.searchConsoleOutput = function() {
        this.filterConsoleOutput();
    };

    MonacoMultifileWrapper.prototype.handleConsoleMessage = function(data) {
        if (!this.consoleOutput) {
            return;
        }

        // Auto-show console panel when there's output
        if (this.consolePanel && this.consolePanel.css('display') === 'none') {
            this.consolePanel.css('display', 'flex');
            if (this.consoleResizeHandle) {
                this.consoleResizeHandle.css('display', 'block');
            }
        }

        // Increment line number
        this.consoleLineNumber = (this.consoleLineNumber || 0) + 1;

        const entry = $('<div class="console-entry"></div>');
        entry.css({
            padding: '6px 8px',
            borderBottom: '1px solid rgba(128, 128, 128, 0.2)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            lineHeight: '1.4'
        });

        // Add line number
        const lineNum = $('<span class="console-line-num"></span>');
        lineNum.text(this.consoleLineNumber);
        lineNum.css({
            color: '#858585',
            fontSize: '11px',
            fontFamily: 'monospace',
            minWidth: '24px',
            textAlign: 'right',
            flexShrink: 0,
            userSelect: 'none'
        });

        // Add icon based on type
        const icon = $('<span class="codicon"></span>');
        icon.css({flexShrink: 0, fontSize: '14px', marginTop: '2px'});

        // Format timestamp
        const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '';
        const timeSpan = $('<span class="console-time"></span>');
        timeSpan.text(`[${timestamp}]`);
        const theme = this.syncPreviewModalTheme();
        const baseTextColor = theme ? theme.consoleColor : '#1f2329';
        const mutedColor = theme ? theme.consoleMuted || theme.buttonColor : '#808080';
        timeSpan.css({color: mutedColor, fontSize: '11px', flexShrink: 0});

        // Format message based on type
        const messageSpan = $('<span class="console-message"></span>');
        messageSpan.css({
            flex: 1,
            color: baseTextColor
        });

        let logLevel = 'log';

        if (data.type === 'console') {
            switch (data.level) {
                case 'error':
                    logLevel = 'error';
                    icon.addClass('codicon-error');
                    icon.css({color: theme ? theme.buttonColor : '#f48771'});
                    entry.css({backgroundColor: theme ? theme.consoleBg : 'rgba(244, 135, 113, 0.1)'});
                    messageSpan.css({color: theme ? theme.buttonColor : '#f48771', fontWeight: '500'});
                    messageSpan.text(data.message);
                    break;
                case 'warn':
                    logLevel = 'warn';
                    icon.addClass('codicon-warning');
                    icon.css({color: theme ? theme.buttonColor : '#cca700'});
                    entry.css({backgroundColor: theme ? theme.consoleBg : 'rgba(204, 167, 0, 0.1)'});
                    messageSpan.css({color: theme ? theme.buttonColor : '#cca700'});
                    messageSpan.text(data.message);
                    break;
                case 'info':
                    logLevel = 'info';
                    icon.addClass('codicon-info');
                    icon.css({color: theme ? theme.buttonColor : '#75beff'});
                    messageSpan.css({color: theme ? theme.buttonColor : '#75beff'});
                    messageSpan.text(data.message);
                    break;
                default:
                    logLevel = 'log';
                    icon.addClass('codicon-chevron-right');
                    icon.css({color: mutedColor});
                    messageSpan.css({color: baseTextColor});
                    messageSpan.text(data.message);
            }
        } else if (data.type === 'error') {
            logLevel = 'error';
            icon.addClass('codicon-x-circle-filled');
            icon.css({color: theme ? theme.buttonColor : '#f48771', fontSize: '16px'});
            entry.css({
                backgroundColor: theme ? theme.consoleBg : 'rgba(244, 135, 113, 0.15)',
                borderLeft: '3px solid ' + (theme ? theme.buttonColor : '#f48771'),
                paddingLeft: '5px'
            });
            messageSpan.css({color: theme ? theme.buttonColor : '#f48771', fontWeight: '600'});

            let errorMessage = 'Runtime Error: ' + data.message;
            if (data.filename) {
                errorMessage += ` at ${data.filename}:${data.lineno}:${data.colno}`;
            }
            messageSpan.text(errorMessage);
        }

        // Add data attribute for filtering
        entry.attr('data-log-level', logLevel);

        // Assemble entry with line number
        if (icon.attr('class').split(' ').length > 1) {
            entry.append(lineNum, icon, timeSpan, messageSpan);
        } else {
            entry.append(lineNum, timeSpan, messageSpan);
        }

        this.consoleOutput.append(entry);

        // Apply current filters to new entry
        if (this.consoleFilters && !this.consoleFilters.all && !this.consoleFilters[logLevel]) {
            entry.hide();
        }

        // Apply current search filter to new entry
        if (this.consoleSearchInput) {
            const searchTerm = this.consoleSearchInput.val().toLowerCase();
            if (searchTerm && !entry.text().toLowerCase().includes(searchTerm)) {
                entry.hide();
            }
        }

        // Auto-scroll to bottom
        if (this.consoleOutputContainer && this.consoleOutputContainer[0]) {
            this.consoleOutputContainer[0].scrollTop = this.consoleOutputContainer[0].scrollHeight;
        }
    };

    MonacoMultifileWrapper.prototype.updatePreviewIframe = function(html) {
        if (!this.previewIframe || !this.previewIframe.length) {
            return;
        }
        const container = this.previewIframe.parent();
        const newIframe = this.buildPreviewIframeElement();

        // Hide loading indicator and setup link interception when iframe loads
        newIframe.on('load', () => {
            if (this.previewLoadingOverlay) {
                this.previewLoadingOverlay.css('display', 'none');
            }
            this.setupPreviewLinkInterception(newIframe[0]);
        });

        newIframe[0].setAttribute('srcdoc', html);
        this.previewIframe.remove();
        this.previewIframe = newIframe;
        if (container && container.length) {
            container.append(this.previewIframe);
        }
    };

    MonacoMultifileWrapper.prototype.buildPreviewIframeElement = function() {
        const iframe = $('<iframe sandbox="allow-scripts allow-same-origin"></iframe>');
        iframe.css({
            width: '100%',
            height: '100%',
            border: '1px solid #ddd',
            borderRadius: '4px',
            backgroundColor: 'white'
        });
        return iframe;
    };

    MonacoMultifileWrapper.prototype.setupPreviewLinkInterception = function(iframeElement) {
        try {
            const iframeDoc = iframeElement.contentDocument || iframeElement.contentWindow.document;
            if (!iframeDoc) {
                return;
            }

            // Add click handler to intercept link clicks
            iframeDoc.addEventListener('click', (e) => {
                const link = e.target.closest('a');
                if (!link || !link.href) {
                    return;
                }

                const href = link.getAttribute('href');
                if (!href) {
                    return;
                }

                // Check if it's a relative link (not external URL, not hash-only)
                const isExternal = href.match(/^(https?:)?\/\//i);
                const isHashOnly = href.startsWith('#');
                const isMailto = href.startsWith('mailto:');
                const isTel = href.startsWith('tel:');
                const isAbsolute = href.startsWith('/');

                if (isExternal || isHashOnly || isMailto || isTel || isAbsolute) {
                    // Let external links, hash links, mailto, tel, and absolute paths work normally
                    return;
                }

                // It's a relative link - try to load it from VFS
                e.preventDefault();
                const file = this.vfs.getFile(href);
                if (file && file.getName().match(/\.html?$/i)) {
                    this.loadPreviewFile(href);
                }
            }, true);
        } catch (err) {
            // Ignore errors accessing iframe document (CORS, etc.)
        }
    };

    MonacoMultifileWrapper.prototype.loadPreviewFile = function(filepath, skipHistory) {
        const file = this.vfs.getFile(filepath);
        if (!file) {
            return;
        }

        // Add to history unless we're navigating back/forward
        if (!skipHistory) {
            // Remove any forward history when navigating to a new page
            this.previewHistory = this.previewHistory.slice(0, this.previewHistoryIndex + 1);
            this.previewHistory.push(filepath);
            this.previewHistoryIndex = this.previewHistory.length - 1;
            this.updateNavigationButtons();
        }

        const html = file.content || '';
        this.updatePreviewIframe(html);
    };

    MonacoMultifileWrapper.prototype.navigateBack = function() {
        if (this.previewHistoryIndex > 0) {
            this.previewHistoryIndex--;
            const filepath = this.previewHistory[this.previewHistoryIndex];
            this.loadPreviewFile(filepath, true);
            this.updateNavigationButtons();
        }
    };

    MonacoMultifileWrapper.prototype.navigateForward = function() {
        if (this.previewHistoryIndex < this.previewHistory.length - 1) {
            this.previewHistoryIndex++;
            const filepath = this.previewHistory[this.previewHistoryIndex];
            this.loadPreviewFile(filepath, true);
            this.updateNavigationButtons();
        }
    };

    MonacoMultifileWrapper.prototype.updateNavigationButtons = function() {
        if (this.previewBackBtn) {
            const disableBack = this.previewHistoryIndex <= 0;
            this.setPreviewButtonDisabled(this.previewBackBtn, disableBack);
        }

        if (this.previewForwardBtn) {
            const disableForward = this.previewHistoryIndex >= this.previewHistory.length - 1;
            this.setPreviewButtonDisabled(this.previewForwardBtn, disableForward);
        }
    };

    MonacoMultifileWrapper.prototype.getUiState = function() {
        return {
            openTabs: Array.from(this.openTabs),
            activeFile: this.activeFile ? this.activeFile.path : null
        };
    };

    MonacoMultifileWrapper.prototype.restoreUiState = function(uiState) {
        if (!uiState) {
            return;
        }

        // Restore open tabs
        if (uiState.openTabs && Array.isArray(uiState.openTabs)) {
            // Only restore tabs for files that exist
            this.openTabs = uiState.openTabs.filter(path => this.vfs.getFile(path));
        }

        // Active file will be restored when we open the first file
        return uiState.activeFile;
    };

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    MonacoMultifileWrapper.prototype.sync = function(isSubmit = false) {
        // Save current file content
        if (this.activeFile && modelIsAlive(this.activeFile.model)) {
            try {
                this.activeFile.content = this.activeFile.model.getValue();
            } catch (e) {
                // Model already disposed, skip
            }
        }

        // Serialize all files to JSON
        const data = this.vfs.toJSON();
        data.uiState = this.getUiState();
        data.timestamp = new Date().getTime(); // Add timestamp
        this.textarea.value = JSON.stringify(data, null, 2);
        if (isSubmit) {
            this.textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    MonacoMultifileWrapper.prototype.getLocalStorageKey = function() {
        // Attempt to extract a more specific identifier from textareaId.
        // Expected format: id_q<questionid>_<field_name> or id_q<questionid>:<attemptid>_<field_name>
        const textareaId = this.textarea.id;
        let identifier = 'unknown';

        const match = textareaId.match(/id_q(\d+)(?::(\d+))?_/);
        if (match) {
            const questionId = match[1];
            const attemptId = match[2]; // This will be undefined if not present

            if (questionId && attemptId) {
                identifier = `${questionId}:${attemptId}`;
            } else if (questionId) {
                identifier = questionId;
            }
        }

        return `coderunner_autosave_multifile_${identifier}`;
    };

    MonacoMultifileWrapper.prototype.syncToLocalStorage = function() {
        if (this.activeFile && modelIsAlive(this.activeFile.model)) {
            this.activeFile.content = this.activeFile.model.getValue();
        }
        const data = this.vfs.toJSON();
        data.uiState = this.getUiState();
        data.timestamp = new Date().getTime();
        try {
            window.localStorage.setItem(this.getLocalStorageKey(), JSON.stringify(data));
        } catch (e) {
            logWarn('Failed to save to localStorage', e);
        }
    };


    MonacoMultifileWrapper.prototype.getElement = function() {
        // Return the raw DOM element
        return this.container;
    };

    MonacoMultifileWrapper.prototype.failed = function() {
        return this.fail;
    };

    MonacoMultifileWrapper.prototype.failMessage = function() {
        return 'err_ui_load_failed';
    };

    MonacoMultifileWrapper.prototype.destroy = function() {
        this.sync();
        this.disposeCurrentLspBinding();

        if (this.documentEventNamespace && this.boundKeydownHandler) {
            $(document).off('keydown' + this.documentEventNamespace, this.boundKeydownHandler);
        }

        if (this.themeListener && typeof this.themeListener.dispose === 'function') {
            this.themeListener.dispose();
        }
        this.themeListener = null;

        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }

        if (this.vfs) {
            this.vfs.getAllFiles().forEach(file => {
                if (file && file.editorBinding && typeof file.editorBinding.dispose === 'function') {
                    try {
                        file.editorBinding.dispose();
                    } catch (err) {
                        logWarn('Failed to dispose LSP binding during destroy for ' + file.path, err);
                    }
                }
                if (file && modelIsAlive(file.model)) {
                    try {
                        file.model.dispose();
                    } catch (err) {
                        // Ignore.
                    }
                }
                file.editorBinding = null;
                file.model = null;
            });
        }

        // Dispose editor
        if (this.editor) {
            try {
                this.editor.dispose();
            } catch (e) {
                // Editor already disposed
            }
        }

        // Remove message listener for preview
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener);
            this.messageListener = null;
        }

        // Remove preview modal
        if (this.previewModal) {
            this.previewModal.remove();
            this.previewModal = null;
        }

        // Remove UI
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    };

    MonacoMultifileWrapper.prototype.resize = function(width, height) {
        if (this.container) {
            this.container.style.width = width + 'px';
            this.container.style.height = height + 'px';
        }
        if (this.editor) {
            this.editor.layout();
        }
    };

    MonacoMultifileWrapper.prototype.hasFocus = function() {
        return this.editor && this.editor.hasTextFocus();
    };

    MonacoMultifileWrapper.prototype.syncIntervalSecs = function() {
        return this.params.sync_interval_secs !== undefined ? this.params.sync_interval_secs : 5;
    };

    MonacoMultifileWrapper.prototype.allowFullScreen = function() {
        return true;
    };

    return {
        Constructor: MonacoMultifileWrapper
    };
});
