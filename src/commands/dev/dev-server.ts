import fs from 'fs';
import path from 'path';
import http from 'http';

// @ts-ignore
import glob from '@now/build-utils/fs/glob';
import chalk from 'chalk';

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
  logHttp (msg?: string) { msg && console.log(`\n  >>> ${msg}\n`) }

  start = async (port = 3000) => {
    const nowJson = readLocalConfig(this.cwd);

    return new Promise((resolve, reject) => {
      this.server.on('error', reject);

      this.server.listen(port, async () => {
        this.logSuccess(
          `dev server listning on port ${chalk.bold(String(port))}`
        );

        if (nowJson.builds) {
          try {
            this.setStatusBusy('installing builders');
            await this.installBuilders(nowJson.builds);

            this.setStatusBusy('building lambdas');
            await this.buildLambdas(nowJson.builds);
          } catch (err) {
            reject(err);
          }
        }

        this.setStatusIdle();
        resolve();
      });
    })
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
    // const proxy = httpProxy.createProxyServer({});

    if (this.status === DevServerStatus.busy) {
      return res.end(`[busy] ${this.statusMessage}...`);
    }

    this.logHttp(req.url);
    res.end('TODO: rebuild & invoke lambda.');
  }

  installBuilders = async (buildsConfig: BuildConfig[]) => {
    const builders = buildsConfig
      .map(build => build.use)
      .filter(pkg => pkg !== '@now/static')
      .concat('@now/build-utils');

    for (const builder of builders) {
      const stopSpinner = wait(`pulling ${builder}`);
      await builderCache.install(this.builderDirectory, builder);
      stopSpinner();
    }
  }

  buildLambdas = async (buildsConfig: BuildConfig[]) => {
    const files = await glob('**', this.cwd);

    for (const build of buildsConfig) {
      try {
        console.log(`> build ${JSON.stringify(build)} with ${build.use}`);
        const builder = builderCache.get(this.builderDirectory, build.use);

        const entries = Object.values(await glob(build.src, this.cwd));

        for (const entrypoint of entries) {
          console.log(`> build ${JSON.stringify(entrypoint)}`);
          const output = await builder.build({
            files,
            entrypoint,
            workPath: this.cwd,
            config: build.config
          });
        }
      } catch (err) {
        throw new NowError({
          code: 'NOW_BUILDER_FAILURE',
          message: `Failed building ${chalk.bold(build.src)} with ${chalk.bold(build.use)}`,
          meta: {
            stack: err.stack
          }
        });
      }
    }
  }
}
