type FileStamp = [path: string, mtime: number | null, size: number];

async function snapshot(paths: string[], excluded: string[] = []): Promise<FileStamp[]> {
  const files: FileStamp[] = [];
  for (const path of paths) {
    if (excluded.includes(path)) continue;
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      files.push([path, null, 0]);
      continue;
    }
    if (stat.isDirectory) {
      const children = [];
      for await (const entry of Deno.readDir(path)) {
        if ([".git", ".jj", ".cache", "node_modules"].includes(entry.name)) continue;
        children.push(`${path}/${entry.name}`);
      }
      files.push(...await snapshot(children, excluded));
    } else {
      files.push([path, stat.mtime?.getTime() ?? null, stat.size]);
    }
  }
  return files.sort(([a], [b]) => a.localeCompare(b));
}

if (import.meta.main) {
  Deno.chdir(new URL(".", import.meta.url));
  if (Deno.args.some(arg => arg !== "--force")) {
    throw new Error("Usage: deno task build [--force]");
  }
  const force = Deno.args.includes("--force");
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const shared = await snapshot([
    "build.ts",
    "deno.json",
    "deno.lock",
    ...((config.workspace ?? []) as string[]).map(site => `${site}/deno.json`),
  ]);
  await Deno.mkdir(".build-cache", { recursive: true });

  const results = await Promise.allSettled(
    Object.keys(config.tasks).filter(task => task.startsWith("build:")).map(async task => {
      const site = task.slice("build:".length);
      const outputPaths = site === "hub"
        ? ["hub/public/js"]
        : [`${site}/public/dist`];
      if (site === "symbol") outputPaths.push("symbol/public/assets/generated");
      const cachePath = `.build-cache/${site}.json`;
      const inputs = [...shared, ...await snapshot([site], outputPaths)];
      const outputs = await snapshot(outputPaths);
      const state = { deno: Deno.version.deno, inputs, outputs };
      let cached: string | undefined;
      try {
        cached = await Deno.readTextFile(cachePath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      if (!force && cached === JSON.stringify(state)) {
        console.log(`${site}: unchanged`);
        return;
      }

      // A failed rebuild may have overwritten outputs from the last successful build.
      if (cached !== undefined) await Deno.remove(cachePath);
      console.log(`${site}: building`);
      const status = await new Deno.Command(Deno.execPath(), {
        args: ["task", task],
        stdin: "null",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn().status;
      if (!status.success) throw new Error(`${task} failed (exit ${status.code})`);
      const built = await snapshot(outputPaths);
      if (!built.length || built.some(([, mtime]) => mtime === null)) {
        throw new Error(`${task} did not produce its expected outputs`);
      }
      // Keep the pre-build inputs so edits made during the build invalidate the cache.
      await Deno.writeTextFile(cachePath, JSON.stringify({ ...state, outputs: built }));
    }),
  );
  for (const result of results) {
    if (result.status === "rejected") console.error(result.reason);
  }
  if (results.some(result => result.status === "rejected")) Deno.exit(1);
}
