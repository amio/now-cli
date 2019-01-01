import fs from 'fs';
import path from 'path';
import tar from 'tar-fs';
import chalk from 'chalk';
import fetch from 'node-fetch';
const distance = require('jaro-winkler');

import { Output } from '../../util/output';
import { NowContext } from '../../types';

const listInput = require('../../util/input/list');
import promptBool from '../../util/input/prompt-bool';
import wait from '../../util/output/wait';

type Options = {
  '--debug': boolean;
  '--force': boolean;
};

const EXAMPLE_API = 'https://now-example-files.zeit.sh';

export default async function init (
  ctx: NowContext,
  opts: Options,
  args: string[],
  output: Output
) {
  const [name, dir] = args;
  const force = opts['--force'];

  const exampleList = await fetchExampleList();

  if (!exampleList) {
    throw new Error(`Could not get examle list.`);
  }

  if (!name) {
    const chosen = await chooseFromDropdown(exampleList);

    if (chosen) {
      await extractExample(chosen, dir, force);
      output.success(`Initialized example "${chalk.bold(chosen)}".`);
      return 0;
    } else {
      output.log('No changes made');
      return 0;
    }
  }

  if (exampleList.includes(name)) {
    await extractExample(name, dir, force);
    output.success(`Initialized example "${chalk.bold(name)}".`);
    return 0;
  }

  await guess(exampleList, name, dir);
  // TODO: extractExample
  return 0;
}

/**
 * Fetch example list json
 */
async function fetchExampleList () {
  const stopSpinner = wait('Fetching examples');
  const url = `${EXAMPLE_API}/list.json`;

  try {
    const resp = await fetch(url);
    stopSpinner();

    if (resp.status !== 200) {
      throw new Error(`${resp.statusText} ${url}`);
    }

    return resp.json();
  } catch (e) {
    stopSpinner();
  }
}

/**
 * Prompt user for choosing which example to init
 */
async function chooseFromDropdown(exampleList: string[]) {
  const choices = exampleList.map(name => ({
    name,
    value: name,
    short: name
  }));

  console.log(choices);

  return listInput({
    message: 'Select example:',
    separator: false,
    choices
  });
}

/**
 * Extract example to directory
 */
async function extractExample(name: string, dir: string, force?: boolean) {
  const stopSpinner = wait(`Fetching ${name}`);

  const url = `${EXAMPLE_API}/download/${name}.tar.gz`;
  return fetch(url).then(resp => {
    if (resp.status !== 200) {
      throw new Error(`Could not get ${name}.tar.gz`);
    }

    stopSpinner();

    const folder = prepareFolder(process.cwd(), dir || name, force);

    return new Promise((resolve, reject) => {
      const extractor = tar.extract(folder);
      resp.body.on('error', reject);
      extractor.on('error', reject);
      extractor.on('finish', resolve);
      resp.body.pipe(extractor);
    });
  }).catch(e => {
    stopSpinner();
    throw e;
  });
}

/**
 * Check & prepare destination folder for extracting.
 */
function prepareFolder (cwd: string, folder: string, force?: boolean) {
  const dest = path.join(cwd, folder);

  // TODO: handle --force
  if (fs.existsSync(dest)) {
    if (!fs.lstatSync(dest).isDirectory()) {
      throw new Error(`Destination path "${chalk.bold(folder)}" already exists and is not an directory.`);
    }
    if (fs.readdirSync(dest).length !== 0) {
      throw new Error(`Destination path "${chalk.bold(folder)}" already exists and is not an empty directory.`);
    }
  }

  if (dest !== cwd) {
    try {
      fs.mkdirSync(dest);
    } catch (e) {
      throw new Error(`Could not create directory "${chalk.bold(folder)}".`);
    }
  }

  return dest;
}

/**
 * Guess which example user try to init
 */
async function guess (exampleList: string[], name: string, dir: string) {
  const found = didYouMean(name, exampleList, 0.6);

  // TODO: handle non-tty
  if (typeof found === 'string') {
    if(await promptBool(`Did you mean ${chalk.bold(found)}?`)) {
      return extractExample(found, dir);
    }
  } else {
    throw new Error(`No example for ${chalk.bold(name)}.`);
  }

  return 0;
}

/**
 * Guess user's intention with jaro-winkler algorithm (with "-" awared)
 */
function didYouMean (input: string, list: string[], threshold: number = 0.5) {
  const rated = list.map(item => [dashAwareDistance(item, input), item])
  const found = rated.filter(item => item[0] > threshold)
  if (found.length) {
    return found.sort((a, b) => (b[0] - a[0]))[0][1]
  }
}

/**
 * jaro-winkler algorithm (with "-" awared)
 */
function dashAwareDistance (word: string, dashWord: string) {
  return dashWord.split('-').map(w => distance(w, word)).sort((a,b) => (b - a))[0]
}
