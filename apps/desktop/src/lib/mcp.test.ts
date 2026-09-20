import { describe, expect, it } from "vitest";

import {
  describeTest,
  draftProblem,
  emptyConfig,
  isRemote,
  joinCommand,
  linesToMap,
  linesToList,
  listToLines,
  mapToLines,
  serverEndpoint,
  splitCommand,
  transportLabel,
} from "@/lib/mcp";

describe("draftProblem", () => {
  it("asks for a name at all", () => {
    expect(draftProblem("  ", emptyConfig())).toBe("Give the server a name.");
  });

  it("refuses a name the agent would", () => {
    // The agent's own rule: 1-80 of letters, numbers, dots, underscores, hyphens.
    expect(draftProblem("my server", emptyConfig())).toContain("holds letters");
    expect(draftProblem("a".repeat(81), emptyConfig())).toContain("holds letters");
    // Accepted, and the first thing a blank draft is missing is its command.
    expect(draftProblem("github", emptyConfig())).toContain("A command is required");
  });

  it("wants a command on a stdio server", () => {
    const blank = { ...emptyConfig(), transport: "stdio", command: "  " };
    expect(draftProblem("github", blank)).toContain("A command is required");
    expect(draftProblem("github", { ...blank, command: "npx" })).toBeNull();
  });

  it("wants an http address on a remote one", () => {
    const http = { ...emptyConfig(), transport: "http" };
    expect(draftProblem("github", http)).toContain("A URL is required");
    expect(draftProblem("github", { ...http, url: "ftp://host/mcp" })).toContain("http://");
    expect(draftProblem("github", { ...http, url: "not a url" })).toContain("http://");
    expect(draftProblem("github", { ...http, url: "https://host/mcp" })).toBeNull();
  });

  it("does not ask a stdio server for a URL", () => {
    // The two halves are exclusive: a command is the whole requirement, whatever
    // is left in the URL field from the transport the reader was on.
    const stdio = { ...emptyConfig(), transport: "stdio", command: "npx", url: "" };
    expect(draftProblem("github", stdio)).toBeNull();
  });
});

describe("describeTest", () => {
  it("counts the tools a connection found", () => {
    expect(describeTest({ success: true, toolCount: 1, tools: [], errorCode: null, errorMessage: null })).toBe(
      "Connected — 1 tool.",
    );
    expect(describeTest({ success: true, toolCount: 4, tools: [], errorCode: null, errorMessage: null })).toBe(
      "Connected — 4 tools.",
    );
    // No count is not a failure, and "0 tools" would read as one.
    expect(describeTest({ success: true, toolCount: null, tools: [], errorCode: null, errorMessage: null })).toBe(
      "Connected.",
    );
  });

  it("says each refusal as the thing to go and do", () => {
    const at = (errorCode: string) =>
      describeTest({ success: false, toolCount: null, tools: [], errorCode, errorMessage: "raw" });

    expect(at("MCP_SERVER_DISABLED")).toContain("switched off");
    expect(at("MCP_COMMAND_NOT_FOUND")).toContain("installed");
    expect(at("MCP_HANDSHAKE_FAILED")).toContain("MCP server");
  });

  it("falls back to the agent's own sentence for a code it does not know", () => {
    // A newer agent is likelier than a broken one, so its words beat a shrug.
    expect(
      describeTest({
        success: false,
        toolCount: null,
        tools: [],
        errorCode: "MCP_SOMETHING_NEW",
        errorMessage: "the agent's own sentence",
      }),
    ).toBe("the agent's own sentence");

    expect(
      describeTest({ success: false, toolCount: null, tools: [], errorCode: null, errorMessage: null }),
    ).toBe("The connection failed.");
  });
});

describe("the command field", () => {
  it("holds the command and its arguments in one line", () => {
    expect(joinCommand("npx", ["-y", "pkg"])).toBe("npx -y pkg");
    expect(splitCommand("npx -y pkg")).toEqual({ command: "npx", args: ["-y", "pkg"] });
  });

  it("round-trips the ordinary case unchanged", () => {
    const line = "npx -y @modelcontextprotocol/server-github";
    const { command, args } = splitCommand(line);
    expect(joinCommand(command, args)).toBe(line);
  });

  it("keeps an argument with a space whole, once it is quoted", () => {
    // **The reason quotes are understood at all.** A path holding a space is
    // ordinary — `/Applications/My App/…` — and a plain split on whitespace would
    // hand the agent three arguments where the reader wrote one. The field is read
    // the way a shell reads one, so such an argument is written the way a shell
    // writes it, and that pair is what closes the round trip.
    const command = "/Applications/My App/bin/x";
    const args = ["--dir", "/Users/me/My Documents"];
    const line = joinCommand(command, args);

    expect(line).toBe('"/Applications/My App/bin/x" --dir "/Users/me/My Documents"');
    expect(splitCommand(line)).toEqual({ command, args });
  });

  it("round-trips an argument holding a quote", () => {
    const args = ['say "hi"'];
    expect(splitCommand(joinCommand("echo", args)).args).toEqual(args);
  });

  it("has no arguments when there is only a command", () => {
    expect(splitCommand("  npx  ")).toEqual({ command: "npx", args: null });
    expect(splitCommand("")).toEqual({ command: "", args: null });
    expect(joinCommand("npx", null)).toBe("npx");
  });
});

describe("the line helpers", () => {
  it("round-trips a map through the textarea", () => {
    const map = { TOKEN: "abc", HOST: "example.test" };
    expect(linesToMap(mapToLines(map))).toEqual(map);
  });

  it("drops a blank line and a line with no `=`", () => {
    // A reader part-way through typing is not a mistake to report.
    expect(linesToMap("A=1\n\nbroken\n=B\nC=3\n")).toEqual({ A: "1", C: "3" });
    expect(linesToMap("   \n\n")).toBeNull();
  });

  it("keeps the rest of a value that holds an `=`", () => {
    expect(linesToMap("TOKEN=a=b")).toEqual({ TOKEN: "a=b" });
  });

  it("round-trips a list of arguments", () => {
    expect(linesToList(listToLines(["-y", "@scope/pkg"]))).toEqual(["-y", "@scope/pkg"]);
    expect(linesToList("  \n")).toBeNull();
  });
});

describe("what a row says", () => {
  it("names the transport the way a reader would", () => {
    // The agent's identifier for a pipe is not a thing anybody has a picture of.
    expect(transportLabel("stdio")).toBe("Runs a command");
    expect(transportLabel("streamable-http")).toBe("HTTP (streamable)");
    // An unspellable one draws as itself rather than as nothing.
    expect(transportLabel("carrier-pigeon")).toBe("carrier-pigeon");
  });

  it("tells the two halves apart", () => {
    expect(isRemote("stdio")).toBe(false);
    expect(isRemote("http")).toBe(true);
    expect(isRemote("sse")).toBe(true);
  });

  it("prefers where the server is over how it talks", () => {
    expect(serverEndpoint({ endpoint: "npx", transport: "stdio" })).toBe("npx");
    expect(serverEndpoint({ endpoint: null, transport: "sse" })).toBe("SSE");
    expect(serverEndpoint({ endpoint: "  ", transport: "http" })).toBe("HTTP");
  });
});
