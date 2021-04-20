'use strict';
/* eslint-disable node/no-unsupported-features/es-syntax */

const fs = require('fs');
const path = require('path');
const process = require('process');

const execa = require('execa');
const chalk = require('chalk');
const debug = require('debug')('publish-packages');
const semver = require('semver');

const projectRoot = path.resolve(__dirname, '../../');
const packagesDir = path.join(projectRoot, './packages');
const packages = fs.readdirSync(packagesDir);

/**
 *
 * @param {*} command The command to execute
 * @param {*} proxyIO whether to proxy stdio from the main process for this command
 *
 * proxyIO=true is useful when you want to see the output log or respond to prompts
 */
function execWithLog(command, proxyIO = false) {
  debug(chalk.cyan('Executing: ') + chalk.yellow(command));
  if (proxyIO) {
    return execa.sync(command, { stdio: [0, 1, 2], shell: true, preferLocal: true });
  }

  return execa.sync(command, { shell: true, preferLocal: true }).stdout;
}

function cleanProject() {
  execWithLog(`cd ${projectRoot} && rm -rf packages/*/dist packages/*/tmp packages/*/node_modules node_modules`);
  execWithLog(`cd ${projectRoot} && yarn install`);
}

function assertGitIsClean(options) {
  let status = execWithLog('git status');

  if (!status.match(/^nothing to commit/m)) {
    if (options.force) {
      console.log(
        chalk.white('⚠️ ⚠️ ⚠️  Local Git branch has uncommitted changes!\n\t') +
          chalk.yellow('Passed option: ') +
          chalk.white('--force') +
          chalk.grey(' :: ignoring unclean git working tree')
      );
    } else {
      console.log(
        chalk.red('💥 Git working tree is not clean. 💥 \n\t') +
          chalk.grey('Use ') +
          chalk.white('--force') +
          chalk.grey(' to ignore this warning and publish anyway\n') +
          chalk.yellow('⚠️  Publishing from an unclean working state may result in a broken release ⚠️\n\n') +
          chalk.grey(`Status:\n${status}`)
      );
      process.exit(1);
    }
  }

  if (!status.match(/^Your branch is up to date with/m)) {
    if (options.force) {
      console.log(
        chalk.white('⚠️ ⚠️ ⚠️  Local Git branch is not in sync with origin branch') +
          chalk.yellow('\n\tPassed option: ') +
          chalk.white('--force') +
          chalk.grey(' :: ignoring unsynced git branch')
      );
    } else {
      console.log(
        chalk.red('💥 Local Git branch is not in sync with origin branch. 💥 \n\t') +
          chalk.grey('Use ') +
          chalk.white('--force') +
          chalk.grey(' to ignore this warning and publish anyway\n') +
          chalk.yellow('⚠️  Publishing from an unsynced working state may result in a broken release ⚠️') +
          chalk.grey(`Status:\n${status}`)
      );
      process.exit(1);
    }
  }

  let expectedChannelBranch =
    options.distTag === 'canary' ? 'master' : options.distTag === 'latest' ? 'release' : options.distTag;

  if (options.channel === 'lts') {
    expectedChannelBranch = `lts-${semver.major(options.currentVersion)}-${semver.minor(options.currentVersion)}`;
  }

  let foundBranch = status.split('\n')[0];
  foundBranch = foundBranch.replace('On branch ', '');

  if (foundBranch !== expectedChannelBranch) {
    if (options.force) {
      console.log(
        chalk.white(
          `⚠️ ⚠️ ⚠️  Expected to publish npm tag ${options.distTag} from the git branch ${expectedChannelBranch}, but found ${foundBranch}`
        ) +
          chalk.yellow('\n\tPassed option: ') +
          chalk.white('--force') +
          chalk.grey(' :: ignoring unexpected branch')
      );
    } else {
      console.log(
        chalk.red(
          `💥 Expected to publish npm tag ${options.distTag} from the git branch ${expectedChannelBranch}, but found ${foundBranch} 💥 \n\t`
        ) +
          chalk.grey('Use ') +
          chalk.white('--force') +
          chalk.grey(' to ignore this warning and publish anyway\n') +
          chalk.yellow('⚠️  Publishing from an incorrect branch may result in a broken release ⚠️')
      );
      process.exit(1);
    }
  }
}

