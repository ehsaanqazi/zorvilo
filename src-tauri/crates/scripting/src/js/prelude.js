// Zorvilo script prelude — builds the Postman-compatible `pm` API inside the
// sandboxed Boa context. The host replaces the context placeholder with a JSON string
// literal describing the request/response/variables. Scripts have no access
// to the filesystem, process, or application internals: the only host
// function is the optional __zorvilo_send bridge used by pm.sendRequest().

var __ctx = JSON.parse(__CTX_JSON__);
var __state = {
  logs: [],
  tests: [],
  error: null,
  mutations: {
    environment: [],
    globals: [],
    collection: [],
    request: { url: null, method: null, headerOps: [], body: null }
  },
  locals: {},
  nextRequestSet: false,
  nextRequest: null
};

function __str(v) {
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return '[Function]';
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function __fmtErr(e) {
  if (e && typeof e === 'object' && e.message !== undefined) {
    return (e.name ? e.name + ': ' : '') + e.message;
  }
  return String(e);
}

function __logLine(prefix, args) {
  var parts = [];
  for (var i = 0; i < args.length; i++) parts.push(__str(args[i]));
  if (__state.logs.length < 2000) __state.logs.push(prefix + parts.join(' '));
}

var console = {
  log: function () { __logLine('', arguments); },
  info: function () { __logLine('[info] ', arguments); },
  debug: function () { __logLine('[debug] ', arguments); },
  warn: function () { __logLine('[warn] ', arguments); },
  error: function () { __logLine('[error] ', arguments); }
};

var __B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function btoa(input) {
  var str = String(input), out = '';
  for (var i = 0; i < str.length; i += 3) {
    var a = str.charCodeAt(i), b = str.charCodeAt(i + 1), c = str.charCodeAt(i + 2);
    var n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += __B64.charAt((n >> 18) & 63) + __B64.charAt((n >> 12) & 63) +
      (i + 1 < str.length ? __B64.charAt((n >> 6) & 63) : '=') +
      (i + 2 < str.length ? __B64.charAt(n & 63) : '=');
  }
  return out;
}
function atob(input) {
  var str = String(input).replace(/=+$/, ''), out = '', buffer = 0, bits = 0;
  for (var i = 0; i < str.length; i++) {
    var idx = __B64.indexOf(str.charAt(i));
    if (idx < 0) continue;
    buffer = (buffer << 6) | idx; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((buffer >> bits) & 255); }
  }
  return out;
}

function __hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function __toValue(v) {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : __str(v);
}

function __scope(store, list) {
  return {
    get: function (k) { return __hasOwn(store, k) ? store[k] : undefined; },
    has: function (k) { return __hasOwn(store, k); },
    set: function (k, v) { var s = __toValue(v); store[String(k)] = s; list.push([String(k), s]); },
    unset: function (k) { delete store[k]; list.push([String(k), null]); },
    clear: function () { Object.keys(store).forEach(function (k) { delete store[k]; list.push([k, null]); }); },
    toObject: function () { return Object.assign({}, store); },
    replaceIn: function (t) { return __replaceIn(t); }
  };
}

var __vars = __ctx.variables;
var __envScope = __scope(__vars.environment, __state.mutations.environment);
__envScope.name = __ctx.environmentName || '';
var __globalScope = __scope(__vars.globals, __state.mutations.globals);
var __collectionScope = __scope(__vars.collection, __state.mutations.collection);

function __lookup(k) {
  if (__hasOwn(__state.locals, k)) return __state.locals[k];
  if (__hasOwn(__vars.request, k)) return __vars.request[k];
  if (__hasOwn(__vars.folder, k)) return __vars.folder[k];
  if (__hasOwn(__vars.collection, k)) return __vars.collection[k];
  if (__hasOwn(__vars.environment, k)) return __vars.environment[k];
  if (__hasOwn(__vars.globals, k)) return __vars.globals[k];
  return undefined;
}

function __replaceIn(t) {
  return String(t).replace(/\{\{\s*([\w.\-$]+)\s*\}\}/g, function (m, name) {
    var v = __lookup(name);
    return v === undefined ? m : v;
  });
}

// ------------------------------------------------------------- assertions

function __deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number' && a !== a && b !== b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    if (!__hasOwn(b, ka[i]) || !__deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}

function __typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof RegExp) return 'regexp';
  if (v instanceof Date) return 'date';
  return typeof v;
}

function AssertionError(message) { this.name = 'AssertionError'; this.message = message; }
AssertionError.prototype = Object.create(Error.prototype);
AssertionError.prototype.constructor = AssertionError;

