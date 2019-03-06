import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import execa from 'execa';
import chokidar from 'chokidar';
import throttle from 'lodash.throttle';

import getUser from '../../../util/get-user';
import Client from '../../../util/client';

import wait from '../../../util/output/wait';
import error from '../../../util/output/error';
import success from '../../../util/output/success';
import { readLocalConfig } from '../../../util/config/files';

import IGNORED from '../../../util/ignored';

import { Output } from '../../../util/output';
import { NowContext } from '../../../types';
import { DevWatcherOptions } from './types';

export default class devWatcher {
  private cwd: string;
  private ctx: NowContext;
  private output: Output;
  private watcher: any;
  private devURL: string = '';

  constructor (cwd: string, options: DevWatcherOptions) {
    this.cwd = cwd;
    this.ctx = options.ctx;
    this.output = options.output;
  }

  start = async () => {
    await this.generateDevURL();

    this.output.log(`Your dev url is ${chalk.bold(this.devURL)}`);

    this.watcher = chokidar.watch(this.cwd, {
      ignored: createIgnoredList(this.cwd),
      ignoreInitial: true
    });
    this.watcher.on('all', this.onFsChange);

    process.on('SIGINT', this.onQuit);

    // first deployment
    await this.deploy();
  };

  onFsChange = (event: NodeJS.Events, _path: string) => {
    this.output.debug(`${event}: ${_path}`);
    this.deploy();
  };

  onQuit = () => {
    this.watcher.close();
    console.log('stop dev-worker');
  };

  deploy = throttle(async () => {
    // TODO: verify project before do deployment
    console.time('> deployed');

    const stopSpinner = wait('Creating dev deployment');
    const deployed = await execa.stdout('now', { cwd: this.cwd });
    await execa.stdout('now', ['alias', deployed, this.devURL]);
    stopSpinner();

    console.timeEnd('> deployed');
  }, 3000);

  generateDevURL = async () => {
    const { apiUrl, authConfig } = this.ctx;
    const { token } = authConfig;

    const stopUserSpinner = wait('Fetching user information');
    const client = new Client({ apiUrl, token });
    const user = await getUser(client);

    stopUserSpinner();

    this.devURL = `project-name-dev-${user.username}.now.sh`;
  }
}

function createIgnoredList (cwd: string) {
  const gitignore = readAsText(cwd, '.gitignore');
  const nowignore = readAsText(cwd, '.nowignore');
  return [
    IGNORED,
    gitignore,
    nowignore
  ].join('\n').split('\n').filter(Boolean);
}

function readAsText (cwd: string, filename: string) {
  const fsPath = path.join(cwd, filename);
  if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
    return fs.readFileSync(fsPath, 'utf8');
  } else {
    return ''
  }
}
