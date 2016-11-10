'use strict';
const os = require('os');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');
const URL = require('url');

const owns = {}.hasOwnProperty;

function applyViaHeader(existingHeaders, opts) {
  if (!opts.via) { return existingHeaders; }

  const viaName = (opts.via === true) ? os.hostname() : opts.via;
  let viaHeader = `1.1 ${viaName}`;

  if (existingHeaders.via) {
    viaHeader = `${existingHeaders.via}, ${viaHeader}`;
  }

  return Object.assign({}, existingHeaders, { via: viaHeader });
}

function rewriteCookieHosts(existingHeaders, opts, req) {
  if (!opts.cookieRewrite || !owns.call(existingHeaders, 'set-cookie')) {
    return req['set-cookie'];
  }

  let existingCookies = existingHeaders['set-cookie'];
  const rewriteHostname = (opts.cookieRewrite === true) ? os.hostname() : opts.cookieRewrite;

  if (!Array.isArray(existingCookies)) {
    existingCookies = [existingCookies];
  }

  const rewrittenCookies = existingCookies.map((c) => {
    let rewrittenCookie = c.replace(/(Domain)=[a-z\.-_]*?(;|$)/gi, `$1=${rewriteHostname}$2`);

    if (!req.connection.encrypted) {
      rewrittenCookie = rewrittenCookie.replace(/;\s*?(Secure)/i, '');
    }

    return rewrittenCookie;
  });

  return rewrittenCookies;
}

function slashJoin(p1, p2) {
  const trailingSlash = (p1.length && p1[p1.length - 1] === '/');
  let suffix = p2;

  if (trailingSlash && p2.length && p2[0] === '/') {
    suffix = p2.substring(1);
  }

  return p1 + suffix;
}

function isRedirectCode(code) {
  return code === 201 || parseInt(code / 100, 10) === 3;
}

function createMiddleware(request, options) {
  const emitter = new EventEmitter();

  /* eslint consistent-return: 0 */
  const middleware = (req, resp, next) => {
    let url = req.url;

    req.body = ''
    req.on('data', (chunk) => { req.body += chunk; });


    //  You can pass the route within the options, as well
    if (typeof options.route === 'string') {
      if (url === options.route) {
        url = '';
      } else if (url.slice(0, options.route.length) === options.route) {
        url = url.slice(options.route.length);
      } else {
        return next();
      }
    }

    // options for this request
    const opts = Object.assign({}, options);
    opts.path = options.pathname;

    if (url && url.charAt(0) === '?') { //  prevent /api/resource/?offset=0
      if (options.pathname.length > 1 && options.pathname.charAt(options.pathname.length - 1) === '/') {
        opts.path = options.pathname.substring(0, options.pathname.length - 1) + url;
      } else {
        opts.path = options.pathname + url;
      }
    } else if (url) {
      opts.path = slashJoin(options.pathname, url);
    }

    opts.method = req.method;
    opts.headers = options.headers ? Object.assign({}, req.headers, options.headers) : req.headers;

    opts.headers = applyViaHeader(req.headers, opts);

    if (!options.preserveHost) {
      //  Forwarding the host breaks dotcloud
      delete opts.headers.host;
    }

    let myReq;

    try {
      myReq = request(opts, (myRes) => {
        const statusCode = myRes.statusCode;
        const headers = myRes.headers;
        const location = headers.location;

        //  Fix the location
        if (isRedirectCode(statusCode) && location && location.indexOf(options.href) > -1) {
          //  absolute path
          headers.location = location.replace(options.href, slashJoin('/', slashJoin((options.route || ''), '')));
        }

        myRes.headers = applyViaHeader(myRes.headers, opts);

        /* eslint no-param-reassign: 0 */
        myRes.headers['set-cookie'] = rewriteCookieHosts(myRes.headers, opts, req);

        resp.writeHead(myRes.statusCode, myRes.headers);

        myRes.body = ''
        myRes.on('data', (chunk ) => {
          myRes.body += chunk;
        });

        myRes.req.body = req.body;

        myRes.on('error', (err) => {
          emitter.emit('error', err);
          next();
        });

        myRes.on('end', () => {
          if (statusCode > 300) {
            emitter.emit('error', myRes);
          } else {
            emitter.emit('end', myRes);
          }
          next();
        });

        myRes.pipe(resp);
      });

      myReq.on('error', (err) => {
        emitter.emit('error', err);
        return next();
      });

      if (!req.readable) {
        return myReq.end();
      }

      return req.pipe(myReq);
    } catch (e) {
      emitter.emit('error', e);
      return next();
    }
  };

  middleware.on = emitter.on.bind(emitter);

  return middleware;
}

module.exports = function proxyMiddleware(opts) {
  let options = Object.assign({}, opts || {});

  const httpLib = options.protocol === 'https:' ? https : http;
  const request = httpLib.request;

  // enable ability to quickly pass a url for shorthand setup
  if (typeof options === 'string') {
    options = URL.parse(options);
  }

  options.hostname = options.hostname;
  options.port = options.port;
  options.pathname = options.pathname || '/';

  return createMiddleware(request, options);
};
