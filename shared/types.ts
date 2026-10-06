export type PageKind = 'story' | 'cover' | 'ad' | 'extra' | 'uncertain' | 'blocked';
export type Box = { x: number; y: number; width: number; height: number };
export interface CharacterFact { key:string; label:string; value:string; certainty:'confirmed'|'uncertain'; evidence:string; sincePage:number; target?:string; }
export interface CharacterRecord extends CharacterFact { section:'profile'|'status'; action:'upsert'|'remove'; }
export interface Character { id: string; name: string; aliases: string[]; description: string; firstPage: number; avatar?: string; appearance?:string; nameType?:'named'|'descriptive'; profile?:CharacterFact[]; statuses?:CharacterFact[]; records?:CharacterRecord[]; }
export interface IdentitySuggestion { source:string; target:string; evidence:string; confidence:number; page:number; }
export interface Mention { name:string; evidence:string; page:number; }
export interface BackgroundSource { title:string; url:string; }
export interface WorkContext { originalWork:string; background:string; characterGuide:string; sources?:BackgroundSource[]; }
export interface BackgroundResearch { id:string; status:'ready'|'uncertain'|'not_found'; originalWork:string; background:string; characterGuide:string; confidence:number; evidence:string[]; sources:BackgroundSource[]; samplePageIds:string[]; researchedAt:string; accepted?:boolean; }
export type PagePurpose='story'|'cover'|'ad'|'extra';
// Measured cost of the last reading call for a page. Diagnostics only: it never
// enters the model context and is overwritten whenever the page is read again.
export interface PageTiming { elapsedMs:number; attempts:number; promptTokens?:number; completionTokens?:number; reasoningTokens?:number; preparationMs?:number; modelMs?:number; contextCharacters?:number; imageCount?:number; }
export interface ReadingMemory { version:1; checkpointPage:number; pending:{page:number;text:string}[]; threads:{id:string;text:string;sincePage:number}[]; }
export interface Relation { source: string; target: string; kind: string; label: string; directed: boolean; evidence: string; sincePage: number; }
export interface Stage { id: string; fromPage: number; toPage: number; title: string; storyTime: string; characters: Character[]; relations: Relation[]; changes: string[]; turningReason?: string; baselineRelations?: Relation[]; baselineStatuses?:Pick<Character,'id'|'statuses'>[]; }
export interface Page { id: string; name: string; image: string; thumbnail: string; width: number; height: number; override: 'auto' | 'story' | 'skip'; purpose?:PagePurpose; analysis?: { kind: PageKind; confidence: number; reason: string; summary: string; storyTime: string; characterIds?:string[] }; timing?:PageTiming; }
export interface Project { id: string; name: string; createdAt: string; updatedAt: string; direction: 'rtl' | 'ltr'; pages: Page[]; characters: Character[]; relations: Relation[]; stages: Stage[]; memory: string; readingMemory?:ReadingMemory; processed: number; status: 'idle' | 'running' | 'paused' | 'completed' | 'error'; error?: string; workContext?:WorkContext; backgroundResearch?:BackgroundResearch; identityRedirects?:Record<string,string>; identitySuggestions?:IdentitySuggestion[]; mentions?:Mention[]; canUndoMerge?:boolean; }
export interface Settings { baseUrl: string; model: string; hasKey: boolean; }