function __expect(actual, negate, flags) {
  flags = flags || {};
  var c = {};
  function assert(pass, msg) {
    if (negate ? pass : !pass) throw new AssertionError(negate ? 'expected NOT: ' + msg : msg);
    return c;
  }
  var words = ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also', 'any', 'all'];
  words.forEach(function (w) { Object.defineProperty(c, w, { get: function () { return c; } }); });
  Object.defineProperty(c, 'not', { get: function () { return __expect(actual, !negate, flags); } });
  Object.defineProperty(c, 'deep', { get: function () { flags.deep = true; return c; } });
  var A = __str(actual);
  var getters = {
    ok: function () { return assert(!!actual, 'expected ' + A + ' to be truthy'); },
    true: function () { return assert(actual === true, 'expected ' + A + ' to be true'); },
    false: function () { return assert(actual === false, 'expected ' + A + ' to be false'); },
    null: function () { return assert(actual === null, 'expected ' + A + ' to be null'); },
    undefined: function () { return assert(actual === undefined, 'expected ' + A + ' to be undefined'); },
    NaN: function () { return assert(actual !== actual, 'expected ' + A + ' to be NaN'); },
    exist: function () { return assert(actual !== null && actual !== undefined, 'expected value to exist'); },
    empty: function () {
      var empty = actual == null ? true
        : (typeof actual === 'string' || Array.isArray(actual)) ? actual.length === 0
        : typeof actual === 'object' ? Object.keys(actual).length === 0 : false;
      return assert(empty, 'expected ' + A + ' to be empty');
    },
    json: function () { return assert(actual && typeof actual.json === 'function', 'expected a JSON response'); }
  };
  Object.keys(getters).forEach(function (k) { Object.defineProperty(c, k, { get: getters[k] }); });

  c.equal = c.equals = c.eq = function (v) {
    if (flags.deep) return c.eql(v);
    return assert(actual === v, 'expected ' + A + ' to equal ' + __str(v));
  };
  c.eql = c.eqls = function (v) { return assert(__deepEqual(actual, v), 'expected ' + A + ' to deeply equal ' + __str(v)); };
  c.include = c.includes = c.contain = c.contains = function (v) {
    var ok = false;
    if (typeof actual === 'string') ok = actual.indexOf(String(v)) !== -1;
    else if (Array.isArray(actual)) ok = actual.some(function (x) { return flags.deep ? __deepEqual(x, v) : x === v; });
    else if (actual && typeof actual === 'object' && v && typeof v === 'object') {
      ok = Object.keys(v).every(function (k) { return __deepEqual(actual[k], v[k]); });
    } else if (actual && typeof actual === 'object') ok = __hasOwn(actual, v);
    return assert(ok, 'expected ' + A + ' to include ' + __str(v));
  };
  c.string = function (s) { return assert(typeof actual === 'string' && actual.indexOf(s) !== -1, 'expected ' + A + ' to contain ' + __str(s)); };
  c.match = c.matches = function (re) { return assert(re instanceof RegExp && re.test(String(actual)), 'expected ' + A + ' to match ' + String(re)); };
  c.property = c.haveOwnProperty = c.ownProperty = function (p, v) {
    var has = actual !== null && actual !== undefined && (typeof actual === 'object' || typeof actual === 'function') && (p in Object(actual));
    if (arguments.length < 2) {
      assert(has, 'expected ' + A + ' to have property ' + __str(p));
      return negate ? c : __expect(has ? actual[p] : undefined, false, {});
    }
    return assert(has && __deepEqual(actual[p], v), 'expected ' + A + ' to have property ' + __str(p) + ' of ' + __str(v));
  };
  c.keys = c.key = function () {
    var wanted = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
    var ok = actual && typeof actual === 'object' && wanted.every(function (k) { return __hasOwn(actual, k); });
    return assert(ok, 'expected ' + A + ' to have keys ' + __str(wanted));
  };
  c.lengthOf = c.length = function (n) {
    var len = actual == null ? undefined : actual.length;
    return assert(len === n, 'expected ' + A + ' to have length ' + n + ' but got ' + len);
  };
  c.above = c.gt = c.greaterThan = function (n) { return assert(actual > n, 'expected ' + A + ' to be above ' + n); };
  c.below = c.lt = c.lessThan = function (n) { return assert(actual < n, 'expected ' + A + ' to be below ' + n); };
  c.least = c.gte = function (n) { return assert(actual >= n, 'expected ' + A + ' to be at least ' + n); };
  c.most = c.lte = function (n) { return assert(actual <= n, 'expected ' + A + ' to be at most ' + n); };
  c.within = function (a, b) { return assert(actual >= a && actual <= b, 'expected ' + A + ' to be within ' + a + '..' + b); };
  c.closeTo = c.approximately = function (v, d) { return assert(Math.abs(actual - v) <= d, 'expected ' + A + ' to be close to ' + v + ' +/- ' + d); };
  c.a = c.an = function (t) {
    var got = __typeOf(actual);
    return assert(got === String(t).toLowerCase(), 'expected ' + A + ' to be a ' + t + ' but got ' + got);
  };
  c.instanceOf = c.instanceof = function (k) { return assert(actual instanceof k, 'expected ' + A + ' to be an instance of the given type'); };
  c.oneOf = function (list) { return assert(Array.isArray(list) && list.some(function (x) { return __deepEqual(x, actual); }), 'expected ' + A + ' to be one of ' + __str(list)); };
  c.members = function (list) {
    var ok = Array.isArray(actual) && Array.isArray(list) && list.length === actual.length &&
      list.every(function (x) { return actual.some(function (y) { return __deepEqual(x, y); }); });
    return assert(ok, 'expected ' + A + ' to have the same members as ' + __str(list));
  };
  c.status = function (code) {
    var got = actual && (typeof code === 'number' ? actual.code : actual.status);
    return assert(got === code, 'expected status ' + code + ' but got ' + got);
  };
  c.header = function (name, value) {
    var h = actual && actual.headers && typeof actual.headers.get === 'function' ? actual.headers.get(name) : undefined;
    if (arguments.length < 2) return assert(h !== undefined, 'expected header ' + name);
    return assert(h === value, 'expected header ' + name + ' to be ' + __str(value) + ' but got ' + __str(h));
  };
  c.body = function (s) {
    var text = actual && typeof actual.text === 'function' ? actual.text() : undefined;
    return assert(text === s, 'expected body to equal ' + __str(s));
  };
  c.jsonBody = function (path, value) {
    var body;
    try { body = actual.json(); } catch (e) { return assert(false, 'expected a JSON body'); }
    if (arguments.length === 0) return assert(true, '');
    var cur = body, parts = String(path).split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined || !(parts[i] in Object(cur))) return assert(false, 'expected JSON body to have path ' + path);
      cur = cur[parts[i]];
    }
    if (arguments.length < 2) return assert(true, '');
    return assert(__deepEqual(cur, value), 'expected JSON path ' + path + ' to equal ' + __str(value));
  };
  return c;
}

