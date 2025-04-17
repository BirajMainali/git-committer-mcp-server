import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const REPOSITORY_PATH = process.env.REPOSITORY_PATH || process.cwd();

const executeAsync = promisify(exec);

const server = new Server(
    {
        name: "commit-generator/v1",
        description: "A tool to generate commit messages based on git diffs.",
        version: "0.1.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
        },
    },
);

server.setRequestHandler(ListToolsRequestSchema, () => {
    return {
        tools: [
            {
                name: "git-changes-commit-message",
                description: "Extract the Git diff of the current repository. This tool helps generate detailed commit messages by providing a comparison of changes. When prompted to commit changes, use this tool to automatically capture the differences and craft meaningful commit messages based on the modifications.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },

            {
                name: "git-changes-commit",
                description: "Commit changes to the Git repository. This tool allows you to save your changes with a meaningful commit message. Use this tool after extracting the Git diff to finalize your changes in the repository.",
                inputSchema: {
                    type: "object",
                    properties: {
                        message: {
                            type: "string",
                            description: "The commit message. That should be a concise summary of the changes made. It should be clear and descriptive enough to understand the purpose of the commit.",
                        },
                    },
                    required: ["message"],
                },
            },
        ],
    }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {

    try {
        const { name, arguments: args } = request.params;

        switch (name) {

            case "git-changes-commit-message": {
                const diff = await getGitChanges(REPOSITORY_PATH);
                const formattedDiff = JSON.stringify(diff, null, 2);
                return {
                    content: [{
                        type: "text",
                        text: `Here is the Git diff of the current repository. Please review the changes and provide a meaningful commit message based on this diff:\n\n\`\`\`diff\n${formattedDiff}\n\`\`\`\n`,
                    }],
                };
            }

            case "git-changes-commit": {
                const { message } = args as { message: string };
                await pushChanges(REPOSITORY_PATH, message);
                return {
                    content: [{
                        type: "text",
                        text: `Successfully committed with message: ${message}`,
                    }],
                };
            }

            default: {
                throw new Error(`Tool ${name} not found`);
            }
        }

    }
    catch (error: any) {
        return {
            content: [{
                type: "text",
                text: `Error: ${error?.message}`,
            }],
        };
    }
})

async function getGitChanges(input: string) {
    try {
        const cwd = input || process.cwd();
        await executeAsync(`cd ${cwd}`);

        const { stdout: diffOutput } = await executeAsync('git diff HEAD', { cwd });
        const { stdout: statusOutput } = await executeAsync('git status --porcelain', { cwd });

        const changes = {
            modified: [] as string[],
            added: [] as string[],
            deleted: [] as string[],
            details: {} as Record<string, string[]>
        };

        statusOutput.split('\n').filter(Boolean).forEach(line => {
            const [status, file] = [line.slice(0, 2).trim(), line.slice(3)];
            if (status.includes('M')) changes.modified.push(file);
            if (status.includes('A')) changes.added.push(file);
            if (status.includes('D')) changes.deleted.push(file);
        });
        let currentFile = '';
        diffOutput.split('\n').forEach(line => {
            if (line.startsWith('diff --git')) {
                currentFile = line.split(' b/')[1];
                changes.details[currentFile] = [];
            } else if (line.startsWith('+') || line.startsWith('-')) {
                if (currentFile && !line.startsWith('+++') && !line.startsWith('---')) {
                    changes.details[currentFile].push(line);
                }
            }
        });

        return changes;
    } catch (error: any) {
        throw new Error(`Failed to get git changes: ${error.message}`);
    }
}

async function pushChanges(path: string, message: string) {
    try {
        const cwd = path || process.cwd();
        await executeAsync(`cd ${cwd}`);
        await executeAsync(`git add --all`, { cwd });
        await executeAsync(`git commit -m "${message}"`, { cwd });
        await executeAsync(`git push`, { cwd });
    } catch (error: any) {
        throw new Error(`Failed to commit changes: ${error.message}`);
    }
}


async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    process.exit(1);
});