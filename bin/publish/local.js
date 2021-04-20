const path = require('path');
const readline = require('readline');

const chalk = require('chalk');
const cliArgs = require('command-line-args');
const debug = require('debug')('publish-packages');

const PreviousReleasePattern = /^release-(\d)-(\d+)$/;

let isBugfixRelease = false;

const {
  cleanProject,
  assertGitIsClean,
  retrieveNextVersion,
  execWithLog,
  packAllPackages,
  collectTarballPaths,
  publishPackage,
} = require('./utils');

function getConfig() {
  const mainOptionsDefinitions = [{ name: 'channel', defaultOption: true }];
  const mainOptions = cliArgs(mainOptionsDefinitions, { stopAtFirstUnknown: true });
  const argv = mainOptions._unknown || [];

  if (!mainOptions.channel) {
    throw new Error(`Incorrect usage of publish:\n\tpublish <channel>\n\nNo channel was specified`);
  }
  if (!['release', 'beta', 'canary', 'lts'].includes(mainOptions.channel)) {
    const channel = mainOptions.channel;
    let potentialRelease = !!channel && channel.match(PreviousReleasePattern);
    if (potentialRelease && Array.isArray(potentialRelease)) {
      isBugfixRelease = true;
    } else {
      throw new Error(
        `Incorrect usage of publish:\n\tpublish <channel>\n\nChannel must be one of release|beta|canary|lts. Received ${mainOptions.channel}`
      );
    }
  }

  const optionsDefinitions = [
    {
      name: 'distTag',
      alias: 't',
      type: String,
      defaultValue: mainOptions.channel === 'release' ? 'latest' : mainOptions.channel,
    },
    { name: 'skipVersion', type: Boolean, defaultValue: false },
    { name: 'skipPack', type: Boolean, defaultValue: false },
    { name: 'skipPublish', type: Boolean, defaultValue: false },
    { name: 'skipSmokeTest', type: Boolean, defaultValue: false },
    { name: 'bumpMajor', type: Boolean, defaultValue: false },
    { name: 'bumpMinor', type: Boolean, defaultValue: false },
    { name: 'force', type: Boolean, defaultValue: false },
  ];
  const options = cliArgs(optionsDefinitions, { argv });
  const currentProjectVersion = require(path.join(__dirname, '../../lerna.json')).version;

  if (isBugfixRelease && (options.bumpMajor || options.bumpMinor)) {
    throw new Error(`Cannot bump major or minor version of a past release`);
  }

  if (options.bumpMinor && options.bumpMajor) {
    throw new Error(`Cannot bump both major and minor versions simultaneously`);
  }

  options.channel = mainOptions.channel;
  options.currentVersion = currentProjectVersion;

  return options;
}

function question(prompt) {
  return new Promise(resolve => {
    cli.question(prompt, resolve);
  });
}

async function getOTPToken() {
  let token = await question(chalk.green('\nPlease provide OTP token '));

  return token.trim();
}

let cli = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function confirmPublish(tarballs, distTag) {
  let otp = await getOTPToken();

  for (let tarball of tarballs) {
    try {
      publishPackage(distTag, tarball, otp);
    } catch (e) {
      // the token is outdated, we need another one
      if (e.message.includes('E401') || e.message.includes('EOTP')) {
        otp = await getOTPToken();

        publishPackage(distTag, tarball, otp);
      } else {
        throw e;
      }
    }
  }
}

/*
Usage

publish lts|release|beta|canary

Flags

--distTag=latest|lts|beta|canary|release-<major>-<minor>
--bumpMajor
--bumpMinor
--skipVersion
--skipPack
--skipPublish
--skipSmokeTest

Inspiration from https://github.com/glimmerjs/glimmer-vm/commit/01e68d7dddf28ac3200f183bffb7d520a3c71249#diff-19fef6f3236e72e3b5af7c884eef67a0
*/
async function main() {
  const options = getConfig();
  assertGitIsClean(options);

  if (!options.skipSmokeTest) {
    execWithLog(`yarn run lint:js && yarn run test`, debug.enabled);
    console.log(`✅ ` + chalk.cyan(`Project passes Smoke Test`));
  } else {
    console.log(`⚠️ ` + chalk.grey(`Skipping Smoke Test`));
  }
  let nextVersion = options.currentVersion;
  if (!options.skipVersion) {
    // https://github.com/lerna/lerna/tree/master/commands/version#--exact
    // We use exact to ensure that our consumers always use the appropriate
    // versions published with each other
    // --force-publish ensures that all packages release a new version regardless
    // of whether changes have occurred in them
    // --yes skips the prompt for confirming the version
    nextVersion = retrieveNextVersion(options, isBugfixRelease);
    execWithLog(`lerna version ${nextVersion} --force-publish --exact --yes`, true);
    console.log(`✅ ` + chalk.cyan(`Successfully Versioned ${nextVersion}`));
  } else {
    console.log('⚠️ ' + chalk.grey(`Skipping Versioning`));
  }
  if (!options.skipPack) {
    cleanProject();
    packAllPackages();
    console.log(`✅ ` + chalk.cyan(`Successfully Packaged ${nextVersion}`));
  } else {
    console.log('⚠️ ' + chalk.grey(`Skipping Packaging`));
  }
  if (!options.skipPublish) {
    const tarballs = collectTarballPaths();
    await confirmPublish(tarballs, options.distTag);
    console.log(`✅ ` + chalk.cyan(`Successfully Published ${nextVersion}`));
  } else {
    console.log('⚠️ ' + chalk.grey(`Skipping Publishing`));
  }
}

main()
  .finally(() => cli.close())
  .catch(reason => {
    console.error(reason);
    process.exit(1);
  });