// ------------------------------------------------------------- headers

function __headerList(pairs) {
  return {
    get: function (name) {
      var n = String(name).toLowerCase();
      for (var i = 0; i < pairs.length; i++) if (String(pairs[i][0]).toLowerCase() === n) return pairs[i][1];
      return undefined;
    },
    has: function (name, value) {
      var v = this.get(name);
      return arguments.length < 2 ? v !== undefined : v === value;
    },
    toObject: function () {
      var o = {};
      pairs.forEach(function (p) { o[String(p[0]).toLowerCase()] = p[1]; });
      return o;
    },
    all: function () { return pairs.map(function (p) { return { key: p[0], value: p[1] }; }); },
    each: function (fn) { pairs.forEach(function (p) { fn({ key: p[0], value: p[1] }); }); },
    count: function () { return pairs.length; }
  };
}

// ------------------------------------------------------------- request

var __reqHeaders = (__ctx.request.headers || []).map(function (p) { return [p[0], p[1]]; });
var __reqHeaderView = __headerList(__reqHeaders);
var __initialUrl = __ctx.request.url;
var __initialMethod = __ctx.request.method;
var __initialBody = __ctx.request.body;

function __headerArgs(h, v) {
  if (typeof h === 'string') {
    var i = h.indexOf(':');
    if (v === undefined && i > 0) return [h.slice(0, i).trim(), h.slice(i + 1).trim()];
    return [h, __toValue(v)];
  }
  return [String(h.key), __toValue(h.value)];
}

