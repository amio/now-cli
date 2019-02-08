import fs from 'fs';
import http from 'http';
import chalk from 'chalk';
import qs from 'querystring';
import httpProxy from 'http-proxy';
import * as listen from 'async-listen';
import serveHandler from 'serve-handler';
import { createFunction } from '@zeit/fun';

import error from '../../../util/output/error';
import success from '../../../util/output/success';
import { readLocalConfig } from '../../../util/config/files';

import isURL from './is-url';
import devRouter from './dev-router';
import {
  buildUserProject,
  createIgnoreList,
  collectProjectFiles
} from './dev-builder';

import FileFsRef from '@now/build-utils/file-fs-ref';

import {
  DevServerStatus,
  DevServerOptions,
  BuilderOutput,
  BuilderOutputs,
  HttpHandler
} from './types';

export default class DevServer {
  public cwd: string;

  private debug: boolean;
  private server: http.Server;
  private status: DevServerStatus;
  private statusMessage = '';

  constructor(cwd: string, options: DevServerOptions) {
    this.cwd = cwd;
    this.debug = options.debug;
    this.server = http.createServer(this.devServerHandler);
    this.status = DevServerStatus.busy;
  }

  /* use dev-server as a "console" for logs. */
  logDebug(...args: any[]): void {
    if (this.debug) {
      console.log(chalk.yellowBright('> [debug]'), ...args);
    }
  }

  logError(str: string): void {
    console.log(error(str));
  }

  logSuccess(str: string): void {
    console.log(success(str));
  }

  logHttp(msg: string): void {
    console.log(`  ${chalk.green('>>>')} ${msg}`);
  }

  /* set dev-server status */

  setStatusIdle(): void {
    this.status = DevServerStatus.idle;
    this.statusMessage = '';
  }

  setStatusBusy(msg: string): void {
    this.status = DevServerStatus.busy;
    this.statusMessage = msg;
  }

  setStatusError(msg: string): void {
    this.status = DevServerStatus.error;
    this.statusMessage = msg;
  }

  /**
   * Launch dev-server
   */
  async start(port = 3000) {
    const nowJson = readLocalConfig(this.cwd);

    return new Promise((resolve, reject) => {
      this.server.on('error', reject);

      this.server.listen(port, async () => {
        this.logSuccess(
          `Dev server listening on port ${chalk.bold(String(port))}`
        );

        // Initial build. Not meant to invoke, but for speed up further builds.
        //if (nowJson && Array.isArray(nowJson.builds)) {
        //  this.logDebug('Initial build');
        //  await buildUserProject(nowJson.builds, this);
        //  this.logSuccess('Initial build ready');
        //}

        this.setStatusIdle();
        resolve();
      });
    });
  }

  /**
   * dev-server http handler
   */
  devServerHandler: HttpHandler = async (req, res) => {
    if (this.status === DevServerStatus.busy) {
      return res.end(`[busy] ${this.statusMessage}...`);
    }

    this.logHttp(`${req.method} ${req.url}`);

    try {
      const nowJson = readLocalConfig(this.cwd);

      if (nowJson === null) {
        await this.serveProjectAsStatics(req, res, this.cwd);
      } else if (nowJson.version !== 2) {
        throw new Error('now-dev only support Now V2.');
      } else {
        await this.serveProjectAsNowV2(req, res, this.cwd, nowJson);
      }
    } catch (err) {
      this.setStatusError(err.message);
      this.logDebug(err.stack);

      if (!res.finished) {
        res.writeHead(500);
        res.end(this.statusMessage);
      }
    }

    this.setStatusIdle();
  };

  /**
   * Serve project directory as static
   */
  serveProjectAsStatics = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cwd: string
  ) => {
    const filePath = req.url ? req.url.replace(/^\//, '') : '';
    const ignore = createIgnoreList(cwd);

    if (filePath && ignore.ignores(filePath)) {
      res.writeHead(404);
      res.end();
      return;
    }

    return serveStaticFile(req, res, cwd);
  };

  /**
   * Server project directory as now v2 app
   */
  serveProjectAsNowV2 = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    cwd: string,
    nowJson: any
  ) => {
    const {
      dest,
      status = 200,
      headers = {},
      uri_args,
      matched_route
    } = devRouter(req.url, nowJson.routes);

    // set headers
    Object.entries(headers).forEach(([name, value]) => {
      res.setHeader(name, value);
    });

    if (isURL(dest)) {
      this.logDebug('ProxyPass', matched_route);
      return proxyPass(req, res, dest);
    }

    if ([301, 302, 404].includes(status)) {
      this.logDebug('Redirect', matched_route);
      return res.end();
    }

    if (!nowJson.builds) {
      return serveStaticFile(req, res, cwd);
    }

    // build source files to assets
    this.logDebug('Start builders', nowJson.builds);
    const assets = await buildUserProject(nowJson.builds, this);

    this.logDebug('Built', Object.keys(assets));

    // find asset responsible for dest
    const asset = resolveDest(assets, dest);

    if (!asset) {
      res.writeHead(404);
      return res.end();
    }

    // invoke asset
    switch (asset.type) {
      case 'FileFsRef':
        return serveStaticFile(req, res, cwd);

      case 'Lambda':
        console.error('lambda', { asset });

        const fn = await createFunction({
          Code: { ZipFile: asset.zipBuffer },
          Handler: asset.handler,
          Runtime: asset.runtime,
          Environment: {
            Variables: { ...asset.environment }
          }
        });

        const invoked = await fn({
          method: req.method,
          path: req.url,
          headers: req.headers,
          encoding: 'base64',
          body: 'eyJlaXlvIjp0cnVlfQ=='
        });

        // TODO: go on here after error resolved.
        console.log({ invoked });
        return res.end(`TODO: send invoke ${asset.handler} result`);

      default:
        res.writeHead(500);
        return res.end();
    }
  };
}

/**
 * Mimic nginx's proxy_pass
 * for routes using a url as dest.
 */
function proxyPass(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  dest: string
): void {
  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    target: dest
  });

  return proxy.web(req, res);
}

/**
 * Handle requests for static files with serve-handler
 */
function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cwd: string
) {
  return serveHandler(req, res, {
    public: cwd,
    cleanUrls: false
  });
}

/**
 * Find the dest handler from assets
 */
function resolveDest(
  assets: BuilderOutputs,
  dest: string
): BuilderOutput | undefined {
  const assetKey = dest.replace(/^\//, '');

  if (assets[assetKey]) return assets[assetKey];

  // find `${assetKey}/index.*` for indexes
  const foundIndex = Object.keys(assets).find(name => {
    return name.replace(/\/?index\.\w+$/, '') === assetKey.replace(/\/$/, '');
  });

  if (foundIndex) return assets[foundIndex];
}
