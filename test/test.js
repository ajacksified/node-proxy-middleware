/* eslint import/no-extraneous-dependencies: 0, new-cap: 0, no-param-reassign: 0 */

const connect = require('connect');
const assert = require('assert');
const Proxy = require('../');
const fs = require('fs');
const url = require('url');
const path = require('path');
const http = require('http');
const https = require('https');
const serveStatic = require('serve-static');

const servers = { http, https };

const key = fs.readFileSync(path.join(__dirname, 'server.key'));
const cert = fs.readFileSync(path.join(__dirname, 'server.crt'));
const describe = global.describe;
const it = global.it;

function createServerWithLibName(libName, requestListener) {
  if (libName === 'http') {
    return http.createServer(requestListener);
  }

  return https.createServer({ key, cert }, requestListener);
}

function testWith(srcLibName, destLibName, cb) {
  const srcHttp = servers[srcLibName];

  const destServer = createServerWithLibName(destLibName, (req, resp) => {
    assert.strictEqual(req.method, 'GET');
    assert.strictEqual(req.headers['x-custom-header'], 'hello');
    assert.strictEqual(req.url, '/api/a/b/c/d');
    resp.statusCode = 200;
    resp.setHeader('x-custom-reply', 'la la la');
    resp.write('this is your body.');
    resp.end();
  });

  destServer.listen(0, 'localhost', () => {
    const app = connect();
    const destEndpoint = `${destLibName}://localhost:${destServer.address().port}/api`;
    const reqOpts = url.parse(destEndpoint);
    reqOpts.rejectUnauthorized = false; // because we're self-signing for tests
    app.use(Proxy(reqOpts));
    const srcServer = createServerWithLibName(srcLibName, app);
    srcServer.listen(0, 'localhost', () => {
      // make client request to proxy server
      const srcRequest = srcHttp.request({
        port: srcServer.address().port,
        method: 'GET',
        path: '/a/b/c/d',
        headers: {
          'x-custom-header': 'hello',
        },
        rejectUnauthorized: false,
      }, (resp) => {
        let buffer = '';
        assert.strictEqual(resp.statusCode, 200);
        assert.strictEqual(resp.headers['x-custom-reply'], 'la la la');
        resp.setEncoding('utf8');
        resp.on('data', (data) => {
          buffer += data;
        });
        resp.on('end', () => {
          assert.strictEqual(buffer, 'this is your body.');
          srcServer.close();
          destServer.close();
          cb();
        });
      });
      srcRequest.end();
    });
  });
}

