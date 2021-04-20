const readline = require('readline');

const semver = require('semver');
const chalk = require('chalk');
const cliArgs = require('command-line-args');

const { packAllPackages, publishPackage, collectTarballPaths } = require('./utils');

function getConfig() {
  const optionsDefinitions = [{ name: 'version', type: String, defaultValue: false }];
  return cliArgs(optionsDefinitions);
}

async function publish(tarballs, distTag) {
  for (let tarball of tarballs) {
    publishPackage(distTag, tarball);
  }
}

async function main() {
  if (!process.env.NODE_AUTH_TOKEN) {
    throw new Error('NODE_AUTH_TOKEN is missing in environment variables');
  }

  const options = getConfig();
  if (options.version) {
    if (!semver.valid(options.version)) {
      throw Error(`Version "${options.version}" is not a valid semantic version.`);
    }
  } else {
    throw Error('No version provided. Use `--version <version>`');
  }

  packAllPackages();
  console.log(`✅ ` + chalk.cyan(`Successfully Packaged ${options.version}`));

  const tarballs = collectTarballPaths();
  await publish(tarballs);
  console.log(`✅ ` + chalk.cyan(`Successfully Published ${options.version}`));
}

let cli = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

main()
  .finally(() => cli.close())
  .catch(reason => {
    console.error(reason);
    process.exit(1);
  });
