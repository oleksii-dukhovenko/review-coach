import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { config } from "./config.ts";
import { runCommand } from "./shell.ts";

type PackageEntry = { name: string; rootDir: string; languageVersion: string };

type LockedPackage = { name: string; source: string; version: string };

const DEFAULT_LANGUAGE_VERSION = "3.0";

const FLUTTER_SDK_PACKAGES = ["flutter", "flutter_test", "flutter_localizations", "flutter_web_plugins", "flutter_driver", "integration_test"];

/** "3.3.2", ">=2.12.0 <3.0.0" and "^3.1.0" all give their lowest major.minor. */
export function languageVersionOf(pubspecText: string): string {
  const sdkLine = pubspecText.match(/^environment:\s*\n(?:[ \t]+.*\n)*?[ \t]+sdk:\s*["']?([^"'\n]+)/m)?.[1] ?? "";
  const lowest = sdkLine.match(/(\d+)\.(\d+)/);
  return lowest ? `${lowest[1]}.${lowest[2]}` : DEFAULT_LANGUAGE_VERSION;
}

export function packageNameOf(pubspecText: string): string | undefined {
  return pubspecText.match(/^name:\s*["']?([\w]+)/m)?.[1];
}

/** Reads name, source and version for each package in a pubspec.lock. */
export function parsePubspecLock(lockText: string): LockedPackage[] {
  const blocks = lockText.split(/\n(?=  [\w]+:\s*\n)/).slice(1);
  return blocks.flatMap((block) => {
    const name = block.match(/^ {2}([\w]+):/)?.[1];
    const source = block.match(/^ {4}source:\s*(\w+)/m)?.[1];
    const version = block.match(/^ {4}version:\s*"?([^"\n]+)"?/m)?.[1];
    return name && source && version ? [{ name, source, version }] : [];
  });
}

function readTextOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function packageAt(rootDir: string, name: string): PackageEntry | undefined {
  if (!fs.existsSync(path.join(rootDir, "lib"))) return undefined;
  return { name, rootDir, languageVersion: languageVersionOf(readTextOrEmpty(path.join(rootDir, "pubspec.yaml"))) };
}

function hostedPackage(locked: LockedPackage): PackageEntry | undefined {
  const cached = path.join(config.pubCacheDir, "hosted", "pub.dev", `${locked.name}-${locked.version}`);
  return packageAt(cached, locked.name);
}

function flutterSdkPackage(name: string): PackageEntry | undefined {
  if (name === "sky_engine") return packageAt(path.join(config.flutterRoot, "bin", "cache", "pkg", "sky_engine"), name);
  if (!FLUTTER_SDK_PACKAGES.includes(name)) return undefined;
  return packageAt(path.join(config.flutterRoot, "packages", name), name);
}

function lockedPackageEntry(locked: LockedPackage): PackageEntry | undefined {
  if (locked.source === "hosted") return hostedPackage(locked);
  if (locked.source === "sdk") return flutterSdkPackage(locked.name);
  return undefined;
}

async function repoPackages(worktree: string): Promise<PackageEntry[]> {
  const listed = await runCommand("git", ["-C", worktree, "ls-files", "*pubspec.yaml"]);
  const pubspecPaths = listed.stdout.split("\n").filter(Boolean).map((relative) => path.join(worktree, relative));
  return pubspecPaths.flatMap((pubspecPath) => {
    const name = packageNameOf(readTextOrEmpty(pubspecPath));
    const entry = name ? packageAt(path.dirname(pubspecPath), name) : undefined;
    return entry ? [entry] : [];
  });
}

function toConfigEntry(entry: PackageEntry) {
  return { name: entry.name, rootUri: pathToFileURL(entry.rootDir).href, packageUri: "lib/", languageVersion: entry.languageVersion };
}

/** Repo packages win over cached ones with the same name. */
function packagesFor(packageDir: string, inRepo: PackageEntry[]): PackageEntry[] {
  const locked = parsePubspecLock(readTextOrEmpty(path.join(packageDir, "pubspec.lock")));
  const byName = new Map<string, PackageEntry>();
  for (const entry of locked.map(lockedPackageEntry)) if (entry) byName.set(entry.name, entry);
  for (const entry of inRepo) byName.set(entry.name, entry);
  return [...byName.values()];
}

function writePackageConfig(packageDir: string, inRepo: PackageEntry[]): void {
  const dartToolDir = path.join(packageDir, ".dart_tool");
  const configFile = path.join(dartToolDir, "package_config.json");
  if (fs.existsSync(configFile)) return;
  const packages = packagesFor(packageDir, inRepo).map(toConfigEntry);
  fs.mkdirSync(dartToolDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ configVersion: 2, packages, generator: "review-coach" }, null, 2));
}

/** Lets the Dart analyzer follow package: imports without a network "pub get". */
export async function writeDartPackageConfigs(worktree: string): Promise<void> {
  const inRepo = await repoPackages(worktree);
  for (const entry of inRepo) writePackageConfig(entry.rootDir, inRepo);
}