var pmRequest = {
  url: __ctx.request.url,
  method: __ctx.request.method,
  name: __ctx.info.requestName,
  id: __ctx.info.requestId,
  body: { mode: 'raw', raw: __ctx.request.body, toString: function () { return this.raw; }, update: function (s) { this.raw = typeof s === 'string' ? s : __str(s); } },
  headers: {
    add: function (h, v) { var kv = __headerArgs(h, v); __reqHeaders.push(kv); __state.mutations.request.headerOps.push(['add', kv[0], kv[1]]); },
    upsert: function (h, v) {
      var kv = __headerArgs(h, v), n = kv[0].toLowerCase();
      for (var i = __reqHeaders.length - 1; i >= 0; i--) if (String(__reqHeaders[i][0]).toLowerCase() === n) __reqHeaders.splice(i, 1);
      __reqHeaders.push(kv);
      __state.mutations.request.headerOps.push(['set', kv[0], kv[1]]);
    },
    remove: function (name) {
      var n = String(name).toLowerCase();
      for (var i = __reqHeaders.length - 1; i >= 0; i--) if (String(__reqHeaders[i][0]).toLowerCase() === n) __reqHeaders.splice(i, 1);
      __state.mutations.request.headerOps.push(['remove', String(name), '']);
    },
    get: function (n) { return __reqHeaderView.get(n); },
    has: function (n) { return __reqHeaderView.has(n); },
    toObject: function () { return __reqHeaderView.toObject(); },
    all: function () { return __reqHeaderView.all(); },
    each: function (fn) { return __reqHeaderView.each(fn); }
  },
  addHeader: function (h) { this.headers.add(h); },
  removeHeader: function (n) { this.headers.remove(n); }
};

// ------------------------------------------------------------- response

function __makeResponse(R) {
  var headers = __headerList(R.headers || []);
  var cookies = [];
  (R.headers || []).forEach(function (p) {
    if (String(p[0]).toLowerCase() !== 'set-cookie') return;
    var first = String(p[1]).split(';')[0], i = first.indexOf('=');
    if (i > 0) cookies.push([first.slice(0, i).trim(), first.slice(i + 1).trim()]);
  });
  var res = {
    code: R.code,
    status: R.status,
    responseTime: R.responseTime,
    responseSize: R.size,
    headers: headers,
    cookies: __headerList(cookies),
    text: function () { return R.body; },
    json: function () { return JSON.parse(R.body); },
    reason: function () { return R.status; }
  };
  var expectRes = function () { return __expect(res, false); };
  var toBe = {};
  var statusGetters = {
    ok: function () { return __expect(R.code >= 200 && R.code < 300, false).true; },
    success: function () { return __expect(R.code >= 200 && R.code < 300, false).true; },
    error: function () { return __expect(R.code >= 400, false).true; },
    clientError: function () { return __expect(R.code >= 400 && R.code < 500, false).true; },
    serverError: function () { return __expect(R.code >= 500, false).true; },
    info: function () { return __expect(R.code >= 100 && R.code < 200, false).true; },
    redirection: function () { return __expect(R.code >= 300 && R.code < 400, false).true; },
    accepted: function () { return __expect(R.code, false).equal(202); },
    badRequest: function () { return __expect(R.code, false).equal(400); },
    unauthorized: function () { return __expect(R.code, false).equal(401); },
    forbidden: function () { return __expect(R.code, false).equal(403); },
    notFound: function () { return __expect(R.code, false).equal(404); },
    rateLimited: function () { return __expect(R.code, false).equal(429); },
    json: function () { return __expect(String(headers.get('content-type') || ''), false).include('json'); }
  };
  Object.keys(statusGetters).forEach(function (k) { Object.defineProperty(toBe, k, { get: statusGetters[k] }); });
  res.to = {
    have: {
      status: function (c) { return expectRes().status(c); },
      header: function (n, v) { return arguments.length < 2 ? expectRes().header(n) : expectRes().header(n, v); },
      body: function (s) { return expectRes().body(s); },
      jsonBody: function () { var e = expectRes(); return e.jsonBody.apply(e, arguments); }
    },
    be: toBe
  };
  return res;
}

var pmResponse = __ctx.response ? __makeResponse(__ctx.response) : null;

// ------------------------------------------------------------- sendRequest

