import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const examplePath = process.argv[2];

if (!examplePath) {
  console.error("Usage: node scripts/install-local-package.mjs <example-dir>");
  process.exit(1);
}

const exampleDir = resolve(repoRoot, examplePath);
const packageDir = resolve(exampleDir, ".local-package");
const localTarball = resolve(packageDir, "nimio-player-local.tgz");
const installedPackageDir = resolve(exampleDir, "node_modules/nimio-player");
const npmEnv = {
  ...process.env,
  npm_config_cache: resolve(repoRoot, ".npm-cache"),
};

mkdirSync(packageDir, { recursive: true });

const packOutput = execFileSync(
  "npm",
  ["pack", "--pack-destination", packageDir],
  {
    cwd: repoRoot,
    env: npmEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);

const packedFile = packOutput
  .trim()
  .split(/\r?\n/)
  .reverse()
  .find((line) => line.endsWith(".tgz"));

if (!packedFile) {
  console.error("npm pack did not report a tarball file name.");
  process.exit(1);
}

copyFileSync(resolve(packageDir, packedFile), localTarball);
console.log(`Packed ${packedFile} -> ${localTarball}`);

rmSync(installedPackageDir, { recursive: true, force: true });

execFileSync(
  "npm",
  [
    "--prefix",
    exampleDir,
    "install",
    localTarball,
    "--force",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
  ],
  {
    cwd: repoRoot,
    env: npmEnv,
    stdio: "inherit",
  },
);
