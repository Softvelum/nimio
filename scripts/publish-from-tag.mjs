import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(repoRoot, "package.json");
const packageLockPath = resolve(repoRoot, "package-lock.json");
const npmEnv = {
  ...process.env,
  npm_config_cache: resolve(repoRoot, ".npm-cache"),
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const help = args.includes("--help") || args.includes("-h");
const npmArgs = args.filter((arg) => arg !== "--dry-run");

if (help) {
  console.log(`Usage:
  npm run publish:tag:dry-run
  npm run publish:tag

Options after the script name are passed to npm publish, for example:
  npm run publish:tag -- --otp 123456
`);
  process.exit(0);
}

function run(command, commandArgs, opts = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    ...opts,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(output.trim() || `${command} ${commandArgs.join(" ")}`);
  }

  return result.stdout.trim();
}

function ensureTrackedWorktreeClean() {
  try {
    run("git", ["diff", "--quiet"]);
    run("git", ["diff", "--cached", "--quiet"]);
  } catch {
    throw new Error(
      "Tracked working tree has uncommitted changes. Commit or stash them before publishing from a tag.",
    );
  }
}

function getExactTag() {
  try {
    return run("git", ["describe", "--tags", "--exact-match", "HEAD"]);
  } catch {
    throw new Error(
      "HEAD is not exactly on a git tag. Check out a release tag, for example: git switch --detach v1.8.1",
    );
  }
}

function getDescribeVersion() {
  try {
    return run("git", ["describe", "--tags"]);
  } catch {
    throw new Error(
      "Cannot determine version from git tags. Create a release tag first.",
    );
  }
}

function getVersionFromGitDescription(description) {
  const version = description.replace(/^v/, "");
  const semverPattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

  if (!semverPattern.test(version)) {
    throw new Error(
      `Git version "${description}" does not map to a valid npm semver version. Expected a tag like v1.2.3.`,
    );
  }

  return version;
}

function getPublishVersion() {
  const description = getExactTag();
  return {
    description,
    version: getVersionFromGitDescription(description),
  };
}

function getDryRunVersion() {
  const description = getDescribeVersion();
  return {
    description,
    version: getVersionFromGitDescription(description),
  };
}

function snapshotFiles(paths) {
  return new Map(
    paths
      .filter((path) => existsSync(path))
      .map((path) => [path, readFileSync(path, "utf8")]),
  );
}

function restoreFiles(snapshots) {
  for (const [path, contents] of snapshots) {
    writeFileSync(path, contents);
  }
}

function setPackageVersion(version) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function hasNpmTag(args) {
  return args.includes("--tag") || args.some((arg) => arg.startsWith("--tag="));
}

let snapshots;
let publishResult;

try {
  if (!dryRun) {
    ensureTrackedWorktreeClean();
  }

  const { description, version } = dryRun
    ? getDryRunVersion()
    : getPublishVersion();

  snapshots = snapshotFiles([packageJsonPath, packageLockPath]);
  setPackageVersion(version);

  const publishArgs = ["publish", "--access", "public", ...npmArgs];
  if (dryRun && version.includes("-") && !hasNpmTag(npmArgs)) {
    publishArgs.push("--tag", "dry-run");
  }
  if (dryRun) publishArgs.push("--dry-run");

  console.log(
    `Publishing nimio-player@${version} from git version ${description}${dryRun ? " (dry run)" : ""}`,
  );

  publishResult = spawnSync("npm", publishArgs, {
    cwd: repoRoot,
    env: npmEnv,
    stdio: "inherit",
  });

  if (publishResult.error) throw publishResult.error;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (snapshots) {
    restoreFiles(snapshots);
  }
}

if (publishResult && publishResult.status !== 0) {
  process.exitCode = publishResult.status ?? 1;
}
