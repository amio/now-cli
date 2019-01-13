import path from 'path';
import http from 'http';
import execa from 'execa';

import httpProxy from 'http-proxy';
import chalk from 'chalk';
import chokidar from 'chokidar';

import wait from '../../util/output/wait';
import info from '../../util/output/info';
import error from '../../util/output/error';
import success from '../../util/output/success';
import { NowError } from '../../util/now-error';
import { readLocalConfig } from '../../util/config/files';

import builderCache from './builder-cache';

// temporally type
interface BuildConfig {
  src: string,
  use: string,
  config?: object
}

enum DevServerStatus { busy, idle }

type HttpHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => any;

export default class DevServer {
  private cwd: string;
  private server: http.Server;
  private status: DevServerStatus;
  private statusMessage = '';
  private builderDirectory = '';
  private remoteDevUrl = '';
  private watcher: any;

  constructor (cwd: string, port = 3000) {
    this.cwd = cwd;
    this.server = http.createServer(this.devServerHandler);
    this.builderDirectory = builderCache.prepare();
    this.status = DevServerStatus.busy;
  }

  /* use dev-server as a "console" for logs. */
  logInfo (str: string) { console.log(info(str)) }
  logError (str: string) { console.log(error(str)) }
  logSuccess (str: string) { console.log(success(str))}
  logHttp (msg?: string) { msg && console.log(
    `  ${chalk.greenBright('>>>')} ${msg}`
  ) }

  start = async (port = 3000) => {
    const nowJson = readLocalConfig(this.cwd);

    return new Promise((resolve, reject) => {
      this.server.on('error', reject);

      this.server.listen(port, async () => {
        this.logSuccess(
          `dev server listning on port ${chalk.bold(String(port))}`
        );

        this.watcher = chokidar.watch(this.cwd, {
          ignored: /node_modules/,
          ignoreInitial: true
        })
        this.watcher.on('all', this.onChange);

        await this.deploy();

        resolve();
      });
    })
  }

  deploy = async () => {
    console.time('> deployed');
    this.setStatusBusy('deploying dev builds');
    const stopSpinner = wait('deploying dev builds');

    const { stdout } = await execa('now', { cwd: this.cwd });
    this.remoteDevUrl = stdout;

    stopSpinner();
    this.setStatusIdle();
    console.timeEnd('> deployed');
  }

  onChange = async (event: NodeJS.Events, _path: string) => {
    // TODO: throttoling
    if (this.isIgnoredPath(_path)) {
      return
    }

    this.logInfo(`changed: ${_path}`);
    await this.deploy();
  }

  isIgnoredPath (fullPath: string) {
    const ignoredList = [/^\./];
    const relativePath = path.relative(this.cwd, fullPath);
    return ignoredList.find(match => match.test(relativePath));
  }

  setStatusIdle = () => {
    this.status = DevServerStatus.idle;
    this.statusMessage = '';
  }

  setStatusBusy = (msg = '') => {
    this.status = DevServerStatus.busy;
    this.statusMessage = msg;
  }

  devServerHandler:HttpHandler = (req, res) => {
    const proxy = httpProxy.createProxyServer({
      secure: false,
      changeOrigin: true
    });

    if (this.status === DevServerStatus.busy) {
      return res.end(`[busy] ${this.statusMessage}...`);
    }

    this.logHttp(req.url);

    if (this.remoteDevUrl) {
      return proxy.web(req, res, { target: this.remoteDevUrl });
    }
  }
}
