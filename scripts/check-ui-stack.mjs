// WorkPaw UI boundary: Shadcn only. QwenPaw is a read-only reference.
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const excluded = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".turbo",
  ".pnpm-store",
  "coverage",
  "vendor",
  "QwenPaw",
]);
const forbidden =
  /^(?:antd(?:[@/]|$)|@ant-design\/|@agentscope-ai\/design(?:[@/]|$))/;
const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
export function checkUIStack(root = process.cwd()) {
  const errors = [];
  const report = (file, detail) =>
    errors.push(`${relative(root, file)}: ${detail}`);
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      const extension = extname(file);
      if (
        ![
          ".js",
          ".jsx",
          ".mjs",
          ".cjs",
          ".ts",
          ".tsx",
          ".mts",
          ".cts",
          ".css",
          ".less",
          ".scss",
        ].includes(extension) &&
        ![
          "package.json",
          "pnpm-lock.yaml",
          "package-lock.json",
          "yarn.lock",
          "bun.lock",
        ].includes(entry.name)
      )
        continue;
      const source = readFileSync(file, "utf8");
      if (entry.name === "package.json") {
        const pkg = JSON.parse(source);
        for (const group of dependencyGroups)
          for (const [name, version] of Object.entries(pkg[group] ?? {})) {
            if (
              forbidden.test(name) ||
              (typeof version === "string" &&
                forbidden.test(version.replace(/^npm:/, "")))
            )
              report(file, `forbidden ${group}: ${name}`);
          }
      } else if (/lock(?:\.yaml|\.json)?$/.test(entry.name)) {
        if (
          /(?:^|[\s"'/])(?:antd(?:@|:|\/)|@ant-design\/|@agentscope-ai\/design(?:@|:|["']))/m.test(
            source,
          )
        )
          report(file, "forbidden UI package in lockfile");
      } else if ([".css", ".scss", ".less"].includes(extension)) {
        const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of css.matchAll(
          /@(?:import|use|forward)\s+(?:url\(\s*)?["']([^"']+)/g,
        ))
          if (forbidden.test(match[1].replace(/^~/, "")))
            report(file, `forbidden stylesheet: ${match[1]}`);
      } else {
        const tree = ts.createSourceFile(
          file,
          source,
          ts.ScriptTarget.Latest,
          true,
        );
        function walk(node) {
          let specifier;
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
          )
            specifier = node.moduleSpecifier.text;
          if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === "require")) &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          )
            specifier = node.arguments[0].text;
          if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
          )
            specifier = node.argument.literal.text;
          if (specifier && forbidden.test(specifier))
            report(file, `forbidden import: ${specifier}`);
          ts.forEachChild(node, walk);
        }
        walk(tree);
      }
    }
  }
  visit(resolve(root));
  return errors;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = checkUIStack();
  if (errors.length) {
    console.error(
      "WorkPaw requires Shadcn. Do not import/install Ant Design or AgentScope Design.\n" +
        errors.join("\n"),
    );
    process.exitCode = 1;
  } else
    console.log(
      "UI stack check passed: no Ant Design/AgentScope Design imports or dependencies.",
    );
}
