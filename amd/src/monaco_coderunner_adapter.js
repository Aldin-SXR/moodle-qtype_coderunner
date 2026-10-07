(function (root, factory) {
  // UMD wrapper: `module` and `global` only exist under CommonJS/Node and are guarded by typeof checks.
  /* eslint-disable no-undef */
  if (typeof define === 'function' && define.amd) {
    define([], function () { return factory(root); });
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : root));
  } else {
    root.lmsMonaco = factory(root);
  }
  /* eslint-enable no-undef */
}(this, function (root) {
  'use strict';

  // Suppress Monaco's DisposableStore errors that occur during file navigation
  // These are benign race conditions when hovers/widgets are disposed during model changes.
  // Only a lone message that *is* Monaco's leak notice is dropped; anything else (including
  // errors that merely mention it alongside other arguments) is passed through untouched.
  var MONACO_DISPOSED_STORE_NOISE = 'Trying to add a disposable to a DisposableStore that has already been disposed';
  /**
   * @param {Arguments|Array} args Arguments passed to console.error.
   * @returns {boolean} True if the call is exactly Monaco's benign disposed-store notice.
   */
  function isMonacoDisposedStoreNoise(args) {
    if (!args || args.length !== 1) {
      return false;
    }
    var entry = args[0];
    var text = null;
    if (typeof entry === 'string') {
      text = entry;
    } else if (entry && typeof entry.message === 'string') {
      text = entry.message;
    }
    if (!text) {
      return false;
    }
    if (text.indexOf('Error: ') === 0) {
      text = text.substring(7);
    }
    return text.indexOf(MONACO_DISPOSED_STORE_NOISE) === 0;
  }
  if (typeof window !== 'undefined' && window.console && typeof window.console.error === 'function' &&
      !window.console.error.__lmsMonacoFiltered) {
    var originalConsoleError = window.console.error;
    var filteredConsoleError = function() {
      if (isMonacoDisposedStoreNoise(arguments)) {
        return; // Known benign Monaco disposal notice.
      }
      return originalConsoleError.apply(window.console, arguments);
    };
    filteredConsoleError.__lmsMonacoFiltered = true;
    window.console.error = filteredConsoleError;
  }

  // Provide a no-op in case bundling/ordering issues prevent later assignment.
  // This avoids ReferenceError in downstream modules if syncModelContent is missing.
  var syncModelContent = function() {};

  /**
   * Throw if a required dependency is missing.
   *
   * @param {*} object The dependency to check.
   * @param {string} name Name used in the error message.
   * @returns {*} The object, if truthy.
   */
  function ensure(object, name) {
    if (!object) { throw new Error(name + ' is required'); }
    return object;
  }

  /**
   * Count the newline characters in a piece of text.
   *
   * @param {string} text The text to scan.
   * @returns {number} Number of newline-terminated lines.
   */
  function countTerminatedLines(text) {
    if (!text) {return 0;}
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

  var workspaceEditHooks = [];
  var workspaceEditWillAffectHooks = [];
  var CONNECTION_RELEASE_DELAY_MS = 2000;
  var EXECUTE_COMMAND_ID = 'lmsMonaco.executeCommand';

  // Standard LSP semantic token types and modifiers. Monaco providers are registered once per
  // language and shared by every server for that language, so they all use this fixed client
  // legend; each connection maps its own server's legend onto it.
  var CLIENT_SEMANTIC_TOKEN_TYPES = [
    'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
    'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method',
    'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'
  ];
  var CLIENT_SEMANTIC_TOKEN_MODIFIERS = [
    'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
    'async', 'modification', 'documentation', 'defaultLibrary'
  ];

  // Prefix info for a document that has no hidden prefix.
  var EMPTY_PREFIX = { text: '', lineCount: 0, lastLineLength: 0 };

  /**
   * Register a callback run after a workspace edit has been applied.
   *
   * @param {Function} fn Callback receiving the edit metadata.
   * @returns {Object} Disposable that unregisters the callback.
   */
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

  /**
   * Register a callback run when a code action is about to modify other files.
   *
   * @param {Function} fn Callback receiving the affected-files metadata.
   * @returns {Object} Disposable that unregisters the callback.
   */
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

  /**
   * Call every registered workspace-edit hook, ignoring hook errors.
   *
   * @param {Object} meta Description of the applied edit.
   */
  function notifyWorkspaceEditApplied(meta) {
    workspaceEditHooks.forEach(function(fn) {
      try {
        fn(meta);
      } catch (e) {
        // A failing hook must not break the others.
      }
    });
  }

  /**
   * Call every registered will-affect hook, ignoring hook errors.
   *
   * @param {Object} meta Target and origin files of the pending edit.
   */
  function notifyWorkspaceEditWillAffect(meta) {
    workspaceEditWillAffectHooks.forEach(function(fn) {
      try {
        fn(meta);
      } catch (e) {
        // A failing hook must not break the others.
      }
    });
  }

  /**
   * Describe a hidden prefix. The LSP document is prefix + student code with nothing in between,
   * so the student's first line starts at column lastLineLength of the prefix's last line.
   * Metrics are taken from the text as actually sent (after the .tpp include rewrite).
   *
   * @param {string} text Hidden prefix code.
   * @returns {Object} {text, lineCount (number of '\n'), lastLineLength (chars after the last '\n')}.
   */
  function makePrefixInfo(text) {
    var raw = typeof text === 'string' ? text : (text ? String(text) : '');
    var sent = rewriteTppIncludePaths(raw);
    return {
      text: raw,
      lineCount: countTerminatedLines(sent),
      lastLineLength: sent.length - (sent.lastIndexOf('\n') + 1)
    };
  }

  /**
   * Whether an LSP position lies inside the hidden prefix (i.e. before the student's code).
   *
   * @param {Object} prefix Prefix info.
   * @param {Object} pos LSP position.
   * @returns {boolean}
   */
  function isPositionInPrefix(prefix, pos) {
    var p = prefix || EMPTY_PREFIX;
    return pos.line < p.lineCount || (pos.line === p.lineCount && pos.character < p.lastLineLength);
  }

  /**
   * Whether an LSP position is at or before the end of the hidden prefix. A range whose
   * (exclusive) end satisfies this covers no student code at all.
   *
   * @param {Object} prefix Prefix info.
   * @param {Object} pos LSP position.
   * @returns {boolean}
   */
  function isPositionAtOrBeforePrefixEnd(prefix, pos) {
    var p = prefix || EMPTY_PREFIX;
    return pos.line < p.lineCount || (pos.line === p.lineCount && pos.character <= p.lastLineLength);
  }

  /**
   * Map a 0-based position in the visible model to the LSP document.
   *
   * @param {Object} prefix Prefix info.
   * @param {number} line 0-based visible line.
   * @param {number} character 0-based visible character.
   * @returns {Object} LSP position {line, character}.
   */
  function lspPositionFromVisible(prefix, line, character) {
    var p = prefix || EMPTY_PREFIX;
    return {
      line: line + p.lineCount,
      character: line === 0 ? character + p.lastLineLength : character
    };
  }

  /**
   * Map an LSP position to a 0-based position in the visible model.
   *
   * @param {Object} prefix Prefix info.
   * @param {Object} pos LSP position.
   * @returns {Object|null} {line, character}, or null if the position is inside the prefix.
   */
  function visiblePositionFromLsp(prefix, pos) {
    var p = prefix || EMPTY_PREFIX;
    if (isPositionInPrefix(p, pos)) {
      return null;
    }
    return {
      line: pos.line - p.lineCount,
      character: pos.line === p.lineCount ? pos.character - p.lastLineLength : pos.character
    };
  }

  /**
   * Per-model feature options, captured when a model is attached/registered.
   *
   * @param {Object} options Attach/register options.
   * @returns {Object} {richFeatures, inlayHints, semanticHighlighting, onTypeFormattingTriggers}.
   */
  function normaliseModelOptions(options) {
    var opts = options || {};
    var triggers = opts.onTypeFormattingTriggers;
    return {
      richFeatures: opts.richFeatures !== false,
      inlayHints: !!opts.enableInlayHints,
      semanticHighlighting: !!opts.semanticHighlighting,
      onTypeFormattingTriggers: Array.isArray(triggers) && triggers.length ? triggers.slice() : null
    };
  }

  /**
   * Find the live pooled connection a model URI is attached to.
   *
   * @param {string} uri Model URI (or, with allowAlias, an alias such as x.tpp for tpp_x.h).
   * @param {boolean} [allowAlias] Also resolve alias URIs.
   * @returns {Object|null} {connection, modelUri}, modelUri being the attached model's URI.
   */
  function findModelOwner(uri, allowAlias) {
    if (!uri) {
      return null;
    }
    var connections = globalLspPool.getAllConnections();
    var i;
    for (i = 0; i < connections.length; i++) {
      var conn = connections[i];
      if (!conn.stopped && conn.modelPrefixes && conn.modelPrefixes.has(uri)) {
        return { connection: conn, modelUri: uri };
      }
    }
    if (allowAlias) {
      for (i = 0; i < connections.length; i++) {
        var aliasConn = connections[i];
        if (aliasConn.stopped || !aliasConn.modelUriAliases || !aliasConn.modelUriAliases.has(uri)) {
          continue;
        }
        var primary = aliasConn.modelUriAliases.get(uri);
        if (aliasConn.modelPrefixes && aliasConn.modelPrefixes.has(primary)) {
          return { connection: aliasConn, modelUri: primary };
        }
      }
    }
    return null;
  }

  /**
   * Locate monaco from options or globals.
   *
   * @param {Object} options Editor options (may contain monaco).
   * @returns {Object} {monaco} (null if not found).
   */
  function resolveDeps(options) {
    return { monaco: options && options.monaco ? options.monaco : (root.monaco || null) };
  }

  /**
   * Make a free model URI by inserting a "dupN" directory before the file name, so the base
   * name (which some language servers care about, e.g. Java) is preserved.
   *
   * @param {Object} monaco
   * @param {Object} uri The URI that is already taken.
   * @returns {Object} An unused monaco Uri.
   */
  function uniqueModelUri(monaco, uri) {
    var str = uri.toString();
    var slash = str.lastIndexOf('/');
    var dir = slash >= 0 ? str.substring(0, slash) : str;
    var base = slash >= 0 ? str.substring(slash + 1) : '';
    for (var n = 2; n < 10000; n++) {
      var candidate = monaco.Uri.parse(dir + '/dup' + n + '/' + base);
      if (!monaco.editor.getModel(candidate)) {
        return candidate;
      }
    }
    return monaco.Uri.parse(dir + '/dup' + Date.now() + '/' + base);
  }

  /**
   * Create a Monaco model with a file:// URI, picking a free URI if the wanted one is taken.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} language Monaco language id.
   * @param {string} value Initial content.
   * @param {string} [path] File path or file:// URI for the model.
   * @returns {Object} The new model.
   */
  function createMonacoModel(monaco, language, value, path) {
    var uri;
    if (path && typeof path === 'string') {
      // Ensure file:// URI for servers that expect real files
      if (path.indexOf('file://') === 0) {uri = monaco.Uri.parse(path);}
      else {uri = monaco.Uri.parse('file://' + path);}
    } else {
      var extMap = {
        python: 'py', java: 'java', cpp: 'cpp', c: 'c', typescript: 'ts',
        javascript: 'js', json: 'json', markdown: 'md', plaintext: 'txt'
      };
      var ext = extMap[language] || 'txt';
      uri = monaco.Uri.parse('file:///coderunner/' + (language || 'txt') + '/Main.' + ext);
    }
    // Monaco throws if a model with this URI already exists (e.g. two questions on one page,
    // or a UI reload that leaked its model). We can't safely tell whether the existing model
    // is still wanted (it may be awaiting its editor), so never dispose it; use a free URI instead.
    if (monaco.editor.getModel(uri)) {
      uri = uniqueModelUri(monaco, uri);
    }
    return monaco.editor.createModel(String(value || ''), language, uri);
  }

  /**
   * Default options for editors created by this adapter.
   *
   * @returns {Object} Monaco editor construction options.
   */
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

  /**
   * Work out the LSP WebSocket URL: an explicit lspUrl, else lspBaseUrl + '/' + language.
   *
   * @param {Object} options Object with lspUrl, lspBaseUrl and language.
   * @returns {string} The WebSocket URL.
   */
  function buildLspUrl(options) {
    if (options.lspUrl) {return options.lspUrl;}
    var base = (options.lspBaseUrl || '').replace(/\/$/, '');
    var lang = options.language || '';
    return base + '/' + lang;
  }

  /**
   * Replace tpp_<name>.h shim file names with the original <name>.tpp in display text.
   *
   * @param {string} text Text to rewrite (non-strings are returned unchanged).
   * @returns {string} The rewritten text.
   */
  function rewriteTppShimName(text) {
    if (typeof text !== 'string') {return text;}
    return text.replace(/tpp_([^\/\s]+)\.h/gi, '$1.tpp');
  }

  /**
   * Increment the attachment count of a model on a connection.
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {string} modelUri The model URI.
   * @returns {number} The count before incrementing.
   */
  function incrementModelRefCount(connection, modelUri) {
    if (!connection.modelRefCounts) {
      connection.modelRefCounts = new Map();
    }
    var prevCount = connection.modelRefCounts.get(modelUri) || 0;
    connection.modelRefCounts.set(modelUri, prevCount + 1);
    return prevCount;
  }

  /**
   * Decrement the attachment count of a model on a connection, removing it at zero.
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {string} modelUri The model URI.
   * @returns {number} The remaining count.
   */
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

  /**
   * Rewrite #include "x.tpp" directives to the tpp_x.h shim headers the server understands.
   *
   * @param {string} text Source text.
   * @returns {string} The rewritten text (unchanged on error or if there are no .tpp includes).
   */
  function rewriteTppIncludePaths(text) {
    if (!text || text.indexOf('.tpp') === -1) {
      return text;
    }
    try {
      return text.replace(/#\s*include\s*([<"])([^">]+\.tpp)\1/gi, function(match, delim, inc) {
        var parts = inc.split('/');
        var filename = parts.pop();
        var base = filename.replace(/\.tpp$/i, '');
        var rewritten = 'tpp_' + base + '.h';
        var rebuilt = (parts.length ? parts.join('/') + '/' : '') + rewritten;
        return match.replace(inc, rebuilt);
      });
    } catch (e) {
      return text;
    }
  }

  /**
   * Apply the .tpp include rewriting to all document text in an outgoing LSP message.
   *
   * @param {Object} msg JSON-RPC message (modified in place).
   * @returns {Object} The same message.
   */
  function sanitizeOutgoingMessage(msg) {
    if (!msg || !msg.params) {
      return msg;
    }
    var params = msg.params;
    // Text on textDocument
    if (params.textDocument && typeof params.textDocument.text === 'string') {
      params.textDocument.text = rewriteTppIncludePaths(params.textDocument.text);
    }
    // Top-level text field
    if (typeof params.text === 'string') {
      params.text = rewriteTppIncludePaths(params.text);
    }
    // Content changes
    if (Array.isArray(params.contentChanges)) {
      for (var ci = 0; ci < params.contentChanges.length; ci++) {
        var change = params.contentChanges[ci];
        if (change && typeof change.text === 'string') {
          change.text = rewriteTppIncludePaths(change.text);
        }
      }
    }
    return msg;
  }

  // URI rewrite pipeline: functions that map one URI string to another.
  // Useful for “fake” files like tpp_<base>.h -> <base>.tpp so nav works naturally.
  var uriRewriters = [
    function(uri) {
      if (!uri || typeof uri !== 'string') {return uri;}
      return uri.replace(/\/tpp_([^\/]+)\.h$/i, '/$1.tpp');
    }
  ];
  /**
   * Pass a URI through every registered URI rewriter in turn.
   *
   * @param {string} uri The URI to rewrite.
   * @returns {string} The rewritten URI.
   */
  function applyUriRewriters(uri) {
    var result = uri;
    for (var i = 0; i < uriRewriters.length; i++) {
      try {
        result = uriRewriters[i](result) || result;
      } catch (e) {}
    }
    return result;
  }
  /**
   * Apply the URI rewriters to an LSP location or array of locations (returns copies).
   *
   * @param {Object|Array} locations LSP Location(s).
   * @returns {Object|Array} Location(s) with rewritten URIs.
   */
  function rewriteLocationsWithUriRewriters(locations) {
    if (!locations) {return locations;}
    var rewriteLoc = function(loc) {
      if (!loc || !loc.uri) {return loc;}
      var cloned = Object.assign({}, loc);
      cloned.uri = applyUriRewriters(loc.uri);
      return cloned;
    };
    if (Array.isArray(locations)) {
      return locations.map(rewriteLoc);
    }
    return rewriteLoc(locations);
  }

  /**
   * Build the full document text sent to the server: hidden prefix + (transformed) model text.
   *
   * @param {string} prefixText Hidden prefix code.
   * @param {Object} model The Monaco model.
   * @param {Function|null} contentTransform Optional transform applied to the model text.
   * @param {string} modelUri The model URI (passed to the transform).
   * @returns {string} The text to send.
   */
  function buildPrefixedContent(prefixText, model, contentTransform, modelUri) {
    var body = model.getValue();
    if (typeof contentTransform === 'function') {
      try {
        body = contentTransform(body, modelUri, model);
      } catch (e) {}
    }

    var safePrefix = rewriteTppIncludePaths(prefixText || '');
    body = rewriteTppIncludePaths(body);

    return safePrefix + body;
  }

  /**
   * Version for the next didChange of a document: follows the model's own version id but
   * never goes backwards (syncModelContent may already have sent a higher forced version).
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {string} modelUri
   * @param {Object} model
   * @param {number} [minimumVersion]
   * @returns {number}
   */
  function nextDocumentVersion(connection, modelUri, model, minimumVersion) {
    if (!connection.lastSentVersions) {
      connection.lastSentVersions = new Map();
    }
    var version = typeof model.getVersionId === 'function' ? model.getVersionId() : 1;
    if (typeof minimumVersion === 'number' && minimumVersion > version) {
      version = minimumVersion;
    }
    var last = connection.lastSentVersions.get(modelUri);
    if (typeof last === 'number' && version <= last) {
      version = last + 1;
    }
    connection.lastSentVersions.set(modelUri, version);
    return version;
  }

  /**
   * Build the text the server sees for a model on a connection (its prefix + transformed text).
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {Object} model The model.
   * @param {string} modelUri The model URI.
   * @returns {string} The document text.
   */
  function buildModelContent(connection, model, modelUri) {
    var prefix = connection.modelPrefixes && connection.modelPrefixes.get(modelUri);
    var transform = connection.modelContentTransforms && connection.modelContentTransforms.get(modelUri);
    return buildPrefixedContent(prefix ? prefix.text : '', model, transform || null, modelUri);
  }

  /**
   * Send a full-content didChange for the model that changed and refresh pull diagnostics.
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {Object} model The model that changed.
   * @param {string} modelUri The model URI (also the document URI the server knows).
   * @returns {boolean} False if the socket isn't open (nothing sent).
   */
  function sendModelDidChange(connection, model, modelUri) {
    if (!connection || !connection.ws || connection.ws.readyState !== 1) {
      return false;
    }
    var version = nextDocumentVersion(connection, modelUri, model);
    connection.send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: {
          uri: modelUri,
          version: version
        },
        contentChanges: [{
          text: buildModelContent(connection, model, modelUri)
        }]
      }
    });
    if (typeof connection.scheduleDiagnostics === 'function') {
      connection.scheduleDiagnostics(250);
    }
    return true;
  }

  /**
   * Keep a pooled connection alive when it is reused inside its release delay.
   *
   * @param {Object} connection
   */
  function cancelPendingConnectionDispose(connection) {
    if (connection && connection.pendingDisposeTimer) {
      clearTimeout(connection.pendingDisposeTimer);
      connection.pendingDisposeTimer = null;
    }
  }

  /**
   * Record the alias for shimmed tpp_<name>.h models (<name>.tpp -> model URI) so results the
   * server reports against the original .tpp path find the model.
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {string} modelUri The model URI.
   */
  function registerModelAlias(connection, modelUri) {
    if (!modelUri.match(/\/tpp_[^\/]+\.h$/i)) {
      return;
    }
    if (!connection.modelUriAliases) {
      connection.modelUriAliases = new Map();
    }
    connection.modelUriAliases.set(modelUri.replace(/\/tpp_([^\/]+)\.h$/i, '/$1.tpp'), modelUri);
  }

  /**
   * Store everything the connection needs to know about a newly attached model: its prefix,
   * its feature options and its content transform. Also offers the workspace config to the
   * connection (it keeps the first non-empty one).
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {Object} model The model.
   * @param {Object} options Attach options (prefixCode, contentTransform, richFeatures, ...).
   */
  function recordModelOnConnection(connection, model, options) {
    var modelUri = model.uri.toString();
    if (!connection.modelPrefixes) {
      connection.modelPrefixes = new Map();
    }
    if (!connection.modelOptions) {
      connection.modelOptions = new Map();
    }
    if (!connection.modelContentTransforms) {
      connection.modelContentTransforms = new Map();
    }
    connection.models.push(model);
    connection.modelPrefixes.set(modelUri, makePrefixInfo(options.prefixCode));
    connection.modelOptions.set(modelUri, normaliseModelOptions(options));
    connection.modelContentTransforms.set(modelUri, options.contentTransform || null);
    registerModelAlias(connection, modelUri);
  }

  /**
   * Listen to a model's changes: send didChange and a debounced didSave.
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {Object} model The model.
   */
  function installModelChangeListener(connection, model) {
    var modelUri = model.uri.toString();
    if (!connection.saveTimers) {
      connection.saveTimers = new Map();
    }
    if (!connection.changeListeners) {
      connection.changeListeners = new Map();
    }
    var changeListener = model.onDidChangeContent(function() {
      if (sendModelDidChange(connection, model, modelUri)) {
        // Debounce didSave to trigger full project revalidation after changes stabilise,
        // so dependent files get updated diagnostics.
        var existingTimer = connection.saveTimers.get(modelUri);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        connection.saveTimers.set(modelUri, setTimeout(function() {
          connection.saveTimers.delete(modelUri);
          if (model.isDisposed && model.isDisposed()) {
            return;
          }
          if (connection.ws && connection.ws.readyState === 1) {
            connection.send({
              jsonrpc: '2.0',
              method: 'textDocument/didSave',
              params: {
                textDocument: { uri: modelUri },
                text: buildModelContent(connection, model, modelUri)
              }
            });
          }
        }, 500));
      }
    });
    connection.changeListeners.set(modelUri, changeListener);
  }

  /**
   * Attach a model (and its editor) to a pooled LSP connection.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} model The model to attach.
   * @param {Object} editor The editor showing the model.
   * @param {Object} connection Pooled LSP connection.
   * @param {Object} options Model options (prefixCode, contentTransform, richFeatures, enableInlayHints,
   *     semanticHighlighting, workspaceConfig, ...).
   * @param {Object} [attachmentOptions] disposeEditor and disposeModel.
   * @returns {Object} Editor API object (editor, model, dispose, setValue, getValue, getPrefixLineCount).
   */
  function attachModelToLspConnection(monaco, model, editor, connection, options, attachmentOptions) {
    // Reusing a pooled connection inside its release delay must keep it alive.
    cancelPendingConnectionDispose(connection);
    var modelUri = model.uri.toString();
    var cleanupOpts = attachmentOptions || {};
    var disposeEditorOnDetach = cleanupOpts.disposeEditor !== false;
    var disposeModelOnDetach = cleanupOpts.disposeModel !== false;
    var isFirstAttachment = incrementModelRefCount(connection, modelUri) === 0;
    if (typeof connection.adoptWorkspaceConfig === 'function') {
      connection.adoptWorkspaceConfig(options.workspaceConfig);
    }

    if (isFirstAttachment) {
      recordModelOnConnection(connection, model, options);
      var didOpenMsgImmediate = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: modelUri,
            languageId: connection.language,
            version: 1,
            text: buildModelContent(connection, model, modelUri)
          }
        }
      };

      if (connection.ws && connection.ws.readyState === 1) {
        connection.send(didOpenMsgImmediate);
        // For Cypher: trigger initial linting by sending a didChange notification
        // The Cypher language server only lints on didChangeContent, not on didOpen
        if (connection.language === 'cypher') {
          connection.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
              textDocument: {
                uri: modelUri,
                version: 2
              },
              contentChanges: [{
                text: buildModelContent(connection, model, modelUri)
              }]
            }
          });
        }
      } else {
        if (!connection.pendingDidOpen) {
          connection.pendingDidOpen = [];
        }
        var alreadyQueued = connection.pendingDidOpen.some(function(msg) {
          return msg && msg.method === 'textDocument/didOpen' &&
            msg.params && msg.params.textDocument && msg.params.textDocument.uri === modelUri;
        });
        if (!alreadyQueued) {
          connection.pendingDidOpen.push(didOpenMsgImmediate);
        }
      }
      installModelChangeListener(connection, model);
    }
    var prefixLineCount = (connection.modelPrefixes.get(modelUri) || EMPTY_PREFIX).lineCount;
    var detached = false;
    return {
      editor: editor,
      model: model,
      dispose: function() {
        if (!detached) {
          detached = true;
          detachModelFromLspConnection(monaco, model, connection);
        }
        if (disposeModelOnDetach) {
          try {
            model.dispose();
          } catch (e) {
            // Already disposed.
          }
        }
        if (disposeEditorOnDetach && editor && typeof editor.dispose === 'function') {
          try {
            editor.dispose();
          } catch (e) {
            // Already disposed.
          }
        }
      },
      setValue: function(v) { editor.setValue(String(v || '')); },
      getValue: function() { return editor.getValue(); },
      getPrefixLineCount: function() { return prefixLineCount; }
    };
  }

  /**
   * Clear the 'lsp' markers this connection has set, on every model it knows about.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} connection Pooled LSP connection.
   */
  function clearConnectionMarkers(monaco, connection) {
    var seen = [];
    var clear = function(m) {
      if (!m || seen.indexOf(m) !== -1) {
        return;
      }
      seen.push(m);
      if (m.isDisposed && m.isDisposed()) {
        return;
      }
      try {
        monaco.editor.setModelMarkers(m, 'lsp', []);
      } catch (e) {
        // Model went away meanwhile.
      }
    };
    (connection.models || []).forEach(clear);
    if (connection.markedModels) {
      connection.markedModels.forEach(clear);
      connection.markedModels.clear();
    }
  }

  /**
   * Tear down a pooled connection: providers, timers, markers and socket, and remove it from the pool.
   *
   * @param {Object} connection Pooled LSP connection.
   */
  function disposeConnectionResources(connection) {
    if (!connection) {
      return;
    }
    if (connection.pendingDisposeTimer) {
      clearTimeout(connection.pendingDisposeTimer);
      connection.pendingDisposeTimer = null;
    }
    try {
      connection.stopped = true;
      if (connection.reconnectTimer) {
        clearTimeout(connection.reconnectTimer);
        connection.reconnectTimer = null;
      }
      if (connection.keepAliveTimer) {
        clearInterval(connection.keepAliveTimer);
        connection.keepAliveTimer = null;
      }
      if (typeof connection.onDispose === 'function') {
        connection.onDispose();
      }
      if (connection.monaco) {
        clearConnectionMarkers(connection.monaco, connection);
      }
      if (connection.ws && connection.ws.readyState < 2) {
        connection.ws.close();
      }
    } catch (e) {
      // Best effort.
    }
    if (connection.providersAcquired) {
      connection.providersAcquired = false;
      releaseLanguageProviders(connection.language);
    }

    // Only touch the pool if this connection is still the pooled one.
    if (globalLspPool.get(connection.language, connection.lspUrl) === connection) {
      globalLspPool.remove(connection.language, connection.lspUrl);
    }
  }

  /**
   * Dispose a connection after CONNECTION_RELEASE_DELAY_MS unless a model is attached again meanwhile.
   *
   * @param {Object} connection Pooled LSP connection.
   */
  function scheduleConnectionDispose(connection) {
    if (!connection) {
      return;
    }
    if (connection.pendingDisposeTimer) {
      clearTimeout(connection.pendingDisposeTimer);
    }
    connection.pendingDisposeTimer = setTimeout(function() {
      connection.pendingDisposeTimer = null;
      if (connection.models && connection.models.length > 0) {
        return; // Reused during the release delay.
      }
      disposeConnectionResources(connection);
    }, CONNECTION_RELEASE_DELAY_MS);
  }

  /**
   * Close a model's document on the server and forget everything the connection knew about it.
   * Called when the model's last attachment/registration goes away.
   *
   * @param {Object} connection Pooled LSP connection.
   * @param {string} modelUri The model URI.
   */
  function releaseModelFromConnection(connection, modelUri) {
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
    if (connection.modelOptions) {
      connection.modelOptions.delete(modelUri);
    }
    if (connection.modelContentTransforms) {
      connection.modelContentTransforms.delete(modelUri);
    }
    if (connection.modelUriAliases && connection.modelUriAliases.size > 0) {
      var aliasesToRemove = [];
      connection.modelUriAliases.forEach(function(primary, alias) {
        if (primary === modelUri) {
          aliasesToRemove.push(alias);
        }
      });
      aliasesToRemove.forEach(function(alias) {
        connection.modelUriAliases.delete(alias);
      });
    }
    if (connection.changeListeners && connection.changeListeners.has(modelUri)) {
      try {
        connection.changeListeners.get(modelUri).dispose();
      } catch (e) {
        // Model already disposed.
      }
      connection.changeListeners.delete(modelUri);
    }
    if (connection.saveTimers && connection.saveTimers.has(modelUri)) {
      clearTimeout(connection.saveTimers.get(modelUri));
      connection.saveTimers.delete(modelUri);
    }
    if (connection.lastSentVersions) {
      connection.lastSentVersions.delete(modelUri);
    }
    if (connection.lastDiagnosticsByUri) {
      connection.lastDiagnosticsByUri.delete(modelUri);
    }

    // If no models left, clean up the connection (after a short delay to allow renames).
    if (connection.models.length === 0) {
      scheduleConnectionDispose(connection);
    }
  }

  /**
   * Detach a model from an LSP connection, closing the document once its last reference goes.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} model The model to detach.
   * @param {Object} connection Pooled LSP connection.
   */
  function detachModelFromLspConnection(monaco, model, connection) {
    var modelUri = model.uri.toString();
    if (!connection.modelRefCounts || !connection.modelRefCounts.has(modelUri)) {
      return; // Already released.
    }
    if (decrementModelRefCount(connection, modelUri) > 0) {
      return;
    }
    releaseModelFromConnection(connection, modelUri);
  }

  /**
   * Create (or bind) a Monaco editor and connect its model to a language server.
   * The built-in WebSocket JSON-RPC client is the only LSP client; the legacy
   * useSimpleLsp option is accepted but ignored.
   *
   * @param {HTMLElement|null} container Element to create the editor in (unused if options.editor is given).
   * @param {Object} options Editor, model and LSP options.
   * @returns {Object} Editor API object (editor, model, dispose, setValue, getValue, getPrefixLineCount).
   */
  function createMonacoLspEditor(container, options) {
    options = options || {};
    var deps = resolveDeps(options);
    var monaco = ensure(deps.monaco, 'monaco');

    var prefixLineCount = makePrefixInfo(options.prefixCode || '').lineCount;

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
      dispose: function() {
        if (ownsModel) {
          try {
            model.dispose();
          } catch (e) {
            // Already disposed.
          }
        }
        if (ownsEditor) {
          try {
            editor.dispose();
          } catch (e) {
            // Already disposed.
          }
        }
      },
      setValue: function(v) { editor.setValue(String(v || '')); },
      getValue: function() { return editor.getValue(); },
      getPrefixLineCount: function() { return prefixLineCount; }
    };

    var lspEnabled = options.lspEnabled !== false && !!(options.lspUrl || options.lspBaseUrl);
    if (!lspEnabled) {
      return api;
    }

    var language = options.language || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: options.lspUrl, lspBaseUrl: options.lspBaseUrl, language: options.language });
    var attachOpts = { disposeEditor: ownsEditor, disposeModel: ownsModel };

    /**
     * Send a full-content didChange for a model using an existing connection.
     *
     * @param {Object} monacoNs The monaco namespace.
     * @param {Object} targetModel The model to sync.
     * @param {Object} syncOptions language, lspUrl/lspBaseUrl and forceVersionId.
     * @returns {boolean} True if a didChange was sent.
     */
    syncModelContent = function(monacoNs, targetModel, syncOptions) {
      if (!monacoNs || !targetModel || !syncOptions) {
        return false;
      }
      var syncLanguage = syncOptions.language || targetModel.getModeId && targetModel.getModeId() || 'plaintext';
      var syncUrl = buildLspUrl({ lspUrl: syncOptions.lspUrl, lspBaseUrl: syncOptions.lspBaseUrl, language: syncLanguage });
      var connection = globalLspPool.get(syncLanguage, syncUrl);
      if (!connection || !connection.ws || connection.ws.readyState !== 1) {
        return false;
      }
      var uri = targetModel.uri.toString();
      var baseVersion = typeof targetModel.getVersionId === 'function' ? targetModel.getVersionId() : 1;
      var forcedVersion = typeof syncOptions.forceVersionId === 'number' ? syncOptions.forceVersionId : null;
      var versionToSend = forcedVersion && forcedVersion > baseVersion ? forcedVersion : (baseVersion + 1);
      // Keep versions monotonic with the didChange notifications sent by the change listeners.
      versionToSend = nextDocumentVersion(connection, uri, targetModel, versionToSend);
      connection.send({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: uri, version: versionToSend },
          contentChanges: [{ text: buildModelContent(connection, targetModel, uri) }]
        }
      });
      return true;
    };

    var existingConnection = globalLspPool.get(language, urlSimple);
    if (existingConnection) {
      return attachModelToLspConnection(monaco, model, editor, existingConnection, options, attachOpts);
    }
    var connection = createLspConnection(monaco, language, urlSimple, options);
    var binding = attachModelToLspConnection(monaco, model, editor, connection, options, attachOpts);
    connection.connect();
    return binding;
  }

  // ---------------------------------------------------------------------------------------------
  // Position/range conversion. Every conversion between the visible model and the LSP document
  // goes through these helpers, using a context {monaco, model, prefix} for the document the
  // positions belong to (for cross-file results: the TARGET document).
  // ---------------------------------------------------------------------------------------------

  /**
   * Get a live model by URI string.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} uriString The URI.
   * @returns {Object|null} The model.
   */
  function getLiveModel(monaco, uriString) {
    var found = null;
    try {
      found = monaco.editor.getModel(monaco.Uri.parse(uriString));
    } catch (e) {
      found = null;
    }
    if (found && found.isDisposed && found.isDisposed()) {
      return null;
    }
    return found || null;
  }

  /**
   * Build a conversion context for an arbitrary model, using the prefix of whichever connection
   * it is attached to (none if it isn't attached).
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} model The model.
   * @returns {Object} {monaco, model, modelUri, prefix, connection}.
   */
  function contextForModel(monaco, model) {
    var modelUri = model.uri.toString();
    var owner = findModelOwner(modelUri, false);
    return {
      monaco: monaco,
      model: model,
      modelUri: modelUri,
      prefix: owner ? (owner.connection.modelPrefixes.get(modelUri) || EMPTY_PREFIX) : EMPTY_PREFIX,
      connection: owner ? owner.connection : null
    };
  }

  /**
   * Build a conversion context for the document a URI reported by a server refers to.
   * Alias URIs (x.tpp for a tpp_x.h model) resolve to the attached model.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} uriString Document URI.
   * @returns {Object|null} Context, or null if there is no live model for the URI.
   */
  function contextForUri(monaco, uriString) {
    if (!uriString) {
      return null;
    }
    var model = getLiveModel(monaco, uriString);
    if (!model) {
      var aliasOwner = findModelOwner(uriString, true);
      if (aliasOwner && aliasOwner.modelUri !== uriString) {
        model = getLiveModel(monaco, aliasOwner.modelUri);
      }
    }
    return model ? contextForModel(monaco, model) : null;
  }

  /**
   * Convert a Monaco position (1-based) to an LSP position in the document.
   *
   * @param {Object} ctx Conversion context.
   * @param {Object} pos Monaco position {lineNumber, column}.
   * @returns {Object} LSP position.
   */
  function lspPositionFromMonaco(ctx, pos) {
    var line = Math.max(0, (pos.lineNumber || 1) - 1);
    var character = Math.max(0, (pos.column || 1) - 1);
    return lspPositionFromVisible(ctx.prefix, line, character);
  }

  /**
   * Convert a Monaco range to an LSP range in the document.
   *
   * @param {Object} ctx Conversion context.
   * @param {Object} range Monaco range.
   * @returns {Object} LSP range.
   */
  function lspRangeFromMonaco(ctx, range) {
    return {
      start: lspPositionFromMonaco(ctx, { lineNumber: range.startLineNumber, column: range.startColumn }),
      end: lspPositionFromMonaco(ctx, { lineNumber: range.endLineNumber, column: range.endColumn })
    };
  }

  /**
   * Whether a value is a well-formed LSP position.
   *
   * @param {*} pos
   * @returns {boolean}
   */
  function isLspPosition(pos) {
    return !!pos && typeof pos.line === 'number' && typeof pos.character === 'number' &&
      !isNaN(pos.line) && !isNaN(pos.character);
  }

  /**
   * Clamp a 0-based visible position to the model and return 1-based {lineNumber, column}.
   *
   * @param {Object|null} model The model (no clamping if null).
   * @param {Object} pos Visible 0-based position.
   * @returns {Object} {lineNumber, column}.
   */
  function clampToModel(model, pos) {
    var lineNumber = Math.max(1, pos.line + 1);
    var column = Math.max(1, pos.character + 1);
    if (model) {
      var lineCount = model.getLineCount();
      if (lineNumber > lineCount) {
        lineNumber = lineCount;
      }
      var maxColumn = model.getLineMaxColumn(lineNumber);
      if (column > maxColumn) {
        column = maxColumn;
      }
    }
    return { lineNumber: lineNumber, column: column };
  }

  /**
   * Convert an LSP range to a Monaco range in the visible model. Ranges entirely inside the
   * prefix give null; ranges that start in the prefix but end in the student's code are clamped
   * to start at the beginning of the visible model, unless strict (used for edits, where
   * clamping would change what is replaced), in which case they give null too.
   *
   * @param {Object} ctx Conversion context.
   * @param {Object} r LSP range.
   * @param {boolean} [strict] Drop ranges that start inside the prefix.
   * @returns {Object|null} Monaco Range, or null.
   */
  function monacoRangeFromLsp(ctx, r, strict) {
    if (!r || !isLspPosition(r.start) || !isLspPosition(r.end)) {
      return null;
    }
    var start = visiblePositionFromLsp(ctx.prefix, r.start);
    if (!start) {
      if (strict || isPositionAtOrBeforePrefixEnd(ctx.prefix, r.end)) {
        return null;
      }
      start = { line: 0, character: 0 };
    }
    var end = visiblePositionFromLsp(ctx.prefix, r.end) || { line: 0, character: 0 };
    var s = clampToModel(ctx.model, start);
    var e = clampToModel(ctx.model, end);
    if (e.lineNumber < s.lineNumber || (e.lineNumber === s.lineNumber && e.column < s.column)) {
      e = s;
    }
    return new ctx.monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column);
  }

  /**
   * Convert an LSP position to a Monaco position in the visible model.
   *
   * @param {Object} ctx Conversion context.
   * @param {Object} pos LSP position.
   * @returns {Object|null} Monaco Position, or null if invalid or inside the prefix.
   */
  function monacoPositionFromLsp(ctx, pos) {
    if (!isLspPosition(pos)) {
      return null;
    }
    var visible = visiblePositionFromLsp(ctx.prefix, pos);
    if (!visible) {
      return null;
    }
    var p = clampToModel(ctx.model, visible);
    return new ctx.monaco.Position(p.lineNumber, p.column);
  }

  /**
   * Convert an LSP Location/LocationLink to a Monaco location, using the TARGET document's prefix.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} lspLoc LSP Location or LocationLink.
   * @param {Object} [fallbackCtx] Context used when the location has no URI.
   * @returns {Object|null} {uri, range}, or null if there is no model for it or it is in the prefix.
   */
  function toMonacoLocation(monaco, lspLoc, fallbackCtx) {
    if (!lspLoc) {
      return null;
    }
    var uriString = lspLoc.uri || lspLoc.targetUri;
    // Locations without a Monaco model (e.g. library files) can't be shown.
    var targetCtx = uriString ? contextForUri(monaco, uriString) : fallbackCtx;
    if (!targetCtx || !targetCtx.model) {
      return null;
    }
    var range = monacoRangeFromLsp(targetCtx, lspLoc.range || lspLoc.targetSelectionRange || lspLoc.targetRange);
    if (!range) {
      return null;
    }
    return { uri: targetCtx.model.uri, range: range };
  }

  /**
   * Convert LSP location results to Monaco locations, dropping ones without a model.
   *
   * @param {Object} ctx Context of the requesting model.
   * @param {Array|Object} results LSP Location(s) or LocationLink(s).
   * @returns {Array} Monaco locations.
   */
  function toMonacoLocations(ctx, results) {
    if (!results) {
      return [];
    }
    var arr = Array.isArray(results) ? results : [results];
    var mapped = [];
    for (var i = 0; i < arr.length; i++) {
      var loc = toMonacoLocation(ctx.monaco, arr[i], ctx);
      if (loc) {
        mapped.push(loc);
      }
    }
    return mapped;
  }

  /**
   * Convert LSP TextEdits to Monaco edit operations (edits touching the prefix are dropped).
   *
   * @param {Object} ctx Context of the edited document.
   * @param {Array} edits LSP TextEdits.
   * @returns {Array} Monaco edits {range, text}.
   */
  function toMonacoEdits(ctx, edits) {
    if (!Array.isArray(edits)) {
      return [];
    }
    var monacoEdits = [];
    for (var i = 0; i < edits.length; i++) {
      var edit = edits[i];
      if (!edit || !edit.range) {
        continue;
      }
      var range = monacoRangeFromLsp(ctx, edit.range, true);
      if (range) {
        monacoEdits.push({ range: range, text: edit.newText || '' });
      }
    }
    return monacoEdits;
  }

  /**
   * Convert LSP document highlights to Monaco format.
   *
   * @param {Object} ctx Conversion context.
   * @param {Array} items LSP DocumentHighlights.
   * @returns {Array} Monaco document highlights.
   */
  function toMonacoHighlights(ctx, items) {
    if (!Array.isArray(items)) {
      return [];
    }
    var Kind = ctx.monaco.languages.DocumentHighlightKind;
    var highlights = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var range = item && item.range ? monacoRangeFromLsp(ctx, item.range) : null;
      if (!range) {
        continue;
      }
      var kind = Kind.Text;
      if (item.kind === 2) {
        kind = Kind.Read;
      } else if (item.kind === 3) {
        kind = Kind.Write;
      }
      highlights.push({ range: range, kind: kind });
    }
    return highlights;
  }

  /**
   * Convert LSP document symbols (recursively) to Monaco format. Symbols whose name lies in the
   * prefix (e.g. the template's wrapping class) are dropped but their children are kept.
   *
   * @param {Object} ctx Conversion context.
   * @param {Array|Object} items LSP DocumentSymbol(s) or SymbolInformation(s).
   * @returns {Array} Monaco document symbols.
   */
  function toMonacoSymbols(ctx, items) {
    if (!items) {
      return [];
    }
    var arr = Array.isArray(items) ? items : [items];
    var results = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      if (!item) {
        continue;
      }
      var lspRange = item.range || (item.location && item.location.range);
      var range = lspRange ? monacoRangeFromLsp(ctx, lspRange) : null;
      if (!range) {
        continue; // Entirely inside the prefix (and so are its children).
      }
      var children = toMonacoSymbols(ctx, item.children || []);
      var lspSelection = item.selectionRange || lspRange;
      if (isLspPosition(lspSelection.start) && isPositionInPrefix(ctx.prefix, lspSelection.start)) {
        // The symbol itself belongs to the hidden template; keep what the student wrote inside it.
        Array.prototype.push.apply(results, children);
        continue;
      }
      var selectionRange = item.selectionRange ? monacoRangeFromLsp(ctx, item.selectionRange) : null;
      results.push({
        name: item.name || item.detail || '',
        detail: item.detail || item.containerName || '',
        kind: item.kind || ctx.monaco.languages.SymbolKind.Function,
        tags: item.tags || [],
        range: range,
        selectionRange: selectionRange || range,
        children: children
      });
    }
    return results;
  }

  /**
   * Map an LSP inlay hint kind to Monaco's InlayHintKind.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {number|string} kind LSP kind.
   * @returns {number|undefined} Monaco kind, if known.
   */
  function mapInlayHintKind(monaco, kind) {
    var HintKind = monaco.languages.InlayHintKind || {};
    if (kind === 1 || kind === 'Type') {
      return HintKind.Type || undefined;
    }
    if (kind === 2 || kind === 'Parameter') {
      return HintKind.Parameter || undefined;
    }
    return undefined;
  }

  /**
   * Convert LSP inlay hints to Monaco inlay hints, dropping hints inside the prefix.
   *
   * @param {Object} ctx Conversion context.
   * @param {Array|Object} items LSP inlay hint(s).
   * @returns {Array} Monaco inlay hints.
   */
  function toMonacoInlayHints(ctx, items) {
    if (!items) {
      return [];
    }
    var arr = Array.isArray(items) ? items : [items];
    var hints = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var position = item ? monacoPositionFromLsp(ctx, item.position) : null;
      if (!position) {
        continue;
      }
      var hint = {
        position: position,
        label: '',
        kind: mapInlayHintKind(ctx.monaco, item.kind),
        paddingLeft: !!item.paddingLeft,
        paddingRight: !!item.paddingRight
      };
      if (Array.isArray(item.label)) {
        hint.label = item.label.map(function(part) {
          var converted = { label: String(part.value || '') };
          if (part.tooltip) {
            converted.tooltip = part.tooltip;
          }
          if (part.location) {
            var loc = toMonacoLocation(ctx.monaco, part.location, ctx);
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
        hint.textEdits = toMonacoEdits(ctx, item.textEdits);
      }
      hints.push(hint);
    }
    return hints;
  }

  /**
   * Convert an LSP SelectionRange (and its parents) to Monaco format.
   *
   * @param {Object} ctx Conversion context.
   * @param {Object} node LSP SelectionRange.
   * @returns {Object|null} Monaco selection range, or null if invalid or inside the prefix.
   */
  function convertSelectionRangeNode(ctx, node) {
    if (!node) {
      return null;
    }
    var range = monacoRangeFromLsp(ctx, node.range);
    if (!range) {
      return null;
    }
    return {
      range: range,
      parent: convertSelectionRangeNode(ctx, node.parent)
    };
  }

  /**
   * Convert LSP selection ranges to Monaco format, dropping invalid ones.
   *
   * @param {Object} ctx Conversion context.
   * @param {Array|Object} items LSP SelectionRange(s).
   * @returns {Array} Monaco selection ranges.
   */
  function toMonacoSelectionRanges(ctx, items) {
    if (!items) {
      return [];
    }
    var arr = Array.isArray(items) ? items : [items];
    var converted = [];
    for (var i = 0; i < arr.length; i++) {
      var node = convertSelectionRangeNode(ctx, arr[i]);
      if (node) {
        converted.push(node);
      }
    }
    return converted;
  }

  /**
   * Convert LSP workspace symbols to Monaco format (each with its own document's prefix).
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Array|Object} items LSP symbol(s).
   * @returns {Array} Monaco workspace symbols.
   */
  function toMonacoWorkspaceSymbols(monaco, items) {
    if (!items) {
      return [];
    }
    var arr = Array.isArray(items) ? items : [items];
    var mapped = [];
    for (var i = 0; i < arr.length; i++) {
      var sym = arr[i];
      var location = sym && sym.location ? toMonacoLocation(monaco, sym.location, null) : null;
      if (!location) {
        continue;
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

  /**
   * Convert LSP folding ranges to Monaco format, dropping ones that start inside the prefix.
   *
   * @param {Object} ctx Conversion context.
   * @param {Array} ranges LSP FoldingRanges.
   * @returns {Array} Monaco folding ranges.
   */
  function toMonacoFoldingRanges(ctx, ranges) {
    if (!Array.isArray(ranges) || !ranges.length) {
      return [];
    }
    var prefix = ctx.prefix;
    var FoldingRangeKind = ctx.monaco.languages.FoldingRangeKind;
    var result = [];
    for (var i = 0; i < ranges.length; i++) {
      var r = ranges[i];
      if (!r || typeof r.startLine !== 'number' || typeof r.endLine !== 'number') {
        continue;
      }
      var startPos = {
        line: r.startLine,
        character: typeof r.startCharacter === 'number' ? r.startCharacter : prefix.lastLineLength
      };
      if (isPositionInPrefix(prefix, startPos)) {
        continue;
      }
      var start = (r.startLine - prefix.lineCount) + 1;
      var end = (r.endLine - prefix.lineCount) + 1;
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

  /**
   * Convert an LSP call/type hierarchy item to Monaco format, using its own document's prefix
   * (unmapped if that document has no model).
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} item LSP CallHierarchyItem / TypeHierarchyItem.
   * @param {number} defaultKind Symbol kind used if the item has none.
   * @returns {Object|null} Monaco item, or null if invalid or inside the prefix.
   */
  function toMonacoHierarchyItem(monaco, item, defaultKind) {
    if (!item || !item.uri) {
      return null;
    }
    var ctx = contextForUri(monaco, item.uri) || { monaco: monaco, model: null, prefix: EMPTY_PREFIX };
    var range = monacoRangeFromLsp(ctx, item.range);
    var selectionRange = monacoRangeFromLsp(ctx, item.selectionRange);
    if (!range || !selectionRange) {
      return null;
    }
    return {
      kind: item.kind || defaultKind,
      name: item.name,
      detail: item.detail || '',
      uri: ctx.model ? ctx.model.uri : monaco.Uri.parse(item.uri),
      range: range,
      selectionRange: selectionRange,
      _lspData: item
    };
  }

  /**
   * Convert hierarchy "fromRanges" (which lie in the caller's document) to Monaco ranges.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} uri URI of the document the ranges are in.
   * @param {Array} ranges LSP ranges.
   * @returns {Array} Monaco ranges.
   */
  function toMonacoRangesInUri(monaco, uri, ranges) {
    if (!Array.isArray(ranges)) {
      return [];
    }
    var ctx = contextForUri(monaco, uri) || { monaco: monaco, model: null, prefix: EMPTY_PREFIX };
    var result = [];
    for (var i = 0; i < ranges.length; i++) {
      var range = monacoRangeFromLsp(ctx, ranges[i]);
      if (range) {
        result.push(range);
      }
    }
    return result;
  }

  /**
   * Convert an LSP WorkspaceEdit to Monaco text edits plus file operations. Each document's edits
   * are mapped with that document's own prefix and clamped to its own model.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} workspaceEdit LSP WorkspaceEdit.
   * @returns {Object|null} {edits, fileOperations}, or null if there is nothing to do.
   */
  function convertWorkspaceEdit(monaco, workspaceEdit) {
    if (!workspaceEdit) {
      return null;
    }
    var edits = [];
    var pushTextEdits = function(uriString, lspEdits) {
      var ctx = contextForUri(monaco, uriString);
      if (!ctx) {
        return;
      }
      var converted = toMonacoEdits(ctx, lspEdits);
      for (var ce = 0; ce < converted.length; ce++) {
        edits.push({ resource: ctx.model.uri, textEdit: converted[ce] });
      }
    };
    if (workspaceEdit.changes) {
      for (var uri in workspaceEdit.changes) {
        if (!Object.prototype.hasOwnProperty.call(workspaceEdit.changes, uri)) {
          continue;
        }
        if (!contextForUri(monaco, uri)) {
          // Model doesn't exist - this is a file creation
          edits.push({
            kind: 'create',
            resource: monaco.Uri.parse(uri),
            initialContent: workspaceEdit.changes[uri]
          });
          continue;
        }
        pushTextEdits(uri, workspaceEdit.changes[uri]);
      }
    }
    if (workspaceEdit.documentChanges) {
      // Track which URIs have CreateFile operations so we can skip their TextDocumentEdits
      var createdFileUris = new Set();

      for (var d = 0; d < workspaceEdit.documentChanges.length; d++) {
        var docChange = workspaceEdit.documentChanges[d];
        if (!docChange) {
          continue;
        }

        // Handle CreateFile operations (for "Create class/interface/enum/record" code actions)
        if (docChange.kind === 'create' && docChange.uri) {
          createdFileUris.add(docChange.uri);

          // Look for the corresponding TextDocumentEdit with the file content
          var initialContent = null;
          for (var lookAhead = d + 1; lookAhead < workspaceEdit.documentChanges.length; lookAhead++) {
            var nextChange = workspaceEdit.documentChanges[lookAhead];
            if (nextChange && nextChange.textDocument && nextChange.textDocument.uri === docChange.uri && nextChange.edits) {
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
          var docUriString = docChange.textDocument.uri;
          // Skip if this is the content for a CreateFile operation (already processed)
          if (createdFileUris.has(docUriString)) {
            continue;
          }
          if (!contextForUri(monaco, docUriString)) {
            // Model doesn't exist - this is a file creation without explicit CreateFile
            edits.push({
              kind: 'create',
              resource: monaco.Uri.parse(docUriString),
              initialContent: docChange.edits
            });
            continue;
          }
          pushTextEdits(docUriString, docChange.edits);
        }
      }
    }
    if (!edits.length) {
      return null;
    }

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
   * Map a server's semantic token legend onto the fixed client legend.
   *
   * @param {Object} [legend] Server legend {tokenTypes, tokenModifiers}; identity if missing.
   * @returns {Object} {types: server index -> client index or -1, modifiers: server bit -> client bit or -1}.
   */
  function buildSemanticLegendMap(legend) {
    var serverTypes = legend && Array.isArray(legend.tokenTypes) ? legend.tokenTypes : CLIENT_SEMANTIC_TOKEN_TYPES;
    var serverModifiers = legend && Array.isArray(legend.tokenModifiers) ?
      legend.tokenModifiers : CLIENT_SEMANTIC_TOKEN_MODIFIERS;
    return {
      types: serverTypes.map(function(name) { return CLIENT_SEMANTIC_TOKEN_TYPES.indexOf(name); }),
      modifiers: serverModifiers.map(function(name) { return CLIENT_SEMANTIC_TOKEN_MODIFIERS.indexOf(name); })
    };
  }

  /**
   * Re-encode server semantic tokens for the visible model: drop tokens in the prefix, shift
   * lines (and columns on the prefix's last line), and map types/modifiers to the client legend
   * (tokens of unknown types are dropped).
   *
   * @param {Object} prefix Prefix info.
   * @param {Array} data Server data [deltaLine, deltaStart, length, type, modifiers, ...].
   * @param {Object} [legendMap] From buildSemanticLegendMap (identity if missing).
   * @returns {Uint32Array} Client-encoded data.
   */
  function remapSemanticTokens(prefix, data, legendMap) {
    var map = legendMap || buildSemanticLegendMap(null);
    var p = prefix || EMPTY_PREFIX;
    var out = [];
    var line = 0;
    var character = 0;
    var prevLine = 0;
    var prevCharacter = 0;
    for (var i = 0; i + 4 < data.length; i += 5) {
      if (data[i] > 0) {
        line += data[i];
        character = data[i + 1];
      } else {
        character += data[i + 1];
      }
      var visible = visiblePositionFromLsp(p, { line: line, character: character });
      if (!visible) {
        continue;
      }
      var type = map.types[data[i + 3]];
      if (typeof type !== 'number' || type < 0) {
        continue;
      }
      var serverModifiers = data[i + 4];
      var modifiers = 0;
      /* eslint-disable no-bitwise */
      for (var bit = 0; bit < map.modifiers.length; bit++) {
        if ((serverModifiers & (1 << bit)) && map.modifiers[bit] >= 0) {
          modifiers |= (1 << map.modifiers[bit]);
        }
      }
      /* eslint-enable no-bitwise */
      var deltaLine = visible.line - prevLine;
      out.push(deltaLine, deltaLine === 0 ? visible.character - prevCharacter : visible.character,
        data[i + 2], type, modifiers);
      prevLine = visible.line;
      prevCharacter = visible.character;
    }
    return new Uint32Array(out);
  }

  /**
   * Convert LSP documentation (string or MarkupContent) to a Monaco markdown string.
   *
   * @param {string|Object} content LSP documentation.
   * @returns {Object|undefined} {value}, or undefined if empty.
   */
  function toMonacoMarkupContent(content) {
    if (!content) {
      return undefined;
    }
    if (typeof content === 'string') {
      return { value: content };
    }
    if (content.value) {
      return { value: content.value };
    }
    return undefined;
  }

  /**
   * Convert an LSP SignatureHelp to Monaco format.
   *
   * @param {Object} res LSP SignatureHelp.
   * @returns {Object|null} Monaco SignatureHelp, or null if there are no signatures.
   */
  function toMonacoSignatureHelp(res) {
    if (!res || !res.signatures) {
      return null;
    }
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
          } else if (Array.isArray(param.label) && param.label.length === 2) {
            paramLabel = sigLabel.substring(param.label[0], param.label[1]);
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
    if (result.activeSignature >= result.signatures.length || result.activeSignature < 0) {
      result.activeSignature = 0;
    }
    if (result.activeParameter < 0) {
      result.activeParameter = 0;
    }
    return result;
  }

  /**
   * Map an LSP completion item kind (number or name) to Monaco's CompletionItemKind.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {number|string} k LSP kind.
   * @returns {number} Monaco kind (Text if unknown).
   */
  function mapCompletionKind(monaco, k) {
    var M = monaco.languages.CompletionItemKind;
    var names = ['Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface',
      'Module', 'Property', 'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference',
      'Folder', 'EnumMember', 'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter'];
    if (typeof k === 'number' && k >= 1 && k <= names.length) {
      return M[names[k - 1]];
    }
    if (typeof k === 'string') {
      var key = k.toLowerCase();
      for (var i = 0; i < names.length; i++) {
        if (names[i].toLowerCase() === key) {
          return M[names[i]];
        }
      }
    }
    return M.Text;
  }

  /**
   * Convert an LSP completion result to a Monaco completion list.
   *
   * @param {Object} ctx Context of the requesting model.
   * @param {Array|Object} result LSP CompletionItem[] or CompletionList.
   * @returns {Object} Monaco CompletionList {suggestions, incomplete}.
   */
  function toMonacoCompletionList(ctx, result) {
    var monaco = ctx.monaco;
    var isList = !!result && !Array.isArray(result);
    var items = Array.isArray(result) ? result : (isList && Array.isArray(result.items) ? result.items : []);
    var suggestions = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var textEdit = it.textEdit || null;
      var range;
      if (textEdit && textEdit.range) {
        range = monacoRangeFromLsp(ctx, textEdit.range, true);
        if (!range) {
          continue; // Edit inside the prefix.
        }
      } else if (textEdit && textEdit.insert && textEdit.replace) {
        var insertRange = monacoRangeFromLsp(ctx, textEdit.insert, true);
        var replaceRange = monacoRangeFromLsp(ctx, textEdit.replace, true);
        if (!insertRange || !replaceRange) {
          continue;
        }
        range = { insert: insertRange, replace: replaceRange };
      }
      var insertTextSource = (textEdit && typeof textEdit.newText === 'string') ? textEdit.newText :
        (typeof it.insertText === 'string' ? it.insertText : it.label || '');
      var sug = {
        label: String(it.label || ''),
        kind: mapCompletionKind(monaco, it.kind),
        insertText: String(insertTextSource || ''),
        range: range,
        detail: it.detail,
        documentation: it.documentation &&
          (typeof it.documentation === 'string' ? { value: it.documentation } : it.documentation),
        sortText: typeof it.sortText === 'string' ? it.sortText : undefined,
        filterText: typeof it.filterText === 'string' ? it.filterText : undefined
      };
      if (Array.isArray(it.additionalTextEdits) && it.additionalTextEdits.length) {
        sug.additionalTextEdits = toMonacoEdits(ctx, it.additionalTextEdits);
      }
      if (it.preselect) {
        sug.preselect = true;
      }
      if (it.insertTextFormat === 2 || it.insertTextFormat === 'snippet') {
        sug.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      }
      suggestions.push(sug);
    }
    return {
      suggestions: suggestions,
      incomplete: isList && result.isIncomplete === true,
      dispose: function() {}
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Monaco providers. They are registered once per language (refcounted by the live connections
  // for that language) and, for each request, find the connection that owns the model. Models
  // that no connection owns get an empty result and nothing is sent.
  // ---------------------------------------------------------------------------------------------

  // Key: language id, Value: {refCount, disposables, documentSymbolProvider}.
  var languageProviderRegistry = {};
  // Workspace symbols aren't per language: one provider for all connections.
  var workspaceSymbolRegistration = { refCount: 0, disposable: null };

  /**
   * Find the connection owning a model and build the request context for it.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} model The model a provider was called for.
   * @param {string} [requirement] 'rich', 'inlayHints' or 'semantic' to also require that feature.
   * @returns {Object|null} {monaco, connection, model, modelUri, docUri, prefix, options}, or null.
   */
  function getRequestContext(monaco, model, requirement) {
    if (!model || !model.uri || (model.isDisposed && model.isDisposed())) {
      return null;
    }
    var modelUri = model.uri.toString();
    var owner = findModelOwner(modelUri, false);
    if (!owner) {
      return null;
    }
    var connection = owner.connection;
    var options = (connection.modelOptions && connection.modelOptions.get(modelUri)) || normaliseModelOptions({});
    if (requirement === 'rich' && !options.richFeatures) {
      return null;
    }
    if (requirement === 'inlayHints' && !options.inlayHints) {
      return null;
    }
    if (requirement === 'semantic' && !(options.richFeatures && options.semanticHighlighting)) {
      return null;
    }
    return {
      monaco: monaco,
      connection: connection,
      model: model,
      modelUri: modelUri,
      docUri: modelUri,
      prefix: connection.modelPrefixes.get(modelUri) || EMPTY_PREFIX,
      options: options
    };
  }

  /**
   * Formatting edits can't be mapped reliably when a hidden prefix precedes the code.
   *
   * @param {Object} ctx Request context.
   * @returns {boolean} True if the document has a prefix.
   */
  function hasPrefix(ctx) {
    return ctx.prefix.lineCount > 0 || ctx.prefix.lastLineLength > 0;
  }

  /**
   * Monaco/LSP formatting options for a model.
   *
   * @param {Object} model The model.
   * @param {Object} optionsLocal Monaco FormattingOptions.
   * @returns {Object} LSP FormattingOptions.
   */
  function lspFormattingOptions(model, optionsLocal) {
    var modelOptions = model.getOptions();
    return {
      tabSize: (optionsLocal && optionsLocal.tabSize) || modelOptions.tabSize,
      insertSpaces: optionsLocal && typeof optionsLocal.insertSpaces === 'boolean' ?
        optionsLocal.insertSpaces : modelOptions.insertSpaces
    };
  }

  /**
   * Distinct target URIs of a converted workspace edit.
   *
   * @param {Object} edit Converted edit {edits}.
   * @returns {Array} URI strings.
   */
  function editTargetUris(edit) {
    var targetUris = [];
    var entries = edit && edit.edits ? edit.edits : [];
    for (var ei = 0; ei < entries.length; ei++) {
      var uriString = entries[ei].resource ? entries[ei].resource.toString() : null;
      if (uriString && targetUris.indexOf(uriString) === -1) {
        targetUris.push(uriString);
      }
    }
    return targetUris;
  }

  /**
   * Monaco command wrapping an LSP command, routed to the connection owning modelUri. Monaco
   * runs it only when the user picks the code action (after applying the action's edit), so
   * nothing is executed merely because an action was offered.
   *
   * @param {Object} lspCommand LSP Command.
   * @param {string} title Fallback title.
   * @param {string} modelUri URI of the model the command was offered for.
   * @param {Object} [edit] The converted edit Monaco applies before running the command, if any.
   * @param {boolean} [editFromArguments] True if that edit was taken from the command's own
   *     arguments, so the command must not apply it a second time.
   * @returns {Object} Monaco Command.
   */
  function toMonacoExecuteCommand(lspCommand, title, modelUri, edit, editFromArguments) {
    var routing = { modelUri: modelUri };
    var targets = editTargetUris(edit);
    if (targets.length) {
      routing.editTargetUris = targets;
    }
    if (editFromArguments) {
      routing.editApplied = true;
    }
    return {
      id: EXECUTE_COMMAND_ID,
      title: lspCommand.title || title,
      arguments: [lspCommand, routing]
    };
  }

  /**
   * Register all LSP-backed Monaco providers for one language.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} language Monaco language id.
   * @returns {Object} {disposables, documentSymbolProvider}.
   */
  function registerLanguageProviders(monaco, language) {
    var languages = monaco.languages;
    var disposables = [];
    var register = function(name, provider) {
      if (typeof languages[name] !== 'function') {
        return;
      }
      try {
        var disposable = languages[name](language, provider);
        if (disposable && typeof disposable.dispose === 'function') {
          disposables.push(disposable);
        }
      } catch (e) {
        if (root && root.console && typeof root.console.warn === 'function') {
          root.console.warn('[lmsMonaco] Could not register ' + name, e);
        }
      }
    };
    var noop = function() {};
    var empty = function() { return []; };

    /**
     * Provider for requests at a single position returning locations.
     *
     * @param {string} method LSP method.
     * @param {boolean} rewriteUris Apply the tpp URI rewriters to the results.
     * @returns {Function} Provider function (model, position).
     */
    var locationProvider = function(method, rewriteUris) {
      return function(model, position) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return [];
        }
        return ctx.connection.request(method, {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(results) {
          return toMonacoLocations(ctx, rewriteUris ? rewriteLocationsWithUriRewriters(results) : results);
        }).catch(empty);
      };
    };

    // Completion.
    var triggerCharacters = ['.', ':', '>', '"', '\'', '/', '\\'];
    if (language === 'html') {
      // Enable Emmet multiplier suggestions without manual trigger.
      triggerCharacters = triggerCharacters.concat(['*', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    }
    register('registerCompletionItemProvider', {
      triggerCharacters: triggerCharacters,
      provideCompletionItems: function(model, position, context) {
        var ctx = getRequestContext(monaco, model);
        if (!ctx) {
          return { suggestions: [] };
        }
        // Monaco: 0 Invoke, 1 TriggerCharacter, 2 TriggerForIncompleteCompletions; LSP is 1-based.
        var monacoKind = context && typeof context.triggerKind === 'number' ? context.triggerKind : 0;
        var completionContext = { triggerKind: monacoKind === 1 ? 2 : (monacoKind === 2 ? 3 : 1) };
        if (monacoKind === 1 && context.triggerCharacter) {
          completionContext.triggerCharacter = context.triggerCharacter;
        }
        return ctx.connection.request('textDocument/completion', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position),
          context: completionContext
        }).then(function(result) {
          return toMonacoCompletionList(ctx, result);
        }).catch(function() { return { suggestions: [] }; });
      }
    });

    // Hover.
    register('registerHoverProvider', {
      provideHover: function(model, position) {
        var ctx = getRequestContext(monaco, model);
        if (!ctx) {
          return null;
        }
        return ctx.connection.request('textDocument/hover', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(res) {
          if (!res) {
            return null;
          }
          var contents = [];
          if (res.contents) {
            if (typeof res.contents === 'string') {
              contents.push({ value: res.contents });
            } else if (Array.isArray(res.contents)) {
              for (var i = 0; i < res.contents.length; i++) {
                var c = res.contents[i];
                if (c) {
                  contents.push(typeof c === 'string' ? { value: c } : (c.value ? { value: c.value } : c));
                }
              }
            } else if (res.contents.value) {
              contents.push({ value: res.contents.value });
            }
          }
          for (var ci = 0; ci < contents.length; ci++) {
            if (contents[ci] && contents[ci].value) {
              contents[ci].value = rewriteTppShimName(contents[ci].value);
            }
          }
          return { contents: contents, range: (res.range && monacoRangeFromLsp(ctx, res.range)) || undefined };
        }).catch(function() { return null; });
      }
    });

    // Folding (LSP folding only for HTML; other languages keep Monaco's own folding).
    if (language === 'html') {
      register('registerFoldingRangeProvider', {
        provideFoldingRanges: function(model) {
          var ctx = getRequestContext(monaco, model);
          if (!ctx) {
            return [];
          }
          return ctx.connection.request('textDocument/foldingRange', { textDocument: { uri: ctx.docUri } })
            .then(function(ranges) { return toMonacoFoldingRanges(ctx, ranges); })
            .catch(empty);
        }
      });
    }

    // Inlay hints (per model: off unless enableInlayHints, e.g. off for read-only editors).
    register('registerInlayHintsProvider', {
      provideInlayHints: function(model, range) {
        var none = { hints: [], dispose: noop };
        var ctx = getRequestContext(monaco, model, 'inlayHints');
        if (!ctx) {
          return none;
        }
        var params = { textDocument: { uri: ctx.docUri } };
        if (range && typeof range.startLineNumber === 'number' && typeof range.endLineNumber === 'number') {
          params.range = lspRangeFromMonaco(ctx, range);
        }
        return ctx.connection.request('textDocument/inlayHint', params).then(function(res) {
          return { hints: toMonacoInlayHints(ctx, res), dispose: noop };
        }).catch(function() { return none; });
      }
    });

    // Everything below is a "rich" feature: off for models attached with richFeatures false.
    register('registerDefinitionProvider', { provideDefinition: locationProvider('textDocument/definition', true) });
    register('registerDeclarationProvider', { provideDeclaration: locationProvider('textDocument/declaration', true) });
    register('registerTypeDefinitionProvider', {
      provideTypeDefinition: locationProvider('textDocument/typeDefinition', true)
    });
    register('registerImplementationProvider', {
      provideImplementation: locationProvider('textDocument/implementation', true)
    });

    register('registerReferenceProvider', {
      provideReferences: function(model, position, context) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return [];
        }
        return ctx.connection.request('textDocument/references', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position),
          context: { includeDeclaration: !!(context && context.includeDeclaration) }
        }).then(function(results) {
          return toMonacoLocations(ctx, results);
        }).catch(empty);
      }
    });

    register('registerDocumentHighlightProvider', {
      provideDocumentHighlights: function(model, position) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return [];
        }
        return ctx.connection.request('textDocument/documentHighlight', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(items) {
          return toMonacoHighlights(ctx, items);
        }).catch(empty);
      }
    });

    register('registerSelectionRangeProvider', {
      provideSelectionRanges: function(model, positions) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return [];
        }
        return ctx.connection.request('textDocument/selectionRange', {
          textDocument: { uri: ctx.docUri },
          positions: positions.map(function(pos) { return lspPositionFromMonaco(ctx, pos); })
        }).then(function(res) {
          return toMonacoSelectionRanges(ctx, res);
        }).catch(empty);
      }
    });

    // Document symbols (also used directly by the multi-file outline panel).
    var documentSymbolProvider = {
      provideDocumentSymbols: function(model) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return [];
        }
        return ctx.connection.request('textDocument/documentSymbol', { textDocument: { uri: ctx.docUri } })
          .then(function(symbols) { return toMonacoSymbols(ctx, symbols); })
          .catch(empty);
      }
    };
    register('registerDocumentSymbolProvider', documentSymbolProvider);

    register('registerSignatureHelpProvider', {
      signatureHelpTriggerCharacters: ['(', ',', '<'],
      provideSignatureHelp: function(model, position) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return null;
        }
        return ctx.connection.request('textDocument/signatureHelp', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(res) {
          var converted = toMonacoSignatureHelp(res);
          if (!converted) {
            return null;
          }
          var hasContent = converted.signatures.some(function(sig) {
            return (sig.label && sig.label.trim()) || (Array.isArray(sig.parameters) && sig.parameters.length);
          });
          return hasContent ? { value: converted, dispose: noop } : null;
        }).catch(function() { return null; });
      }
    });

    register('registerRenameProvider', {
      provideRenameEdits: function(model, position, newName) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return null;
        }
        return ctx.connection.request('textDocument/rename', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position),
          newName: newName
        }).then(function(result) {
          // Each file's edits are mapped with that file's own prefix.
          return convertWorkspaceEdit(monaco, result);
        }).catch(function(err) {
          if (err && err.message) {
            throw err;
          }
          throw new Error('Rename request failed');
        });
      },
      resolveRenameLocation: function(model, position) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return null;
        }
        return ctx.connection.request('textDocument/prepareRename', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(res) {
          if (!res) {
            return null;
          }
          var lspRange = res.range || (res.start && res.end ? res : null);
          var range = lspRange ? monacoRangeFromLsp(ctx, lspRange, true) : null;
          if (!range) {
            return null;
          }
          var text = typeof res.placeholder === 'string' ? res.placeholder : model.getValueInRange(range);
          return { range: range, text: text };
        }).catch(function() { return null; });
      }
    });

    register('registerLinkedEditingRangeProvider', {
      provideLinkedEditingRanges: function(model, position) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return null;
        }
        return ctx.connection.request('textDocument/linkedEditingRange', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(result) {
          if (!result || !Array.isArray(result.ranges)) {
            return null;
          }
          var ranges = [];
          for (var i = 0; i < result.ranges.length; i++) {
            var range = monacoRangeFromLsp(ctx, result.ranges[i], true);
            if (range) {
              ranges.push(range);
            }
          }
          return ranges.length > 0 ? { ranges: ranges, wordPattern: result.wordPattern } : null;
        }).catch(function() { return null; });
      }
    });

    register('registerOnTypeFormattingEditProvider', {
      autoFormatTriggerCharacters: [';', '\n', '}'],
      provideOnTypeFormattingEdits: function(model, position, ch, optionsLocal) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx || hasPrefix(ctx)) {
          return [];
        }
        var triggers = ctx.options.onTypeFormattingTriggers;
        if (triggers && triggers.indexOf(ch) === -1) {
          return [];
        }
        return ctx.connection.request('textDocument/onTypeFormatting', {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position),
          ch: ch,
          options: lspFormattingOptions(model, optionsLocal)
        }).then(function(edits) {
          return toMonacoEdits(ctx, edits);
        }).catch(empty);
      }
    });

    register('registerDocumentFormattingEditProvider', {
      provideDocumentFormattingEdits: function(model, optionsLocal) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx || hasPrefix(ctx)) {
          return [];
        }
        var formattingOptions = lspFormattingOptions(model, optionsLocal);
        formattingOptions.trimTrailingWhitespace = true;
        formattingOptions.insertFinalNewline = true;
        formattingOptions.trimFinalNewlines = true;
        return ctx.connection.request('textDocument/formatting', {
          textDocument: { uri: ctx.docUri },
          options: formattingOptions
        }).then(function(edits) {
          return toMonacoEdits(ctx, edits);
        }).catch(empty);
      }
    });

    register('registerDocumentRangeFormattingEditProvider', {
      provideDocumentRangeFormattingEdits: function(model, range, optionsLocal) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx || hasPrefix(ctx)) {
          return [];
        }
        return ctx.connection.request('textDocument/rangeFormatting', {
          textDocument: { uri: ctx.docUri },
          range: lspRangeFromMonaco(ctx, range),
          options: lspFormattingOptions(model, optionsLocal)
        }).then(function(edits) {
          return toMonacoEdits(ctx, edits);
        }).catch(empty);
      }
    });

    register('registerCodeActionProvider', {
      provideCodeActions: function(model, range, context) {
        var none = { actions: [], dispose: noop };
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return none;
        }
        // Monaco's trigger (1 Invoke, 2 Auto) matches LSP's CodeActionTriggerKind.
        var lspContext = {
          diagnostics: ctx.connection.lastDiagnosticsByUri.get(ctx.docUri) || [],
          triggerKind: context && context.trigger !== undefined ? context.trigger : 2
        };
        // Monaco may provide 'only' as a string or array, LSP requires array.
        if (context && context.only) {
          lspContext.only = Array.isArray(context.only) ? context.only : [context.only];
        }
        return ctx.connection.request('textDocument/codeAction', {
          textDocument: { uri: ctx.docUri },
          range: lspRangeFromMonaco(ctx, range),
          context: lspContext
        }).then(function(res) {
          var actions = [];
          var arr = Array.isArray(res) ? res : [];
          for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            if (!item) {
              continue;
            }
            // A bare LSP Command has a string 'command'; a CodeAction may carry a Command object.
            var isBareCommand = typeof item.command === 'string';
            var lspCommand = isBareCommand ?
              { title: item.title, command: item.command, arguments: item.arguments } : (item.command || null);
            var monacoAction = {
              title: item.title || (lspCommand && lspCommand.title) || 'Code Action',
              diagnostics: context && context.markers ? context.markers : [],
              kind: item.kind,
              isPreferred: !!item.isPreferred,
              _lspModelUri: ctx.modelUri
            };

            // Preserve the LSP data field (and command, which the server expects echoed back)
            // for codeAction/resolve.
            if (item.data) {
              monacoAction._lspData = {
                title: item.title,
                kind: item.kind,
                data: item.data,
                diagnostics: item.diagnostics
              };
              if (item.command) {
                monacoAction._lspData.command = item.command;
              }
            }

            var editFromArguments = false;
            if (item.edit) {
              monacoAction.edit = convertWorkspaceEdit(monaco, item.edit);
            }
            // Command-based actions may carry their workspace edit in the arguments.
            if (!monacoAction.edit && isBareCommand && Array.isArray(lspCommand.arguments)) {
              for (var argIndex = 0; argIndex < lspCommand.arguments.length; argIndex++) {
                var argument = lspCommand.arguments[argIndex];
                if (argument && (argument.changes || argument.documentChanges)) {
                  monacoAction.edit = convertWorkspaceEdit(monaco, argument);
                  editFromArguments = true;
                  break;
                }
              }
            }
            var hasEdit = monacoAction.edit && monacoAction.edit.edits && monacoAction.edit.edits.length > 0;
            if (!hasEdit) {
              delete monacoAction.edit;
              editFromArguments = false;
            }

            // Code actions can have both an edit and a command. When the user picks the action
            // Monaco applies the edit and then runs the command; nothing runs just because the
            // action is offered.
            if (lspCommand && lspCommand.command) {
              monacoAction._lspCommand = lspCommand;
              monacoAction.command = toMonacoExecuteCommand(lspCommand, monacoAction.title, ctx.modelUri,
                monacoAction.edit, editFromArguments);
            }

            if (hasEdit) {
              var targetUris = editTargetUris(monacoAction.edit);
              var modifiesOtherFiles = targetUris.some(function(uri) { return uri !== ctx.modelUri; });
              if (!monacoAction._lspCommand && modifiesOtherFiles) {
                // No explicit command, but this edit modifies other files (e.g. jdtls):
                // let the UI refresh the current file afterwards.
                notifyWorkspaceEditWillAffect({ targetFiles: targetUris, originFile: ctx.modelUri });
              }
              actions.push(monacoAction);
            } else if (monacoAction._lspData || monacoAction.command) {
              // Resolved when selected (resolveCodeAction), or a command-only action.
              actions.push(monacoAction);
            }
          }
          return { actions: actions, dispose: noop };
        }).catch(function() {
          // Code action errors (not connected, server errors) aren't actionable by users.
          return none;
        });
      },

      resolveCodeAction: function(codeAction) {
        // Even if the action has an edit, resolve it to get the command field.
        if (!codeAction._lspData) {
          return codeAction;
        }
        var owner = findModelOwner(codeAction._lspModelUri, false);
        if (!owner) {
          return codeAction;
        }
        return owner.connection.request('codeAction/resolve', codeAction._lspData).then(function(resolved) {
          if (!resolved) {
            return codeAction;
          }
          if (resolved.edit) {
            var converted = convertWorkspaceEdit(monaco, resolved.edit);
            // File creations are applied immediately (before the text edits).
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
            codeAction.edit = converted && converted.edits && converted.edits.length > 0 ?
              { edits: converted.edits } : null;
          }
          if (resolved.command && resolved.command.command) {
            // Run by Monaco (after the edit) only because the user picked this action.
            codeAction._lspCommand = resolved.command;
            codeAction.command = toMonacoExecuteCommand(resolved.command, codeAction.title, owner.modelUri,
              codeAction.edit, false);
          }
          return codeAction;
        }).catch(function() {
          return codeAction;
        });
      }
    });

    // Document links (clickable imports/includes/URLs).
    register('registerLinkProvider', {
      provideLinks: function(model) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return { links: [] };
        }
        return ctx.connection.request('textDocument/documentLink', { textDocument: { uri: ctx.docUri } })
          .then(function(links) {
            var monacoLinks = [];
            var arr = Array.isArray(links) ? links : [];
            for (var i = 0; i < arr.length; i++) {
              var link = arr[i];
              if (!link || !link.range || typeof link.target !== 'string' || !link.target.length) {
                continue;
              }
              var range = monacoRangeFromLsp(ctx, link.range);
              if (!range) {
                continue;
              }
              var monacoLink = {
                range: range,
                // Point LSP tpp_* header shims back to their original .tpp files.
                url: link.target.replace(/\/tpp_([^\/]+)\.h$/i, '/$1.tpp')
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
    });

    // Code lenses (inline reference counts and actions).
    register('registerCodeLensProvider', {
      provideCodeLenses: function(model) {
        var none = { lenses: [], dispose: noop };
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return none;
        }
        return ctx.connection.request('textDocument/codeLens', { textDocument: { uri: ctx.docUri } })
          .then(function(lenses) {
            var monacoLenses = [];
            var arr = Array.isArray(lenses) ? lenses : [];
            for (var i = 0; i < arr.length; i++) {
              var lens = arr[i];
              var range = lens && lens.range ? monacoRangeFromLsp(ctx, lens.range) : null;
              if (!range) {
                continue;
              }
              var monacoLens = { range: range, _lspData: lens };
              if (lens.command) {
                monacoLens.command = {
                  id: lens.command.command,
                  title: lens.command.title,
                  arguments: lens.command.arguments
                };
              }
              monacoLenses.push(monacoLens);
            }
            return { lenses: monacoLenses, dispose: noop };
          })
          .catch(function() { return none; });
      },
      resolveCodeLens: function(model, codeLens) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx || !codeLens._lspData || !codeLens._lspData.data) {
          return codeLens;
        }
        return ctx.connection.request('codeLens/resolve', codeLens._lspData)
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
    });

    /**
     * Connection for a follow-up hierarchy request: the one owning the model the hierarchy was
     * prepared for, else the one owning the model passed in.
     *
     * @param {Object} model Model passed by Monaco (may be absent).
     * @param {Object} item Monaco hierarchy item.
     * @returns {Object|null} Connection.
     */
    var hierarchyConnection = function(model, item) {
      var owner = item && item._lspOwnerUri ? findModelOwner(item._lspOwnerUri, false) : null;
      if (owner) {
        return owner.connection;
      }
      var ctx = getRequestContext(monaco, model, 'rich');
      return ctx ? ctx.connection : null;
    };
    var convertHierarchyItems = function(items, defaultKind, ownerUri) {
      var arr = Array.isArray(items) ? items : (items ? [items] : []);
      var result = [];
      for (var i = 0; i < arr.length; i++) {
        var converted = toMonacoHierarchyItem(monaco, arr[i], defaultKind);
        if (converted) {
          converted._lspOwnerUri = ownerUri;
          result.push(converted);
        }
      }
      return result;
    };
    var prepareHierarchy = function(method, defaultKind) {
      return function(model, position) {
        var ctx = getRequestContext(monaco, model, 'rich');
        if (!ctx) {
          return [];
        }
        return ctx.connection.request(method, {
          textDocument: { uri: ctx.docUri },
          position: lspPositionFromMonaco(ctx, position)
        }).then(function(items) {
          return convertHierarchyItems(items, defaultKind(), ctx.modelUri);
        }).catch(empty);
      };
    };
    var functionKind = function() { return monaco.languages.SymbolKind.Function; };
    var classKind = function() { return monaco.languages.SymbolKind.Class; };
    var hierarchyCalls = function(method, ownKey) {
      return function(model, item) {
        var connection = item && item._lspData ? hierarchyConnection(model, item) : null;
        if (!connection) {
          return [];
        }
        return connection.request(method, { item: item._lspData }).then(function(calls) {
          var result = [];
          var arr = Array.isArray(calls) ? calls : [];
          for (var i = 0; i < arr.length; i++) {
            var call = arr[i];
            if (!call || !call[ownKey]) {
              continue;
            }
            var converted = toMonacoHierarchyItem(monaco, call[ownKey], functionKind());
            if (!converted) {
              continue;
            }
            converted._lspOwnerUri = item._lspOwnerUri;
            var entry = {};
            entry[ownKey] = converted;
            // fromRanges are in the caller's document: the 'from' item for incoming calls,
            // the original item for outgoing calls.
            var rangesUri = ownKey === 'from' ? call.from.uri : item._lspData.uri;
            entry.fromRanges = toMonacoRangesInUri(monaco, rangesUri, call.fromRanges);
            result.push(entry);
          }
          return result;
        }).catch(empty);
      };
    };
    var hierarchyTypes = function(method) {
      return function(model, item) {
        var connection = item && item._lspData ? hierarchyConnection(model, item) : null;
        if (!connection) {
          return [];
        }
        return connection.request(method, { item: item._lspData }).then(function(items) {
          return convertHierarchyItems(items, classKind(), item._lspOwnerUri);
        }).catch(empty);
      };
    };

    // Call/type hierarchy: standalone Monaco has no UI for these; the providers only serve
    // external integrations.
    register('registerCallHierarchyProvider', {
      prepareCallHierarchy: prepareHierarchy('textDocument/prepareCallHierarchy', functionKind),
      provideCallHierarchyIncomingCalls: hierarchyCalls('callHierarchy/incomingCalls', 'from'),
      provideCallHierarchyOutgoingCalls: hierarchyCalls('callHierarchy/outgoingCalls', 'to')
    });
    register('registerTypeHierarchyProvider', {
      prepareTypeHierarchy: prepareHierarchy('textDocument/prepareTypeHierarchy', classKind),
      provideTypeHierarchySupertypes: hierarchyTypes('typeHierarchy/supertypes'),
      provideTypeHierarchySubtypes: hierarchyTypes('typeHierarchy/subtypes')
    });

    // Semantic tokens (per model: needs semanticHighlighting). Fixed client legend; each
    // connection maps its server's legend onto it.
    register('registerDocumentSemanticTokensProvider', {
      getLegend: function() {
        return {
          tokenTypes: CLIENT_SEMANTIC_TOKEN_TYPES.slice(),
          tokenModifiers: CLIENT_SEMANTIC_TOKEN_MODIFIERS.slice()
        };
      },
      provideDocumentSemanticTokens: function(model) {
        var none = { data: new Uint32Array(0) };
        var ctx = getRequestContext(monaco, model, 'semantic');
        if (!ctx) {
          return none;
        }
        return ctx.connection.request('textDocument/semanticTokens/full', { textDocument: { uri: ctx.docUri } })
          .then(function(result) {
            if (!result || !Array.isArray(result.data)) {
              return none;
            }
            return { data: remapSemanticTokens(ctx.prefix, result.data, ctx.connection.semanticLegendMap) };
          })
          .catch(function() { return none; });
      },
      releaseDocumentSemanticTokens: noop
    });

    return { disposables: disposables, documentSymbolProvider: documentSymbolProvider };
  }

  /**
   * Register the global workspace symbol provider, which asks every live connection.
   *
   * @param {Object} monaco The monaco namespace.
   * @returns {Object|null} Disposable.
   */
  function registerWorkspaceSymbolProvider(monaco) {
    if (typeof monaco.languages.registerWorkspaceSymbolProvider !== 'function') {
      return null;
    }
    return monaco.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: function(query) {
        var connections = globalLspPool.getAllConnections().filter(function(conn) {
          if (conn.stopped || !conn.ws || conn.ws.readyState !== 1 || !conn.modelOptions) {
            return false;
          }
          var rich = false;
          conn.modelOptions.forEach(function(opts) {
            rich = rich || opts.richFeatures;
          });
          return rich;
        });
        return Promise.all(connections.map(function(conn) {
          return conn.request('workspace/symbol', { query: query || '' }).then(function(symbols) {
            return toMonacoWorkspaceSymbols(monaco, symbols);
          }).catch(function() { return []; });
        })).then(function(lists) {
          return [].concat.apply([], lists);
        });
      }
    });
  }

  /**
   * Take a reference on a language's providers, registering them on first use.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} language Monaco language id.
   */
  function acquireLanguageProviders(monaco, language) {
    var entry = languageProviderRegistry[language];
    if (!entry) {
      var registered = registerLanguageProviders(monaco, language);
      entry = languageProviderRegistry[language] = {
        refCount: 0,
        disposables: registered.disposables,
        documentSymbolProvider: registered.documentSymbolProvider
      };
    }
    entry.refCount++;
    if (workspaceSymbolRegistration.refCount === 0) {
      try {
        workspaceSymbolRegistration.disposable = registerWorkspaceSymbolProvider(monaco);
      } catch (e) {
        workspaceSymbolRegistration.disposable = null;
      }
    }
    workspaceSymbolRegistration.refCount++;
  }

  /**
   * Drop a reference on a language's providers, disposing them when none remain.
   *
   * @param {string} language Monaco language id.
   */
  function releaseLanguageProviders(language) {
    var disposeAll = function(list) {
      list.forEach(function(d) {
        try {
          d.dispose();
        } catch (e) {
          // Already disposed.
        }
      });
    };
    var entry = languageProviderRegistry[language];
    if (entry && --entry.refCount <= 0) {
      delete languageProviderRegistry[language];
      disposeAll(entry.disposables);
    }
    if (workspaceSymbolRegistration.refCount > 0 && --workspaceSymbolRegistration.refCount === 0) {
      if (workspaceSymbolRegistration.disposable) {
        disposeAll([workspaceSymbolRegistration.disposable]);
      }
      workspaceSymbolRegistration.disposable = null;
    }
  }

  /**
   * Connection a global command should go to: the one owning the model it was offered for,
   * else the first live connection with an open socket.
   *
   * @param {Object} [routing] {modelUri}.
   * @returns {Object|null} Connection.
   */
  function resolveCommandConnection(routing) {
    if (routing && routing.modelUri) {
      var owner = findModelOwner(routing.modelUri, true);
      if (owner) {
        return owner.connection;
      }
    }
    var connections = globalLspPool.getAllConnections();
    for (var i = 0; i < connections.length; i++) {
      if (!connections[i].stopped && connections[i].ws && connections[i].ws.readyState === 1) {
        return connections[i];
      }
    }
    return null;
  }

  /**
   * Handle the java.show.references code-lens command: move to the lens position and open the
   * references widget there.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} accessor Monaco service accessor.
   * @param {string} uri Document URI.
   * @param {Object} position LSP position of the lens.
   * @param {Array} references LSP Locations.
   */
  function showJavaReferences(monaco, accessor, uri, position, references) {
    if (!Array.isArray(references) || references.length === 0) {
      return;
    }
    var targetCtx = typeof uri === 'string' ? contextForUri(monaco, uri) : null;
    var editors = monaco.editor.getEditors ? monaco.editor.getEditors() : [];
    var editor = null;
    // Prefer an editor showing the lens's document, then the active editor, then any editor.
    if (targetCtx) {
      editors.forEach(function(ed) {
        if (!editor && ed.getModel && ed.getModel() === targetCtx.model) {
          editor = ed;
        }
      });
    }
    if (!editor && accessor && typeof accessor.get === 'function' && monaco.editor.IStandaloneCodeEditorService) {
      try {
        var codeEditorService = accessor.get(monaco.editor.IStandaloneCodeEditorService);
        editor = codeEditorService && codeEditorService.getActiveCodeEditor ? codeEditorService.getActiveCodeEditor() : null;
      } catch (e) {
        editor = null;
      }
    }
    if (!editor && editors.length > 0) {
      editor = editors[0];
    }
    if (!editor) {
      return;
    }

    var locations = toMonacoLocations({ monaco: monaco }, references);
    if (locations.length === 0) {
      return;
    }

    var ctx = targetCtx || (editor.getModel() ? contextForModel(monaco, editor.getModel()) : null);
    var monacoPos = ctx && ctx.model === editor.getModel() ? monacoPositionFromLsp(ctx, position) : null;
    if (!monacoPos) {
      // No usable position: just navigate to the first reference.
      var first = { lineNumber: locations[0].range.startLineNumber, column: locations[0].range.startColumn };
      editor.setPosition(first);
      editor.revealPositionInCenter(first);
      return;
    }
    try {
      editor.setPosition(monacoPos);
      editor.revealPositionInCenter(monacoPos);
      if (editor.trigger) {
        editor.trigger('codeLens', 'editor.action.goToReferences');
        return;
      }
      var action = editor.getAction('editor.action.goToReferences') ||
        editor.getAction('editor.action.referenceSearch.trigger') ||
        editor.getAction('editor.action.showReferences') ||
        editor.getAction('editor.action.peekLocations');
      if (action) {
        var runResult = action.run();
        if (runResult && typeof runResult.then === 'function') {
          runResult.catch(function() {}); // May reject with "Canceled".
        }
      }
    } catch (err) {
      // Navigation is best effort.
    }
  }

  /**
   * Register (once per monaco instance) the global commands: lmsMonaco.executeCommand, which
   * forwards an LSP command to the server owning the model it was offered for (applying any
   * workspace edit argument first, unless Monaco already applied it as the action's edit), and
   * java.show.references for jdtls code lenses.
   *
   * @param {Object} monaco The monaco namespace.
   */
  function ensureGlobalCommands(monaco) {
    if (!monaco.__lmsExecuteCommandRegistered) {
      // Monaco calls registered commands with (accessor, ...command.arguments); our code actions
      // pass [lspCommand, {modelUri, editTargetUris?, editApplied?}]. Monaco only runs the command
      // when the user picks the action, after applying the action's edit.
      monaco.editor.registerCommand(EXECUTE_COMMAND_ID, function(_accessor, lspCommand, routing) {
        if (!lspCommand || !lspCommand.command) {
          return undefined;
        }
        var connection = resolveCommandConnection(routing);
        if (!connection) {
          return undefined;
        }
        var args = lspCommand.arguments || [];
        if (!(routing && routing.editApplied)) {
          for (var i = 0; i < args.length; i++) {
            if (args[i] && (args[i].changes || args[i].documentChanges)) {
              try {
                applyWorkspaceEdit(monaco, args[i]);
              } catch (err) {
                // Ignore workspace edit errors.
              }
              break;
            }
          }
        }
        var result = connection.request('workspace/executeCommand', {
          command: lspCommand.command,
          arguments: args
        }).catch(function() {});
        // The action's edit changed other files: let the UI refresh the file it was invoked from.
        var targets = routing && Array.isArray(routing.editTargetUris) ? routing.editTargetUris : [];
        if (routing && routing.modelUri && targets.some(function(uri) { return uri !== routing.modelUri; })) {
          notifyWorkspaceEditApplied({ uris: targets, affectedOriginFiles: [routing.modelUri] });
        }
        return result;
      });
      monaco.__lmsExecuteCommandRegistered = true;
    }
    if (!monaco.__javaShowReferencesRegistered) {
      monaco.editor.registerCommand('java.show.references', function(accessor, uri, position, references) {
        showJavaReferences(monaco, accessor, uri, position, references);
      });
      monaco.__javaShowReferencesRegistered = true;
    }
  }

  /**
   * Apply the text edits of an LSP WorkspaceEdit to open models (each file mapped with its own
   * prefix).
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} edit LSP WorkspaceEdit.
   * @returns {boolean} True if anything was applied.
   */
  function applyWorkspaceEdit(monaco, edit) {
    var converted = convertWorkspaceEdit(monaco, edit);
    // File operations (create/rename/delete) are not applied here; only text edits to open models.
    if (!converted || !converted.edits || !converted.edits.length) {
      return false;
    }

    // Group text edits by target model.
    var grouped = new Map();
    (converted.edits || []).forEach(function(entry) {
      if (!entry || !entry.resource || !entry.textEdit) {
        return;
      }
      var key = entry.resource.toString();
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(entry.textEdit);
    });

    var applied = false;
    var appliedUris = [];
    var editors = monaco.editor.getEditors ? monaco.editor.getEditors() : [];
    grouped.forEach(function(textEdits, uriString) {
      var targetModel = getLiveModel(monaco, uriString);
      if (!targetModel) {
        return; // No (live) model for this document; nothing we can edit.
      }
      // Use an editor showing the model (for undo stops), otherwise edit the model directly.
      var editor = null;
      editors.forEach(function(ed) {
        if (!editor && ed.getModel && ed.getModel() === targetModel && typeof ed.executeEdits === 'function') {
          editor = ed;
        }
      });
      var done = false;
      if (editor) {
        editor.pushUndoStop();
        done = editor.executeEdits('lsp', textEdits) !== false;
        editor.pushUndoStop();
      } else if (typeof targetModel.applyEdits === 'function') {
        targetModel.applyEdits(textEdits);
        done = true;
      } else if (typeof targetModel.pushEditOperations === 'function') {
        targetModel.pushEditOperations([], textEdits, function() { return []; });
        done = true;
      }
      if (done) {
        applied = true;
        appliedUris.push(uriString);
      }
    });

    if (applied) {
      notifyWorkspaceEditApplied({ edits: converted.edits, uris: appliedUris });
    }
    return applied;
  }

  /**
   * Interpret a config value as a boolean ('true'/'1' strings count as true).
   *
   * @param {*} value The config value.
   * @returns {boolean} The boolean interpretation.
   */
  function normaliseTruth(value) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      var trimmed = value.trim().toLowerCase();
      return trimmed === 'true' || trimmed === '1';
    }
    return !!value;
  }

  /**
   * Parse a workspace configuration (JSON string or object).
   *
   * @param {string|Object} raw The configuration.
   * @returns {Object|null} The parsed object, or null if empty or invalid.
   */
  function parseWorkspaceConfig(raw) {
    var parsed = null;
    try {
      if (raw && typeof raw === 'object') {
        parsed = JSON.parse(JSON.stringify(raw)); // Private copy: Cypher defaults are added to it.
      } else if (typeof raw === 'string' && raw.trim()) {
        parsed = JSON.parse(raw);
      }
    } catch (e) {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
      return null;
    }
    return parsed;
  }

  /**
   * Get the directory part of a file path/URI, for use as the workspace root.
   *
   * @param {string} path File path or URI.
   * @returns {string|null} The directory URI, or null if there is none.
   */
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

  /**
   * Create a pooled connection to a language server (minimal WebSocket + JSON-RPC client) and
   * take a reference on the language's Monaco providers. Call connection.connect() once the
   * first model is attached.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} language Monaco language id.
   * @param {string} urlSimple WebSocket URL.
   * @param {Object} options Options of the editor creating the connection (workspaceRootUri, path,
   *     workspaceConfig are server-wide settings taken from it).
   * @returns {Object} The connection.
   */
  function createLspConnection(monaco, language, urlSimple, options) {
    var ws = null;
    var idSeq = 1;
    var pending = {};
    var pullDiagnosticsEnabled = false;
    var diagnosticIdentifier = null;
    var lastDiagnosticResultIds = new Map();
    var diagnosticTimer = null;
    var diagnosticRequestToken = 0;
    var KEEPALIVE_INTERVAL = 30000;
    var workspaceUri = options.workspaceRootUri || directoryUriFromPath(options.path);
    var workspaceFolders = workspaceUri ? [{ uri: workspaceUri, name: options.language || 'workspace' }] : null;
    var workspaceFoldersRegistered = false;
    var initialized = false;
    // Workspace configuration is server-wide: the connection keeps the first non-empty one offered.
    var workspaceConfig = null;
    var workspaceConfigFromUser = false;
    var neo4jConnectionSettings = null;
    var neo4jLintWorkerSettings = null;
    var neo4jParameterValues = null;

    var sharedConnection = {
      ws: null,
      monaco: monaco,
      language: language,
      lspUrl: urlSimple,
      models: [], // All models using this connection.
      modelRefCounts: new Map(),
      modelPrefixes: new Map(), // Model URI -> prefix info.
      modelOptions: new Map(), // Model URI -> feature options.
      modelUriAliases: new Map(), // Alias URI (x.tpp) -> model URI (tpp_x.h).
      modelContentTransforms: new Map(),
      markedModels: new Set(), // Models we have set 'lsp' markers on.
      lastDiagnosticsByUri: new Map(), // Model URI -> LSP diagnostics (outside the prefix).
      semanticLegendMap: buildSemanticLegendMap(null),
      // Lifecycle state lives only here, so disposeConnectionResources() really stops
      // reconnects and the keepalive (the socket handlers below read these fields).
      stopped: false,
      reconnectTimer: null,
      reconnectAttempts: 0,
      keepAliveTimer: null,
      pendingDisposeTimer: null,
      providersAcquired: false,
      workspaceUri: workspaceUri,
      workspaceFolders: workspaceFolders,
      workspaceConfig: null,
      neo4jLintWorkerSettings: null,
      send: function(msg) {
        send(msg);
      },
      request: function(method, params) {
        return request(method, params);
      },
      scheduleDiagnostics: function(delay) {
        scheduleDiagnostics(delay);
      },
      adoptWorkspaceConfig: function(raw) {
        if (applyWorkspaceConfig(raw) && initialized) {
          sendConfigurationUpdates();
        }
      },
      connect: function() {
        connect();
      },
      onDispose: function() {
        clearTimeout(diagnosticTimer);
        diagnosticTimer = null;
        diagnosticRequestToken++;
      }
    };

    // Add connection to pool IMMEDIATELY to prevent race conditions
    // Other editors checking the pool will find this pending connection and reuse it
    globalLspPool.set(language, urlSimple, sharedConnection);
    acquireLanguageProviders(monaco, language);
    sharedConnection.providersAcquired = true;
    ensureGlobalCommands(monaco);

    /**
     * Read Neo4j connection settings for the Cypher language server from the workspace config.
     *
     * @returns {Object|null} connectionUpdated payload, or null if not connecting.
     */
    function extractNeo4jConnectionSettings() {
      if (!workspaceConfig || language !== 'cypher') {
        return null;
      }
      var neo4jSettings = workspaceConfig.neo4j;
      if (!neo4jSettings || typeof neo4jSettings !== 'object') {
        return null;
      }
      var shouldConnect = normaliseTruth(
        Object.prototype.hasOwnProperty.call(neo4jSettings, 'connect') ? neo4jSettings.connect : true
      );
      var connectURL = typeof neo4jSettings.connectURL === 'string' ? neo4jSettings.connectURL.trim() : '';
      var user = typeof neo4jSettings.user === 'string' ? neo4jSettings.user : '';
      var password = typeof neo4jSettings.password === 'string' ? neo4jSettings.password : '';
      var database = typeof neo4jSettings.database === 'string' ? neo4jSettings.database.trim() : '';

      if (!shouldConnect || !connectURL || !user || !password) {
        return null;
      }

      var payload = {
        connect: true,
        connectURL: connectURL,
        user: user,
        password: password
      };
      if (database) {
        payload.database = database;
      }
      return payload;
    }

    /**
     * Read Cypher lint worker settings from the workspace config.
     *
     * @returns {Object|null} updateLintWorker payload, or null if linting is off or not Cypher.
     */
    function extractNeo4jLintWorkerSettings() {
      if (language !== 'cypher') {
        return null;
      }
      var neo4jSettings = (workspaceConfig && workspaceConfig.neo4j) ? workspaceConfig.neo4j : {};
      var features = neo4jSettings.features;
      if (features && features.linting === false) {
        return null;
      }
      var lintWorkerPath = (typeof neo4jSettings.lintWorkerPath === 'string') ? neo4jSettings.lintWorkerPath.trim() : '';
      var linterVersion = (typeof neo4jSettings.linterVersion === 'string') ? neo4jSettings.linterVersion.trim() : '';
      return {
        lintWorkerPath: lintWorkerPath.length ? lintWorkerPath : null,
        linterVersion: linterVersion.length ? linterVersion : 'Default'
      };
    }

    /**
     * Use a workspace configuration offered by an attaching editor, unless the connection
     * already has a non-empty one. Recomputes the derived (Cypher/Neo4j) settings.
     *
     * @param {string|Object} raw The offered configuration.
     * @returns {boolean} True if the configuration was adopted.
     */
    function applyWorkspaceConfig(raw) {
      var parsed = workspaceConfigFromUser ? null : parseWorkspaceConfig(raw);
      var adopted = !!parsed;
      if (adopted) {
        workspaceConfig = parsed;
        workspaceConfigFromUser = true;
      } else if (workspaceConfig) {
        return false;
      }
      if (language === 'cypher') {
        if (!workspaceConfig || typeof workspaceConfig !== 'object') {
          workspaceConfig = {};
        }
        if (!workspaceConfig.neo4j || typeof workspaceConfig.neo4j !== 'object') {
          workspaceConfig.neo4j = {};
        }
        if (!workspaceConfig.neo4j.features || typeof workspaceConfig.neo4j.features !== 'object') {
          workspaceConfig.neo4j.features = {};
        }
        if (typeof workspaceConfig.neo4j.features.linting === 'undefined') {
          workspaceConfig.neo4j.features.linting = true;
        }
        var neo4jSettings = workspaceConfig.neo4j;
        neo4jParameterValues = neo4jSettings.parameters && typeof neo4jSettings.parameters === 'object' ?
          neo4jSettings.parameters : {};
      }
      neo4jConnectionSettings = extractNeo4jConnectionSettings();
      neo4jLintWorkerSettings = extractNeo4jLintWorkerSettings();
      // Stored on the connection for registerModelWithLsp.
      sharedConnection.workspaceConfig = workspaceConfig;
      sharedConnection.neo4jLintWorkerSettings = neo4jLintWorkerSettings;
      return adopted;
    }

    applyWorkspaceConfig(options.workspaceConfig);

    /**
     * Send the Cypher updateLintWorker notification, if there are lint worker settings.
     */
    function sendNeo4jLintWorkerUpdate() {
      if (!neo4jLintWorkerSettings) {
        return;
      }
      send({
        jsonrpc: '2.0',
        method: 'updateLintWorker',
        params: neo4jLintWorkerSettings
      });
    }

    /**
     * Send the Cypher updateParameters notification, if parameters are configured.
     */
    function sendNeo4jParametersUpdate() {
      if (neo4jParameterValues === null) {
        return;
      }
      var payload = neo4jParameterValues;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        payload = {};
      }
      send({
        jsonrpc: '2.0',
        method: 'updateParameters',
        params: payload
      });
    }

    /**
     * Send the workspace configuration (and the Neo4j updates derived from it) to the server.
     */
    function sendConfigurationUpdates() {
      if (workspaceConfig) {
        send({
          jsonrpc: '2.0',
          method: 'workspace/didChangeConfiguration',
          params: {
            settings: workspaceConfig
          }
        });
      }
      if (neo4jConnectionSettings) {
        send({
          jsonrpc: '2.0',
          method: 'connectionUpdated',
          params: neo4jConnectionSettings
        });
        sendNeo4jParametersUpdate();
      }
      // Re-send lint worker update in case linter settings changed.
      sendNeo4jLintWorkerUpdate();
    }

    /**
     * Send a JSON-RPC message if the socket is open (errors are ignored).
     *
     * @param {Object} msg The message.
     */
    function send(msg) {
      try {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify(sanitizeOutgoingMessage(msg)));
        }
      } catch (e) {
        // Socket closing.
      }
    }

    /**
     * Send a JSON-RPC request and wait for its response.
     *
     * @param {string} method LSP method name.
     * @param {Object} params Request parameters.
     * @returns {Promise} Resolves with the result; rejects on error or if not connected.
     */
    function request(method, params) {
      if (!ws || ws.readyState !== 1) {
        return Promise.reject({ code: 'not_connected' });
      }
      return new Promise(function(resolve, reject) {
        var id = idSeq++;
        pending[id] = { resolve: resolve, reject: reject };
        send({ jsonrpc: '2.0', id: id, method: method, params: params });
      });
    }

    /**
     * Send the LSP initialize request; on success send initialized, the configuration
     * notifications and (re)open every attached document.
     */
    function openInitialize() {
      var init = {
        jsonrpc: '2.0', id: idSeq++, method: 'initialize', params: {
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
                tokenTypes: CLIENT_SEMANTIC_TOKEN_TYPES.slice(),
                tokenModifiers: CLIENT_SEMANTIC_TOKEN_MODIFIERS.slice(),
                formats: ['relative']
              },
              diagnostic: {
                dynamicRegistration: false,
                relatedDocumentSupport: false
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
              },
              diagnostics: {
                refreshSupport: true
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
        resolve: function(result) {
          initialized = true;
          send({ jsonrpc: '2.0', method: 'initialized', params: {} });
          var capabilities = (result && result.capabilities) || {};
          // Map the server's semantic token legend onto the client legend used by the providers.
          var semanticProvider = capabilities.semanticTokensProvider;
          sharedConnection.semanticLegendMap = buildSemanticLegendMap(semanticProvider && semanticProvider.legend);
          // Detect pull-diagnostics support from server capabilities
          var diagProvider = capabilities.diagnosticProvider;
          if (diagProvider) {
            pullDiagnosticsEnabled = true;
            diagnosticIdentifier = typeof diagProvider === 'object' ? (diagProvider.identifier || null) : null;
            lastDiagnosticResultIds.clear();
            scheduleDiagnostics(0);
          }
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
          // Send Neo4j connection update, which triggers connectionUpdated + updateParameters
          // NOTE: updateLintWorker is sent in registerModelWithLsp after textDocument/didOpen
          if (neo4jConnectionSettings) {
            send({
              jsonrpc: '2.0',
              method: 'connectionUpdated',
              params: neo4jConnectionSettings
            });
          }
          sendNeo4jParametersUpdate();
          // For Java LSP (jdtls), configure to include commands in code actions
          // By default, jdtls assumes all buffers are auto-validated (validateAllOpenBuffersOnChanges=true)
          // and omits refresh commands. We need those commands for proper diagnostics refresh.
          if (language === 'java') {
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
          // (Re-)open all models, e.g. after a reconnection.
          var didOpenSentUris = new Set();
          sharedConnection.models.forEach(function(m) {
            if (!m || !m.uri) {
              return;
            }
            var uri = m.uri.toString();
            send({
              jsonrpc: '2.0',
              method: 'textDocument/didOpen',
              params: {
                textDocument: {
                  uri: uri,
                  languageId: language,
                  version: 1,
                  text: buildModelContent(sharedConnection, m, uri)
                }
              }
            });
            didOpenSentUris.add(uri);
          });

          // Send any other notifications queued while the socket was down.
          if (sharedConnection.pendingDidOpen && sharedConnection.pendingDidOpen.length > 0) {
            sharedConnection.pendingDidOpen.forEach(function(pendingMsg) {
              var pendingUri = pendingMsg && pendingMsg.params && pendingMsg.params.textDocument &&
                pendingMsg.params.textDocument.uri;
              if (pendingMsg && pendingMsg.method === 'textDocument/didOpen' &&
                  (didOpenSentUris.has(pendingUri) || !sharedConnection.modelPrefixes.has(pendingUri))) {
                return; // Already sent during the reopen loop, or detached meanwhile.
              }
              send(pendingMsg);
            });
            sharedConnection.pendingDidOpen = [];
          }
        },
        reject: function() {}
      };
      send(init);
    }

    /**
     * Show diagnostics from the server as Monaco markers on the matching model.
     *
     * @param {Object} params publishDiagnostics params {uri, diagnostics}.
     */
    function handleDiagnostics(params) {
      if (!params || !params.diagnostics) {
        return;
      }
      // Multi-model: find which model these diagnostics belong to.
      var targetUri = params.uri;
      if (sharedConnection.modelUriAliases.has(targetUri)) {
        targetUri = sharedConnection.modelUriAliases.get(targetUri);
      }
      var targetModel = null;
      sharedConnection.models.forEach(function(m) {
        if (!targetModel && m && m.uri && m.uri.toString() === targetUri) {
          targetModel = m;
        }
      });
      if (!targetModel) {
        return; // Model not on this connection.
      }

      // If this is a shimmed tpp_* URI, prefer placing markers on the user-facing .tpp model
      var markerModel = targetModel;
      var normalizedUri = applyUriRewriters(targetUri);
      if (normalizedUri && normalizedUri !== targetUri) {
        markerModel = getLiveModel(monaco, normalizedUri) || targetModel;
      }
      if (markerModel.isDisposed && markerModel.isDisposed()) {
        return;
      }

      var ctx = {
        monaco: monaco,
        model: markerModel,
        prefix: sharedConnection.modelPrefixes.get(targetUri) || EMPTY_PREFIX
      };
      var markers = [];
      var kept = [];
      for (var i = 0; i < params.diagnostics.length; i++) {
        var d = params.diagnostics[i];
        var range = d && d.range ? monacoRangeFromLsp(ctx, d.range) : null;
        if (!range) {
          continue; // Inside the hidden prefix.
        }
        kept.push(d);
        markers.push({
          severity: monaco.MarkerSeverity[
            d.severity === 1 ? 'Error' : (d.severity === 2 ? 'Warning' : (d.severity === 3 ? 'Info' : 'Hint'))
          ] || monaco.MarkerSeverity.Info,
          message: d.message || '',
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.endLineNumber,
          endColumn: range.endColumn
        });
      }
      monaco.editor.setModelMarkers(markerModel, 'lsp', markers);
      sharedConnection.markedModels.add(markerModel);
      // Kept in LSP coordinates: sent back as code action context.
      sharedConnection.lastDiagnosticsByUri.set(targetUri, kept);
    }

    /**
     * Schedule a pull-diagnostics refresh (only if the server supports pull diagnostics).
     *
     * @param {number} [delay] Delay in ms (default 250).
     */
    function scheduleDiagnostics(delay) {
      if (!pullDiagnosticsEnabled) {
        return;
      }
      clearTimeout(diagnosticTimer);
      diagnosticTimer = setTimeout(refreshDiagnostics, delay !== null && delay !== undefined ? delay : 250);
    }

    /**
     * Request pull diagnostics for every model on the connection.
     */
    function refreshDiagnostics() {
      if (!pullDiagnosticsEnabled) {
        return;
      }
      var token = ++diagnosticRequestToken;
      for (var mi = 0; mi < sharedConnection.models.length; mi++) {
        requestModelDiagnostics(sharedConnection.models[mi], token);
      }
    }

    /**
     * Pull diagnostics for one model. The response is ignored if a newer refresh
     * (or a disconnect) has bumped diagnosticRequestToken in the meantime.
     *
     * @param {Object} m The model.
     * @param {number} token Value of diagnosticRequestToken for this refresh.
     */
    function requestModelDiagnostics(m, token) {
      var uri = m && m.uri && m.uri.toString();
      if (!uri) {
        return;
      }
      var params = { textDocument: { uri: uri } };
      if (diagnosticIdentifier) {
        params.identifier = diagnosticIdentifier;
      }
      if (lastDiagnosticResultIds.has(uri)) {
        params.previousResultId = lastDiagnosticResultIds.get(uri);
      }
      request('textDocument/diagnostic', params).then(function(report) {
        if (token !== diagnosticRequestToken) {
          return;
        }
        var hasResultId = report && report.resultId !== null && report.resultId !== undefined;
        if (report && report.kind === 'full') {
          lastDiagnosticResultIds.set(uri, hasResultId ? report.resultId : null);
          handleDiagnostics({ uri: uri, diagnostics: report.items || [] });
        } else if (report && report.kind === 'unchanged') {
          var prev = lastDiagnosticResultIds.get(uri);
          lastDiagnosticResultIds.set(uri, hasResultId ? report.resultId : prev);
        }
      }).catch(function() {});
    }

    /**
     * Tell the server about the workspace folders, once it has registered for folder changes.
     */
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

    /**
     * Reject and forget every outstanding request.
     *
     * @param {Object} [err] Rejection reason (default {code: 'closed'}).
     */
    function rejectAllPending(err) {
      var outstanding = pending;
      pending = {};
      Object.keys(outstanding).forEach(function(k) {
        try {
          outstanding[k].reject(err || { code: 'closed' });
        } catch (e) {
          // Ignore.
        }
      });
    }

    /**
     * Reconnect after an exponential back-off (max 30s), unless the connection was stopped.
     */
    function scheduleReconnect() {
      if (sharedConnection.stopped || sharedConnection.reconnectTimer) {
        return;
      }
      var delay = Math.min(30000, 1000 * Math.pow(2, sharedConnection.reconnectAttempts));
      sharedConnection.reconnectAttempts++;
      sharedConnection.reconnectTimer = setTimeout(function() {
        sharedConnection.reconnectTimer = null;
        connect();
      }, delay);
      if (root && root.console && root.console.warn) {
        root.console.warn('[lmsMonaco] LSP reconnect in ' + delay + 'ms');
      }
    }

    /**
     * Answer a server-to-client request or notification.
     *
     * @param {Object} msg The JSON-RPC message.
     */
    function handleServerMessage(msg) {
      if (msg.method === 'textDocument/publishDiagnostics') {
        handleDiagnostics(msg.params);
        return;
      }
      if (msg.method === 'workspace/diagnostic/refresh') {
        if (msg.id !== undefined) {
          send({ jsonrpc: '2.0', id: msg.id, result: null });
        }
        scheduleDiagnostics(0);
        return;
      }
      if (msg.method === 'workspace/applyEdit') {
        var success = false;
        try {
          success = applyWorkspaceEdit(monaco, msg.params && msg.params.edit);
        } catch (e) {
          success = false;
        }
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
        var wantsConfigUpdates = false;
        for (var ri = 0; ri < regList.length; ri++) {
          var reg = regList[ri];
          if (reg && reg.method === 'workspace/didChangeWorkspaceFolders') {
            workspaceFoldersRegistered = true;
            registeredFolders = true;
          }
          if (reg && reg.method === 'workspace/didChangeConfiguration') {
            wantsConfigUpdates = true;
          }
        }
        if (msg.id !== undefined) {
          send({ jsonrpc: '2.0', id: msg.id, result: null });
        }
        if (registeredFolders) {
          notifyWorkspaceFoldersAdded();
        }
        if (wantsConfigUpdates) {
          sendConfigurationUpdates();
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
          var section = items[i] && items[i].section ? items[i].section : null;
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
      }
    }

    /**
     * Open the WebSocket and install its handlers (message routing, reconnect, keepalive).
     */
    function connect() {
      if (sharedConnection.stopped) {
        return;
      }
      try {
        if (ws && ws.readyState < 2) {
          ws.close();
        }
      } catch (e) {
        // Ignore.
      }
      try {
        ws = new (root.WebSocket || window.WebSocket)(urlSimple);
      } catch (e) {
        // Malformed LSP URL (or no WebSocket support): keep the editor usable without LSP.
        // Retrying can't fix a bad URL, so don't schedule a reconnect.
        ws = null;
        sharedConnection.ws = null;
        return;
      }
      var thisSocket = ws;
      sharedConnection.ws = ws;
      ws.onopen = function() {
        if (sharedConnection.stopped) {
          try {
            thisSocket.close();
          } catch (e) {
            // Ignore.
          }
          return;
        }
        sharedConnection.reconnectAttempts = 0;
        openInitialize();
      };
      ws.onmessage = function(ev) {
        var data = ev && ev.data;
        if (!data) {
          return;
        }
        var msg;
        try {
          msg = JSON.parse(data);
        } catch (e) {
          return;
        }
        if (msg.id !== undefined && msg.id !== null && !msg.method && (msg.result !== undefined || msg.error)) {
          var p = pending[msg.id];
          delete pending[msg.id];
          if (p) {
            if (msg.error) {
              p.reject(msg.error);
            } else {
              p.resolve(msg.result);
            }
          }
          return;
        }
        if (msg.method) {
          handleServerMessage(msg);
        }
      };
      ws.onerror = function() {
        rejectAllPending({ code: 'error' });
      };
      ws.onclose = function() {
        if (sharedConnection.ws !== thisSocket) {
          return; // Superseded by a newer socket.
        }
        initialized = false;
        if (sharedConnection.stopped) {
          // Disposed: just fail outstanding requests, never reconnect.
          rejectAllPending({ code: 'closed' });
          return;
        }
        clearConnectionMarkers(monaco, sharedConnection);
        sharedConnection.lastDiagnosticsByUri.clear();
        clearTimeout(diagnosticTimer);
        diagnosticTimer = null;
        diagnosticRequestToken++;
        pullDiagnosticsEnabled = false;
        diagnosticIdentifier = null;
        lastDiagnosticResultIds.clear();
        rejectAllPending({ code: 'closed' });
        if (sharedConnection.keepAliveTimer) {
          clearInterval(sharedConnection.keepAliveTimer);
          sharedConnection.keepAliveTimer = null;
        }
        scheduleReconnect();
      };
      if (sharedConnection.keepAliveTimer) {
        clearInterval(sharedConnection.keepAliveTimer);
      }
      sharedConnection.keepAliveTimer = setInterval(function() {
        try {
          if (ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', method: '$/keepalive' }));
          }
        } catch (e) {
          // Ignore.
        }
      }, KEEPALIVE_INTERVAL);
    }

    return sharedConnection;
  }

  /**
   * Connect an existing editor's model to a language server.
   *
   * @param {Object} options Options for createMonacoLspEditor; options.editor is required.
   * @returns {Object} Editor API object.
   */
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
   * @param {Object} options - language, lspUrl, lspBaseUrl, prefixCode, contentTransform and the
   *     per-model feature options (richFeatures, enableInlayHints, semanticHighlighting).
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
    // Reusing a pooled connection inside its release delay must keep it alive.
    cancelPendingConnectionDispose(connection);

    var modelUri = model.uri.toString();
    var isNewModel = incrementModelRefCount(connection, modelUri) === 0;
    if (typeof connection.adoptWorkspaceConfig === 'function') {
      connection.adoptWorkspaceConfig(options.workspaceConfig);
    }

    if (isNewModel) {
      recordModelOnConnection(connection, model, options);

      var didOpenMsg = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: modelUri,
            languageId: language,
            version: 1,
            text: buildModelContent(connection, model, modelUri)
          }
        }
      };
      var lintWorkerMsg = language === 'cypher' && connection.neo4jLintWorkerSettings ? {
        jsonrpc: '2.0',
        method: 'updateLintWorker',
        params: connection.neo4jLintWorkerSettings
      } : null;

      if (connection.ws && connection.ws.readyState === 1) {
        connection.send(didOpenMsg);
        // For Cypher language, send updateLintWorker immediately after didOpen
        // The Cypher LS needs this to initialize the lint worker and start linting
        if (lintWorkerMsg) {
          connection.send(lintWorkerMsg);
        }
      } else {
        if (!connection.pendingDidOpen) {
          connection.pendingDidOpen = [];
        }
        connection.pendingDidOpen.push(didOpenMsg);
        // Also queue updateLintWorker for Cypher to be sent when connection opens
        if (lintWorkerMsg) {
          connection.pendingDidOpen.push(lintWorkerMsg);
        }
      }
      installModelChangeListener(connection, model, false);
    }

    // Return disposable
    var registrationDisposed = false;
    return {
      dispose: function() {
        if (registrationDisposed) {
          return;
        }
        registrationDisposed = true;
        detachModelFromLspConnection(monaco, model, connection);
      }
    };
  }

  /**
   * Whether a model is attached to the pooled connection for its language and URL.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} model The model.
   * @param {Object} options language, lspUrl and lspBaseUrl.
   * @returns {boolean} True if registered.
   */
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
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} fileUri URI of the deleted file.
   * @param {Object} options language, lspUrl and lspBaseUrl.
   * @returns {boolean} True if the notification was sent.
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
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} fileUri URI of the new file.
   * @param {Object} options language, lspUrl and lspBaseUrl.
   * @returns {boolean} True if the notification was sent.
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
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string} oldUri Previous file URI.
   * @param {string} newUri New file URI.
   * @param {Object} options language, lspUrl and lspBaseUrl.
   * @returns {boolean} True if the notification was sent.
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

  /**
   * Get the document symbol provider for a given language and LSP URL (used by the multi-file
   * outline). Null unless that connection exists and has a model with rich features.
   *
   * @param {string} language Language id.
   * @param {string} lspUrl Explicit LSP URL (or empty).
   * @param {string} lspBaseUrl Base LSP URL used when lspUrl is empty.
   * @returns {Object|null} The provider, or null.
   */
  function getDocumentSymbolProvider(language, lspUrl, lspBaseUrl) {
    language = language || 'plaintext';
    var urlSimple = buildLspUrl({ lspUrl: lspUrl, lspBaseUrl: lspBaseUrl, language: language });
    var connection = globalLspPool.get(language, urlSimple);
    var entry = languageProviderRegistry[language];
    if (!connection || connection.stopped || !entry || !connection.modelOptions) {
      return null;
    }
    var rich = false;
    connection.modelOptions.forEach(function(opts) {
      rich = rich || opts.richFeatures;
    });
    return rich ? entry.documentSymbolProvider : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Page-level services shared by the Monaco UIs (ui_monaco and ui_monaco_multifile): a single
  // idempotent Monaco loader, a single page theme and the language-name mapping.
  // ---------------------------------------------------------------------------------------------

  var MONACO_VS_PATH = '/question/type/coderunner/monaco/vs';
  var MONACO_THEME_STORAGE_KEY = 'qtype_coderunner.monaco.theme';
  var MONACO_THEME_EVENT = 'qtype_coderunner:monacothemechange';
  // Custom themes defined by the UIs from JSON files, and the built-in theme to use if they are
  // not (yet) available.
  var CUSTOM_THEME_FALLBACKS = { 'one-dark': 'vs-dark', 'one-light': 'vs' };
  var monacoLoadPromise = null;
  var monacoPagePrepared = false;
  // The one theme active on this page (Monaco themes are page-global) and where it came from:
  // 'user', 'author', 'system' or 'default'.
  var pageTheme = { theme: null, source: null };

  /**
   * URL of the bundled Monaco 'vs' directory.
   *
   * @returns {string}
   */
  function getMonacoBasePath() {
    var moodle = root.M;
    var wwwroot = moodle && moodle.cfg && moodle.cfg.wwwroot ? moodle.cfg.wwwroot : '';
    return wwwroot + MONACO_VS_PATH;
  }

  /**
   * The page's RequireJS require function, or null.
   *
   * @returns {Function|null}
   */
  function getAmdRequire() {
    var req = root.require;
    return typeof req === 'function' && typeof req.config === 'function' ? req : null;
  }

  /**
   * Point RequireJS at the bundled Monaco and give Monaco a worker URL. Idempotent, and never
   * replaces a 'vs' path or a MonacoEnvironment worker factory that something else has set.
   *
   * @param {Function} req RequireJS require.
   */
  function configureMonacoEnvironment(req) {
    var basePath = getMonacoBasePath();
    var context = req.s && req.s.contexts && req.s.contexts._;
    var paths = context && context.config && context.config.paths ? context.config.paths : {};
    if (!paths.vs) {
      req.config({ paths: { vs: basePath } });
    }
    var env = root.MonacoEnvironment;
    if (!env || typeof env !== 'object') {
      env = {};
      root.MonacoEnvironment = env;
    }
    if (!env.baseUrl) {
      env.baseUrl = basePath;
    }
    if (typeof env.getWorkerUrl !== 'function' && typeof env.getWorker !== 'function') {
      // Monaco's workerMain loads the language workers itself.
      env.getWorkerUrl = function() {
        return (env.baseUrl || basePath) + '/base/worker/workerMain.js';
      };
    }
  }

  /**
   * True if a promise rejection reason is Monaco's own cancellation error (a CancellationError
   * has name and message 'Canceled'), or its benign disposed-DisposableStore notice.
   *
   * @param {*} reason The rejection reason.
   * @returns {boolean}
   */
  function isMonacoCancellation(reason) {
    if (reason === 'Canceled') {
      return true;
    }
    if (!reason || typeof reason !== 'object') {
      return false;
    }
    return reason.name === 'Canceled' || reason.message === 'Canceled' || isMonacoDisposedStoreNoise([reason]);
  }

  /**
   * Stop Monaco's cancellation rejections (raised when widgets are disposed or view state is
   * restored while switching models) being reported as unhandled. Installed once per page;
   * every other rejection is left alone.
   */
  function installMonacoCancellationFilter() {
    if (typeof root.addEventListener !== 'function' || root.__qtypeCoderunnerMonacoCancelFilter) {
      return;
    }
    root.__qtypeCoderunnerMonacoCancelFilter = true;
    root.addEventListener('unhandledrejection', function(event) {
      if (event && isMonacoCancellation(event.reason) && typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
    });
  }

  /**
   * Turn off Monaco's built-in HTML completion items, if configurable.
   *
   * @param {Object} monaco The monaco namespace.
   */
  function disableHtmlCompletions(monaco) {
    try {
      var defaults = monaco && monaco.languages && monaco.languages.html && monaco.languages.html.htmlDefaults;
      if (!defaults || typeof defaults.setModeConfiguration !== 'function') {
        return;
      }
      var current = defaults.modeConfiguration || {};
      if (current.completionItems === false) {
        return;
      }
      defaults.setModeConfiguration(Object.assign({}, current, { completionItems: false }));
    } catch (err) {
      // Best effort.
    }
  }

  /**
   * Register the MongoDB language (not in Monaco's default set) from the bundled grammar.
   *
   * @param {Object} monaco The monaco namespace.
   * @returns {Promise} Always resolves.
   */
  function registerMongoDbLanguage(monaco) {
    var req = getAmdRequire();
    if (!req || !monaco || !monaco.languages) {
      return Promise.resolve();
    }
    return new Promise(function(resolve) {
      try {
        req(['vs/basic-languages/mongodb/mongodb'], function(mongodb) {
          try {
            var registered = monaco.languages.getLanguages().some(function(lang) { return lang.id === 'mongodb'; });
            if (!registered) {
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
            // The editor falls back to plain text.
          }
          resolve();
        }, function() {
          resolve();
        });
      } catch (err) {
        resolve();
      }
    });
  }

  /**
   * One-off page set-up once Monaco is available.
   *
   * @param {Object} monaco The monaco namespace.
   * @returns {Promise} Resolves with monaco.
   */
  function prepareMonacoPage(monaco) {
    if (monacoPagePrepared || !monaco) {
      return Promise.resolve(monaco);
    }
    monacoPagePrepared = true;
    disableHtmlCompletions(monaco);
    return registerMongoDbLanguage(monaco).then(function() {
      return monaco;
    });
  }

  /**
   * Load Monaco once per page, for every Monaco UI: configures RequireJS and MonacoEnvironment
   * (without clobbering anything already set), loads the editor, disables Monaco's HTML
   * completions, registers MongoDB and installs the cancellation-rejection filter.
   *
   * @returns {Promise} Resolves with the monaco namespace.
   */
  function loadMonaco() {
    if (monacoLoadPromise) {
      return monacoLoadPromise;
    }
    installMonacoCancellationFilter();
    monacoLoadPromise = new Promise(function(resolve, reject) {
      var existing = root.monaco;
      if (existing && existing.editor) {
        resolve(existing);
        return;
      }
      var req = getAmdRequire();
      if (!req) {
        reject(new Error('RequireJS not available'));
        return;
      }
      try {
        configureMonacoEnvironment(req);
        req(['vs/editor/editor.main'], resolve, reject);
      } catch (err) {
        reject(err);
      }
    }).then(prepareMonacoPage);
    return monacoLoadPromise;
  }

  /**
   * The browser's localStorage, or null if it is unavailable (accessing it can throw).
   *
   * @returns {Storage|null}
   */
  function getThemeStorage() {
    try {
      return root.localStorage || null;
    } catch (err) {
      return null;
    }
  }

  /**
   * The theme the user explicitly chose with a Monaco theme control, if any.
   *
   * @returns {string|null}
   */
  function getStoredMonacoTheme() {
    var storage = getThemeStorage();
    if (!storage) {
      return null;
    }
    try {
      var value = storage.getItem(MONACO_THEME_STORAGE_KEY);
      return value ? String(value) : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Store (or with a falsy theme, clear) the user's explicit theme choice.
   *
   * @param {string|null} theme The theme.
   */
  function storeMonacoTheme(theme) {
    var storage = getThemeStorage();
    if (!storage) {
      return;
    }
    try {
      if (theme) {
        storage.setItem(MONACO_THEME_STORAGE_KEY, theme);
      } else {
        storage.removeItem(MONACO_THEME_STORAGE_KEY);
      }
    } catch (err) {
      // Blocked or full storage: the choice just isn't remembered.
    }
  }

  /**
   * A theme name that can be used now: blank gives null, and a custom theme falls back to its
   * built-in equivalent if options.customThemesAvailable is false.
   *
   * @param {*} theme Theme name.
   * @param {Object} [options] {customThemesAvailable}.
   * @returns {string|null}
   */
  function usableThemeName(theme, options) {
    if (typeof theme !== 'string' || !theme.trim()) {
      return null;
    }
    var name = theme.trim();
    if (options && options.customThemesAvailable === false &&
        Object.prototype.hasOwnProperty.call(CUSTOM_THEME_FALLBACKS, name)) {
      return CUSTOM_THEME_FALLBACKS[name];
    }
    return name;
  }

  /**
   * The OS colour-scheme preference: true for dark, false for light, null if unknown.
   *
   * @returns {boolean|null}
   */
  function prefersDarkScheme() {
    if (typeof root.matchMedia !== 'function') {
      return null;
    }
    try {
      if (root.matchMedia('(prefers-color-scheme: dark)').matches) {
        return true;
      }
      if (root.matchMedia('(prefers-color-scheme: light)').matches) {
        return false;
      }
    } catch (err) {
      // Treat as unknown.
    }
    return null;
  }

  /**
   * Choose a theme for a Monaco UI. Precedence: the user's stored choice, then the question
   * author's explicit 'theme' parameter, then the OS light/dark preference (if
   * auto_switch_light_dark, default true), then 'vs'.
   *
   * @param {Object} params UI parameters (theme, auto_switch_light_dark).
   * @param {Object} [options] {customThemesAvailable}.
   * @returns {Object} {theme, source}.
   */
  function resolveThemeChoice(params, options) {
    var p = params || {};
    var stored = usableThemeName(getStoredMonacoTheme(), options);
    if (stored) {
      return { theme: stored, source: 'user' };
    }
    var authored = usableThemeName(p.theme, options);
    if (authored) {
      return { theme: authored, source: 'author' };
    }
    var autoSwitch = p.auto_switch_light_dark === undefined || p.auto_switch_light_dark === null ?
      true : normaliseTruth(p.auto_switch_light_dark);
    if (autoSwitch) {
      var dark = prefersDarkScheme();
      if (dark !== null) {
        return { theme: dark ? 'vs-dark' : 'vs', source: 'system' };
      }
    }
    return { theme: 'vs', source: 'default' };
  }

  /**
   * The theme a Monaco UI with these parameters would choose (see resolveThemeChoice). Does not
   * change anything.
   *
   * @param {Object} params UI parameters.
   * @param {Object} [options] {customThemesAvailable}.
   * @returns {string}
   */
  function resolveMonacoTheme(params, options) {
    return resolveThemeChoice(params, options).theme;
  }

  /**
   * Tell every Monaco UI on the page that the theme changed (a document CustomEvent named
   * MONACO_THEME_EVENT, with detail {theme, source}).
   *
   * @param {Object} choice {theme, source}.
   */
  function dispatchMonacoThemeEvent(choice) {
    var doc = root.document;
    if (!doc || typeof doc.dispatchEvent !== 'function') {
      return;
    }
    var detail = { theme: choice.theme, source: choice.source };
    var event = null;
    try {
      if (typeof root.CustomEvent === 'function') {
        event = new root.CustomEvent(MONACO_THEME_EVENT, { detail: detail });
      } else if (typeof doc.createEvent === 'function') {
        event = doc.createEvent('CustomEvent');
        event.initCustomEvent(MONACO_THEME_EVENT, false, false, detail);
      }
    } catch (err) {
      event = null;
    }
    if (event) {
      try {
        doc.dispatchEvent(event);
      } catch (err) {
        // Listener errors are not our concern.
      }
    }
  }

  /**
   * Make a theme the page theme: set it in Monaco and notify the UIs.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} choice {theme, source}.
   */
  function setPageTheme(monaco, choice) {
    pageTheme = { theme: choice.theme, source: choice.source };
    if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
      try {
        monaco.editor.setTheme(choice.theme);
      } catch (err) {
        // Unknown theme: Monaco keeps its current one.
      }
    }
    dispatchMonacoThemeEvent(choice);
  }

  /**
   * Called by each Monaco UI when its editor is created. Only one theme can be active per page,
   * so the first UI to get here sets it (see resolveThemeChoice) and later UIs keep it; only an
   * explicit user choice (setUserMonacoTheme) changes it afterwards.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {Object} params The calling UI's parameters.
   * @param {Object} [options] {customThemesAvailable}.
   * @returns {string} The page theme.
   */
  function applyInitialMonacoTheme(monaco, params, options) {
    if (pageTheme.theme) {
      return pageTheme.theme;
    }
    var choice = resolveThemeChoice(params, options);
    setPageTheme(monaco, choice);
    return choice.theme;
  }

  /**
   * The user explicitly chose a theme (or, with a falsy theme, to go back to the automatic
   * choice for the given parameters). Remembers the choice and applies it to the whole page.
   *
   * @param {Object} monaco The monaco namespace.
   * @param {string|null} theme The chosen theme, or null for automatic.
   * @param {Object} params The calling UI's parameters (used for the automatic choice).
   * @param {Object} [options] {customThemesAvailable}.
   * @returns {string} The page theme.
   */
  function setUserMonacoTheme(monaco, theme, params, options) {
    var name = usableThemeName(theme, options);
    storeMonacoTheme(name ? String(theme).trim() : null);
    var choice = name ? { theme: name, source: 'user' } : resolveThemeChoice(params, options);
    setPageTheme(monaco, choice);
    return choice.theme;
  }

  /**
   * The theme currently active on the page, or null before any Monaco UI has set one.
   *
   * @returns {string|null}
   */
  function getCurrentMonacoTheme() {
    return pageTheme.theme;
  }

  /**
   * Listen for page theme changes.
   *
   * @param {Function} listener Called with {theme, source}.
   * @returns {Object} Disposable.
   */
  function onMonacoThemeChange(listener) {
    var doc = root.document;
    if (typeof listener !== 'function' || !doc || typeof doc.addEventListener !== 'function') {
      return { dispose: function() {} };
    }
    var handler = function(event) {
      listener(event && event.detail ? event.detail : { theme: pageTheme.theme, source: pageTheme.source });
    };
    doc.addEventListener(MONACO_THEME_EVENT, handler);
    return {
      dispose: function() {
        doc.removeEventListener(MONACO_THEME_EVENT, handler);
      }
    };
  }

  // CodeRunner language names (question <language>, Ace <acelang>, ucwords'd data-lang values,
  // file extensions) -> Monaco language ids. Values are also used as the LSP language segment of
  // lsp_base_url, so existing entries must not change.
  var MONACO_LANGUAGE_ALIASES = {
    python: 'python', python2: 'python', python3: 'python', py: 'python', py2: 'python', py3: 'python',
    pypy: 'python', pypy3: 'python',
    java: 'java',
    javascript: 'javascript', js: 'javascript', nodejs: 'javascript', node: 'javascript',
    typescript: 'typescript', ts: 'typescript',
    c: 'c',
    cpp: 'cpp', cplusplus: 'cpp', 'c++': 'cpp', cxx: 'cpp', cc: 'cpp', 'c_cpp': 'cpp',
    csharp: 'csharp', 'c#': 'csharp', cs: 'csharp',
    'objective-c': 'objective-c', objectivec: 'objective-c', objc: 'objective-c',
    php: 'php',
    ruby: 'ruby', rb: 'ruby',
    go: 'go', golang: 'go',
    kotlin: 'kotlin', kt: 'kotlin', kts: 'kotlin',
    swift: 'swift',
    scala: 'scala',
    rust: 'rust', rs: 'rust',
    haskell: 'haskell', hs: 'haskell',
    perl: 'perl', pl: 'perl',
    pascal: 'pascal', pas: 'pascal', delphi: 'pascal', freepascal: 'pascal', fpc: 'pascal',
    r: 'r',
    lua: 'lua',
    dart: 'dart',
    clojure: 'clojure',
    scheme: 'scheme', racket: 'scheme',
    fsharp: 'fsharp', 'f#': 'fsharp',
    vb: 'vb', vbnet: 'vb',
    shell: 'shell', sh: 'shell', bash: 'shell',
    powershell: 'powershell',
    // No Monaco grammar.
    octave: 'plaintext', matlab: 'plaintext', prolog: 'plaintext', fortran: 'plaintext',
    sql: 'sql', mysql: 'sql', sqlite: 'sql', sqlite3: 'sql',
    postgres: 'pgsql', postgresql: 'pgsql', pgsql: 'pgsql',
    mongo: 'mongodb', mongosh: 'mongodb', mongodb: 'mongodb',
    cypher: 'cypher', neo4j: 'cypher',
    hbase: 'hbase',
    solidity: 'sol', sol: 'sol',
    html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml', yml: 'yaml',
    markdown: 'markdown', md: 'markdown',
    plaintext: 'plaintext', text: 'plaintext', txt: 'plaintext'
  };

  /**
   * Map a CodeRunner language name to a Monaco language id. Tries the name itself, then without
   * trailing version digits (java17, python3), then the part before the first '_', '-' or space
   * (kotlin_compose, java-21), with and without digits. An Ace multi-language list such as
   * 'c,cpp,python3*' maps its default (starred, else first) entry.
   *
   * @param {string} lang Language name.
   * @param {string} [fallback] Result for unknown names (default 'plaintext').
   * @returns {string} Monaco language id.
   */
  function mapMonacoLanguage(lang, fallback) {
    var defaultId = fallback === undefined ? 'plaintext' : fallback;
    if (lang === null || lang === undefined) {
      return defaultId;
    }
    var key = String(lang).trim().toLowerCase();
    if (key.indexOf(',') !== -1) {
      var parts = key.split(',').map(function(part) { return part.trim(); }).filter(Boolean);
      var starred = parts.filter(function(part) { return /\*$/.test(part); });
      key = starred.length ? starred[0] : (parts[0] || '');
    }
    key = key.replace(/\*$/, '').trim();
    if (!key) {
      return defaultId;
    }
    var base = key.split(/[_\s-]/)[0];
    var candidates = [key, key.replace(/[\d.]+$/, ''), base, base.replace(/[\d.]+$/, '')];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && Object.prototype.hasOwnProperty.call(MONACO_LANGUAGE_ALIASES, candidates[i])) {
        return MONACO_LANGUAGE_ALIASES[candidates[i]];
      }
    }
    return defaultId;
  }

  return {
    createMonacoModel: createMonacoModel,
    createMonacoLspEditor: createMonacoLspEditor,
    bindEditorModelToLsp: bindEditorModelToLsp,
    registerModelWithLsp: registerModelWithLsp,
    syncModelContent: syncModelContent,
    isModelRegisteredWithLsp: isModelRegisteredWithLsp,
    registerWorkspaceEditHook: registerWorkspaceEditHook,
    registerWorkspaceEditWillAffectHook: registerWorkspaceEditWillAffectHook,
    notifyFileDeleted: notifyFileDeleted,
    notifyFileCreated: notifyFileCreated,
    notifyFileRenamed: notifyFileRenamed,
    getDocumentSymbolProvider: getDocumentSymbolProvider,
    loadMonaco: loadMonaco,
    installMonacoCancellationFilter: installMonacoCancellationFilter,
    isMonacoCancellation: isMonacoCancellation,
    mapMonacoLanguage: mapMonacoLanguage,
    resolveMonacoTheme: resolveMonacoTheme,
    applyInitialMonacoTheme: applyInitialMonacoTheme,
    setUserMonacoTheme: setUserMonacoTheme,
    getCurrentMonacoTheme: getCurrentMonacoTheme,
    getStoredMonacoTheme: getStoredMonacoTheme,
    onMonacoThemeChange: onMonacoThemeChange,
    MONACO_THEME_EVENT: MONACO_THEME_EVENT
  };
}));
