import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const base = pkg.version;
const count = execSync("git rev-list --count HEAD").toString().trim();
const hash = execSync("git rev-parse --short HEAD").toString().trim();

// «1.2.3+45.abcdef0» — 45 commits after tag, hash abcdef0
const version = `${base}-${count}.${hash}`;
console.log(version);