function retrieveNextVersion(options, isBugfixRelease) {
  /*

  A brief rundown of how version updates flow through the branches.

  - We only ever bump the major or minor version on master
  - All other branches pick it up as those changes flow through the release cycle.

  See RELEASE.md for more about this

  #master lerna.json 3.11.0-canary.x
    releases with `canary`
  #beta lerna.json 3.10.0-beta.x
    cuts from last 3.10.0-canary.x master with `beta`
  #release lerna.json 3.9.0
    cuts from last 3.9.0-beta.x
  #lts lerna.json 3.8.x
     cuts from last 3.8.x on release
*/
  let v;
  if (options.channel === 'release' || options.channel === 'lts') {
    // a new patch, or our first release of a new minor/major
    // usually for new minor/major the version will have drifted up
    // from prior beta/canary incrementing
    // bumpMajor means we are doing a re-release that makes us a new major release
    // bumpMinor means we are doing a re-release that makes us a new minor release
    // else this is a new patch release or the first release but cut from a previous beta.
    let bumpType = options.bumpMajor ? 'major' : options.bumpMinor ? 'minor' : 'patch';
    v = semver.inc(options.currentVersion, bumpType);
  } else if (options.channel === 'beta') {
    // bumpMajor means we are doing a re-release that makes us the first beta of an upcoming major release
    // bumpMinor means we are doing a re-release that makes us the first beta of an upcoming minor release
    // else this is a new weekly beta or the first beta but cut from a previous canary.
    let bumpType = options.bumpMajor ? 'premajor' : options.bumpMinor ? 'preminor' : 'prerelease';
    v = semver.inc(options.currentVersion, bumpType, 'beta');
  } else if (options.channel === 'canary') {
    // bumpMajor is our first canary for an upcoming major
    // bumpMinor is our first canary for an upcoming minor
    // else this is a new nightly canary
    let bumpType = options.bumpMajor ? 'premajor' : options.bumpMinor ? 'preminor' : 'prerelease';
    v = semver.inc(options.currentVersion, bumpType, 'alpha');
  } else if (isBugfixRelease) {
    let bumpType = 'patch';
    v = semver.inc(options.currentVersion, bumpType);
  }

  return v;
}

function convertPackageNameToTarballName(str) {
  str = str.replace('@', '');
  str = str.replace('/', '-');
  return str;
}

function collectTarballPaths() {
  const tarballs = [];
  packages.forEach(localName => {
    const pkgDir = path.join(packagesDir, localName);
    const pkgPath = path.join(pkgDir, 'package.json');
    const pkgInfo = require(pkgPath);
    if (pkgInfo.private !== true) {
      const tarballName = `${convertPackageNameToTarballName(pkgInfo.name)}-${pkgInfo.version}.tgz`;
      tarballs.push(path.join(projectRoot, tarballName));
    }
  });
  return tarballs;
}

function packAllPackages() {
  packages.forEach(localName => {
    const pkgDir = path.join(packagesDir, localName);
    const pkgPath = path.join(pkgDir, 'package.json');
    const pkgInfo = require(pkgPath);
    if (pkgInfo.private !== true) {
      // will pack into the project root directory
      // due to an issue where npm does not run prepublishOnly for pack, we run it here
      // however this is also a timing bug, as typically it would be run *after* prepublish
      // and prepare and now it is run *before*
      // we do not use `prepublish` or `prepare` so this should be fine for now.
      // https://docs.npmjs.com/misc/scripts
      // https://github.com/npm/npm/issues/15363
      if (pkgInfo.scripts) {
        if (pkgInfo.scripts.prepublishOnly) {
          if (pkgInfo.scripts.prepublish || pkgInfo.scripts.prepare) {
            console.log(
              `⚠️ ` +
                chalk.grey(
                  `${pkgInfo.name} has both a 'prepublishOnly' and either 'prepare' or 'publish' scripts. Running prepublishOnly manually before instead of after publish and prepare. See https://github.com/npm/npm/issues/15363`
                )
            );
          }
          execWithLog(`cd ${pkgDir} && npm run prepublishOnly`);
        }
      }
      execWithLog(`npm pack ${pkgDir}`);
    }
  });
}

/**
 * If otp is passed add it as a parameter to the publish command else assume authentication is setup either
 * as environment variable
 *
 * @param {string} distTag - Use this tag on npm for this instance
 * @param {string} tarball - Path to the tarball
 * @param {string} otp - Token to make publish requests to npm
 */
function publishPackage(distTag, tarball, otp) {
  let cmd = `npm publish ${tarball} --tag=${distTag} --access=public`;

  if (otp) {
    cmd += ` --otp=${otp}`;
  }

  execWithLog(cmd);
}

module.exports = {
  assertGitIsClean,
  cleanProject,
  retrieveNextVersion,
  execWithLog,
  packAllPackages,
  collectTarballPaths,
  publishPackage,
};
