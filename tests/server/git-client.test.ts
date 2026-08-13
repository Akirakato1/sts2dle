import { describe, expect, it } from "vitest";
import {
  GitClient,
  GitPushError,
  type ArgumentArrayRunner,
  type ProcessResult,
} from "../../src/server/release/git-client.js";

const REPOSITORY_ROOT = "C:\\private\\stsdle-repository";
const EXPECTED_ORIGIN = "git@github.com:Akirakato1/sts2dle.git";

class RecordingRunner {
  readonly calls: Array<[string, string[]]> = [];
  readonly #responses = new Map<string, Array<ProcessResult | Error>>();

  constructor() {
    this.respond(["rev-parse", "--show-toplevel"], `${REPOSITORY_ROOT}\n`);
    this.respond(["status", "--porcelain=v1", "--untracked-files=all"], "");
    this.respond(["remote", "get-url", "origin"], `${EXPECTED_ORIGIN}\n`);
    this.respond(["fetch", "origin", "main"], "");
    this.respond(["rev-parse", "HEAD"], "a".repeat(40));
    this.respond(["rev-parse", "refs/remotes/origin/main"], "a".repeat(40));
    this.respond(["add", "-A", "--", "deploy/snapshot-data"], "");
    this.respond(["diff", "--cached", "--name-only"], "deploy/snapshot-data/active.json\n");
    this.respond(["commit", "-m", `chore: refresh card snapshot ${"b".repeat(12)}`], "");
    this.respond(["push", "origin", "HEAD:main"], "");
  }

  readonly run: ArgumentArrayRunner = async (command, args) => {
    this.calls.push([command, [...args]]);
    const queue = this.#responses.get(key(args));
    const response = queue?.length === 1 ? queue[0] : queue?.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    return response;
  };

  replace(args: readonly string[], ...responses: Array<string | Error>): void {
    this.#responses.set(key(args), responses.map(toResult));
  }

  private respond(args: readonly string[], stdout: string): void {
    this.#responses.set(key(args), [toResult(stdout)]);
  }
}

