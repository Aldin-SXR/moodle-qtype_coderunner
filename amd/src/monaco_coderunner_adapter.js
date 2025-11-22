(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], function () { return factory(root); });
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : root));
  } else {
    root.lmsMonaco = factory(root);
  }
}(this, function (root) {
  'use strict';

  // Suppress Monaco's DisposableStore errors that occur during file navigation
  // These are benign race conditions when hovers/widgets are disposed during model changes
  if (typeof window !== 'undefined' && window.console && window.console.error) {
    var originalConsoleError = window.console.error;
    window.console.error = function() {
      var args = Array.prototype.slice.call(arguments);
      var message = args.join(' ');
      // Suppress known Monaco disposal errors that don't affect functionality
      if (message && typeof message === 'string' &&
          message.indexOf('DisposableStore that has already been disposed') !== -1) {
        return; // Silently ignore
      }
      originalConsoleError.apply(window.console, args);
    };
  }

  // Provide a no-op in case bundling/ordering issues prevent later assignment.
  // This avoids ReferenceError in downstream modules if syncModelContent is missing.
  var syncModelContent = function() {};

  function ensure(object, name) {
    if (!object) { throw new Error(name + ' is required'); }
    return object;
  }

  function countTerminatedLines(text) {
    if (!text) return 0;
    var m = String(text).match(/\n/g);
    return m ? m.length : 0;
  }

  // Global LSP connection pool - shared across all editor instances
  // Allows multiple models to reuse the same WebSocket connection per language
  var globalLspPool = {
    connections: {}, // Key: "language::url", Value: connection object

    makeKey: function(language, lspUrl) {
      return String(language || 'plaintext') + '::' + String(lspUrl || '');
    },

    get: function(language, lspUrl) {
      return this.connections[this.makeKey(language, lspUrl)] || null;
    },

    set: function(language, lspUrl, connection) {
      this.connections[this.makeKey(language, lspUrl)] = connection;
    },

    remove: function(language, lspUrl) {
      delete this.connections[this.makeKey(language, lspUrl)];
    },

    has: function(language, lspUrl) {
      return !!this.get(language, lspUrl);
    },

    getAllConnections: function() {
      var result = [];
      for (var key in this.connections) {
        if (Object.prototype.hasOwnProperty.call(this.connections, key)) {
          result.push(this.connections[key]);
        }
      }
      return result;
    }
  };

  // Track which providers have been registered per language to avoid duplicates
  var globalRegisteredProviders = {};
  var workspaceEditHooks = [];
  var workspaceEditWillAffectHooks = [];
  var CONNECTION_RELEASE_DELAY_MS = 2000;

  function registerWorkspaceEditHook(fn) {
    if (typeof fn !== 'function') {
      return { dispose: function() {} };
    }
    workspaceEditHooks.push(fn);
    return {
      dispose: function() {
        workspaceEditHooks = workspaceEditHooks.filter(function(entry) { return entry !== fn; });
      }
    };
  }

  function registerWorkspaceEditWillAffectHook(fn) {
    if (typeof fn !== 'function') {
      return { dispose: function() {} };
    }
    workspaceEditWillAffectHooks.push(fn);
    return {
      dispose: function() {
        workspaceEditWillAffectHooks = workspaceEditWillAffectHooks.filter(function(entry) { return entry !== fn; });
      }
    };
  }

  function notifyWorkspaceEditApplied(meta) {
    if (!workspaceEditHooks.length) return;
    workspaceEditHooks.forEach(function (fn) {
      try { fn(meta); } catch (e) {}
    });
  }

  function notifyWorkspaceEditWillAffect(meta) {
    if (!workspaceEditWillAffectHooks.length) return;
    workspaceEditWillAffectHooks.forEach(function (fn) {
      try { fn(meta); } catch (e) {}
    });
  }

  function registerDidChangeHook() {
    return { dispose: function() {} };
  }

  function notifyDidChangeSent() {}

  // Prefix-aware wrappers around VSCode JSON-RPC reader/writer.
  function createPrefixingReader(baseReader, prefixLineCount) {
    return {
      listen: function (callback) {
        return baseReader.listen(function (message) {
          try {
            // Diagnostics
            if (message && message.method === 'textDocument/publishDiagnostics' && message.params && message.params.diagnostics) {
              message.params.diagnostics = message.params.diagnostics.filter(function (d) {
                return d && d.range && d.range.start && d.range.start.line >= prefixLineCount;
              });
              for (var i = 0; i < message.params.diagnostics.length; i++) {
                var diag = message.params.diagnostics[i];
                if (diag.range) {
                  diag.range.start.line = Math.max(0, diag.range.start.line - prefixLineCount);
                  diag.range.end.line = Math.max(0, diag.range.end.line - prefixLineCount);
                }
              }
            }

            // Responses with array result (folding ranges, inlay hints, symbols, etc.)
            if (message && message.id && Array.isArray(message.result)) {
              var arr = message.result;
              // folding ranges
              if (arr.length && typeof arr[0].startLine !== 'undefined') {
                arr = arr.filter(function (r) { return r.startLine >= prefixLineCount && r.endLine >= prefixLineCount; });
                for (var fi = 0; fi < arr.length; fi++) {
                  arr[fi].startLine = Math.max(0, arr[fi].startLine - prefixLineCount);
                  arr[fi].endLine = Math.max(0, arr[fi].endLine - prefixLineCount);
                }
                message.result = arr;
              }
              // inlay hints
              if (arr.length && arr[0] && arr[0].position && typeof arr[0].position.line !== 'undefined') {
                arr = arr.filter(function (h) { return h.position.line >= prefixLineCount; });
                for (var hi = 0; hi < arr.length; hi++) {
                  arr[hi].position.line = Math.max(0, arr[hi].position.line - prefixLineCount);
                }
                message.result = arr;
              }
              // document symbols style
              if (arr.length && arr[0] && arr[0].range && typeof arr[0].range.start.line !== 'undefined') {
                arr = arr.filter(function (s) { return s.range.start.line >= prefixLineCount; });
                for (var si = 0; si < arr.length; si++) {
                  var sym = arr[si];
                  if (sym.range) {
                    sym.range.start.line = Math.max(0, sym.range.start.line - prefixLineCount);
                    sym.range.end.line = Math.max(0, sym.range.end.line - prefixLineCount);
                  }
                  if (sym.selectionRange) {
                    sym.selectionRange.start.line = Math.max(0, sym.selectionRange.start.line - prefixLineCount);
                    sym.selectionRange.end.line = Math.max(0, sym.selectionRange.end.line - prefixLineCount);
                  }
                }
                message.result = arr;
              }
            }

            // Hover response
            if (message && message.id && message.result && message.result.range && typeof message.result.range.start.line !== 'undefined') {
              message.result.range.start.line = Math.max(0, message.result.range.start.line - prefixLineCount);
              message.result.range.end.line = Math.max(0, message.result.range.end.line - prefixLineCount);
              if (message.result.data && message.result.data[1] && typeof message.result.data[1].line !== 'undefined') {
                message.result.data[1].line = Math.max(0, message.result.data[1].line - prefixLineCount);
              }
            }

            // Completion arrays and edits
            if (message && message.id && message.result && (message.result.items || Array.isArray(message.result))) {
              var items = message.result.items || message.result;
              items = items.filter(function (item) {
                var line = prefixLineCount;
                if (item && item.textEdit && item.textEdit.range && item.textEdit.range.start) line = item.textEdit.range.start.line;
                else if (item && item.range && item.range.start) line = item.range.start.line;
                return line >= prefixLineCount;
              });
              for (var ci = 0; ci < items.length; ci++) {
                var it = items[ci];
                if (it.range) {
                  it.range.start.line = Math.max(0, it.range.start.line - prefixLineCount);
                  it.range.end.line = Math.max(0, it.range.end.line - prefixLineCount);
                }
                if (it.location && it.location.range) {
                  it.location.range.start.line = Math.max(0, it.location.range.start.line - prefixLineCount);
                  it.location.range.end.line = Math.max(0, it.location.range.end.line - prefixLineCount);
                }
                if (it.selectionRange) {
                  it.selectionRange.start.line = Math.max(0, it.selectionRange.start.line - prefixLineCount);
                  it.selectionRange.end.line = Math.max(0, it.selectionRange.end.line - prefixLineCount);
                }
                if (it.textEdit && it.textEdit.range) {
                  it.textEdit.range.start.line = Math.max(0, it.textEdit.range.start.line - prefixLineCount);
                  it.textEdit.range.end.line = Math.max(0, it.textEdit.range.end.line - prefixLineCount);
                }
                if (it.additionalTextEdits) {
                  for (var ae = 0; ae < it.additionalTextEdits.length; ae++) {
                    var edit = it.additionalTextEdits[ae];
                    if (edit.range) {
                      edit.range.start.line = Math.max(0, edit.range.start.line - prefixLineCount);
                      edit.range.end.line = Math.max(0, edit.range.end.line - prefixLineCount);
                    }
                  }
                }
              }
              if (message.result.items) message.result.items = items; else message.result = items;

              if (message.result.itemDefaults && message.result.itemDefaults.editRange) {
                var def = message.result.itemDefaults.editRange;
                if (def.insert) {
                  def.insert.start.line = Math.max(0, def.insert.start.line - prefixLineCount);
                  def.insert.end.line = Math.max(0, def.insert.end.line - prefixLineCount);
                }
                if (def.replace) {
                  def.replace.start.line = Math.max(0, def.replace.start.line - prefixLineCount);
                  def.replace.end.line = Math.max(0, def.replace.end.line - prefixLineCount);
                }
              }
            }

            // Code actions edit normalization
            if (message && message.id && message.result && message.result.edit) {
              var editRoot = message.result.edit;
              if (editRoot.changes) {
                for (var uri in editRoot.changes) {
                  var ch = editRoot.changes[uri];
                  for (var e = 0; e < ch.length; e++) {
                    ch[e].range.start.line = Math.max(0, ch[e].range.start.line - prefixLineCount);
                    ch[e].range.end.line = Math.max(0, ch[e].range.end.line - prefixLineCount);
                  }
                }
              }
              if (editRoot.documentChanges) {
                for (var dc = 0; dc < editRoot.documentChanges.length; dc++) {
                  var docChange = editRoot.documentChanges[dc];
                  if (docChange.edits) {
                    var filtered = [];
                    for (var de = 0; de < docChange.edits.length; de++) {
                      var ed = docChange.edits[de];
                      var isInPrefix = ed.range.start.line < prefixLineCount && ed.range.end.line <= prefixLineCount;
                      if (!isInPrefix) {
                        ed.range.start.line = Math.max(0, ed.range.start.line - prefixLineCount);
                        ed.range.end.line = Math.max(0, ed.range.end.line - prefixLineCount);
                        filtered.push(ed);
                      }
                    }
                    docChange.edits = filtered;
                  }
                }
              }
            }
          } catch (e) {
            // Keep LSP resilient even if we fail to adjust a rare shape.
          }
          callback(message);
        });
      },
      dispose: function () { if (typeof baseReader.dispose === 'function') baseReader.dispose(); }
    };
  }

  function createPrefixingWriter(baseWriter, prefixLineCount, prefixText) {
    return {
      write: function (message) {
        try {
          // Completion, hover, definition: bump position
          if (message && message.method === 'textDocument/completion' && message.params && message.params.position) {
            message.params.position.line += prefixLineCount;
          } else if (message && message.method === 'textDocument/hover' && message.params && message.params.position) {
            message.params.position.line += prefixLineCount;
          } else if (message && message.method === 'textDocument/definition' && message.params && message.params.position) {
            message.params.position.line += prefixLineCount;
          }

          // didOpen: prepend hidden prefix text
          if (message && message.method === 'textDocument/didOpen' && message.params && message.params.textDocument && typeof message.params.textDocument.text === 'string') {
            message.params.textDocument.text = (prefixText || '') + message.params.textDocument.text;
          }

          // codeAction request context
          if (message && message.method === 'textDocument/codeAction') {
            if (message.params && message.params.range) {
              message.params.range.start.line += prefixLineCount;
              message.params.range.end.line += prefixLineCount;
            }
            if (message.params && message.params.context && message.params.context.diagnostics) {
              for (var i = 0; i < message.params.context.diagnostics.length; i++) {
                var d = message.params.context.diagnostics[i];
                d.range.start.line += prefixLineCount;
                d.range.end.line += prefixLineCount;
              }
            }
          }

          // codeAction/resolve
          if (message && message.method === 'codeAction/resolve' && message.params && message.params.diagnostics) {
            for (var r = 0; r < message.params.diagnostics.length; r++) {
              var diag = message.params.diagnostics[r];
              diag.range.start.line += prefixLineCount;
              diag.range.end.line += prefixLineCount;
            }
          }

          // didChange: bump change ranges
          if (message && message.method === 'textDocument/didChange' && message.params && message.params.contentChanges) {
            for (var c = 0; c < message.params.contentChanges.length; c++) {
              var change = message.params.contentChanges[c];
              if (change.range) {
                change.range.start.line += prefixLineCount;
                change.range.end.line += prefixLineCount;
              }
            }
          }

          // Generic fallbacks
          if (message && message.params) {
            if (message.params.position && typeof message.params.position.line === 'number') {
              message.params.position.line += prefixLineCount;
            }
            if (message.params.range && message.params.range.start) {
              message.params.range.start.line += prefixLineCount;
              message.params.range.end.line += prefixLineCount;
            }
          }
        } catch (e) {
          // Ignore write adjustment errors.
        }
        return baseWriter.write(message);
      },
      dispose: function () { if (typeof baseWriter.dispose === 'function') baseWriter.dispose(); }
    };
  }

  function resolveDeps(options) {
    var deps = options && options.deps ? options.deps : {};
    var monaco = options && options.monaco ? options.monaco : (root.monaco || null);
    var mlc = deps.monacoLanguageClient || root.monacoLanguageClient || root.MonacoLanguageClient || root['monaco-languageclient'] || null;
    var wsjson = deps.vscodeWsJsonrpc || root.vscodeWsJsonrpc || root['vscode-ws-jsonrpc'] || null;
    var jsonrpcAlt = deps.vscodeWs || root.vscode_ws_jsonrpc || null;
    if (!wsjson && jsonrpcAlt) wsjson = jsonrpcAlt;
    return { monaco: monaco, monacoLanguageClient: mlc, wsjson: wsjson };
  }

  function createMonacoModel(monaco, language, value, path) {
    var uri;
    if (path && typeof path === 'string') {
      // Ensure file:// URI for servers that expect real files
      if (path.indexOf('file://') === 0) uri = monaco.Uri.parse(path);
      else uri = monaco.Uri.parse('file://' + path);
    } else {
      var extMap = { python: 'py', java: 'java', cpp: 'cpp', c: 'c', typescript: 'ts', javascript: 'js', json: 'json', markdown: 'md', plaintext: 'txt' };
      var ext = extMap[language] || 'txt';
      uri = monaco.Uri.parse('file:///coderunner/' + (language || 'txt') + '/Main.' + ext);
    }
    return monaco.editor.createModel(String(value || ''), language, uri);
  }

  function defaultEditorOptions() {
    return {
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      wordBasedSuggestions: 'currentDocument',
      scrollBeyondLastLine: false,
      folding: true,
      rulers: [80],
      foldingStrategy: 'auto'
    };
  }

  function buildLspUrl(options) {
    if (options.lspUrl) return options.lspUrl;
    var base = (options.lspBaseUrl || '').replace(/\/$/, '');
    var lang = options.language || '';
    return base + '/' + lang;
  }

  function createConnectionFactory(monacoLanguageClient, wsjson, socket, prefixLineCount, prefixText) {
    // Prepare base reader/writer
    var iws = (wsjson && typeof wsjson.toSocket === 'function') ? wsjson.toSocket(socket) : socket;
    var BaseReader = wsjson && wsjson.WebSocketMessageReader ? wsjson.WebSocketMessageReader : null;
    var BaseWriter = wsjson && wsjson.WebSocketMessageWriter ? wsjson.WebSocketMessageWriter : null;
    if (!BaseReader || !BaseWriter) throw new Error('vscode-ws-jsonrpc WebSocketMessageReader/Writer not found');
    var reader = new BaseReader(iws);
    var writer = new BaseWriter(iws);

    var wrappedReader = createPrefixingReader(reader, prefixLineCount);
    var wrappedWriter = createPrefixingWriter(writer, prefixLineCount, prefixText);

    // Return transports; monaco-languageclient will build the connection and listen.
    return function (_errorHandler, _closeHandler) {
      return Promise.resolve({ reader: wrappedReader, writer: wrappedWriter });
    };
  }

  function incrementModelRefCount(connection, modelUri) {
    if (!connection.modelRefCounts) {
      connection.modelRefCounts = new Map();
    }
    var prevCount = connection.modelRefCounts.get(modelUri) || 0;
    connection.modelRefCounts.set(modelUri, prevCount + 1);
    return prevCount;
  }

  function decrementModelRefCount(connection, modelUri) {
    if (!connection.modelRefCounts || !connection.modelRefCounts.has(modelUri)) {
      return 0;
    }
    var prevCount = connection.modelRefCounts.get(modelUri);
    var nextCount = prevCount - 1;
    if (nextCount <= 0) {
      connection.modelRefCounts.delete(modelUri);
      return 0;
    }
    connection.modelRefCounts.set(modelUri, nextCount);
    return nextCount;
  }

  // Helper: Attach a model to an existing LSP connection
  function attachModelToLspConnection(monaco, model, editor, connection, prefixText, prefixLineCount, attachmentOptions) {
    var modelUri = model.uri.toString();
    var cleanupOpts = attachmentOptions || {};
    var disposeEditorOnDetach = cleanupOpts.disposeEditor !== false;
    var disposeModelOnDetach = cleanupOpts.disposeModel !== false;
    var previousRefCount = incrementModelRefCount(connection, modelUri);
    var isFirstAttachment = previousRefCount === 0;

    if (isFirstAttachment) {
      // Register this model with the connection
      connection.models.push(model);
      connection.modelPrefixes.set(modelUri, {
        text: prefixText || '',
        lineCount: prefixLineCount || 0
      });

      // Send didOpen notification for this model
      if (connection.ws && connection.ws.readyState === 1) {
        connection.send({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: modelUri,
              languageId: connection.language,
              version: 1,
              text: (prefixText || '') + model.getValue()
            }
          }
        });
      } else {
        if (!connection.pendingDidOpen) {
          connection.pendingDidOpen = [];
        }
        connection.pendingDidOpen.push({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              uri: modelUri,
              languageId: connection.language,
              version: 1,
              text: (prefixText || '') + model.getValue()
            }
          }
        });
      }

      // Listen to model changes
      var saveTimer = null;
      var changeListener = model.onDidChangeContent(function() {
        if (connection.ws && connection.ws.readyState === 1) {
          connection.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: {
                uri: modelUri,
                version: model.getVersionId()
              },
              contentChanges: [{
                text: (prefixText || '') + model.getValue()
              }]
            }
          });
          notifyDidChangeSent({ uri: modelUri, version: model.getVersionId() });

          // Debounce didSave to trigger full project revalidation after changes stabilize
          // This ensures dependent files get updated diagnostics
          if (saveTimer) {
            clearTimeout(saveTimer);
          }
          saveTimer = setTimeout(function() {
            if (connection.ws && connection.ws.readyState === 1) {
              connection.send({
                jsonrpc: '2.0',
                method: 'textDocument/didSave',
                params: {
                  textDocument: {
                    uri: modelUri
                  },
                  text: (prefixText || '') + model.getValue()
                }
              });
            }
            saveTimer = null;
          }, 500); // 500ms delay after last change
        }
      });

      // Store change listener for cleanup
      if (!connection.changeListeners) {
        connection.changeListeners = new Map();
      }
      connection.changeListeners.set(modelUri, changeListener);
    }

    return {
      editor: editor,
      model: model,
      dispose: function() {
        detachModelFromLspConnection(monaco, model, connection);
        if (disposeModelOnDetach) {
          try { model.dispose(); } catch (e) {}
        }
        if (disposeEditorOnDetach && editor && typeof editor.dispose === 'function') {
          try { editor.dispose(); } catch (e) {}
        }
      },
      setValue: function(v) { editor.setValue(String(v || '')); },
      getValue: function() { return editor.getValue(); },
      getPrefixLineCount: function() { return prefixLineCount; }
    };
  }

  function disposeConnectionResources(connection) {
    if (!connection) {
      return;
    }
    if (connection.pendingDisposeTimer) {
      clearTimeout(connection.pendingDisposeTimer);
      connection.pendingDisposeTimer = null;
    }
    try {
      // Dispose all tracked providers
      if (connection.trackedDisposables) {
        for (var i = 0; i < connection.trackedDisposables.length; i++) {
          var disposable = connection.trackedDisposables[i];
          if (disposable && typeof disposable.dispose === 'function') {
            try { disposable.dispose(); } catch (e) {}
          }
        }
        connection.trackedDisposables = [];
      }
      connection.stopped = true;
      if (connection.reconnectTimer) {
        clearTimeout(connection.reconnectTimer);
        connection.reconnectTimer = null;
      }
      if (connection.keepAliveTimer) {
        clearInterval(connection.keepAliveTimer);
        connection.keepAliveTimer = null;
      }
      if (connection.ws && connection.ws.readyState < 2) {
        connection.ws.close();
      }
    } catch (e) {}

    // Clear provider registration flag to allow re-registration on reconnect
    if (connection.language && connection.lspUrl) {
      var providerKey = globalLspPool.makeKey(connection.language, connection.lspUrl);
      delete globalRegisteredProviders[providerKey];
    }

    globalLspPool.remove(connection.language, connection.lspUrl);
  }

  function scheduleConnectionDispose(connection) {
    if (!connection) {
      return;
    }
    if (connection.pendingDisposeTimer) {
      clearTimeout(connection.pendingDisposeTimer);
    }
    connection.pendingDisposeTimer = setTimeout(function() {
      disposeConnectionResources(connection);
    }, CONNECTION_RELEASE_DELAY_MS);
  }

  // Helper: Detach a model from an LSP connection
  function detachModelFromLspConnection(monaco, model, connection) {
    var modelUri = model.uri.toString();
    var remainingRefs = decrementModelRefCount(connection, modelUri);
    if (remainingRefs > 0) {
      return;
    }

    // Send didClose notification
    if (connection.ws && connection.ws.readyState === 1) {
      connection.send({
        jsonrpc: '2.0',
        method: 'textDocument/didClose',
        params: {
          textDocument: { uri: modelUri }
        }
      });
    }

    // Remove from models array
    connection.models = connection.models.filter(function(m) {
      return m.uri.toString() !== modelUri;
    });

    // Remove prefix
    connection.modelPrefixes.delete(modelUri);

    // Dispose change listener
    if (connection.changeListeners && connection.changeListeners.has(modelUri)) {
      var listener = connection.changeListeners.get(modelUri);
      try { listener.dispose(); } catch (e) {}
      connection.changeListeners.delete(modelUri);
    }

    // Clear any pending save timers
    if (connection.saveTimers && connection.saveTimers.has(modelUri)) {
      var timer = connection.saveTimers.get(modelUri);
      clearTimeout(timer);
      connection.saveTimers.delete(modelUri);
    }

    // If no models left, clean up the connection (after a short delay to allow renames)
    if (connection.models.length === 0) {
      scheduleConnectionDispose(connection);
    }
  }

  function createMonacoLspEditor(container, options) {
    options = options || {};
    var deps = resolveDeps(options);
    var monaco = ensure(deps.monaco, 'monaco');

    var prefixText = options.prefixCode || '';
    var prefixLineCount = countTerminatedLines(prefixText);

    var model = options.model || (options.editor && options.editor.getModel ? options.editor.getModel() : null);
    var ownsModel = false;
    if (!model) {
      model = createMonacoModel(monaco, options.language || 'plaintext', options.value || '', options.path);
      ownsModel = true;
    }

    var editor = options.editor || null;
    var ownsEditor = false;
    if (!editor) {
      var targetContainer = ensure(container, 'container');
      editor = monaco.editor.create(targetContainer, Object.assign(defaultEditorOptions(), { model: model }));
      ownsEditor = true;
    } else if (typeof editor.setModel === 'function' && editor.getModel() !== model) {
      editor.setModel(model);
    }

    if (ownsEditor && container && container.addEventListener) {
      container.addEventListener('wheel', function(e) {
      if (!editor || e.defaultPrevented || e.ctrlKey || e.metaKey) {
        return;
      }

      // Check if scrolling over a Monaco overlay widget (menu, popup, completion list, etc.)
      // These are rendered outside the main editor view and need independent scrolling
      var target = e.target;
      var isOverOverlayWidget = false;
      while (target && target !== document.body) {
        var classList = target.classList;
        if (classList && (
          classList.contains('suggest-widget') ||
          classList.contains('parameter-hints-widget') ||
          classList.contains('monaco-hover') ||
          classList.contains('context-view') ||
          classList.contains('quick-input-widget') ||
          classList.contains('monaco-quick-input') ||
          classList.contains('quick-input-list')
        )) {
          isOverOverlayWidget = true;
          break;
        }
        // Stop searching if we hit the container (we're in editor area, not overlay)
        if (target === container) {
          break;
        }
        target = target.parentElement;
      }

      // Allow normal scrolling in Monaco overlay widgets (menus, popups, etc.)
      if (isOverOverlayWidget) {
        return;
      }

      // Ignore purely horizontal scrolling.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        return;
      }

      if (e.deltaY === 0) {
        return;
      }

      var layoutInfo = editor.getLayoutInfo ? editor.getLayoutInfo() : null;
      var height = layoutInfo && typeof layoutInfo.height === 'number' ? layoutInfo.height : container.clientHeight;
      var scrollTop = editor.getScrollTop();
      var scrollHeight = editor.getScrollHeight();
      var deltaY = e.deltaY;
      var hasVerticalScroll = scrollHeight > height + 1;
      var atTop = scrollTop <= 1;
      var atBottom = scrollTop + height >= scrollHeight - 1;
      var releaseScroll = !hasVerticalScroll || (deltaY < 0 && atTop) || (deltaY > 0 && atBottom);

      if (releaseScroll) {
        // Stop Monaco from swallowing the wheel event; let the page handle it.
        e.stopPropagation();
      }
    }, { passive: false, capture: true });
    }

    var api = {
      editor: editor,
      model: model,
      dispose: function () {
        try { if (client) client.stop(); } catch (e) {}
        try { if (socket && socket.readyState < 2) socket.close(); } catch (e) {}
        if (ownsModel) {
          try { if (model) model.dispose(); } catch (e) {}
        }
        if (ownsEditor) {
          try { if (editor) editor.dispose(); } catch (e) {}
        }
      },
      setValue: function (v) { editor.setValue(String(v || '')); },
      getValue: function () { return editor.getValue(); },
      getPrefixLineCount: function () { return prefixLineCount; }
    };

    var lspEnabled = options.lspEnabled !== false && !!(options.lspUrl || options.lspBaseUrl);
    if (!lspEnabled) {
      return api;
    }

    var useSimple = options.useSimpleLsp !== false; // default true
    if (useSimple) {
      // Minimal WebSocket + JSON-RPC client without monaco-languageclient
      var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: options.language });
      var language = options.language || 'plaintext';

      // Check if we already have a pooled connection for this language+url
      var existingConnection = globalLspPool.get(language, urlSimple);
      if (existingConnection) {
        // Reuse existing connection
        return attachModelToLspConnection(monaco, model, editor, existingConnection, prefixText, prefixLineCount, {
          disposeEditor: ownsEditor,
          disposeModel: ownsModel
        });
      }

      // Creating new connection
      // No existing connection - create a new one
      var ws = null;
      var idSeq = 1;
      var pending = {};
      var version = 1;
      var reconnectAttempts = 0;
      var reconnectTimer = null;
      var stopped = false;
      var trackedDisposables = [];
      var lastDiagnosticsByUri = new Map();
      var keepAliveTimer = null;
      var KEEPALIVE_INTERVAL = 30000;
      var EXECUTE_COMMAND_ID = 'lmsMonaco.executeCommand';
      var workspaceUri = null;
      var workspaceFolders = null;
      var workspaceFoldersRegistered = false;
      var workspaceConfig = null;
      var pendingCodeActionCommands = []; // Store commands from code actions to execute after edits
      var pendingCommandsByUri = new Map(); // Map URI to pending commands for that file

      // Create connection object for pooling
      var sharedConnection = {
        ws: null,
        language: language,
        lspUrl: urlSimple,
        models: [model],  // Track all models using this connection
        modelRefCounts: new Map([[model.uri.toString(), 1]]),
        modelPrefixes: new Map([[model.uri.toString(), { text: prefixText, lineCount: prefixLineCount }]]),
        pending: pending,
        idSeq: idSeq,
        stopped: stopped,
        reconnectTimer: reconnectTimer,
        reconnectAttempts: reconnectAttempts,
        keepAliveTimer: keepAliveTimer,
        trackedDisposables: trackedDisposables,
        pendingDisposeTimer: null,
        workspaceUri: workspaceUri,
        workspaceFolders: workspaceFolders,
        workspaceConfig: workspaceConfig,
        send: function(msg) {
          try {
            if (this.ws && this.ws.readyState === 1) {
              this.ws.send(JSON.stringify(msg));
            }
          } catch (e) {}
        }
      };

      // Add connection to pool IMMEDIATELY to prevent race conditions
      // Other editors checking the pool will find this pending connection and reuse it
      globalLspPool.set(language, urlSimple, sharedConnection);

      function directoryUriFromPath(path) {
        if (!path || typeof path !== 'string') {
          return null;
        }
        var normalized = String(path).split('#')[0].replace(/\\/g, '/');
        var lastSlash = normalized.lastIndexOf('/');
        if (lastSlash <= 8) { // length of 'file:///'
          return null;
        }
        return normalized.substring(0, lastSlash);
      }

      workspaceUri = options.workspaceRootUri || directoryUriFromPath(options.path);
      if (workspaceUri) {
        workspaceFolders = [{
          uri: workspaceUri,
          name: options.language || 'workspace'
        }];
      }

      // Parse workspace configuration if provided (e.g., for SQL LSP server database config)
      if (options.workspaceConfig && typeof options.workspaceConfig === 'string') {
        try {
          workspaceConfig = JSON.parse(options.workspaceConfig);
        } catch (e) {
          workspaceConfig = null;
        }
      }

      function toUri(u) { return (model && model.uri && model.uri.toString()) || u || 'file:///coderunner/' + (options.language || 'txt') + '/Main.txt'; }
      function nowId() { return idSeq++; }
      function send(msg) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch (e) {} }
      function request(method, params) {
        if (!ws || ws.readyState !== 1) {
          return Promise.reject({ code: 'not_connected' });
        }
        return new Promise(function (resolve, reject) {
          var id = nowId();
          pending[id] = { resolve: resolve, reject: reject };
          send({ jsonrpc: '2.0', id: id, method: method, params: params });
        });
      }
      function lspPositionFromMonaco(pos, prefixOverride) {
        var prefixLines = typeof prefixOverride === 'number' ? prefixOverride : prefixLineCount;
        return { line: Math.max(0, (pos.lineNumber - 1) + prefixLines), character: Math.max(0, (pos.column - 1)) };
      }
      function monacoRangeFromLsp(r, context) {
        if (!r) return null;
        if (!r.start || !r.end) return null;
        if (typeof r.start.line !== 'number' || typeof r.start.character !== 'number') return null;
        if (typeof r.end.line !== 'number' || typeof r.end.character !== 'number') return null;
        var ctx = context || {};
        var targetModel = ctx.model || model;
        var prefixOffset = typeof ctx.prefixLineCount === 'number' ? ctx.prefixLineCount : prefixLineCount;
        var startLineNumber = (r.start.line - prefixOffset) + 1;
        var endLineNumber = (r.end.line - prefixOffset) + 1;
        if (startLineNumber < 1) startLineNumber = 1;
        if (endLineNumber < 1) endLineNumber = 1;
        if (targetModel) {
          var lineCount = targetModel.getLineCount();
          if (startLineNumber > lineCount) startLineNumber = lineCount;
          if (endLineNumber > lineCount) endLineNumber = lineCount;
        }
        var maxStartColumn = targetModel ? targetModel.getLineMaxColumn(startLineNumber) : null;
        var maxEndColumn = targetModel ? targetModel.getLineMaxColumn(endLineNumber) : null;
        var startColumn = (r.start.character) + 1;
        var endColumn = (r.end.character) + 1;
        if (maxStartColumn && startColumn > maxStartColumn) startColumn = maxStartColumn;
        if (maxEndColumn && endColumn > maxEndColumn) endColumn = maxEndColumn;
        if (startColumn < 1) startColumn = 1;
        if (endColumn < 1) endColumn = 1;
        return new monaco.Range(
          startLineNumber,
          startColumn,
          endLineNumber,
          endColumn
        );
      }
      function toMonacoLocation(lspLoc, context) {
        if (!lspLoc) return null;
        var uriString = lspLoc.uri || lspLoc.targetUri;
        var uri = uriString ? monaco.Uri.parse(uriString) : model.uri;
        // Filter out locations that don't have a Monaco model (e.g., builtin libraries)
        var targetModel = monaco.editor.getModel(uri);
        if (!targetModel) return null;
        // Rebuild context with TARGET model's prefix, not source model's
        var targetContext = buildRangeContext(targetModel);
        var range = monacoRangeFromLsp(lspLoc.range || lspLoc.targetSelectionRange || lspLoc.targetRange, targetContext);
        if (!range) return null;
        return { uri: uri, range: range };
      }
      function monacoPositionFromLsp(pos, context) {
        if (!pos) return null;
        var ctx = context || {};
        var targetModel = ctx.model || model;
        var prefixOffset = typeof ctx.prefixLineCount === 'number' ? ctx.prefixLineCount : prefixLineCount;
        var lineNumber = (pos.line - prefixOffset) + 1;
        if (lineNumber < 1) lineNumber = 1;
        if (targetModel) {
          var lineCount = targetModel.getLineCount();
          if (lineNumber > lineCount) lineNumber = lineCount;
        }
        var column = (typeof pos.character === 'number' ? pos.character : 0) + 1;
        if (targetModel) {
          var maxColumn = targetModel.getLineMaxColumn(lineNumber);
          if (column > maxColumn) column = maxColumn;
        }
        if (column < 1) column = 1;
        return new monaco.Position(lineNumber, column);
      }
      function mapInlayHintKind(kind) {
        var HintKind = monaco.languages.InlayHintKind || {};
        if (kind === 1 || kind === 'Type') {
          return HintKind.Type || undefined;
        }
        if (kind === 2 || kind === 'Parameter') {
          return HintKind.Parameter || undefined;
        }
        return undefined;
      }
      function toMonacoInlayHints(items, context) {
        if (!items) return [];
        var arr = Array.isArray(items) ? items : [items];
        var hints = [];
        for (var i = 0; i < arr.length; i++) {
          var item = arr[i];
          if (!item || !item.position) continue;
          var position = monacoPositionFromLsp(item.position, context);
          if (!position) continue;
          var hint = {
            position: position,
            label: '',
            kind: mapInlayHintKind(item.kind),
            paddingLeft: !!item.paddingLeft,
            paddingRight: !!item.paddingRight
          };
          if (Array.isArray(item.label)) {
            hint.label = item.label.map(function(part) {
              var converted = { value: String(part.value || '') };
              if (part.tooltip) {
                converted.tooltip = part.tooltip;
              }
              if (part.location) {
                var loc = toMonacoLocation(part.location, context);
                if (loc) {
                  converted.location = loc;
                }
              }
              if (part.command) {
                converted.command = part.command;
              }
              return converted;
            });
          } else if (typeof item.label === 'string') {
            hint.label = item.label;
          } else if (item.label && typeof item.label.value === 'string') {
            hint.label = item.label.value;
          }
          if (item.textEdits) {
            hint.textEdits = toMonacoEdits(item.textEdits, context);
          }
          hints.push(hint);
        }
        return hints;
      }
      function convertSelectionRangeNode(node, context) {
        if (!node) return null;
        var range = monacoRangeFromLsp(node.range, context);
        if (!range) return null;
        return {
          range: range,
          parent: convertSelectionRangeNode(node.parent, context)
        };
      }
      function toMonacoSelectionRanges(items, context) {
        if (!items) return [];
        var arr = Array.isArray(items) ? items : [items];
        var converted = [];
        for (var i = 0; i < arr.length; i++) {
          var node = convertSelectionRangeNode(arr[i], context);
          if (node) converted.push(node);
        }
        return converted;
      }
      function toMonacoWorkspaceSymbols(items, context) {
        if (!items) return [];
        var arr = Array.isArray(items) ? items : [items];
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
          var sym = arr[i];
          if (!sym) continue;
          var location = sym.location ? toMonacoLocation(sym.location, context) : null;
          if (!location && sym.uri && sym.range) {
            location = { uri: monaco.Uri.parse(sym.uri), range: monacoRangeFromLsp(sym.range, context) };
          }
          if (!location && sym.range) {
            location = { uri: model && model.uri, range: monacoRangeFromLsp(sym.range, context) };
          }
          mapped.push({
            name: sym.name || '',
            containerName: sym.containerName,
            kind: sym.kind || monaco.languages.SymbolKind.Function,
            location: location
          });
        }
        return mapped;
      }

      function ensureExecuteCommandRegistered() {
        if (monaco.__lmsExecuteCommandRegistered) {
          return;
        }
        // Monaco calls registered commands with: function(_accessor, ...args)
        // where args are spread from command.arguments array
        // We pass LSP Command object as first argument: {command, title, arguments}
        monaco.editor.registerCommand(EXECUTE_COMMAND_ID, function(_accessor, lspCommand) {
          if (!lspCommand || !lspCommand.command) {
            return;
          }
          var commandId = lspCommand.command;
          var args = lspCommand.arguments || [];
        var workspaceEditArg = null;
        for (var i = 0; i < args.length; i++) {
          var candidate = args[i];
          if (candidate && (candidate.changes || candidate.documentChanges)) {
            workspaceEditArg = candidate;
            break;
          }
        }
        if (workspaceEditArg) {
          try {
            applyWorkspaceEdit(workspaceEditArg);
          } catch (err) {
            // Silently ignore workspace edit errors
          }
        }
        return request('workspace/executeCommand', {
          command: commandId,
          arguments: args
        }).catch(function(err) {});
      });
        monaco.__lmsExecuteCommandRegistered = true;
      }

      // Register handler for java.show.references command from code lens
      if (!monaco.__javaShowReferencesRegistered) {
        monaco.editor.registerCommand('java.show.references', function(_accessor, uri, position, references) {

          if (!references || !Array.isArray(references) || references.length === 0) {
            return;
          }

          // Get the active editor
          var editor = null;

          // Try to get editor from the service accessor (Monaco internal)
          if (_accessor && typeof _accessor.get === 'function') {
            try {
              // Try to get the code editor service using the service identifier
              if (monaco.editor.IStandaloneCodeEditorService) {
                var codeEditorService = _accessor.get(monaco.editor.IStandaloneCodeEditorService);
                if (codeEditorService && codeEditorService.getActiveCodeEditor) {
                  editor = codeEditorService.getActiveCodeEditor();
                }
              }
            } catch (e) {
              // Service accessor not available, will use fallback
            }
          }

          // Fallback: get from global editor list
          if (!editor && monaco.editor.getEditors) {
            var editors = monaco.editor.getEditors();
            editor = editors && editors.length > 0 ? editors[0] : null;
          }

          if (!editor) {
            return;
          }

          // Convert LSP references to Monaco locations
          var locations = [];
          for (var i = 0; i < references.length; i++) {
            var ref = references[i];
            if (!ref || !ref.uri || !ref.range) continue;
            try {
              var refUri = monaco.Uri.parse(ref.uri);
              var prefixInfo = getPrefixInfoForUri(refUri.toString());
              var range = monacoRangeFromLsp(ref.range, { prefixLineCount: prefixInfo.lineCount });
              if (range) {
                locations.push({
                  uri: refUri,
                  range: range
                });
              }
            } catch (e) {
              // Skip invalid references
            }
          }

          if (locations.length === 0) return;

          // Trigger the references widget at the specified position
          if (position && typeof position.line === 'number' && typeof position.character === 'number') {
            try {
              var prefixInfo = getPrefixInfoForModel(editor.getModel());
              var monacoPos = monacoPositionFromLsp(position, { prefixLineCount: prefixInfo.lineCount });
              editor.setPosition(monacoPos);
              editor.revealPositionInCenter(monacoPos);

              // Try multiple ways to trigger the references widget
              var triggered = false;

              // Method 1: Try editor.trigger (Monaco 0.44+)
              if (editor.trigger) {
                try {
                  editor.trigger('codeLens', 'editor.action.goToReferences');
                  triggered = true;
                } catch (e) {}
              }

              // Method 2: Try getAction
              if (!triggered) {
                var action = editor.getAction('editor.action.goToReferences');
                if (!action) {
                  action = editor.getAction('editor.action.referenceSearch.trigger');
                }
                if (!action) {
                  action = editor.getAction('editor.action.showReferences');
                }
                if (!action) {
                  action = editor.getAction('editor.action.peekLocations');
                }

                if (action) {
                  // action.run() returns a Promise that may reject with "Canceled"
                  var runResult = action.run();
                  if (runResult && typeof runResult.then === 'function') {
                    runResult.catch(function(err) {
                    });
                  }
                  triggered = true;
                }
              }

              if (!triggered) {
                alert(locations.length + ' reference(s) found');
              }
            } catch (err) {
            }
          } else {
            // No position provided, just navigate to first reference
            if (locations[0]) {
              editor.setPosition({
                lineNumber: locations[0].range.startLineNumber,
                column: locations[0].range.startColumn
              });
              editor.revealPositionInCenter({
                lineNumber: locations[0].range.startLineNumber,
                column: locations[0].range.startColumn
              });
            }
          }
        });
        monaco.__javaShowReferencesRegistered = true;
      }

      function applyWorkspaceEdit(edit) {
        var converted = convertWorkspaceEdit(edit);
        if (!converted || !converted.edits || !converted.edits.length) {
          return false;
        }

        // Separate file operations from text edits
        var fileOperations = [];
        var textEditEntries = [];

        converted.edits.forEach(function(entry) {
          if (!entry) return;

          if (entry.kind === 'create' || entry.kind === 'rename' || entry.kind === 'delete') {
            fileOperations.push(entry);
          } else if (entry.resource && entry.textEdit) {
            textEditEntries.push(entry);
          }
        });

        // Group text edits by target model
        var grouped = new Map();
        textEditEntries.forEach(function(entry) {
          var key = entry.resource.toString();
          if (!grouped.has(key)) {
            grouped.set(key, []);
          }
          grouped.get(key).push(entry.textEdit);
        });

        // Apply text edits to existing models
        var applied = false;
        grouped.forEach(function(textEdits, uriString) {
          var resource = monaco.Uri.parse(uriString);
          var targetModel = monaco.editor.getModel(resource);
          if (!targetModel) {
          }

          // Use editor if it matches; otherwise apply directly to the model.
          if (editor && editor.getModel && editor.getModel() === targetModel && typeof editor.executeEdits === 'function') {
            editor.pushUndoStop();
            editor.executeEdits('lsp', textEdits);
            editor.pushUndoStop();
          } else if (typeof targetModel.applyEdits === 'function') {
            targetModel.applyEdits(textEdits);
          } else if (typeof targetModel.pushEditOperations === 'function') {
            targetModel.pushEditOperations([], textEdits, function() { return []; });
          }
          applied = true;
        });

        // Handle file operations (create, rename, delete)
        if (fileOperations.length > 0) {

          fileOperations.forEach(function(op) {
            if (op.kind === 'create') {
              // Notify via the workspace edit hook with file creation metadata
              notifyWorkspaceEditApplied({
                kind: 'create',
                uri: op.resource.toString(),
                initialContent: op.initialContent,
                options: op.options
              });
            } else if (op.kind === 'rename') {
              notifyWorkspaceEditApplied({
                kind: 'rename',
                oldUri: op.oldResource.toString(),
                newUri: op.newResource.toString(),
                options: op.options
              });
            } else if (op.kind === 'delete') {
              notifyWorkspaceEditApplied({
                kind: 'delete',
                uri: op.resource.toString(),
                options: op.options
              });
            }
          });
          applied = true;
        }

        if (applied) {
          var uris = [];
          grouped.forEach(function(_edits, uriString) {
            uris.push(uriString);
          });
          notifyWorkspaceEditApplied({ edits: converted.edits, uris: uris });

          // Execute any pending commands from code actions (LSP protocol)
          // Commands should be executed after workspace edits are applied
          if (pendingCodeActionCommands.length > 0) {

            // Process all pending commands (usually just one)
            var commandsToExecute = pendingCodeActionCommands.slice();
            pendingCodeActionCommands = [];

            commandsToExecute.forEach(function(cmdInfo) {
              var cmd = cmdInfo.command;
              if (!cmd || !cmd.command) {
                return;
              }
              // Send workspace/executeCommand to LSP
              // This will trigger the LSP to refresh diagnostics or perform other actions
              request('workspace/executeCommand', {
                command: cmd.command,
                arguments: cmd.arguments || []
              });
            });
          }
        }
      }

      function toMonacoLocations(results, context) {
        if (!results) return [];
        var arr = Array.isArray(results) ? results : [results];
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
          var loc = toMonacoLocation(arr[i], context);
          if (loc) mapped.push(loc);
        }
        return mapped;
      }
  function toMonacoHighlights(items, context) {
    if (!items) return [];
    var highlights = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
          if (!item || !item.range) continue;
          var range = monacoRangeFromLsp(item.range, context);
          if (!range) continue;
          var kind = monaco.languages.DocumentHighlightKind.Text;
          if (item.kind === 2) {
            kind = monaco.languages.DocumentHighlightKind.Write;
          } else if (item.kind === 1) {
            kind = monaco.languages.DocumentHighlightKind.Read;
          }
          highlights.push({ range: range, kind: kind });
        }
        return highlights;
      }
      function toMonacoSymbols(items, context) {
        if (!items) return [];
        if (!Array.isArray(items)) items = [items];
        var results = [];
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (!item) continue;

          if (item.location) {
            var location = toMonacoLocation(item.location, context);
            if (location && location.range) {
              results.push({
                name: item.name || '',
                containerName: item.containerName,
                kind: item.kind || monaco.languages.SymbolKind.Function,
                location: location
              });
            }
          } else {
            var range = monacoRangeFromLsp(item.range, context);
            var selectionRange = monacoRangeFromLsp(item.selectionRange, context);
            // Only include symbol if both ranges are valid and have required properties
            if (range && selectionRange &&
                typeof range.startLineNumber === 'number' &&
                typeof range.startColumn === 'number' &&
                typeof range.endLineNumber === 'number' &&
                typeof range.endColumn === 'number' &&
                typeof selectionRange.startLineNumber === 'number' &&
                typeof selectionRange.startColumn === 'number' &&
                typeof selectionRange.endLineNumber === 'number' &&
                typeof selectionRange.endColumn === 'number') {
              results.push({
                name: item.name || '',
                detail: item.detail,
                kind: item.kind || monaco.languages.SymbolKind.Function,
                range: range,
                selectionRange: selectionRange,
                children: toMonacoSymbols(item.children || [], context)
              });
            }
          }
        }
        return results;
      }
  function toMonacoEdits(edits, context) {
    if (!edits) return [];
    var monacoEdits = [];
    for (var i = 0; i < edits.length; i++) {
          var edit = edits[i];
          if (!edit || !edit.range) continue;
          var range = monacoRangeFromLsp(edit.range, context);
          if (!range) continue;
          monacoEdits.push({ range: range, text: edit.newText || '' });
        }
        return monacoEdits;
  }

  // Helper to get prefix info for a model URI from any connection
  function getPrefixInfoForUri(modelUri) {
    // Search all connections in the pool for this model's prefix info
    var connections = globalLspPool.getAllConnections();
    for (var i = 0; i < connections.length; i++) {
      var conn = connections[i];
      if (conn.modelPrefixes && conn.modelPrefixes.has(modelUri)) {
        return conn.modelPrefixes.get(modelUri);
      }
    }
    return { text: '', lineCount: 0 };
  }

  function convertWorkspaceEdit(workspaceEdit, context) {
    if (!workspaceEdit) return null;
    var edits = [];
      if (workspaceEdit.changes) {
        for (var uri in workspaceEdit.changes) {
          if (!Object.prototype.hasOwnProperty.call(workspaceEdit.changes, uri)) continue;
          var resource = monaco.Uri.parse(uri);
          var targetModel = monaco.editor.getModel(resource);
          if (!targetModel) {
            // Model doesn't exist - this is a file creation
            edits.push({
              kind: 'create',
              resource: resource,
              initialContent: workspaceEdit.changes[uri]
            });
            continue;
          }
          // Get prefix info for this specific file
          var fileContext = context || {};
          if (!fileContext.prefixLineCount) {
            var prefixInfo = getPrefixInfoForUri(uri);
            fileContext = {
              model: targetModel,
              prefixLineCount: prefixInfo.lineCount
            };
          }
          var changeEdits = toMonacoEdits(workspaceEdit.changes[uri], fileContext);
          if (!changeEdits.length) continue;
          for (var ce = 0; ce < changeEdits.length; ce++) {
            edits.push({ resource: resource, textEdit: changeEdits[ce] });
          }
        }
      }
      if (workspaceEdit.documentChanges) {
        // Track which URIs have CreateFile operations so we can skip their TextDocumentEdits
        var createdFileUris = new Set();

        for (var d = 0; d < workspaceEdit.documentChanges.length; d++) {
          var docChange = workspaceEdit.documentChanges[d];

          // Handle CreateFile operations (for "Create class/interface/enum/record" code actions)
          if (docChange.kind === 'create' && docChange.uri) {
            createdFileUris.add(docChange.uri);

            // Look for the corresponding TextDocumentEdit with the file content
            var initialContent = null;
            for (var lookAhead = d + 1; lookAhead < workspaceEdit.documentChanges.length; lookAhead++) {
              var nextChange = workspaceEdit.documentChanges[lookAhead];
              if (nextChange.textDocument && nextChange.textDocument.uri === docChange.uri && nextChange.edits) {
                initialContent = nextChange.edits;
                break;
              }
            }

            edits.push({
              kind: 'create',
              resource: monaco.Uri.parse(docChange.uri),
              initialContent: initialContent,
              options: docChange.options
            });
            continue;
          }

          // Handle RenameFile operations
          if (docChange.kind === 'rename' && docChange.oldUri && docChange.newUri) {
            edits.push({
              kind: 'rename',
              oldResource: monaco.Uri.parse(docChange.oldUri),
              newResource: monaco.Uri.parse(docChange.newUri),
              options: docChange.options
            });
            continue;
          }

          // Handle DeleteFile operations
          if (docChange.kind === 'delete' && docChange.uri) {
            edits.push({
              kind: 'delete',
              resource: monaco.Uri.parse(docChange.uri),
              options: docChange.options
            });
            continue;
          }

          // Handle regular text edits
          if (docChange.textDocument && docChange.edits) {
            var docUri = monaco.Uri.parse(docChange.textDocument.uri);

            // Skip if this is the content for a CreateFile operation (already processed)
            if (createdFileUris.has(docChange.textDocument.uri)) {
              continue;
            }

            var docModel = monaco.editor.getModel(docUri);
            if (!docModel) {
              // Model doesn't exist - this is a file creation without explicit CreateFile
              edits.push({
                kind: 'create',
                resource: docUri,
                initialContent: docChange.edits
              });
              continue;
            }
            // Get prefix info for this specific file
            var docContext = context || {};
            if (!docContext.prefixLineCount) {
              var docPrefixInfo = getPrefixInfoForUri(docChange.textDocument.uri);
              docContext = {
                model: docModel,
                prefixLineCount: docPrefixInfo.lineCount
              };
            }
            var docEdits = toMonacoEdits(docChange.edits, docContext);
            for (var de = 0; de < docEdits.length; de++) {
              edits.push({ resource: docUri, textEdit: docEdits[de] });
            }
          }
      }
    }
    if (!edits.length) return null;

    // Separate file operations from text edits for Monaco
    var textEdits = [];
    var fileOps = [];
    for (var i = 0; i < edits.length; i++) {
      if (edits[i].kind) {
        fileOps.push(edits[i]);
      } else {
        textEdits.push(edits[i]);
      }
    }

    return {
      edits: textEdits,
      fileOperations: fileOps.length > 0 ? fileOps : undefined
    };
  }

  /**
   * Send a full-content didChange for a model using an existing connection.
   * Does not modify registrations; no-op if no live connection exists.
   */
  syncModelContent = function(monaco, model, options) {
    if (!monaco || !model || !options) {
      return false;
    }
    var language = options.language || model.getModeId && model.getModeId() || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: language });
    var connection = globalLspPool.get(language, urlSimple);
    if (!connection || !connection.ws || connection.ws.readyState !== 1) {
      return false;
    }
    var uri = model.uri.toString();
    var prefixText = options.prefixCode || '';
    var baseVersion = typeof model.getVersionId === 'function' ? model.getVersionId() : 1;
    var forcedVersion = typeof options.forceVersionId === 'number' ? options.forceVersionId : null;
    var versionToSend = forcedVersion && forcedVersion > baseVersion ? forcedVersion : (baseVersion + 1);
    notifyDidChangeSent({ uri: uri, version: versionToSend });
    return true;
  };
  function toMonacoMarkupContent(content) {
    if (!content) return undefined;
    if (typeof content === 'string') {
      return { value: content };
    }
    if (content.value) {
      return { value: content.value };
    }
    return undefined;
  }
  function toMonacoSignatureHelp(res) {
    if (!res || !res.signatures) return null;
    var result = {
      signatures: [],
      activeSignature: typeof res.activeSignature === 'number' ? res.activeSignature : 0,
      activeParameter: typeof res.activeParameter === 'number' ? res.activeParameter : 0
    };
    for (var i = 0; i < res.signatures.length; i++) {
      var sig = res.signatures[i];
      var sigLabel = typeof sig.label === 'string' ? sig.label : '';
      var parameters = [];
      if (Array.isArray(sig.parameters)) {
        for (var p = 0; p < sig.parameters.length; p++) {
          var param = sig.parameters[p];
          var paramLabel = '';
          if (typeof param.label === 'string') {
            paramLabel = param.label;
          } else if (Array.isArray(param.label) && param.label.length === 2 && typeof sigLabel === 'string') {
            var start = param.label[0];
            var end = param.label[1];
            paramLabel = sigLabel.substring(start, end);
          }
          parameters.push({
            label: paramLabel,
            documentation: toMonacoMarkupContent(param.documentation)
          });
        }
      }
      result.signatures.push({
        label: sigLabel,
        documentation: toMonacoMarkupContent(sig.documentation),
        parameters: parameters
      });
    }
    if (result.signatures.length === 0) {
      result.signatures.push({ label: '', parameters: [] });
    }
    if (result.activeSignature >= result.signatures.length) {
      result.activeSignature = 0;
    }
    if (result.activeSignature < 0) {
      result.activeSignature = 0;
    }
    if (result.activeParameter < 0) {
      result.activeParameter = 0;
    }
    return result;
  }

      function toMonacoFoldingRanges(ranges, context) {
        if (!Array.isArray(ranges) || !ranges.length) {
          return [];
        }
        var prefixLines = context && typeof context.prefixLineCount === 'number' ?
          context.prefixLineCount : prefixLineCount;
        var FoldingRangeKind = monaco.languages.FoldingRangeKind;
        var result = [];
        for (var i = 0; i < ranges.length; i++) {
          var r = ranges[i];
          if (!r || typeof r.startLine !== 'number' || typeof r.endLine !== 'number') {
            continue;
          }
          if (r.startLine < prefixLines) {
            continue;
          }
          var start = (r.startLine - prefixLines) + 1;
          var end = (r.endLine - prefixLines) + 1;
          if (end < start) {
            continue;
          }
          var kind = null;
          if (r.kind === 'comment') {
            kind = FoldingRangeKind.Comment;
          } else if (r.kind === 'imports') {
            kind = FoldingRangeKind.Imports;
          } else if (r.kind === 'region') {
            kind = FoldingRangeKind.Region;
          }
          result.push({
            start: start,
            end: end,
            kind: kind || undefined
          });
        }
        return result;
      }

      function shouldEnableLspFolding(lang) {
        return lang === 'html';
      }

      function mapCompletionKind(k) {
        var M = monaco.languages.CompletionItemKind;
        var numericMap = {
          1: M.Text,
          2: M.Method,
          3: M.Function,
          4: M.Constructor,
          5: M.Field,
          6: M.Variable,
          7: M.Class,
          8: M.Interface,
          9: M.Module,
          10: M.Property,
          11: M.Unit,
          12: M.Value,
          13: M.Enum,
          14: M.Keyword,
          15: M.Snippet,
          16: M.Color,
          17: M.File,
          18: M.Reference,
          19: M.Folder,
          20: M.EnumMember,
          21: M.Constant,
          22: M.Struct,
          23: M.Event,
          24: M.Operator,
          25: M.TypeParameter
        };
        if (typeof k === 'number') {
          if (numericMap[k]) {
            return numericMap[k];
          }
          var monacoKindValues = {};
          monacoKindValues[M.Text] = true;
          monacoKindValues[M.Method] = true;
          monacoKindValues[M.Function] = true;
          monacoKindValues[M.Constructor] = true;
          monacoKindValues[M.Field] = true;
          monacoKindValues[M.Variable] = true;
          monacoKindValues[M.Class] = true;
          monacoKindValues[M.Interface] = true;
          monacoKindValues[M.Module] = true;
          monacoKindValues[M.Property] = true;
          monacoKindValues[M.Unit] = true;
          monacoKindValues[M.Value] = true;
          monacoKindValues[M.Enum] = true;
          monacoKindValues[M.Keyword] = true;
          monacoKindValues[M.Snippet] = true;
          monacoKindValues[M.Color] = true;
          monacoKindValues[M.File] = true;
          monacoKindValues[M.Reference] = true;
          monacoKindValues[M.Folder] = true;
          monacoKindValues[M.EnumMember] = true;
          monacoKindValues[M.Constant] = true;
          monacoKindValues[M.Struct] = true;
          monacoKindValues[M.Event] = true;
          monacoKindValues[M.Operator] = true;
          monacoKindValues[M.TypeParameter] = true;
          if (monacoKindValues[k]) {
            return k;
          }
        }
        if (typeof k === 'string') {
          var key = k.toLowerCase();
          var stringMap = {
            text: M.Text,
            method: M.Method,
            function: M.Function,
            constructor: M.Constructor,
            field: M.Field,
            variable: M.Variable,
            class: M.Class,
            interface: M.Interface,
            module: M.Module,
            property: M.Property,
            unit: M.Unit,
            value: M.Value,
            enum: M.Enum,
            keyword: M.Keyword,
            snippet: M.Snippet,
            color: M.Color,
            file: M.File,
            reference: M.Reference,
            folder: M.Folder,
            enummember: M.EnumMember,
            constant: M.Constant,
            struct: M.Struct,
            event: M.Event,
            operator: M.Operator,
            typeparameter: M.TypeParameter
          };
          if (stringMap[key]) {
            return stringMap[key];
          }
        }
        return M.Text;
      }
      function track(disposable) {
        if (disposable && typeof disposable.dispose === 'function') {
          trackedDisposables.push(disposable);
        }
        return disposable;
      }
      function openInitialize() {
        var init = {
          jsonrpc: '2.0', id: nowId(), method: 'initialize', params: {
            processId: null,
            clientInfo: { name: 'lms-monaco', version: '0.1.0' },
            rootUri: workspaceUri || null,
            capabilities: {
              textDocument: {
                synchronization: {
                  dynamicRegistration: true,
                  willSave: true,
                  willSaveWaitUntil: true,
                  didSave: true
                },
                completion: { completionItem: { snippetSupport: true } },
                hover: {},
                publishDiagnostics: {
                  relatedInformation: true,
                  tagSupport: { valueSet: [1, 2] },
                  versionSupport: true
                },
                codeAction: {
                  dynamicRegistration: true,
                  codeActionLiteralSupport: {
                    codeActionKind: {
                      valueSet: [
                        '',
                        'quickfix',
                        'refactor',
                        'refactor.extract',
                        'refactor.inline',
                        'refactor.rewrite',
                        'source',
                        'source.organizeImports'
                      ]
                    }
                  },
                  dataSupport: true,
                  isPreferredSupport: true,
                  disabledSupport: true,
                  resolveSupport: {
                    properties: ['edit', 'command']
                  },
                  honorsChangeAnnotations: true
                },
                documentLink: {
                  dynamicRegistration: true,
                  tooltipSupport: true
                },
                codeLens: {
                  dynamicRegistration: true
                },
                callHierarchy: {
                  dynamicRegistration: true
                },
                typeHierarchy: {
                  dynamicRegistration: true
                },
                semanticTokens: {
                  dynamicRegistration: true,
                  requests: {
                    full: {
                      delta: true
                    }
                  },
                  tokenTypes: [
                    'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
                    'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method',
                    'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator'
                  ],
                  tokenModifiers: [
                    'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
                    'async', 'modification', 'documentation', 'defaultLibrary'
                  ],
                  formats: ['relative']
                }
              },
              workspace: {
                applyEdit: true,
                configuration: true,
                workspaceFolders: true,
                workspaceEdit: {
                  documentChanges: true,
                  resourceOperations: ['create', 'rename', 'delete']
                },
                didChangeWatchedFiles: {
                  dynamicRegistration: true
                },
                executeCommand: {
                  dynamicRegistration: true
                }
              }
            },
            workspaceFolders: workspaceFolders || []
          }
        };
        if (!workspaceFolders) {
          delete init.params.workspaceFolders;
        }
        pending[init.id] = {
          resolve: function (result) {
            send({ jsonrpc: '2.0', method: 'initialized', params: {} });
            // Send workspace configuration via didChangeConfiguration for LSP servers like sqls
            if (workspaceConfig) {
              send({
                jsonrpc: '2.0',
                method: 'workspace/didChangeConfiguration',
                params: {
                  settings: workspaceConfig
                }
              });
            }
            // For Java LSP (jdtls), configure to include commands in code actions
            // By default, jdtls assumes all buffers are auto-validated (validateAllOpenBuffersOnChanges=true)
            // and omits refresh commands. We need those commands for proper diagnostics refresh.
            if (options.language === 'java') {
              send({
                jsonrpc: '2.0',
                method: 'workspace/didChangeConfiguration',
                params: {
                  settings: {
                    java: {
                      edit: {
                        validateAllOpenBuffersOnChanges: false
                      }
                    }
                  }
                }
              });
            }
            // Connection was already added to pool when created (to prevent race conditions)
            // Re-open all models after reconnection
            for (var mi = 0; mi < sharedConnection.models.length; mi++) {
              var m = sharedConnection.models[mi];
              if (m && m.uri) {
                var uri = m.uri.toString();
                var prefixInfo = sharedConnection.modelPrefixes.get(uri) || { text: '', lineCount: 0 };
                send({
                  jsonrpc: '2.0',
                  method: 'textDocument/didOpen',
                  params: {
                    textDocument: {
                      uri: uri,
                      languageId: options.language || 'plaintext',
                      version: 1,
                      text: (prefixInfo.text || '') + m.getValue()
                    }
                  }
                });
              }
            }

            // Send any pending didOpen notifications for models registered during reconnection
            if (sharedConnection.pendingDidOpen && sharedConnection.pendingDidOpen.length > 0) {
              for (var i = 0; i < sharedConnection.pendingDidOpen.length; i++) {
                send(sharedConnection.pendingDidOpen[i]);
              }
              sharedConnection.pendingDidOpen = [];
            }
          },
          reject: function () {}
        };
        send(init);
      }
      function handleDiagnostics(params) {
        if (!params || !params.diagnostics) return;

        // Multi-model: find which model these diagnostics belong to
        var targetUri = params.uri;
        if (!targetUri) return;

        // Find the model in the shared connection
        var targetModel = null;
        var targetPrefixInfo = null;
        for (var mi = 0; mi < sharedConnection.models.length; mi++) {
          var m = sharedConnection.models[mi];
          if (m && m.uri && m.uri.toString() === targetUri) {
            targetModel = m;
            targetPrefixInfo = sharedConnection.modelPrefixes.get(targetUri) || { lineCount: 0 };
            break;
          }
        }

        if (!targetModel) return; // Model not found in connection

        var targetPrefixLineCount = targetPrefixInfo.lineCount || 0;
        var diags = [];
        for (var i=0;i<params.diagnostics.length;i++) {
          var d = params.diagnostics[i];
          if (!d || !d.range) continue;
          if (d.range.start.line < targetPrefixLineCount) continue;

          // Adjust range for this model's prefix
          var adjustedRange = {
            start: {
              line: Math.max(0, d.range.start.line - targetPrefixLineCount),
              character: d.range.start.character
            },
            end: {
              line: Math.max(0, d.range.end.line - targetPrefixLineCount),
              character: d.range.end.character
            }
          };

          var startLineNumber = adjustedRange.start.line + 1;
          var endLineNumber = adjustedRange.end.line + 1;
          if (startLineNumber < 1) startLineNumber = 1;
          if (endLineNumber < 1) endLineNumber = 1;
          if (targetModel) {
            var lineCount = targetModel.getLineCount();
            if (startLineNumber > lineCount) startLineNumber = lineCount;
            if (endLineNumber > lineCount) endLineNumber = lineCount;
          }

          var maxStartColumn = targetModel ? targetModel.getLineMaxColumn(startLineNumber) : null;
          var maxEndColumn = targetModel ? targetModel.getLineMaxColumn(endLineNumber) : null;
          var startColumn = adjustedRange.start.character + 1;
          var endColumn = adjustedRange.end.character + 1;
          if (maxStartColumn && startColumn > maxStartColumn) startColumn = maxStartColumn;
          if (maxEndColumn && endColumn > maxEndColumn) endColumn = maxEndColumn;
          if (startColumn < 1) startColumn = 1;
          if (endColumn < 1) endColumn = 1;

          diags.push({
            severity: monaco.MarkerSeverity[d.severity === 1 ? 'Error' : (d.severity === 2 ? 'Warning' : (d.severity === 3 ? 'Info' : 'Hint'))] || monaco.MarkerSeverity.Info,
            message: d.message || '',
            startLineNumber: startLineNumber,
            startColumn: startColumn,
            endLineNumber: endLineNumber,
            endColumn: endColumn
          });
        }
        monaco.editor.setModelMarkers(targetModel, 'lsp', diags);
        var filteredDiagnostics = params && params.diagnostics ? params.diagnostics.filter(function(d) {
          return d && d.range && d.range.start && d.range.start.line >= targetPrefixLineCount;
        }) : [];
        lastDiagnosticsByUri.set(targetUri, filteredDiagnostics);
      }

      function getPrefixInfoForModel(targetModel) {
        var fallback = { text: prefixText || '', lineCount: prefixLineCount || 0 };
        if (!targetModel || !targetModel.uri) {
          return fallback;
        }
        var uri = targetModel.uri.toString();
        var info = sharedConnection.modelPrefixes.get(uri);
        if (!info) {
          return fallback;
        }
        return {
          text: typeof info.text === 'string' ? info.text : fallback.text,
          lineCount: typeof info.lineCount === 'number' ? info.lineCount : fallback.lineCount
        };
      }

      function getUriForModel(targetModel) {
        if (targetModel && targetModel.uri) {
          return targetModel.uri.toString();
        }
        return (model && model.uri && model.uri.toString()) || toUri();
      }

      function buildRangeContext(targetModel) {
        var info = getPrefixInfoForModel(targetModel);
        return {
          model: targetModel || model,
          prefixLineCount: info.lineCount
        };
      }
      function notifyWorkspaceFoldersAdded() {
        if (!workspaceFoldersRegistered || !workspaceFolders || !workspaceFolders.length) {
          return;
        }
        send({
          jsonrpc: '2.0',
          method: 'workspace/didChangeWorkspaceFolders',
          params: {
            event: {
              added: workspaceFolders,
              removed: []
            }
          }
        });
      }

      // Register providers only once per language
      var providerKey = globalLspPool.makeKey(language, urlSimple);
      var shouldRegisterProviders = !globalRegisteredProviders[providerKey];
      if (shouldRegisterProviders) {
        globalRegisteredProviders[providerKey] = true;
      }

      // Providers
      if (shouldRegisterProviders) {
        var providerLanguage = options.language || 'plaintext';
        var baseTriggerCharacters = ['.', ':', '>', '"', '\'', '/', '\\'];
        var triggerCharacters = baseTriggerCharacters.slice();
        if (providerLanguage === 'html') {
          // Enable Emmet multiplier suggestions without manual trigger.
          triggerCharacters = triggerCharacters.concat(['*', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
        }
        var completionProvider = track(monaco.languages.registerCompletionItemProvider(providerLanguage, {
          triggerCharacters: triggerCharacters,
        provideCompletionItems: function (modelLocal, position) {
          var prefixInfo = getPrefixInfoForModel(modelLocal);
          var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
          var docUri = getUriForModel(modelLocal);
          var rangeContext = buildRangeContext(modelLocal);
          return request('textDocument/completion', { textDocument: { uri: docUri }, position: pos }).then(function (result) {
            var items = result && (result.items || result) || [];
            var suggestions = [];
            for (var i=0;i<items.length;i++) {
              var it = items[i] || {};
              // filter out prefix hits
              var line = (it.textEdit && it.textEdit.range && it.textEdit.range.start && it.textEdit.range.start.line) || (it.range && it.range.start && it.range.start.line) || pos.line;
              if (line < prefixInfo.lineCount) continue;
              var insertTextSource = (it.textEdit && typeof it.textEdit.newText === 'string') ? it.textEdit.newText :
                (typeof it.insertText === 'string' ? it.insertText : it.label || '');
              var insertText = String(insertTextSource || '');
              var isSnippet = (it.insertTextFormat === 2 || it.insertTextFormat === 'snippet');
              var sug = {
                label: String(it.label || ''),
                kind: mapCompletionKind(it.kind),
                insertText: insertText,
                range: it.textEdit && it.textEdit.range ? monacoRangeFromLsp(it.textEdit.range, rangeContext) : undefined,
                detail: it.detail,
                documentation: it.documentation && (typeof it.documentation === 'string' ? { value: it.documentation } : it.documentation),
                sortText: typeof it.sortText === 'string' ? it.sortText : undefined,
                filterText: typeof it.filterText === 'string' ? it.filterText : undefined
              };
              if (Array.isArray(it.additionalTextEdits) && it.additionalTextEdits.length) {
                sug.additionalTextEdits = it.additionalTextEdits.map(function (ed) {
                  return {
                    range: ed.range ? monacoRangeFromLsp(ed.range, rangeContext) : undefined,
                    text: ed.newText || ''
                  };
                }).filter(function (ed) { return ed.range; });
              }
              if (it.preselect) {
                sug.preselect = true;
              }
              if (isSnippet) {
                sug.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
              }
              suggestions.push(sug);
            }
            if (!suggestions.length) {
              return null;
            }
            return { suggestions: suggestions, dispose: function () {} };
          }).catch(function () { return null; });
        }
      }));

      var hoverProvider = track(monaco.languages.registerHoverProvider(options.language || 'plaintext', {
        provideHover: function (modelLocal, position) {
          var prefixInfo = getPrefixInfoForModel(modelLocal);
          var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
          var docUri = getUriForModel(modelLocal);
          var rangeContext = buildRangeContext(modelLocal);
          return request('textDocument/hover', { textDocument: { uri: docUri }, position: pos }).then(function (res) {
            if (!res) return null;
            var rng = res.range ? monacoRangeFromLsp(res.range, rangeContext) : null;
            var contents = [];
            if (res.contents) {
              if (typeof res.contents === 'string') contents.push({ value: res.contents });
              else if (Array.isArray(res.contents)) {
                for (var i=0;i<res.contents.length;i++) {
                  var c = res.contents[i]; if (!c) continue;
                  contents.push(typeof c === 'string' ? { value: c } : c);
                }
              } else if (res.contents.value) contents.push({ value: res.contents.value });
            }
            return { contents: contents, range: rng };
          }).catch(function () { return null; });
        }
      }));

      if (shouldEnableLspFolding(options.language || 'plaintext')) {
        track(monaco.languages.registerFoldingRangeProvider(options.language || 'plaintext', {
          provideFoldingRanges: function(modelLocal) {
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/foldingRange', { textDocument: { uri: docUri } })
              .then(function(ranges) {
                return toMonacoFoldingRanges(ranges, rangeContext);
              })
              .catch(function () { return []; });
          }
        }));
      }

      if (monaco.languages.registerInlayHintsProvider) {
        track(monaco.languages.registerInlayHintsProvider(options.language || 'plaintext', {
          provideInlayHints: function(modelLocal, range) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            var params = { textDocument: { uri: docUri } };
            if (range) {
              params.range = {
                start: { line: (range.startLineNumber - 1) + prefixInfo.lineCount, character: range.startColumn - 1 },
                end: { line: (range.endLineNumber - 1) + prefixInfo.lineCount, character: range.endColumn - 1 }
              };
            }
            return request('textDocument/inlayHint', params).then(function(res) {
              return { hints: toMonacoInlayHints(res, rangeContext), dispose: function () {} };
            }).catch(function() {
              return { hints: [], dispose: function () {} };
            });
          }
        }));
      }

      if (options.richFeatures) {
        track(monaco.languages.registerDefinitionProvider(options.language || 'plaintext', {
          provideDefinition: function(modelLocal, position) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
            var docUri = getUriForModel(modelLocal);
            var context = buildRangeContext(modelLocal);
            return request('textDocument/definition', { textDocument: { uri: docUri }, position: pos })
              .then(function(results) {
                return toMonacoLocations(results, context);
              })
              .catch(function () { return []; });
          }
        }));
        if (monaco.languages.registerDeclarationProvider) {
          track(monaco.languages.registerDeclarationProvider(options.language || 'plaintext', {
            provideDeclaration: function(modelLocal, position) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
              var docUri = getUriForModel(modelLocal);
              var context = buildRangeContext(modelLocal);
              return request('textDocument/declaration', { textDocument: { uri: docUri }, position: pos })
                .then(function(results) {
                  return toMonacoLocations(results, context);
                })
                .catch(function () { return []; });
            }
          }));
        }
        if (monaco.languages.registerTypeDefinitionProvider) {
          track(monaco.languages.registerTypeDefinitionProvider(options.language || 'plaintext', {
            provideTypeDefinition: function(modelLocal, position) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
              var docUri = getUriForModel(modelLocal);
              var context = buildRangeContext(modelLocal);
              return request('textDocument/typeDefinition', { textDocument: { uri: docUri }, position: pos })
                .then(function(results) {
                  return toMonacoLocations(results, context);
                })
                .catch(function () { return []; });
            }
          }));
        }
        if (monaco.languages.registerImplementationProvider) {
          track(monaco.languages.registerImplementationProvider(options.language || 'plaintext', {
            provideImplementation: function(modelLocal, position) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
              var docUri = getUriForModel(modelLocal);
              var context = buildRangeContext(modelLocal);
              return request('textDocument/implementation', { textDocument: { uri: docUri }, position: pos })
                .then(function(results) {
                  return toMonacoLocations(results, context);
                })
                .catch(function () { return []; });
            }
          }));
        }

        track(monaco.languages.registerReferenceProvider(options.language || 'plaintext', {
          provideReferences: function(modelLocal, position, context) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/references', {
              textDocument: { uri: docUri },
              position: pos,
              context: { includeDeclaration: !!(context && context.includeDeclaration) }
            }).then(function(results) {
              return toMonacoLocations(results, rangeContext);
            }).catch(function () { return []; });
          }
        }));

        track(monaco.languages.registerDocumentHighlightProvider(options.language || 'plaintext', {
          provideDocumentHighlights: function(modelLocal, position) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/documentHighlight', { textDocument: { uri: docUri }, position: pos })
              .then(function(items) {
                return toMonacoHighlights(items, rangeContext);
              })
              .catch(function () { return []; });
          }
        }));
        if (monaco.languages.registerSelectionRangeProvider) {
          track(monaco.languages.registerSelectionRangeProvider(options.language || 'plaintext', {
            provideSelectionRanges: function(modelLocal, positions) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var docUri = getUriForModel(modelLocal);
              var rangeContext = buildRangeContext(modelLocal);
              var params = {
                textDocument: { uri: docUri },
                positions: positions.map(function(pos) {
                  return lspPositionFromMonaco(pos, prefixInfo.lineCount);
                })
              };
              return request('textDocument/selectionRange', params).then(function(res) {
                return toMonacoSelectionRanges(res, rangeContext);
              }).catch(function () { return []; });
            }
          }));
        }

        track(monaco.languages.registerDocumentSymbolProvider(options.language || 'plaintext', {
          provideDocumentSymbols: function(modelLocal) {
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/documentSymbol', { textDocument: { uri: docUri } })
              .then(function(symbols) {
                return toMonacoSymbols(symbols, rangeContext);
              })
              .catch(function () { return []; });
          }
        }));
        if (monaco.languages.registerWorkspaceSymbolProvider) {
          track(monaco.languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: function(query) {
              var rangeContext = buildRangeContext(model);
              return request('workspace/symbol', { query: query || '' })
                .then(function(symbols) {
                  return toMonacoWorkspaceSymbols(symbols, rangeContext);
                })
                .catch(function () { return []; });
            }
          }));
        }

        track(monaco.languages.registerSignatureHelpProvider(options.language || 'plaintext', {
          signatureHelpTriggerCharacters: ['(', ',', '<'],
          provideSignatureHelp: function(modelLocal, position) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
            var docUri = getUriForModel(modelLocal);
            return request('textDocument/signatureHelp', { textDocument: { uri: docUri }, position: pos })
              .then(function(res) {
                var converted = toMonacoSignatureHelp(res);
                if (!converted || !converted.signatures || !converted.signatures.length) {
                  return null;
                }
                var hasContent = false;
                for (var i = 0; i < converted.signatures.length; i++) {
                  var sig = converted.signatures[i];
                  if ((sig.label && sig.label.trim()) ||
                    (Array.isArray(sig.parameters) && sig.parameters.length)) {
                    hasContent = true;
                    break;
                  }
                }
                if (!hasContent) {
                  return null;
                }
                return { value: converted, dispose: function () {} };
              })
              .catch(function () { return null; });
          }
        }));

        track(monaco.languages.registerRenameProvider(options.language || 'plaintext', {
          provideRenameEdits: function(modelLocal, position, newName) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/rename', {
              textDocument: { uri: docUri },
              position: pos,
              newName: newName
            }).then(function(result) {
              return convertWorkspaceEdit(result, rangeContext);
            }).catch(function(err) {
              if (err && err.message) {
                throw err;
              }
              throw new Error('Rename request failed');
            });
          },
          resolveRenameLocation: function(modelLocal, position) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/prepareRename', {
              textDocument: { uri: docUri },
              position: pos
            }).then(function (res) {
              if (!res) return null;
              var range = res.range ? monacoRangeFromLsp(res.range, rangeContext) : null;
              return range ? { range: range, text: res.placeholder } : null;
            }).catch(function () { return null; });
          }
        }));
        if (monaco.languages.registerLinkedEditingRangeProvider) {
          track(monaco.languages.registerLinkedEditingRangeProvider(options.language || 'plaintext', {
            provideLinkedEditingRanges: function(modelLocal, position) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
              var docUri = getUriForModel(modelLocal);
              var rangeContext = buildRangeContext(modelLocal);
              return request('textDocument/linkedEditingRange', {
                textDocument: { uri: docUri },
                position: pos
              }).then(function(result) {
                if (!result || !result.ranges) return null;
                var ranges = [];
                for (var i = 0; i < result.ranges.length; i++) {
                  var range = monacoRangeFromLsp(result.ranges[i], rangeContext);
                  if (range) ranges.push(range);
                }
                return ranges.length > 0 ? { ranges: ranges, wordPattern: result.wordPattern } : null;
              }).catch(function () { return null; });
            }
          }));
        }
        if (monaco.languages.registerOnTypeFormattingEditProvider) {
          var triggerChars = Array.isArray(options.onTypeFormattingTriggers) && options.onTypeFormattingTriggers.length
            ? options.onTypeFormattingTriggers
            : [';', '\n', '}'];
          track(monaco.languages.registerOnTypeFormattingEditProvider(options.language || 'plaintext', {
            autoFormatTriggerCharacters: triggerChars,
            provideOnTypeFormattingEdits: function(modelLocal, position, ch, optionsLocal) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              if (prefixInfo.lineCount > 0) {
                return [];
              }
              var docUri = getUriForModel(modelLocal);
              var targetModel = modelLocal || model;
              var rangeContext = buildRangeContext(modelLocal);
              return request('textDocument/onTypeFormatting', {
                textDocument: { uri: docUri },
                position: lspPositionFromMonaco(position, prefixInfo.lineCount),
                ch: ch,
                options: {
                  tabSize: optionsLocal.tabSize || targetModel.getOptions().tabSize,
                  insertSpaces: typeof optionsLocal.insertSpaces === 'boolean'
                    ? optionsLocal.insertSpaces
                    : targetModel.getOptions().insertSpaces
                }
              }).then(function(edits) {
                return toMonacoEdits(edits, rangeContext);
              }).catch(function () { return []; });
            }
          }));
        }

        track(monaco.languages.registerDocumentFormattingEditProvider(options.language || 'plaintext', {
          provideDocumentFormattingEdits: function(modelLocal, optionsLocal) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            if (prefixInfo.lineCount > 0) {
              return [];
            }
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            var targetModel = modelLocal || model;
            return request('textDocument/formatting', {
              textDocument: { uri: docUri },
              options: {
                tabSize: optionsLocal.tabSize || targetModel.getOptions().tabSize,
                insertSpaces: typeof optionsLocal.insertSpaces === 'boolean'
                  ? optionsLocal.insertSpaces
                  : targetModel.getOptions().insertSpaces,
                trimTrailingWhitespace: true,
                insertFinalNewline: true,
                trimFinalNewlines: true
              }
            }).then(function(edits) {
              return toMonacoEdits(edits, rangeContext);
            }).catch(function () { return []; });
          }
        }));

        track(monaco.languages.registerDocumentRangeFormattingEditProvider(options.language || 'plaintext', {
          provideDocumentRangeFormattingEdits: function(modelLocal, range, optionsLocal) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            if (prefixInfo.lineCount > 0) {
              return [];
            }
            var docUri = getUriForModel(modelLocal);
            var targetModel = modelLocal || model;
            var rangeContext = buildRangeContext(modelLocal);
            return request('textDocument/rangeFormatting', {
              textDocument: { uri: docUri },
              range: {
                start: { line: (range.startLineNumber - 1) + prefixInfo.lineCount, character: range.startColumn - 1 },
                end: { line: (range.endLineNumber - 1) + prefixInfo.lineCount, character: range.endColumn - 1 }
              },
              options: {
                tabSize: optionsLocal.tabSize || targetModel.getOptions().tabSize,
                insertSpaces: typeof optionsLocal.insertSpaces === 'boolean'
                  ? optionsLocal.insertSpaces
                  : targetModel.getOptions().insertSpaces
              }
            }).then(function(edits) {
              return toMonacoEdits(edits, rangeContext);
            }).catch(function () { return []; });
          }
        }));

        track(monaco.languages.registerCodeActionProvider(options.language || 'plaintext', {
          provideCodeActions: function(modelLocal, range, context) {
            var prefixInfo = getPrefixInfoForModel(modelLocal);
            var docUri = getUriForModel(modelLocal);
            var rangeContext = buildRangeContext(modelLocal);
            var diagKey = docUri;
            var diagnosticsPayload = lastDiagnosticsByUri.get(diagKey) || [];

            // Map Monaco's trigger to LSP's triggerKind
            // Monaco: 1 = Invoke (manual), 2 = Auto (automatic)
            // LSP: 1 = Invoked, 2 = Automatic
            var triggerKind = context && context.trigger !== undefined ? context.trigger : 2;

            // Build LSP context with code action kinds
            var lspContext = {
              diagnostics: diagnosticsPayload,
              triggerKind: triggerKind
            };

            // If Monaco provides requested action kinds, pass them to LSP
            // Monaco may provide 'only' as a string or array, LSP requires array
            if (context && context.only) {
              lspContext.only = Array.isArray(context.only) ? context.only : [context.only];
            }

            var params = {
              textDocument: { uri: docUri },
              range: {
                start: { line: (range.startLineNumber - 1) + prefixInfo.lineCount, character: range.startColumn - 1 },
                end: { line: (range.endLineNumber - 1) + prefixInfo.lineCount, character: range.endColumn - 1 }
              },
              context: lspContext
            };
            return request('textDocument/codeAction', params).then(function(res) {
              if (!res) {
                return { actions: [], dispose: function () {} };
              }
              var actions = [];
              var arr = Array.isArray(res) ? res : [];

              for (var i = 0; i < arr.length; i++) {
                var item = arr[i];
                if (!item) continue;
                var title = item.title || (item.command && item.command.title) || 'Code Action';
              var monacoAction = {
                title: title,
                diagnostics: context && context.markers ? context.markers : [],
                kind: item.kind,
                isPreferred: !!item.isPreferred
              };

              // Preserve LSP data field for code action resolve
              // The data field is used by the LSP server to resolve the full code action later
              // IMPORTANT: We must include command if present, as the server expects it to be echoed back
              if (item.data) {
                monacoAction._lspData = {
                  title: item.title,
                  kind: item.kind,
                  data: item.data,
                  diagnostics: item.diagnostics
                };
                // Include command if present - server will echo it back in resolve response
                if (item.command) {
                  monacoAction._lspData.command = item.command;
                }
              }

              // First, check for direct edit
              if (item.edit) {
                monacoAction.edit = convertWorkspaceEdit(item.edit, rangeContext);
              }

              // Then check if there's a workspace edit in arguments (command-based code actions)
              // Note: item.command is an object {command, title, arguments}, not a string
              if (!monacoAction.edit && item.arguments && Array.isArray(item.arguments)) {
              try {
                if (item.arguments && Array.isArray(item.arguments)) {
                  item.arguments.forEach(function(arg, argIdx) {
                  });
                }
              } catch (e) {}
                for (var argIndex = 0; argIndex < item.arguments.length; argIndex++) {
                  var argument = item.arguments[argIndex];
                  if (argument && (argument.changes || argument.documentChanges)) {
                    monacoAction.edit = convertWorkspaceEdit(argument, rangeContext);
                  try {
                  } catch (e) {}
                    break;
                  }
                }
              }

              // Store command to execute after edit is applied (LSP protocol)
              // Code actions can have both edit and command - edit is applied first, then command is executed
              if (item.command) {
                monacoAction._lspCommand = item.command;
                // Convert LSP command to Monaco command format
                // Monaco expects: {id, title, arguments}
                // LSP provides: {command, title, arguments}
                monacoAction.command = {
                  id: EXECUTE_COMMAND_ID,
                  title: item.command.title || item.title,
                  arguments: [item.command]
                };
              }

              // Add actions that have a valid edit OR have data for resolve
              // Actions with _lspData will be resolved when selected via resolveCodeAction
              var hasEdit = monacoAction.edit && monacoAction.edit.edits && monacoAction.edit.edits.length > 0;
              var needsResolve = !!monacoAction._lspData;

              if (hasEdit || needsResolve) {
                // If action needs resolve, we'll handle it in resolveCodeAction method
                if (needsResolve && !hasEdit) {
                  actions.push(monacoAction);
                } else if (hasEdit) {
                  // Extract URIs from the workspace edit to know which files will be modified
                  var targetUris = [];
                  var currentFileUri = toUri();
                  for (var ei = 0; ei < monacoAction.edit.edits.length; ei++) {
                    var editResource = monacoAction.edit.edits[ei].resource;
                    if (editResource) {
                      var uriString = editResource.toString();
                      if (targetUris.indexOf(uriString) === -1) {
                        targetUris.push(uriString);
                      }
                    }
                  }

                  // Check if this edit modifies OTHER files (not the current file)
                  var modifiesOtherFiles = targetUris.some(function(uri) {
                    return uri !== currentFileUri;
                  });

                  // Store command for execution after workspace edit
                  if (monacoAction._lspCommand) {
                    // Store command for each target URI
                    // When any of these files change, the command should be executed
                    for (var ui = 0; ui < targetUris.length; ui++) {
                      var targetUri = targetUris[ui];
                      if (!pendingCommandsByUri.has(targetUri)) {
                        pendingCommandsByUri.set(targetUri, []);
                      }
                      pendingCommandsByUri.get(targetUri).push({
                        command: monacoAction._lspCommand,
                        timestamp: Date.now(),
                        originFile: currentFileUri
                      });
                    }

                    // Also keep in global array for backward compatibility
                    pendingCodeActionCommands.push({
                      command: monacoAction._lspCommand,
                      timestamp: Date.now(),
                      targetUris: targetUris
                    });
                    var cmdName = typeof monacoAction._lspCommand === 'string' ? monacoAction._lspCommand :
                      (monacoAction._lspCommand.command || 'unknown');
                  } else if (modifiesOtherFiles) {
                    // No explicit command, but this edit modifies other files
                    // For Java LSP (jdtls), we should trigger a diagnostic refresh on the current file
                    // after the other files are modified
                    notifyWorkspaceEditWillAffect({ targetFiles: targetUris, originFile: currentFileUri });
                  }
                  actions.push(monacoAction);
                }
              } else if (monacoAction.command) {
                // Command-only action (no edit, no resolve needed)
                // These actions execute a command immediately when selected
                actions.push(monacoAction);
              }
            }
            try {
              actions.forEach(function(action, idx) {
              });
            } catch (e) {}
            return { actions: actions, dispose: function () {} };
            }).catch(function () {
              // Silently ignore all code action errors (not_connected, LSP internal errors, etc.)
              // These are not actionable by users
              return { actions: [], dispose: function () {} };
            });
          },

          resolveCodeAction: function(codeAction, token) {

            // If action has _lspData, send resolve request to LSP server
            // NOTE: Even if action has an edit, we still need to resolve it to get the command field!
            // LSP spec allows CodeActions to have both edit and command, and both can be lazy-loaded
            if (codeAction._lspData) {

              return request('codeAction/resolve', codeAction._lspData).then(function(resolved) {

                var rangeContext = {
                  startLine: 0,
                  startCol: 0,
                  endLine: 0,
                  endCol: 0
                };

                // Convert resolved edit to Monaco format
                if (resolved.edit) {
                  var converted = convertWorkspaceEdit(resolved.edit, rangeContext);

                  // Handle file operations immediately (they need to be applied before text edits)
                  if (converted && converted.fileOperations) {
                    converted.fileOperations.forEach(function(op) {
                      if (op.kind === 'create') {
                        notifyWorkspaceEditApplied({
                          kind: 'create',
                          uri: op.resource.toString(),
                          initialContent: op.initialContent,
                          options: op.options
                        });
                      }
                    });
                  }

                  // Only assign text edits to codeAction.edit for Monaco
                  codeAction.edit = converted && converted.edits && converted.edits.length > 0
                    ? { edits: converted.edits }
                    : null;

                }

                // Store resolved command for execution after edit
                if (resolved.command) {
                  codeAction._lspCommand = resolved.command;
                  // Convert LSP command to Monaco command format
                  codeAction.command = {
                    id: EXECUTE_COMMAND_ID,
                    title: resolved.command.title || codeAction.title,
                    arguments: [resolved.command]
                  };

                  // If edit was resolved, set up command execution after edit is applied
                  if (codeAction.edit && codeAction.edit.edits && codeAction.edit.edits.length > 0) {
                    var currentFileUri = toUri();
                    var targetUris = [];
                    for (var ei = 0; ei < codeAction.edit.edits.length; ei++) {
                      var editResource = codeAction.edit.edits[ei].resource;
                      if (editResource) {
                        var uriString = editResource.toString();
                        if (targetUris.indexOf(uriString) === -1) {
                          targetUris.push(uriString);
                        }
                      }
                    }

                    // Store command for each target URI
                    for (var ui = 0; ui < targetUris.length; ui++) {
                      var targetUri = targetUris[ui];
                      if (!pendingCommandsByUri.has(targetUri)) {
                        pendingCommandsByUri.set(targetUri, []);
                      }
                      pendingCommandsByUri.get(targetUri).push({
                        command: resolved.command,
                        timestamp: Date.now(),
                        originFile: currentFileUri
                      });
                    }

                    // Also keep in global array so applyWorkspaceEdit executes it
                    pendingCodeActionCommands.push({
                      command: resolved.command,
                      timestamp: Date.now(),
                      targetUris: targetUris
                    });

                  }
                }

                return codeAction;
              }).catch(function(err) {
                return codeAction;
              });
            }

            // No resolve needed
            return codeAction;
          }
        }));

        // Document Link Provider - Makes imports/includes/URLs clickable
        if (monaco.languages.registerLinkProvider) {
          track(monaco.languages.registerLinkProvider(options.language || 'plaintext', {
            provideLinks: function(modelLocal) {
              var docUri = getUriForModel(modelLocal);
              var rangeContext = buildRangeContext(modelLocal);
              return request('textDocument/documentLink', { textDocument: { uri: docUri } })
                .then(function(links) {
                  if (!links || !Array.isArray(links)) return { links: [] };
                  var monacoLinks = [];
                  for (var i = 0; i < links.length; i++) {
                    var link = links[i];
                    if (!link || !link.range) continue;
                    var range = monacoRangeFromLsp(link.range, rangeContext);
                    if (!range) continue;
                    var monacoLink = {
                      range: range,
                      url: link.target || link.tooltip
                    };
                    if (link.tooltip) {
                      monacoLink.tooltip = link.tooltip;
                    }
                    monacoLinks.push(monacoLink);
                  }
                  return { links: monacoLinks };
                })
                .catch(function() { return { links: [] }; });
            }
          }));
        }

        // Code Lens Provider - Shows inline reference counts and actions
        if (monaco.languages.registerCodeLensProvider) {
          track(monaco.languages.registerCodeLensProvider(options.language || 'plaintext', {
            provideCodeLenses: function(modelLocal) {
              var docUri = getUriForModel(modelLocal);
              var rangeContext = buildRangeContext(modelLocal);
              return request('textDocument/codeLens', { textDocument: { uri: docUri } })
                .then(function(lenses) {
                  if (!lenses || !Array.isArray(lenses)) return { lenses: [], dispose: function() {} };
                  var monacoLenses = [];
                  for (var i = 0; i < lenses.length; i++) {
                    var lens = lenses[i];
                    if (!lens || !lens.range) continue;
                    var range = monacoRangeFromLsp(lens.range, rangeContext);
                    if (!range) continue;
                    var monacoLens = {
                      range: range,
                      _lspData: lens
                    };
                    if (lens.command) {
                      monacoLens.command = {
                        id: lens.command.command,
                        title: lens.command.title,
                        arguments: lens.command.arguments
                      };
                    }
                    monacoLenses.push(monacoLens);
                  }
                  return { lenses: monacoLenses, dispose: function() {} };
                })
                .catch(function() { return { lenses: [], dispose: function() {} }; });
            },
            resolveCodeLens: function(modelLocal, codeLens) {
              if (!codeLens._lspData || !codeLens._lspData.data) {
                return codeLens;
              }
              return request('codeLens/resolve', codeLens._lspData)
                .then(function(resolved) {
                  if (resolved && resolved.command) {
                    codeLens.command = {
                      id: resolved.command.command,
                      title: resolved.command.title,
                      arguments: resolved.command.arguments
                    };
                  }
                  return codeLens;
                })
                .catch(function() { return codeLens; });
            }
          }));
        }

        // Call Hierarchy Provider - Navigate function call chains
        if (monaco.languages.registerCallHierarchyProvider) {
          track(monaco.languages.registerCallHierarchyProvider(options.language || 'plaintext', {
            prepareCallHierarchy: function(modelLocal, position) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
              var docUri = getUriForModel(modelLocal);
              var rangeContext = buildRangeContext(modelLocal);
              return request('textDocument/prepareCallHierarchy', {
                textDocument: { uri: docUri },
                position: pos
              }).then(function(items) {
                if (!items) return [];
                var arr = Array.isArray(items) ? items : [items];
                var result = [];
                for (var i = 0; i < arr.length; i++) {
                  var item = arr[i];
                  if (!item) continue;
                  var uri = monaco.Uri.parse(item.uri);
                  var range = monacoRangeFromLsp(item.range, rangeContext);
                  var selectionRange = monacoRangeFromLsp(item.selectionRange, rangeContext);
                  if (!range || !selectionRange) continue;
                  result.push({
                    kind: item.kind || monaco.languages.SymbolKind.Function,
                    name: item.name,
                    detail: item.detail || '',
                    uri: uri,
                    range: range,
                    selectionRange: selectionRange,
                    _lspData: item
                  });
                }
                return result;
              }).catch(function() { return []; });
            },
            provideCallHierarchyIncomingCalls: function(modelLocal, item) {
              if (!item._lspData) return [];
              var rangeContext = buildRangeContext(modelLocal);
              return request('callHierarchy/incomingCalls', item._lspData)
                .then(function(calls) {
                  if (!calls || !Array.isArray(calls)) return [];
                  var result = [];
                  for (var i = 0; i < calls.length; i++) {
                    var call = calls[i];
                    if (!call || !call.from) continue;
                    var fromItem = call.from;
                    var uri = monaco.Uri.parse(fromItem.uri);
                    var range = monacoRangeFromLsp(fromItem.range, rangeContext);
                    var selectionRange = monacoRangeFromLsp(fromItem.selectionRange, rangeContext);
                    if (!range || !selectionRange) continue;
                    var fromRanges = [];
                    if (call.fromRanges && Array.isArray(call.fromRanges)) {
                      for (var j = 0; j < call.fromRanges.length; j++) {
                        var fr = monacoRangeFromLsp(call.fromRanges[j], rangeContext);
                        if (fr) fromRanges.push(fr);
                      }
                    }
                    result.push({
                      from: {
                        kind: fromItem.kind || monaco.languages.SymbolKind.Function,
                        name: fromItem.name,
                        detail: fromItem.detail || '',
                        uri: uri,
                        range: range,
                        selectionRange: selectionRange,
                        _lspData: fromItem
                      },
                      fromRanges: fromRanges
                    });
                  }
                  return result;
                }).catch(function() { return []; });
            },
            provideCallHierarchyOutgoingCalls: function(modelLocal, item) {
              if (!item._lspData) return [];
              var rangeContext = buildRangeContext(modelLocal);
              return request('callHierarchy/outgoingCalls', item._lspData)
                .then(function(calls) {
                  if (!calls || !Array.isArray(calls)) return [];
                  var result = [];
                  for (var i = 0; i < calls.length; i++) {
                    var call = calls[i];
                    if (!call || !call.to) continue;
                    var toItem = call.to;
                    var uri = monaco.Uri.parse(toItem.uri);
                    var range = monacoRangeFromLsp(toItem.range, rangeContext);
                    var selectionRange = monacoRangeFromLsp(toItem.selectionRange, rangeContext);
                    if (!range || !selectionRange) continue;
                    var fromRanges = [];
                    if (call.fromRanges && Array.isArray(call.fromRanges)) {
                      for (var j = 0; j < call.fromRanges.length; j++) {
                        var fr = monacoRangeFromLsp(call.fromRanges[j], rangeContext);
                        if (fr) fromRanges.push(fr);
                      }
                    }
                    result.push({
                      to: {
                        kind: toItem.kind || monaco.languages.SymbolKind.Function,
                        name: toItem.name,
                        detail: toItem.detail || '',
                        uri: uri,
                        range: range,
                        selectionRange: selectionRange,
                        _lspData: toItem
                      },
                      fromRanges: fromRanges
                    });
                  }
                  return result;
                }).catch(function() { return []; });
            }
          }));
        }

        // Type Hierarchy Provider - Navigate class inheritance
        if (monaco.languages.registerTypeHierarchyProvider) {
          track(monaco.languages.registerTypeHierarchyProvider(options.language || 'plaintext', {
            prepareTypeHierarchy: function(modelLocal, position) {
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              var pos = lspPositionFromMonaco(position, prefixInfo.lineCount);
              var docUri = getUriForModel(modelLocal);
              var rangeContext = buildRangeContext(modelLocal);
              return request('textDocument/prepareTypeHierarchy', {
                textDocument: { uri: docUri },
                position: pos
              }).then(function(items) {
                if (!items) return [];
                var arr = Array.isArray(items) ? items : [items];
                var result = [];
                for (var i = 0; i < arr.length; i++) {
                  var item = arr[i];
                  if (!item) continue;
                  var uri = monaco.Uri.parse(item.uri);
                  var range = monacoRangeFromLsp(item.range, rangeContext);
                  var selectionRange = monacoRangeFromLsp(item.selectionRange, rangeContext);
                  if (!range || !selectionRange) continue;
                  result.push({
                    kind: item.kind || monaco.languages.SymbolKind.Class,
                    name: item.name,
                    detail: item.detail || '',
                    uri: uri,
                    range: range,
                    selectionRange: selectionRange,
                    _lspData: item
                  });
                }
                return result;
              }).catch(function() { return []; });
            },
            provideTypeHierarchySupertypes: function(modelLocal, item) {
              if (!item._lspData) return [];
              var rangeContext = buildRangeContext(modelLocal);
              return request('typeHierarchy/supertypes', item._lspData)
                .then(function(items) {
                  if (!items || !Array.isArray(items)) return [];
                  var result = [];
                  for (var i = 0; i < items.length; i++) {
                    var superItem = items[i];
                    if (!superItem) continue;
                    var uri = monaco.Uri.parse(superItem.uri);
                    var range = monacoRangeFromLsp(superItem.range, rangeContext);
                    var selectionRange = monacoRangeFromLsp(superItem.selectionRange, rangeContext);
                    if (!range || !selectionRange) continue;
                    result.push({
                      kind: superItem.kind || monaco.languages.SymbolKind.Class,
                      name: superItem.name,
                      detail: superItem.detail || '',
                      uri: uri,
                      range: range,
                      selectionRange: selectionRange,
                      _lspData: superItem
                    });
                  }
                  return result;
                }).catch(function() { return []; });
            },
            provideTypeHierarchySubtypes: function(modelLocal, item) {
              if (!item._lspData) return [];
              var rangeContext = buildRangeContext(modelLocal);
              return request('typeHierarchy/subtypes', item._lspData)
                .then(function(items) {
                  if (!items || !Array.isArray(items)) return [];
                  var result = [];
                  for (var i = 0; i < items.length; i++) {
                    var subItem = items[i];
                    if (!subItem) continue;
                    var uri = monaco.Uri.parse(subItem.uri);
                    var range = monacoRangeFromLsp(subItem.range, rangeContext);
                    var selectionRange = monacoRangeFromLsp(subItem.selectionRange, rangeContext);
                    if (!range || !selectionRange) continue;
                    result.push({
                      kind: subItem.kind || monaco.languages.SymbolKind.Class,
                      name: subItem.name,
                      detail: subItem.detail || '',
                      uri: uri,
                      range: range,
                      selectionRange: selectionRange,
                      _lspData: subItem
                    });
                  }
                  return result;
                }).catch(function() { return []; });
            }
          }));
        }

        // Semantic Tokens Provider - Enhanced syntax highlighting
        if (monaco.languages.registerDocumentSemanticTokensProvider) {
          var semanticTokensLegend = null;

          // Helper to build legend from server capabilities
          var getSemanticTokensLegend = function() {
            if (semanticTokensLegend) return semanticTokensLegend;

            // Default legend if server doesn't provide one
            // These match common LSP semantic token types
            semanticTokensLegend = {
              tokenTypes: [
                'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
                'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method',
                'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator'
              ],
              tokenModifiers: [
                'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
                'async', 'modification', 'documentation', 'defaultLibrary'
              ]
            };
            return semanticTokensLegend;
          };

          track(monaco.languages.registerDocumentSemanticTokensProvider(options.language || 'plaintext', {
            getLegend: function() {
              return getSemanticTokensLegend();
            },
            provideDocumentSemanticTokens: function(modelLocal) {
              var docUri = getUriForModel(modelLocal);
              var prefixInfo = getPrefixInfoForModel(modelLocal);
              return request('textDocument/semanticTokens/full', { textDocument: { uri: docUri } })
                .then(function(result) {
                  if (!result || !result.data || !Array.isArray(result.data)) {
                    return { data: new Uint32Array(0) };
                  }

                  // LSP semantic tokens format: [deltaLine, deltaStart, length, tokenType, tokenModifiers]
                  // Need to adjust for prefix lines
                  var data = result.data;
                  var adjusted = [];
                  var currentLine = 0;
                  var lastMonacoLine = 0;

                  for (var i = 0; i < data.length; i += 5) {
                    var deltaLine = data[i];
                    var deltaStart = data[i + 1];
                    var length = data[i + 2];
                    var tokenType = data[i + 3];
                    var tokenModifiers = data[i + 4];

                    currentLine += deltaLine;

                    // Skip tokens in prefix region
                    if (currentLine < prefixInfo.lineCount) continue;

                    // Adjust line number for Monaco (subtract prefix)
                    var monacoLine = currentLine - prefixInfo.lineCount;
                    var monacoLineDelta = monacoLine - lastMonacoLine;

                    adjusted.push(monacoLineDelta);
                    adjusted.push(deltaStart);
                    adjusted.push(length);
                    adjusted.push(tokenType);
                    adjusted.push(tokenModifiers);

                    lastMonacoLine = monacoLine;
                  }

                  return { data: new Uint32Array(adjusted), resultId: result.resultId };
                })
                .catch(function() { return { data: new Uint32Array(0) }; });
            },
            releaseDocumentSemanticTokens: function() {
              // Optional cleanup
            }
          }));
        }

        // Note: Call Hierarchy and Type Hierarchy providers are registered above,
        // but standalone Monaco Editor doesn't include built-in UI widgets for these features.
        // The providers are available for external integrations (e.g., if using monaco-languageclient
        // or building custom widgets), but won't show up in the context menu by default.
        // To use these features, you would need to:
        // 1. Use monaco-languageclient which provides the UI widgets, or
        // 2. Build custom widgets that call the providers and display results, or
        // 3. Integrate with VS Code's implementation
        //
        // For now, these providers enable the LSP protocol support but don't have visual UI.
      }
      } // End shouldRegisterProviders

      var saveTimer = null;
      var changeListener = model.onDidChangeContent(function () {
        version++;
        var text = (prefixText || '') + editor.getValue();
        var currentUri = toUri();
        send({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri: currentUri, version: version }, contentChanges: [ { text: text } ] } });
        notifyDidChangeSent({ uri: currentUri, version: version });

        // Debounce didSave to trigger full project revalidation after changes stabilize
        // This ensures dependent files get updated diagnostics
        if (saveTimer) {
          clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(function() {
          send({
            jsonrpc: '2.0',
            method: 'textDocument/didSave',
            params: {
              textDocument: {
                uri: currentUri
              },
              text: text
            }
          });
          saveTimer = null;
        }, 500); // 500ms delay after last change

        // Check if there are pending commands for this URI (from code actions)
        // Execute them after the content change has been sent
        if (pendingCommandsByUri.has(currentUri)) {
          var commands = pendingCommandsByUri.get(currentUri);
          pendingCommandsByUri.delete(currentUri);


          var originFiles = [];
          commands.forEach(function(cmdInfo) {
            // Track origin files that need refreshing
            if (cmdInfo.originFile && originFiles.indexOf(cmdInfo.originFile) === -1) {
              originFiles.push(cmdInfo.originFile);
            }

            var cmd = cmdInfo.command;
            if (!cmd) {
              return;
            }

            // Handle both command objects and command strings
            var commandName = typeof cmd === 'string' ? cmd : cmd.command;
            var commandArgs = typeof cmd === 'object' ? (cmd.arguments || []) : [];

            if (!commandName) {
              return;
            }

            // Send workspace/executeCommand to LSP
            request('workspace/executeCommand', {
              command: commandName,
              arguments: commandArgs
            });
          });

          // Notify that these origin files may need refreshing
          if (originFiles.length > 0) {
            notifyWorkspaceEditApplied({ uris: [currentUri], affectedOriginFiles: originFiles });
          }
        }
      });

      // Store change listener in connection for cleanup
      if (!sharedConnection.changeListeners) {
        sharedConnection.changeListeners = new Map();
      }
      sharedConnection.changeListeners.set(model.uri.toString(), changeListener);
      function rejectAllPending(err) {
        try {
          for (var k in pending) { if (pending[k] && pending[k].reject) pending[k].reject(err || { code: 'closed' }); }
        } catch (e) {}
        pending = {};
      }
      function scheduleReconnect() {
        if (stopped) return;
        if (reconnectTimer) return;
        var delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
        reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(); }, delay);
        if (root && root.console && console.warn) {
          console.warn('[lmsMonaco] LSP reconnect in ' + delay + 'ms');
        }
      }
      function connect() {
        if (stopped) return;
        try { if (ws && ws.readyState < 2) ws.close(); } catch (e) {}
        ws = new (root.WebSocket || window.WebSocket)(urlSimple);
        sharedConnection.ws = ws; // Store ws reference in shared connection
        ws.onopen = function () { reconnectAttempts = 0; openInitialize(); };
        ws.onmessage = function (ev) {
          var data = ev && ev.data; if (!data) return;
          var msg; try { msg = JSON.parse(data); } catch (e) { return; }
          if (msg.id && (msg.result !== undefined || msg.error)) {
            var p = pending[msg.id]; delete pending[msg.id];
            if (p) { if (msg.error) p.reject(msg.error); else p.resolve(msg.result); }
            return;
          }
          if (msg.method === 'textDocument/publishDiagnostics') { handleDiagnostics(msg.params); return; }
          if (msg.method === 'workspace/applyEdit') {
            var success = false;
            try { success = applyWorkspaceEdit(msg.params && msg.params.edit); } catch (e) { success = false; }
            if (msg.id !== undefined) {
              send({ jsonrpc: '2.0', id: msg.id, result: { applied: !!success } });
            }
            return;
          }
          if (msg.method === 'window/showMessage') {
            // Suppress window/showMessage notifications (e.g., sqls "no database connection" on startup)
            return;
          }
          if (msg.method === 'client/registerCapability') {
            var regList = (msg.params && msg.params.registrations) || [];
            var registeredFolders = false;
            for (var ri = 0; ri < regList.length; ri++) {
              var reg = regList[ri];
              if (reg && reg.method === 'workspace/didChangeWorkspaceFolders') {
                workspaceFoldersRegistered = true;
                registeredFolders = true;
              }
            }
            if (msg.id !== undefined) {
              send({ jsonrpc: '2.0', id: msg.id, result: null });
            }
            if (registeredFolders) {
              notifyWorkspaceFoldersAdded();
            }
            return;
          }
          if (msg.method === 'client/unregisterCapability') {
            if (msg.id !== undefined) {
              send({ jsonrpc: '2.0', id: msg.id, result: null });
            }
            return;
          }
          if (msg.method === 'workspace/configuration') {
            // Handle workspace/configuration request (e.g., for SQL LSP server)
            var items = msg.params && msg.params.items ? msg.params.items : [];
            var results = [];
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              var section = item && item.section ? item.section : null;
              var config = null;
              if (workspaceConfig && section) {
                // Navigate to the requested section in the config
                var parts = section.split('.');
                config = workspaceConfig;
                for (var j = 0; j < parts.length && config; j++) {
                  config = config[parts[j]];
                }
              }
              results.push(config !== undefined ? config : null);
            }
            if (msg.id !== undefined) {
              send({ jsonrpc: '2.0', id: msg.id, result: results });
            }
            return;
          }
        };
        ws.onerror = function () { rejectAllPending({ code: 'error' }); };
        ws.onclose = function () {
          try { monaco.editor.setModelMarkers(model, 'lsp', []); } catch (e) {}
          rejectAllPending({ code: 'closed' });
          scheduleReconnect();
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        };
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
        }
        keepAliveTimer = setInterval(function () {
          try {
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ jsonrpc: '2.0', method: '$/keepalive' }));
            }
          } catch (e) {}
        }, KEEPALIVE_INTERVAL);
        ensureExecuteCommandRegistered();
      }
      connect();

      // extend dispose to cleanup providers and socket
      var prevDispose = api.dispose;
      api.dispose = function () {
        // Use detach helper to clean up this model from the shared connection
        detachModelFromLspConnection(monaco, model, sharedConnection);
        prevDispose();
      };

      return api;
    }

    // If advanced LSP deps are not available and simple mode is disabled, return a plain editor.
    if (!deps.monacoLanguageClient || !deps.wsjson) {
      if (root && root.console && console.warn) {
        console.warn('[lmsMonaco] Advanced LSP disabled: missing monaco-languageclient or ws-jsonrpc');
      }
      return api;
    }

    // Install MonacoServices if exposed by monaco-languageclient
    try {
      if (deps.monacoLanguageClient && deps.monacoLanguageClient.MonacoServices && typeof deps.monacoLanguageClient.MonacoServices.install === 'function') {
        deps.monacoLanguageClient.MonacoServices.install(monaco);
      }
    } catch (e) {
      if (root && root.console && console.warn) {
        console.warn('[lmsMonaco] MonacoServices install skipped', e);
      }
    }

    var url = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: options.language });
    var socket = new (root.WebSocket || window.WebSocket)(url);
    var client = null;

    socket.onopen = function () {
      try {
        var getConnection = createConnectionFactory(deps.monacoLanguageClient, deps.wsjson, socket, prefixLineCount, prefixText);

        var CloseAction = deps.monacoLanguageClient.CloseAction || { DoNotRestart: 1, Restart: 2 };
        var ErrorAction = deps.monacoLanguageClient.ErrorAction || { Continue: 1, Shutdown: 2 };

        client = new deps.monacoLanguageClient.MonacoLanguageClient({
          name: 'LSP: ' + (options.language || 'unknown'),
          clientOptions: {
            documentSelector: [options.language || 'plaintext'],
            initializationOptions: options.initializationOptions || {},
            errorHandler: {
              error: function () { return ErrorAction.Continue || 1; },
              closed: function () { return CloseAction.DoNotRestart || 1; }
            }
          },
          connectionProvider: { get: getConnection }
        });

        client.start();
      } catch (e) {
        if (root && root.console && console.error) {
          console.error('[lmsMonaco] LSP start failed', e);
        }
      }
    };

    socket.onclose = function () {
      try { if (client) client.stop(); } catch (e) {}
    };

    return api;
  }

  function bindEditorModelToLsp(options) {
    options = options || {};
    if (!options.editor) {
      throw new Error('bindEditorModelToLsp requires an editor instance');
    }
    return createMonacoLspEditor(null, options);
  }

  /**
   * Register a model with an existing LSP connection.
   * This allows models created outside createMonacoLspEditor to receive LSP features.
   *
   * @param {Object} monaco - Monaco instance
   * @param {Object} model - Monaco editor model
   * @param {Object} options - Options including language, lspUrl, lspBaseUrl, prefixCode
   * @returns {Object} Disposable to unregister the model
   */
  function registerModelWithLsp(monaco, model, options) {
    if (!monaco || !model || !options) {
      return { dispose: function() {} };
    }

    var language = options.language || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: language });

    // Get existing connection from pool
    var connection = globalLspPool.get(language, urlSimple);
    if (!connection) {
      // No connection exists yet
      return { dispose: function() {} };
    }
    if (connection.pendingDisposeTimer) {
      clearTimeout(connection.pendingDisposeTimer);
      connection.pendingDisposeTimer = null;
    }

    var modelUri = model.uri.toString();
    var prefixText = options.prefixCode || '';
    var prefixLineCount = prefixText ? prefixText.split('\n').length : 0;

    var previousCount = incrementModelRefCount(connection, modelUri);
    var isNewModel = previousCount === 0;

    if (isNewModel) {
      connection.models.push(model);
      connection.modelPrefixes.set(modelUri, {
        text: prefixText,
        lineCount: prefixLineCount
      });

      var didOpenMsg = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: modelUri,
            languageId: language,
            version: 1,
            text: prefixText + model.getValue()
          }
        }
      };

      if (connection.ws && connection.ws.readyState === 1) {
        connection.send(didOpenMsg);
      } else {
        if (!connection.pendingDidOpen) {
          connection.pendingDidOpen = [];
        }
        connection.pendingDidOpen.push(didOpenMsg);
      }

      // Store save timers on connection object so they persist
      if (!connection.saveTimers) {
        connection.saveTimers = new Map();
      }

      var changeListener = model.onDidChangeContent(function() {
        if (connection && connection.ws && connection.ws.readyState === 1) {
          connection.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: {
                uri: modelUri,
                version: model.getVersionId()
              },
              contentChanges: [{
                text: prefixText + model.getValue()
              }]
            }
          });
          notifyDidChangeSent({ uri: modelUri, version: model.getVersionId() });

          // Debounce didSave to trigger full project revalidation after changes stabilize
          // This ensures dependent files get updated diagnostics
          var existingTimer = connection.saveTimers.get(modelUri);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          var newTimer = setTimeout(function() {
            if (connection && connection.ws && connection.ws.readyState === 1) {
              connection.send({
                jsonrpc: '2.0',
                method: 'textDocument/didSave',
                params: {
                  textDocument: {
                    uri: modelUri
                  },
                  text: prefixText + model.getValue()
                }
              });
            }
            connection.saveTimers.delete(modelUri);
          }, 500); // 500ms delay after last change
          connection.saveTimers.set(modelUri, newTimer);
        }
      });

      if (!connection.changeListeners) {
        connection.changeListeners = new Map();
      }
      connection.changeListeners.set(modelUri, changeListener);
    }

    // Return disposable
    return {
      dispose: function() {
        var remaining = decrementModelRefCount(connection, modelUri);
        if (remaining > 0) {
          return;
        }

        if (connection.ws && connection.ws.readyState === 1) {
          connection.send({
            jsonrpc: '2.0',
            method: 'textDocument/didClose',
            params: {
              textDocument: { uri: modelUri }
            }
          });
        }

        connection.models = connection.models.filter(function(m) {
          return m.uri.toString() !== modelUri;
        });

        connection.modelPrefixes.delete(modelUri);

        if (connection.changeListeners && connection.changeListeners.has(modelUri)) {
          var listener = connection.changeListeners.get(modelUri);
          try { listener.dispose(); } catch (e) {}
          connection.changeListeners.delete(modelUri);
        }

        // Clear any pending save timers
        if (connection.saveTimers && connection.saveTimers.has(modelUri)) {
          var timer = connection.saveTimers.get(modelUri);
          clearTimeout(timer);
          connection.saveTimers.delete(modelUri);
        }
      }
    };
  }

  function isModelRegisteredWithLsp(monaco, model, options) {
    if (!monaco || !model || !options) {
      return false;
    }
    var language = options.language || (model.getModeId && model.getModeId()) || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: language });
    var connection = globalLspPool.get(language, urlSimple);
    if (!connection || !connection.modelPrefixes) {
      return false;
    }
    var modelUri = model.uri && model.uri.toString ? model.uri.toString() : null;
    if (!modelUri) {
      return false;
    }
    return connection.modelPrefixes.has(modelUri);
  }

  /**
   * Notify LSP server that a file has been deleted
   */
  function notifyFileDeleted(monaco, fileUri, options) {
    if (!monaco || !fileUri || !options) {
      return false;
    }
    var language = options.language || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: language });
    var connection = globalLspPool.get(language, urlSimple);
    if (!connection || !connection.ws || connection.ws.readyState !== 1) {
      return false;
    }

    // Send workspace/didDeleteFiles notification
    connection.send({
      jsonrpc: '2.0',
      method: 'workspace/didDeleteFiles',
      params: {
        files: [{
          uri: fileUri
        }]
      }
    });

    return true;
  }

  /**
   * Notify LSP server that a file has been created
   */
  function notifyFileCreated(monaco, fileUri, options) {
    if (!monaco || !fileUri || !options) {
      return false;
    }
    var language = options.language || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: language });
    var connection = globalLspPool.get(language, urlSimple);
    if (!connection || !connection.ws || connection.ws.readyState !== 1) {
      return false;
    }

    // Send workspace/didCreateFiles notification
    connection.send({
      jsonrpc: '2.0',
      method: 'workspace/didCreateFiles',
      params: {
        files: [{
          uri: fileUri
        }]
      }
    });

    return true;
  }

  /**
   * Notify LSP server that a file has been renamed
   */
  function notifyFileRenamed(monaco, oldUri, newUri, options) {
    if (!monaco || !oldUri || !newUri || !options) {
      return false;
    }
    var language = options.language || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: language });
    var connection = globalLspPool.get(language, urlSimple);
    if (!connection || !connection.ws || connection.ws.readyState !== 1) {
      return false;
    }

    // Send workspace/didRenameFiles notification
    connection.send({
      jsonrpc: '2.0',
      method: 'workspace/didRenameFiles',
      params: {
        files: [{
          oldUri: oldUri,
          newUri: newUri
        }]
      }
    });

    return true;
  }

  return {
    createMonacoLspEditor: createMonacoLspEditor,
    bindEditorModelToLsp: bindEditorModelToLsp,
    registerModelWithLsp: registerModelWithLsp,
    syncModelContent: syncModelContent,
    isModelRegisteredWithLsp: isModelRegisteredWithLsp,
    registerWorkspaceEditHook: registerWorkspaceEditHook,
    registerWorkspaceEditWillAffectHook: registerWorkspaceEditWillAffectHook,
    registerDidChangeHook: registerDidChangeHook,
    notifyFileDeleted: notifyFileDeleted,
    notifyFileCreated: notifyFileCreated,
    notifyFileRenamed: notifyFileRenamed
  };
}));