function __sendRequest(req, cb) {
  var spec = typeof req === 'string' ? { url: req, method: 'GET' } : (req || {});
  var headers = [];
  var h = spec.header || spec.headers;
  if (Array.isArray(h)) h.forEach(function (x) { if (x && x.key) headers.push([String(x.key), __toValue(x.value)]); });
  else if (h && typeof h === 'object') Object.keys(h).forEach(function (k) { headers.push([k, __toValue(h[k])]); });
  var body = null;
  if (spec.body) {
    if (typeof spec.body === 'string') body = spec.body;
    else if (spec.body.mode === 'raw') body = __toValue(spec.body.raw);
    else if (spec.body.mode === 'urlencoded' && Array.isArray(spec.body.urlencoded)) {
      body = spec.body.urlencoded.map(function (p) { return encodeURIComponent(p.key) + '=' + encodeURIComponent(__toValue(p.value)); }).join('&');
      headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    }
  }
  var payload = JSON.stringify({ url: __replaceIn(String(spec.url || '')), method: String(spec.method || 'GET').toUpperCase(), headers: headers, body: body });
  var err = null, res = null;
  if (typeof __zorvilo_send !== 'function') {
    err = new Error('pm.sendRequest is disabled in Settings → Scripting');
  } else {
    var out = JSON.parse(__zorvilo_send(payload));
    if (out.error) err = new Error(out.error);
    else res = __makeResponse(out);
  }
  if (typeof cb === 'function') {
    cb(err, res);
    return undefined;
  }
  return err ? Promise.reject(err) : Promise.resolve(res);
}

// ------------------------------------------------------------- pm

var pm = {
  request: pmRequest,
  response: pmResponse,
  environment: __envScope,
  globals: __globalScope,
  collectionVariables: __collectionScope,
  variables: {
    get: function (k) { return __lookup(k); },
    has: function (k) { return __lookup(k) !== undefined; },
    set: function (k, v) { __state.locals[String(k)] = __toValue(v); },
    unset: function (k) { delete __state.locals[k]; },
    replaceIn: function (t) { return __replaceIn(t); },
    toObject: function () {
      var o = {};
      [__vars.globals, __vars.environment, __vars.collection, __vars.folder, __vars.request, __state.locals].forEach(function (s) { Object.assign(o, s); });
      return o;
    }
  },
  info: {
    eventName: __ctx.info.eventName,
    iteration: __ctx.info.iteration,
    iterationCount: __ctx.info.iterationCount,
    requestName: __ctx.info.requestName,
    requestId: __ctx.info.requestId
  },
  cookies: __headerList(__ctx.cookies || []),
  expect: function (v) { return __expect(v, false); },
  test: function (name, fn) {
    try {
      if (typeof fn === 'function') fn();
      __state.tests.push({ name: String(name), passed: true });
    } catch (e) {
      __state.tests.push({ name: String(name), passed: false, error: __fmtErr(e) });
    }
  },
  sendRequest: __sendRequest,
  execution: {
    setNextRequest: function (name) { __state.nextRequestSet = true; __state.nextRequest = name === null || name === undefined ? null : String(name); }
  }
};
pm.test.skip = function (name) { __state.tests.push({ name: String(name), passed: true, skipped: true }); };

// legacy Postman sandbox globals
var postman = {
  setEnvironmentVariable: function (k, v) { __envScope.set(k, v); },
  getEnvironmentVariable: function (k) { return __envScope.get(k); },
  clearEnvironmentVariable: function (k) { __envScope.unset(k); },
  setGlobalVariable: function (k, v) { __globalScope.set(k, v); },
  getGlobalVariable: function (k) { return __globalScope.get(k); },
  clearGlobalVariable: function (k) { __globalScope.unset(k); },
  setNextRequest: function (n) { pm.execution.setNextRequest(n); }
};
var tests = {};
var environment = __vars.environment;
var globals = __vars.globals;
var request = { url: __ctx.request.url, method: __ctx.request.method, headers: __reqHeaderView.toObject(), data: __ctx.request.body };
var responseBody = __ctx.response ? __ctx.response.body : undefined;
var responseCode = __ctx.response ? { code: __ctx.response.code, name: __ctx.response.status } : undefined;
var responseTime = __ctx.response ? __ctx.response.responseTime : undefined;
var responseHeaders = pmResponse ? pmResponse.headers.toObject() : undefined;

function __zorvilo_result() {
  Object.keys(tests).forEach(function (k) { __state.tests.push({ name: k, passed: !!tests[k] }); });
  tests = {};
  var m = __state.mutations.request;
  if (pmRequest.url !== null && String(pmRequest.url) !== __initialUrl) m.url = String(pmRequest.url);
  if (String(pmRequest.method).toUpperCase() !== String(__initialMethod).toUpperCase()) m.method = String(pmRequest.method).toUpperCase();
  if (pmRequest.body && pmRequest.body.raw !== __initialBody) m.body = __toValue(pmRequest.body.raw);
  return JSON.stringify({
    logs: __state.logs,
    tests: __state.tests,
    error: __state.error,
    mutations: __state.mutations,
    locals: __state.locals,
    nextRequestSet: __state.nextRequestSet,
    nextRequest: __state.nextRequest
  });
}