describe('proxy', () => {
  it('http -> https', (done) => {
    testWith('http', 'https', done);
  });

  it('https -> http', (done) => {
    testWith('https', 'http', done);
  });

  it('http -> http', (done) => {
    testWith('http', 'http', done);
  });

  it('https -> https', (done) => {
    testWith('https', 'https', done);
  });

  it('Can still proxy empty requests if the request stream has ended.', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const app = connect();
    // serveStatic causes the incoming request stream to be ended for GETs.
    app.use(serveStatic(path.resolve('.')));
    app.use('/foo', Proxy(url.parse('http://localhost:8001/')));

    destServer.listen(8001, 'localhost', () => {
      app.listen(8000);
      http.get('http://localhost:8000/foo/test/', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          assert.strictEqual(data, '/test/');
          destServer.close();
          done();
        });
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('can proxy just the given route.', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8003/');
    proxyOptions.route = '/foo';

    const app = connect();
    app.use(serveStatic(path.resolve('.')));
    app.use(Proxy(proxyOptions));

    destServer.listen(8003, 'localhost', () => {
      app.listen(8002);
      http.get('http://localhost:8002/foo/test/', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          assert.strictEqual(data, '/test/');
          destServer.close();
          done();
        });
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('Can proxy just the given route with query.', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8021');
    proxyOptions.route = '/foo';

    const app = connect();
    app.use(serveStatic(path.resolve('.')));
    app.use(Proxy(proxyOptions));

    destServer.listen(8021, 'localhost', () => {
      app.listen(8022);
      http.get('http://localhost:8022/foo?baz=true', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          assert.strictEqual(data, '/?baz=true');
          destServer.close();
          done();
        });
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('can proxy an exact url.', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8074/foo');
    proxyOptions.route = '/foo';

    const app = connect();
    app.use(serveStatic(path.resolve('.')));
    app.use(Proxy(proxyOptions));

    destServer.listen(8074, 'localhost', () => {
      app.listen(8075);
      http.get('http://localhost:8075/foo', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          assert.strictEqual(data, '/foo');
          destServer.close();
          done();
        });
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('Can proxy url with query', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8028/foo-bar');
    proxyOptions.route = '/foo-bar';

    const app = connect();
    app.use(serveStatic(path.resolve('.')));
    app.use(Proxy(proxyOptions));

    destServer.listen(8028, 'localhost', () => {
      app.listen(8029);
      http.get('http://localhost:8029/foo-bar?baz=true', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          assert.strictEqual(data, '/foo-bar?baz=true');
          destServer.close();
          done();
        });
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('Does not keep header data across requests.', (done) => {
    const headerValues = ['foo', 'bar'];
    let reqIdx = 0;

    const destServer = createServerWithLibName('http', (req, resp) => {
      assert.strictEqual(req.headers['some-header'], headerValues[reqIdx]);
      reqIdx += 1;
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const app = connect();
    app.use(Proxy(url.parse('http://localhost:8005/')));

    destServer.listen(8005, 'localhost', () => {
      app.listen(8004);

      const options = url.parse('http://localhost:8004/foo/test/');

      // Get with 0 content length, then 56;
      options.headers = { 'some-header': headerValues[0] };
      http.get(options, () => {
        options.headers['some-header'] = headerValues[1];
        http.get(options, () => {
          destServer.close();
          done();
        }).on('error', () => {
          assert.fail('Request proxy failed');
        });
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('correctly applies the via header to the request', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      assert.strictEqual(req.headers.via, '1.1 my-proxy-name');
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8015/');
    proxyOptions.via = 'my-proxy-name';
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8015, 'localhost', () => {
      app.listen(8014);

      const options = url.parse('http://localhost:8014/foo/test/');

      http.get(options, () => {
        // ok...
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('correctly applies the via header to the request where the request has an existing via header', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      assert.strictEqual(req.headers.via, '1.0 other-proxy-name, 1.1 my-proxy-name');
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8025/');
    proxyOptions.via = 'my-proxy-name';
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8025, 'localhost', () => {
      app.listen(8024);

      const options = url.parse('http://localhost:8024/foo/test/');
      options.headers = { via: '1.0 other-proxy-name' };

      http.get(options, () => {
        // ok...
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('correctly applies the via header to the response', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8035/');
    proxyOptions.via = 'my-proxy-name';
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8035, 'localhost', () => {
      app.listen(8034);

      const options = url.parse('http://localhost:8034/foo/test/');

      http.get(options, (res) => {
        assert.strictEqual('1.1 my-proxy-name', res.headers.via);
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('correctly applies the via header to the response where the response has an existing via header', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.setHeader('via', '1.0 other-proxy-name');
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8045/');
    proxyOptions.via = 'my-proxy-name';
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8045, 'localhost', () => {
      app.listen(8044);

      const options = url.parse('http://localhost:8044/foo/test/');

      http.get(options, (res) => {
        assert.strictEqual('1.0 other-proxy-name, 1.1 my-proxy-name', res.headers.via);
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('correctly applies the location header to the response when the response status code is 3xx', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 302;
      resp.setHeader('location', 'http://localhost:8055/foo/redirect/');
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8055/');
    const app = connect();
    const proxy = Proxy(proxyOptions);
    proxy.on('error', () => {});

    app.use(proxy);

    destServer.listen(8055, 'localhost', () => {
      app.listen(8054);

      const options = url.parse('http://localhost:8054/foo/test/');

      http.get(options, (res) => {
        assert.strictEqual(res.headers.location, '/foo/redirect/');
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });


  it('correctly rewrites the cookie domain for set-cookie headers', (done) => {
    const cookie1 = host => `cookie1=value1; Expires=Fri, 01-Mar-2019 00:00:01 GMT; Path=/; Domain=${host}; HttpOnly`;
    const cookie2 = host => `cookie2=value2; Expires=Fri, 01-Mar-2019 00:00:01 GMT; Domain=${host}; Path=/test/`;
    const cookie3 = () => 'cookie3=value3';
    const cookie4 = host => `cookie4=value4; Expires=Fri, 01-Mar-2019 00:00:01 GMT; Domain=${host}`;

    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 200;
      resp.setHeader('set-cookie', [
        cookie1('.server.com'),
        cookie2('.server.com'),
        cookie3('.server.com'),
        cookie4('.server.com'),
      ]);
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8065/');
    proxyOptions.cookieRewrite = '.proxy.com';
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8065, 'localhost', () => {
      app.listen(8064);

      const options = url.parse('http://localhost:8064/foo/test/');

      http.get(options, (res) => {
        const cookies = res.headers['set-cookie'];
        assert.strictEqual(cookies[0], cookie1(proxyOptions.cookieRewrite));
        assert.strictEqual(cookies[1], cookie2(proxyOptions.cookieRewrite));
        assert.strictEqual(cookies[2], cookie3(proxyOptions.cookieRewrite));
        assert.strictEqual(cookies[3], cookie4(proxyOptions.cookieRewrite));
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('removes the Secure directive when proxying from https to http', (done) => {
    const cookie1 = (host, after) => {
      if (after) {
        return `cookie1=value1; Expires=Fri, 01-Mar-2019 00:00:01 GMT; Domain=${host}`;
      }

      return `cookie1=value1; Expires=Fri, 01-Mar-2019 00:00:01 GMT; Domain=${host};Secure`;
    };

    const destServer = createServerWithLibName('https', (req, resp) => {
      resp.statusCode = 200;
      resp.setHeader('set-cookie', [
        cookie1('.server.com'),
      ]);
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('https://localhost:8066/');
    proxyOptions.cookieRewrite = '.proxy.com';
    proxyOptions.rejectUnauthorized = false;
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8066, 'localhost', () => {
      app.listen(8067);

      const options = url.parse('http://localhost:8067/foo/test/');

      http.get(options, (res) => {
        const cookies = res.headers['set-cookie'];
        assert.strictEqual(cookies[0], cookie1(proxyOptions.cookieRewrite, true));
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('does not forward the Host header with default options', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      assert.strictEqual(req.headers.host, 'localhost:8068');
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8068/');
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8068, 'localhost', () => {
      app.listen(8069);

      const options = url.parse('http://localhost:8069/foo/test/');
      http.get(options, () => {
        // ok...
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('does not forward the Host header with options.preserveHost = false', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      assert.strictEqual(req.headers.host, 'localhost:8070');
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8070/');
    proxyOptions.preserveHost = false;
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8070, 'localhost', () => {
      app.listen(8071);

      const options = url.parse('http://localhost:8071/foo/test/');
      http.get(options, () => {
        // ok...
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('forwards the Host header with options.preserveHost = true', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      assert.strictEqual(req.headers.host, 'localhost:8073');
      resp.statusCode = 200;
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8072/');
    proxyOptions.preserveHost = true;
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8072, 'localhost', () => {
      app.listen(8073);

      const options = url.parse('http://localhost:8073/foo/test/');
      http.get(options, () => {
        // ok...
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });

  it('correctly applies the location header to the response when the response status code is 201', (done) => {
    const destServer = createServerWithLibName('http', (req, resp) => {
      resp.statusCode = 201;
      resp.setHeader('location', 'http://localhost:8085/foo/redirect/');
      resp.write(req.url);
      resp.end();
    });

    const proxyOptions = url.parse('http://localhost:8085/');
    const app = connect();
    app.use(Proxy(proxyOptions));

    destServer.listen(8085, 'localhost', () => {
      app.listen(8084);

      const options = url.parse('http://localhost:8084/foo/test/');

      http.get(options, (res) => {
        assert.strictEqual(res.headers.location, '/foo/redirect/');
        done();
      }).on('error', () => {
        assert.fail('Request proxy failed');
      });
    });
  });
});
