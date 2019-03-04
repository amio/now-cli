import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import throttle from 'lodash.throttle';

import IGNORED from '../../../util/ignored';

type DevWatcherOptions = {
  debug: boolean;
}

export default class devWatcher {
  private cwd: string;
  private debug: boolean;
  private watcher: any;

  constructor (cwd: string, options: DevWatcherOptions) {
    this.cwd = cwd;
    this.debug = options.debug;
  }

  start = async () => {
    this.watcher = chokidar.watch(this.cwd, {
      ignored: createIgnoredList(this.cwd),
      ignoreInitial: true
    });

    this.watcher.on('all', this.onFsChange);

    console.log(this.watcher.getWatched(), this.cwd, createIgnoredList(this.cwd));
    console.log('start dev-worker & local, remote dev url is: xxx.now.dev');

    process.on('SIGINT', this.onQuit);
  };

  onFsChange = throttle((event: NodeJS.Events, _path: string) => {
    console.log(event, _path)
  }, 3000);

  onQuit = () => {
    this.watcher.close();
    console.log('stop dev-worker');
  };
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
