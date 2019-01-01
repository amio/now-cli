import chalk from 'chalk';

import getArgs from '../../util/get-args';
import getSubcommand from '../../util/get-subcommand';
import { NowContext } from '../../types';
import handleError from '../../util/handle-error';
import createOutput from '../../util/output/create-output';
import logo from '../../util/output/logo';

import init from './init';

const COMMAND_CONFIG = {
  init: ['init']
};

const help = () => {
  // TODO: update help message
  console.log(`
  ${chalk.bold(`${logo} now init`)} [example]

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')}  Initialize example project in current directory

      ${chalk.cyan(`$ now init <example>`)}

  ${chalk.gray('–')}  Choose from all available examples

      ${chalk.cyan(`$ now init`)}
  `);
};

export default async function main(ctx: NowContext) {
  let argv;
  let args;
  let output;

  try {
    argv = getArgs(ctx.argv.slice(2), { '--force': Boolean });
    args = getSubcommand(argv._.slice(1), COMMAND_CONFIG).args;
    output = createOutput({ debug: argv['--debug'] });
  } catch (err) {
    handleError(err);
    return 1;
  }

  if (argv['--help']) {
    help();
    return 2;
  }

  if (argv._.length > 3) {
    output.error('Too much arguments.');
    return 1;
  }

  try {
    return await init(ctx, argv, args, output);
  } catch (err) {
    output.error(err.message); // TODO: better error messages
    output.debug(err.stack);
    return 1;
  }
};
