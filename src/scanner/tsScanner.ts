/**
 * BlockGraph MCP v0.1 — TypeScript/React Scanner
 * Uses ts-morph to scan a repository and produce CodeEntity and CodeEdge records.
 * Follows PRD §9.2 minimum scanner requirements.
 */
import fs from "node:fs";
import path from "node:path";
import { Project, SyntaxKind, type SourceFile, type Node } from "ts-morph";
import type { CodeEntity, CodeEdge, CodeEntityType, CodeEdgeType } from "../graph/schema.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScanResult {
  entities: CodeEntity[];
  edges: CodeEdge[];
  unsupportedFileCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".blockgraph",
  "__tests__", "coverage", ".next", ".nuxt",
]);

// ── ID generation ──────────────────────────────────────────────────────────

function makeId(repoRelativePath: string, kind: string, name: string, startLine: number): string {
  return `${repoRelativePath}:${kind}:${name}:${startLine}`;
}

// ── File walking ───────────────────────────────────────────────────────────

function walkSourceFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SCAN_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function repoRelative(filePath: string, baseDir: string): string {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

function isReactComponent(name: string): boolean {
  // React components start with uppercase
  return /^[A-Z]/.test(name);
}

function getJsxEventHandlers(sourceFile: SourceFile): Array<{ name: string; attrName: string; line: number }> {
  const handlers: Array<{ name: string; attrName: string; line: number }> = [];
  const eventAttrNames = new Set(["onClick", "onSubmit", "onChange", "onMouseDown", "onMouseUp", "onKeyDown", "onKeyUp"]);

  // Walk all JSX attributes
  sourceFile.forEachDescendant((node) => {
    if (node.isKind(SyntaxKind.JsxAttribute)) {
      const attrName = node.getNameNode().getText();
      if (eventAttrNames.has(attrName)) {
        const initializer = node.getInitializer();
        if (initializer) {
          let handlerName = "";
          if (initializer.isKind(SyntaxKind.StringLiteral)) {
            handlerName = initializer.getLiteralValue();
          } else {
            handlerName = initializer.getText();
            // Strip surrounding braces from JSX expressions: {handleSubmit} → handleSubmit
            if (handlerName.startsWith("{") && handlerName.endsWith("}")) {
              handlerName = handlerName.slice(1, -1).trim();
            }
          }
          handlers.push({
            name: handlerName.length > 60 ? handlerName.slice(0, 60) : handlerName,
            attrName,
            line: node.getStartLineNumber(),
          });
        }
      }
    }
  });

  return handlers;
}

function findFetchCalls(sourceFile: SourceFile): Array<{ name: string; line: number }> {
  const calls: Array<{ name: string; line: number }> = [];

  sourceFile.forEachDescendant((node) => {
    if (node.isKind(SyntaxKind.CallExpression)) {
      const expr = node.getExpression();
      const text = expr.getText();

      // fetch(...)
      if (text === "fetch") {
        calls.push({ name: "fetch", line: node.getStartLineNumber() });
      }
      // axios.get/post/put/delete/patch(...)
      else if (text.startsWith("axios.") || text.startsWith("axios(")) {
        calls.push({ name: text.split("(")[0], line: node.getStartLineNumber() });
      }
    }
  });

  return calls;
}

function findFunctionCalls(sourceFile: SourceFile): Array<{ caller: string; callee: string; line: number }> {
  const calls: Array<{ caller: string; callee: string; line: number }> = [];

  // Find all function declarations and their call expressions
  sourceFile.forEachDescendant((node) => {
    if (
      node.isKind(SyntaxKind.FunctionDeclaration) ||
      node.isKind(SyntaxKind.ArrowFunction) ||
      node.isKind(SyntaxKind.MethodDeclaration)
    ) {
      const funcName = node.isKind(SyntaxKind.MethodDeclaration)
        ? node.getName()
        : (node as any).getName?.() || "<anonymous>";

      if (!funcName) return;

      // Find call expressions within this function body
      const body = node.isKind(SyntaxKind.MethodDeclaration)
        ? node.getBody()
        : (node as any).getBody?.();

      if (body) {
        body.forEachDescendant((child: Node) => {
          if (child.isKind(SyntaxKind.CallExpression)) {
            const calleeText = child.getExpression().getText();
            // Only track simple identifier calls (not method chains like a.b())
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(calleeText)) {
              calls.push({
                caller: funcName,
                callee: calleeText,
                line: child.getStartLineNumber(),
              });
            }
          }
        });
      }
    }
  });

  return calls;
}

