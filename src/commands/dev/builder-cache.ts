import fs from 'fs';
import path from 'path';
import execa from 'execa';
import mkdirp from 'mkdirp';
// @ts-ignore
import cacheDirectory from 'cache-or-tmp-directory';

export default {
  prepare,
  install,
  get
}

/**
 * Prepare cache directory for installing now-builders
 */
function prepare () {
  try {
    const designated = cacheDirectory('co.zeit.now-builders');
    const buildersPkg = path.join(designated, 'package.json');

    if (designated) {
      fs.writeFileSync(buildersPkg, '{"private":true}');

      if (fs.existsSync(designated)) {
        return designated;
      }

      mkdirp.sync(designated);
      return designated;
    }
  } catch (error) {
    throw new Error('Could not create cache directory for now-builders.');
  }
}

/**
 * Install a builder to cache directory
 * @param cacheDir directory
 * @param name builder's name
 */
async function install (cacheDir: string, name: string) {
  const dest = path.join(cacheDir, 'node_modules', name);
  if (!fs.existsSync(dest)) {
    return execa('npm', ['install', name, '--prefer-offline'], {
      cwd: cacheDir
    });
  }
}

/**
 * Get a builder from cache directory
 * @param cacheDir directory
 * @param name builder's name
 */
function get (cacheDir: string, name: string) {
  const dest = path.join(cacheDir, 'node_modules', name);
  return require(dest);
}
