/**
 * Maps backend analysis data to graph node/edge structures
 * Used by the 3D knowledge graph visualization
 */

import { KGNode, KGEdge } from "@/components/git-nexus-function-graph";
import { NexusSymbolInventory } from "@/types/git-nexus";

/**
 * Infer node type based on file path and symbol name
 */
function inferNodeType(
  file: string,
  symbolName: string
): KGNode["type"] {
  const fileLower = file.toLowerCase();
  const nameLower = symbolName.toLowerCase();

  // Route detection
  if (fileLower.includes("/routes/") || fileLower.includes(".routes.")) return "route";

  // Controller detection
  if (fileLower.includes("/controllers/") || nameLower.includes("controller")) return "controller";

  // Service detection
  if (fileLower.includes("/services/") || nameLower.includes("service")) return "service";

  // Component detection
  if (fileLower.includes("/components/") || fileLower.endsWith(".tsx") || fileLower.endsWith(".jsx")) return "component";

  // Agent detection
  if (fileLower.includes("/agents/") || nameLower.includes("agent")) return "agent";

  // Utility detection
  if (fileLower.includes("/utils/") || fileLower.includes("/util/") || nameLower.includes("util")) return "util";

  // Default
  return "default";
}

/**
 * Converts symbol inventory to graph nodes and edges
 * Creates a node for each function/class/interface found
 */
export function mapSymbolInventoryToGraph(
  symbolInventory?: NexusSymbolInventory
): { nodes: KGNode[]; edges: KGEdge[] } {
  if (!symbolInventory?.top_files || symbolInventory.top_files.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: KGNode[] = [];
  const nodeMap = new Map<string, KGNode>(); // Track by id
  const edges: KGEdge[] = [];

  // Create nodes for each symbol
  symbolInventory.top_files.forEach((fileEntry) => {
    const file = fileEntry.file;

    // Add file node
    const fileNodeId = `file:${file}`;
    const fileNode: KGNode = {
      id: fileNodeId,
      label: file.split("/").pop() || file,
      file,
      type: "default",
    };
    if (!nodeMap.has(fileNodeId)) {
      nodes.push(fileNode);
      nodeMap.set(fileNodeId, fileNode);
    }

    // Add function nodes
    if (fileEntry.functions) {
      fileEntry.functions.forEach((funcName) => {
        const funcNodeId = `func:${file}:${funcName}`;
        const funcNode: KGNode = {
          id: funcNodeId,
          label: funcName,
          file,
          type: inferNodeType(file, funcName),
        };
        if (!nodeMap.has(funcNodeId)) {
          nodes.push(funcNode);
          nodeMap.set(funcNodeId, funcNode);

          // Create edge from file to function
          edges.push({
            source: fileNodeId,
            target: funcNodeId,
          });
        }
      });
    }

    // Add class nodes
    if (fileEntry.classes) {
      fileEntry.classes.forEach((className) => {
        const classNodeId = `class:${file}:${className}`;
        const classNode: KGNode = {
          id: classNodeId,
          label: className,
          file,
          type: inferNodeType(file, className),
        };
        if (!nodeMap.has(classNodeId)) {
          nodes.push(classNode);
          nodeMap.set(classNodeId, classNode);

          // Create edge from file to class
          edges.push({
            source: fileNodeId,
            target: classNodeId,
          });
        }
      });
    }

    // Add interface nodes
    if (fileEntry.interfaces) {
      fileEntry.interfaces.forEach((interfaceName) => {
        const ifaceNodeId = `iface:${file}:${interfaceName}`;
        const ifaceNode: KGNode = {
          id: ifaceNodeId,
          label: interfaceName,
          file,
          type: inferNodeType(file, interfaceName),
        };
        if (!nodeMap.has(ifaceNodeId)) {
          nodes.push(ifaceNode);
          nodeMap.set(ifaceNodeId, ifaceNode);

          // Create edge from file to interface
          edges.push({
            source: fileNodeId,
            target: ifaceNodeId,
          });
        }
      });
    }
  });

  // Optional: Add cross-file edges based on naming patterns
  // For now, keep edges simple (file -> symbols)
  // In a real system, you'd parse imports/exports to create more meaningful connections

  return { nodes, edges };
}

/**
 * Export types for use in component props
 */
export type { KGNode, KGEdge };
