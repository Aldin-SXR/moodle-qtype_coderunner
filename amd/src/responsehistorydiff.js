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
 * Provides a Monaco diff modal for CodeRunner response history entries.
 *
 * @module qtype_coderunner/responsehistorydiff
 */

define(['core/modal', 'core/modal_events'], function(Modal, ModalEvents) {
    'use strict';

    let monacoLoaderPromise = null;
    let modalPromise = null;
    let diffEditor = null;
    let originalModel = null;
    let modifiedModel = null;

    const SELECTOR = '.coderunner-diff-popup';

    /**
     * Load the Monaco editor via RequireJS, once.
     *
     * @returns {Promise} Resolves with the monaco namespace.
     */
    function ensureMonacoLoaded() {
        if (monacoLoaderPromise) {
            return monacoLoaderPromise;
        }
        monacoLoaderPromise = new Promise(function(resolve, reject) {
            try {
                if (typeof require === 'undefined') {
                    reject(new Error('RequireJS not available'));
                    return;
                }
                const basePath = (window.M && M.cfg && M.cfg.wwwroot ? M.cfg.wwwroot : '') +
                    '/question/type/coderunner/monaco/vs';
                const context = require.s && require.s.contexts && require.s.contexts._;
                const paths = context && context.config && context.config.paths ? context.config.paths : {};
                if (!paths.vs) {
                    require.config({ paths: { vs: basePath } });
                }
                window.MonacoEnvironment = window.MonacoEnvironment || {};
                if (!window.MonacoEnvironment.baseUrl) {
                    window.MonacoEnvironment.baseUrl = basePath;
                }
                require(['vs/editor/editor.main'], resolve, reject);
            } catch (err) {
                reject(err);
            }
        });
        return monacoLoaderPromise;
    }

    /**
     * Decode a base64 (UTF-8) data attribute, falling back to plain base64.
     *
     * @param {string} value The base64-encoded value.
     * @returns {string} The decoded text, or '' if it cannot be decoded.
     */
    function decode(value) {
        if (!value) {
            return '';
        }
        try {
            return decodeURIComponent(escape(window.atob(value)));
        } catch (err) {
            try {
                return window.atob(value);
            } catch (e) {
                return '';
            }
        }
    }

    /**
     * Dispose of the current diff editor and its models, if any.
     */
    function disposeDiff() {
        if (diffEditor) {
            try { diffEditor.dispose(); } catch (e) {}
            diffEditor = null;
        }
        if (originalModel) {
            try { originalModel.dispose(); } catch (e) {}
            originalModel = null;
        }
        if (modifiedModel) {
            try { modifiedModel.dispose(); } catch (e) {}
            modifiedModel = null;
        }
    }

    /**
     * Get (creating on first use) the shared diff modal, with the given title.
     *
     * @param {string} title The modal title.
     * @returns {Promise} Resolves with the modal.
     */
    function getModal(title) {
        if (!modalPromise) {
            modalPromise = Modal.create({
                title: title,
                body: '<div class="coderunner-diff-info"></div><div class="coderunner-diff-host"></div>'
            }).then(function(modal) {
                if (typeof modal.setLarge === 'function') {
                    modal.setLarge(true);
                }
                modal.getRoot().addClass('coderunner-diff-modal');
                modal.getRoot().on(ModalEvents.hidden, disposeDiff);
                return modal;
            });
        }
        return modalPromise.then(function(modal) {
            modal.setTitle(title);
            const body = modal.getBody();
            if (!body.find('.coderunner-diff-info').length || !body.find('.coderunner-diff-host').length) {
                body.empty();
                body.append('<div class="coderunner-diff-info"></div><div class="coderunner-diff-host"></div>');
            }
            return modal;
        });
    }

    /**
     * Show a side-by-side Monaco diff of two responses in the modal.
     *
     * @param {string} previous The previous response text.
     * @param {string} current The current response text.
     * @param {string} title The modal title.
     * @param {string} language The Monaco language id.
     * @param {string} previousLabel Label for the previous response.
     * @param {string} currentLabel Label for the current response.
     * @param {HTMLElement} returnElement Element to refocus when the modal closes.
     */
    function renderDiff(previous, current, title, language, previousLabel, currentLabel, returnElement) {
        ensureMonacoLoaded().then(function(monaco) {
            getModal(title).then(function(modal) {
                if (returnElement) {
                    modal.setReturnElement(returnElement);
                }
                const container = modal.getBody().find('.coderunner-diff-host').get(0);
                if (!container) {
                    return;
                }
                const info = modal.getBody().find('.coderunner-diff-info');
                if (info.length) {
                    info.empty();
                    const wrapper = document.createElement('div');
                    wrapper.className = 'coderunner-diff-labels';
                    const prev = document.createElement('div');
                    const curr = document.createElement('div');
                    prev.className = 'coderunner-diff-label-left';
                    curr.className = 'coderunner-diff-label-right';
                    prev.textContent = previousLabel ? ('Previous: ' + previousLabel) : '';
                    curr.textContent = currentLabel ? ('Current: ' + currentLabel) : '';
                    wrapper.append(prev, curr);
                    info.append(wrapper);
                }
                disposeDiff();
                diffEditor = monaco.editor.createDiffEditor(container, {
                    readOnly: true,
                    renderSideBySide: true,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on'
                });
                const languageId = language || 'plaintext';
                originalModel = monaco.editor.createModel(previous || '', languageId);
                modifiedModel = monaco.editor.createModel(current || '', languageId);
                diffEditor.setModel({
                    original: originalModel,
                    modified: modifiedModel
                });
                modal.show();
            });
        }).catch(function(err) {
            if (window.console && window.console.error) {
                window.console.error(err);
            }
        });
    }

    /**
     * Delegated click handler for diff popup links.
     *
     * @param {Event} event The click event.
     */
    function handleClick(event) {
        const link = event.target.closest(SELECTOR);
        if (!link) {
            return;
        }
        event.preventDefault();
        const previous = decode(link.dataset.previous);
        const current = decode(link.dataset.current);
        const title = link.dataset.title || '';
        const language = (link.dataset.language || 'plaintext').toLowerCase();
        const previousLabel = link.dataset.prevlabel || '';
        const currentLabel = link.dataset.currentlabel || '';
        renderDiff(previous, current, title, language, previousLabel, currentLabel, link);
    }

    /**
     * Register the document-level click handler.
     */
    function init() {
        document.addEventListener('click', handleClick);
    }

    return {
        init: init
    };
});