// ── Main scanner ───────────────────────────────────────────────────────────

export function scanRepo(repoPath: string): ScanResult {
  const resolvedPath = path.resolve(repoPath);
  const filePaths = walkSourceFiles(resolvedPath, resolvedPath);

  const project = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4, // JsxEmit.ReactJSX
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const fp of filePaths) {
    project.addSourceFileAtPath(fp);
  }

  const entities: CodeEntity[] = [];
  const edges: CodeEdge[] = [];
  const entityIdMap = new Map<string, string>(); // name -> id for call resolution
  const seenEdgeIds = new Set<string>(); // deduplicate edge IDs
  let unsupportedFileCount = 0;

  function uniqueEdgeId(baseId: string): string {
    if (!seenEdgeIds.has(baseId)) {
      seenEdgeIds.add(baseId);
      return baseId;
    }
    let counter = 2;
    while (seenEdgeIds.has(`${baseId}:${counter}`)) counter++;
    const uniqueId = `${baseId}:${counter}`;
    seenEdgeIds.add(uniqueId);
    return uniqueId;
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const relPath = repoRelative(filePath, resolvedPath);
    const ext = path.extname(filePath);
    const isTsx = ext === ".tsx" || ext === ".jsx";

    // Skip non-scan extensions (shouldn't happen but guard)
    if (!SCAN_EXTENSIONS.has(ext)) {
      unsupportedFileCount++;
      continue;
    }

    // 1. File entity
    const fileLines = sourceFile.getEndLineNumber();
    const fileEntity: CodeEntity = {
      id: makeId(relPath, "file", path.basename(filePath), 1),
      type: "file",
      name: path.basename(filePath),
      file_path: relPath,
      start_line: 1,
      end_line: fileLines,
      metadata: {},
    };
    entities.push(fileEntity);

    // 2. Functions (top-level and nested)
    sourceFile.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.FunctionDeclaration)) return;
      const func = node.asKind(SyntaxKind.FunctionDeclaration);
      if (!func) return;
      const name = func.getName();
      if (!name) return;
      const startLine = func.getStartLineNumber();
      const endLine = func.getEndLineNumber();
      const isExported = func.isExported();
      const isDefault = func.isDefaultExport();

      const entity: CodeEntity = {
        id: makeId(relPath, "function", name, startLine),
        type: "function",
        name,
        file_path: relPath,
        start_line: startLine,
        end_line: endLine,
        metadata: { exported: isExported, defaultExport: isDefault },
      };
      entities.push(entity);
      entityIdMap.set(name, entity.id);
    });

    // 3. Classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      const startLine = cls.getStartLineNumber();
      const endLine = cls.getEndLineNumber();

      const classEntity: CodeEntity = {
        id: makeId(relPath, "class", name, startLine),
        type: "class",
        name,
        file_path: relPath,
        start_line: startLine,
        end_line: endLine,
        metadata: { exported: cls.isExported() },
      };
      entities.push(classEntity);

      // Methods
      for (const method of cls.getMethods()) {
        const methodName = method.getName();
        const methodStart = method.getStartLineNumber();
        const methodEnd = method.getEndLineNumber();

        const methodEntity: CodeEntity = {
          id: makeId(relPath, "method", `${name}.${methodName}`, methodStart),
          type: "method",
          name: `${name}.${methodName}`,
          file_path: relPath,
          start_line: methodStart,
          end_line: methodEnd,
          metadata: { className: name },
        };
        entities.push(methodEntity);
      }
    }

    // 4. React function components (in TSX/JSX files)
    if (isTsx) {
      for (const func of sourceFile.getFunctions()) {
        const name = func.getName();
        if (!name || !isReactComponent(name)) continue;
        const startLine = func.getStartLineNumber();
        const endLine = func.getEndLineNumber();

        const componentEntity: CodeEntity = {
          id: makeId(relPath, "component", name, startLine),
          type: "component",
          name,
          file_path: relPath,
          start_line: startLine,
          end_line: endLine,
          metadata: { exported: func.isExported() },
        };
        entities.push(componentEntity);
        entityIdMap.set(name, componentEntity.id);
      }
    }

    // 5. Event handlers in JSX
    if (isTsx) {
      const handlers = getJsxEventHandlers(sourceFile);
      for (const handler of handlers) {
        const entity: CodeEntity = {
          id: makeId(relPath, "event_handler", handler.name, handler.line),
          type: "event_handler",
          name: handler.name,
          file_path: relPath,
          start_line: handler.line,
          end_line: handler.line,
          metadata: { attributeName: handler.attrName },
        };
        entities.push(entity);
      }
    }

    // 5b. Route detection — exported async functions in routes/ directories
    const isInRoutesDir = relPath.includes("routes/") || relPath.includes("routes\\");
    if (isInRoutesDir) {
      for (const func of sourceFile.getFunctions()) {
        if (!func.isExported()) continue;
        const name = func.getName();
        if (!name) continue;
        // Check if this function was already detected and replace its type
        const existingIdx = entities.findIndex(
          (e) => e.type === "function" && e.name === name && e.file_path === relPath,
        );
        if (existingIdx >= 0) {
          entities[existingIdx] = { ...entities[existingIdx], type: "route" };
          entityIdMap.set(name, entities[existingIdx].id);
        }
      }
    }

    // 6. fetch/axios calls
    const fetchCalls = findFetchCalls(sourceFile);
    for (const fc of fetchCalls) {
      const entity: CodeEntity = {
        id: makeId(relPath, "api_call", fc.name, fc.line),
        type: "api_call",
        name: fc.name,
        file_path: relPath,
        start_line: fc.line,
        end_line: fc.line,
        metadata: {},
      };
      entities.push(entity);
    }

    // 7. Import edges
    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      const startLine = imp.getStartLineNumber();

      // Try to resolve to a source file in the project
      const resolved = imp.getModuleSpecifierSourceFile();
      const targetPath = resolved ? repoRelative(resolved.getFilePath(), resolvedPath) : null;

      const edge: CodeEdge = {
        id: uniqueEdgeId(makeId(relPath, "imports", moduleSpecifier, startLine)),
        type: "imports",
        source_entity_id: fileEntity.id,
        target_entity_id: targetPath ? makeId(targetPath, "file", path.basename(targetPath), 1) : null,
        confidence: targetPath ? 1.0 : 0.5,
        evidence: [{ file_path: relPath, start_line: startLine, end_line: startLine, note: `import from "${moduleSpecifier}"` }],
      };
      edges.push(edge);
    }

    // 8. Function call edges (within the same file)
    const funcCalls = findFunctionCalls(sourceFile);
    for (const fc of funcCalls) {
      const callerId = entityIdMap.get(fc.caller);
      const calleeId = entityIdMap.get(fc.callee);
      if (callerId && calleeId && callerId !== calleeId) {
        const edge: CodeEdge = {
          id: uniqueEdgeId(makeId(relPath, "calls", `${fc.caller}->${fc.callee}`, fc.line)),
          type: "calls",
          source_entity_id: callerId,
          target_entity_id: calleeId,
          confidence: 0.9,
          evidence: [{ file_path: relPath, start_line: fc.line, end_line: fc.line, note: `${fc.caller} calls ${fc.callee}` }],
        };
        edges.push(edge);
      }
    }

    // 9. handles_event edges (component → event handler via JSX attributes)
    if (isTsx) {
      const handlers = getJsxEventHandlers(sourceFile);
      for (const handler of handlers) {
        // The handler name (e.g., "handleSubmit") should match an entity
        const handlerEntityId = entityIdMap.get(handler.name);
        if (!handlerEntityId) continue;
        // Find the enclosing component
        const enclosingComp = entities.find(
          (e) =>
            (e.type === "component" || e.type === "function") &&
            e.file_path === relPath &&
            e.start_line <= handler.line &&
            e.end_line >= handler.line,
        );
        if (!enclosingComp) continue;
        edges.push({
          id: uniqueEdgeId(makeId(relPath, "handles_event", handler.name, handler.line)),
          type: "handles_event",
          source_entity_id: enclosingComp.id,
          target_entity_id: handlerEntityId,
          confidence: 0.9,
          evidence: [{ file_path: relPath, start_line: handler.line, end_line: handler.line, note: `${enclosingComp.name} handles ${handler.attrName} via ${handler.name}` }],
        });
      }
    }

    // 10. renders edges (component → child component via JSX tags)
    if (isTsx) {
      sourceFile.forEachDescendant((node) => {
        if (!node.isKind(SyntaxKind.JsxOpeningElement) && !node.isKind(SyntaxKind.JsxSelfClosingElement)) return;
        const tagNode = node.isKind(SyntaxKind.JsxOpeningElement)
          ? node.getTagNameNode()
          : (node as any).getTagNameNode();
        const tag = tagNode.getText();
        // Uppercase = component reference; lowercase = HTML element
        if (!tag[0] || tag[0] !== tag[0].toUpperCase()) return;
        const targetId = entityIdMap.get(tag);
        if (!targetId) return;
        // Find enclosing component
        const enclosingComp = entities.find(
          (e) =>
            (e.type === "component" || e.type === "function") &&
            e.file_path === relPath &&
            e.start_line <= node.getStartLineNumber() &&
            e.end_line >= node.getEndLineNumber(),
        );
        if (!enclosingComp || enclosingComp.id === targetId) return;
        edges.push({
          id: uniqueEdgeId(makeId(relPath, "renders", tag, node.getStartLineNumber())),
          type: "renders",
          source_entity_id: enclosingComp.id,
          target_entity_id: targetId,
          confidence: 0.8,
          evidence: [{ file_path: relPath, start_line: node.getStartLineNumber(), end_line: node.getEndLineNumber(), note: `${enclosingComp.name} renders ${tag}` }],
        });
      });
    }

    // 11. fetches edges (function → api_call entity)
    for (const fc of fetchCalls) {
      const apiCallId = entityIdMap.get(`api_call:${fc.name}:${fc.line}`);
      if (!apiCallId) {
        // Find the api_call entity by line number
        const apiEntity = entities.find(
          (e) => e.type === "api_call" && e.file_path === relPath && e.start_line === fc.line,
        );
        if (!apiEntity) continue;
        // Find enclosing function
        const enclosingFunc = entities.find(
          (e) =>
            (e.type === "function" || e.type === "component" || e.type === "method" || e.type === "route") &&
            e.file_path === relPath &&
            e.start_line <= fc.line &&
            e.end_line >= fc.line,
        );
        if (!enclosingFunc) continue;
        edges.push({
          id: uniqueEdgeId(makeId(relPath, "fetches", fc.name, fc.line)),
          type: "fetches",
          source_entity_id: enclosingFunc.id,
          target_entity_id: apiEntity.id,
          confidence: 0.9,
          evidence: [{ file_path: relPath, start_line: fc.line, end_line: fc.line, note: `${enclosingFunc.name} calls ${fc.name}` }],
        });
      }
    }
  }

  return { entities, edges, unsupportedFileCount };
}
