import dagre from '@dagrejs/dagre';
import type { Relation, Stage } from '../shared/types';

export const CARD_WIDTH = 196;
export const CARD_HEIGHT = 132;
export type Point = { x:number; y:number };
export type RelationGroup = { id:string; source:string; target:string; relations:Relation[] };

// Keep all facts and directions, but reserve only one route for each pair.
export function groupRelations(relations:Relation[]):RelationGroup[] {
  const groups = new Map<string,RelationGroup>();
  for (const relation of relations) {
    const id = JSON.stringify([relation.source,relation.target].sort());
    const group = groups.get(id);
    if (group) group.relations.push(relation);
    else groups.set(id,{id,source:relation.source,target:relation.target,relations:[relation]});
  }
  return [...groups.values()];
}

export function layoutGraph(characters:Stage['characters'], groups:RelationGroup[]) {
  const graph = new dagre.graphlib.Graph({multigraph:true});
  graph.setGraph({rankdir:'TB',nodesep:48,ranksep:92,edgesep:32,marginx:28,marginy:28});
  graph.setDefaultEdgeLabel(()=>({}));
  for (const person of characters) graph.setNode(person.id,{width:CARD_WIDTH,height:CARD_HEIGHT});
  const valid = groups.filter(group=>graph.hasNode(group.source)&&graph.hasNode(group.target));
  for (const group of valid) graph.setEdge(group.source,group.target,{width:136,height:32,labelpos:'c'},group.id);
  dagre.layout(graph);
  const positions = new Map(characters.map(person=>{
    const node = graph.node(person.id);
    return [person.id,{x:node.x-CARD_WIDTH/2,y:node.y-CARD_HEIGHT/2}] as const;
  }));
  const routes = new Map(valid.map(group=>{
    const edge = graph.edge({v:group.source,w:group.target,name:group.id});
    return [group.id,{points:edge.points as Point[],label:{x:edge.x!,y:edge.y!}}] as const;
  }));
  return {positions,routes};
}