describe("GitClient", () => {
  it("uses fixed argument arrays for readiness, snapshot staging, and pushing", async () => {
    const runner = new RecordingRunner();
    const client = new GitClient(REPOSITORY_ROOT, runner.run);

    await client.assertReady();
    await client.assertOnlySnapshotChanges();
    await client.pushMain();

    expect(runner.calls).toContainEqual(["git", ["fetch", "origin", "main"]]);
    expect(runner.calls).toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data"]]);
    expect(runner.calls).toContainEqual(["git", ["push", "origin", "HEAD:main"]]);
  });

  it.each([
    ["dirty tracked files", " M src/server/main.ts\n"],
    ["untracked files", "?? local-secrets.txt\n"],
  ])("rejects %s before fetching", async (_label, status) => {
    const runner = new RecordingRunner();
    runner.replace(["status", "--porcelain=v1", "--untracked-files=all"], status);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertReady())
      .rejects.toThrow("Repository is not ready for snapshot release");
    expect(runner.calls).not.toContainEqual(["git", ["fetch", "origin", "main"]]);
  });

  it("rejects a repository root other than the configured root without disclosing either path", async () => {
    const runner = new RecordingRunner();
    const otherRoot = "C:\\private\\different-repository";
    runner.replace(["rev-parse", "--show-toplevel"], `${otherRoot}\n`);

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).assertReady());

    expect(stringifyErrorChain(error)).toBe("Repository is not ready for snapshot release");
    expect(stringifyErrorChain(error)).not.toContain(REPOSITORY_ROOT);
    expect(stringifyErrorChain(error)).not.toContain(otherRoot);
  });

  it.each([
    "https://github.com/Akirakato1/sts2dle.git",
    "git@github.com:Akirakato1/other.git",
    "ssh://fake-user:fake-password@github.com/Akirakato1/sts2dle.git",
  ])("rejects non-approved origin %s without disclosing it", async (origin) => {
    const runner = new RecordingRunner();
    runner.replace(["remote", "get-url", "origin"], `${origin}\n`);

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).assertReady());

    expect(stringifyErrorChain(error)).toBe("Repository is not ready for snapshot release");
    expect(stringifyErrorChain(error)).not.toContain(origin);
    expect(runner.calls).not.toContainEqual(["git", ["fetch", "origin", "main"]]);
  });

  it.each([
    "git@github.com:Akirakato1/sts2dle.git",
    "ssh://git@github.com/Akirakato1/sts2dle.git",
  ])("accepts the exact SSH origin %s", async (origin) => {
    const runner = new RecordingRunner();
    runner.replace(["remote", "get-url", "origin"], `${origin}\n`);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertReady()).resolves.toBeUndefined();
  });

  it("rejects HEAD that differs from fetched origin/main", async () => {
    const runner = new RecordingRunner();
    runner.replace(["rev-parse", "refs/remotes/origin/main"], `${"c".repeat(40)}\n`);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertReady())
      .rejects.toThrow("Repository is not ready for snapshot release");
  });

  it.each([
    ["working tree", ["status", "--porcelain=v1", "--untracked-files=all"], " M deploy/snapshot-data/active.json\n?? README-private.md\n"],
    ["staging area", ["diff", "--cached", "--name-only"], "deploy/snapshot-data/active.json\nREADME.md\n"],
  ] as const)("rejects extra paths in the %s", async (_label, command, response) => {
    const runner = new RecordingRunner();
    runner.replace(command, response);

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertOnlySnapshotChanges())
      .rejects.toThrow("Snapshot release changes are unsafe");
  });

  it("does not stage when a changed path is outside the snapshot directory", async () => {
    const runner = new RecordingRunner();
    runner.replace(
      ["status", "--porcelain=v1", "--untracked-files=all"],
      " M deploy/snapshot-data/active.json\n?? another-path.txt\n",
    );

    await expect(new GitClient(REPOSITORY_ROOT, runner.run).assertOnlySnapshotChanges()).rejects.toThrow();
    expect(runner.calls).not.toContainEqual(["git", ["add", "-A", "--", "deploy/snapshot-data"]]);
  });

  it("uses a source-revision commit message and hides commit failures", async () => {
    const runner = new RecordingRunner();
    const secret = "fake-ssh-private-key";
    runner.replace(
      ["commit", "-m", `chore: refresh card snapshot ${"b".repeat(12)}`],
      new Error(`${secret} at ${REPOSITORY_ROOT}`),
    );

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).commitSnapshot("b".repeat(64)));

    expect(stringifyErrorChain(error)).toBe("Unable to commit card snapshot");
    expect(stringifyErrorChain(error)).not.toContain(secret);
    expect(stringifyErrorChain(error)).not.toContain(REPOSITORY_ROOT);
  });

  it("commits the verified index rather than re-reading snapshot working-tree files", async () => {
    const runner = new RecordingRunner();

    await new GitClient(REPOSITORY_ROOT, runner.run).commitSnapshot("b".repeat(64));

    expect(runner.calls).toContainEqual([
      "git",
      ["commit", "-m", `chore: refresh card snapshot ${"b".repeat(12)}`],
    ]);
  });

  it("returns a fixed typed push error without preserving credential-bearing causes", async () => {
    const runner = new RecordingRunner();
    const secret = "ssh://fake-user:fake-password@github.com/private/repository.git";
    runner.replace(["push", "origin", "HEAD:main"], new Error(`${secret} ${REPOSITORY_ROOT}`));

    const error = await captureError(new GitClient(REPOSITORY_ROOT, runner.run).pushMain());

    expect(error).toBeInstanceOf(GitPushError);
    expect(stringifyErrorChain(error)).toBe("Unable to push card snapshot");
    expect(stringifyErrorChain(error)).not.toContain(secret);
    expect(stringifyErrorChain(error)).not.toContain(REPOSITORY_ROOT);
  });
});

function key(args: readonly string[]): string {
  return args.join("\u0000");
}

function toResult(value: string | Error): ProcessResult | Error {
  return value instanceof Error ? value : { stdout: value, stderr: "" };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function stringifyErrorChain(error: unknown): string {
  const messages: string[] = [];
  const visit = (value: unknown): void => {
    if (!(value instanceof Error)) return;
    messages.push(value.message);
    if (value instanceof AggregateError) value.errors.forEach(visit);
    visit(value.cause);
  };
  visit(error);
  return messages.join("\n");
}
