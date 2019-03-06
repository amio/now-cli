import path from 'path';

import { Output } from '../../util/output';
import { NowContext } from '../../types';

import DevServer from './lib/dev-server';
import DevWatcher from './lib/dev-watcher';

type Options = {
  '--port': number;
  '-p': number;
  '--debug': boolean;
  '-d': boolean;
  '--cloud': boolean;
  '-c': boolean;
};

export default async function dev(
  ctx: NowContext,
  opts: Options,
  args: string[],
  output: Output
) {
  const [dir = '.'] = args;
  const cwd = path.join(process.cwd(), dir);
  const port = opts['-p'] || opts['--port'];
  const debug = Boolean(opts['-d'] || opts['--debug']);
  const cloud = Boolean(opts['-c'] || opts['--cloud']);

  if (cloud) {
    const devWatcher = new DevWatcher(cwd, { ctx, debug, output });
    await devWatcher.start();
  } else {
    const devServer = new DevServer(cwd, { debug });
    await devServer.start(port);
  }
}
