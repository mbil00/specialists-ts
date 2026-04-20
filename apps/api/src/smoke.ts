import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js", "--workspace-root", process.cwd()],
    cwd: process.cwd(),
    stderr: "inherit",
  });

  const client = new Client(
    { name: "specialists-api-smoke", version: "0.1.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  const tools = await client.listTools();
  console.log(
    JSON.stringify(
      {
        tools: tools.tools.map((tool) => tool.name),
      },
      null,
      2,
    ),
  );

  const listResult = await client.callTool({
    name: "list_specialists",
    arguments: {},
  });
  console.log(JSON.stringify(listResult.structuredContent ?? listResult.content, null, 2));

  await transport.close();
}

main().catch((error) => {
  console.error("specialists api smoke failed:\n");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
