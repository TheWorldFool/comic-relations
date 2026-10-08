export type PageKind = 'story' | 'cover' | 'ad' | 'extra' | 'uncertain' | 'blocked';
export type Box = { x: number; y: number; width: number; height: number };
export interface CharacterFact { appearanceId?:string; key:string; label:string; value:string; certainty:'confirmed'|'uncertain'; evidence:string; sincePage:number; target?:string; }
export interface CharacterRecord extends CharacterFact { section:'profile'|'status'; action:'upsert'|'remove'; }
export interface CharacterReference { appearanceId?:string; url:string; page:number; view:string; }
export interface IdentityEvidence { kind:"visual"|"continuity"|"dialogue"|"distinct"; text:string; }
export interface IdentityDecision { id:string; decision:"match"|"new"|"confirm"|"separate"|"pending"; appearanceId?:string; nameLink?:string; identity?:{name:string;aliases:string[];description:string;appearance:string;nameType:"named"|"descriptive"}; target:string|null; candidates:string[]; evidence:IdentityEvidence[]; conflicts:string[]; }
export interface Character { identityState?:"pending"|"confirmed"; identityEvidence?:string; identityCandidates?:string[]; references?:CharacterReference[]; id: string; name: string; aliases: string[]; description: string; firstPage: number; avatar?: string; appearance?:string; nameType?:'named'|'descriptive'; profile?:CharacterFact[]; statuses?:CharacterFact[]; records?:CharacterRecord[]; }
export interface IdentitySuggestion { source:string; target:string; evidence:string; confidence?:number; reviewed?:boolean; page:number; }
export interface Mention { name:string; evidence:string; page:number; }
export interface BackgroundSource { title:string; url:string; }
export interface WorkContext { originalWork:string; background:string; characterGuide:string; sources?:BackgroundSource[]; }
export interface BackgroundResearch { id:string; status:'ready'|'uncertain'|'not_found'; originalWork:string; background:string; characterGuide:string; confidence:number; evidence:string[]; sources:BackgroundSource[]; samplePageIds:string[]; researchedAt:string; accepted?:boolean; }
export type PagePurpose='story'|'cover'|'ad'|'extra';
// Last reading call for display; the project readingRuns ledger retains prior
// calls, including failures and cancellation. Neither enters the model context.
export interface IdentityReviewResult { status:"complete"|"partial"|"failed"; checked:number; pending:number; issue?:string; }
export interface PageTiming { identityReviewMs?:number; identityReviewResult?:IdentityReviewResult; identityReviewRequests?:number; elapsedMs:number; attempts:number; promptTokens?:number; completionTokens?:number; reasoningTokens?:number; preparationMs?:number; modelMs?:number; contextCharacters?:number; imageCount?:number; model?:string; endpointOrigin?:string; promptHash?:string; reasoningEffort?:string; maxTokens?:number; }
export interface ReadingRun extends PageTiming { task?:"reading"|"identity-review"; id:string;pageId:string;pageNumber:number;recordedAt:string;outcome:'success'|'error'|'cancelled'|'legacy'; }
export interface ReadingMemory { version:1; checkpointPage:number; pending:{page:number;text:string}[]; threads:{id:string;text:string;sincePage:number}[]; }
export interface Relation { sourceAppearanceId?:string; targetAppearanceId?:string; source: string; target: string; kind: string; label: string; directed: boolean; evidence: string; sincePage: number; }
export interface Stage { id: string; fromPage: number; toPage: number; title: string; storyTime: string; characters: Character[]; relations: Relation[]; changes: string[]; turningReason?: string; baselineRelations?: Relation[]; baselineStatuses?:Pick<Character,'id'|'statuses'>[]; }
export interface Page { id: string; name: string; image: string; thumbnail: string; width: number; height: number; override: 'auto' | 'story' | 'skip'; purpose?:PagePurpose; analysis?: { kind: PageKind; confidence: number; reason: string; summary: string; storyTime: string; characterIds?:string[]; identityObservations?:{personId:string;name:string;evidence:string;decision:string}[] }; timing?:PageTiming; }
export interface AppearanceEndpoint { appearanceId?:string; characterId?:string; }
export interface AppearanceFactUpdate { action:'upsert'|'remove'; key:string; label:string; value:string; certainty:'confirmed'|'uncertain'; evidence:string; target?:AppearanceEndpoint; }
export interface Appearance {
  id:string; pageId:string; page:number; trackId:string; characterId:string|null;
  verification:'reviewed'|'continuity'|'pending'|'manual';
  observed:{name:string;appearance:string;outfit?:string;hairStyle?:string;box:Box|null;view:string;crop?:string};
  evidence:string; candidates:string[];
  profileUpdates:AppearanceFactUpdate[]; statusChanges:AppearanceFactUpdate[];
  bindings:{characterId:string|null;atPage:number;reason:string;method:'model'|'manual'|'merge'}[];
}
export interface AppearanceFactEvent { page:number; pageId:string; owner:AppearanceEndpoint; profileUpdates:AppearanceFactUpdate[]; statusChanges:AppearanceFactUpdate[]; }
export interface AppearanceRelationEvent { page:number; pageId:string; action:'upsert'|'remove'; source:AppearanceEndpoint; target:AppearanceEndpoint; kind:string;label:string;directed:boolean;evidence:string; }
export interface IdentityBaseline { throughPage:number; characters:Character[]; relations:Relation[]; }
export interface Project { appearances?:Appearance[]; appearanceFacts?:AppearanceFactEvent[]; appearanceRelations?:AppearanceRelationEvent[]; identityBaseline?:IdentityBaseline; pendingIdentities?:Character[]; identityReviewNotice?:string; id: string; name: string; createdAt: string; updatedAt: string; direction: 'rtl' | 'ltr'; pages: Page[]; characters: Character[]; relations: Relation[]; stages: Stage[]; memory: string; readingMemory?:ReadingMemory; readingRuns?:ReadingRun[]; processed: number; status: 'idle' | 'running' | 'paused' | 'completed' | 'error'; error?: string; workContext?:WorkContext; backgroundResearch?:BackgroundResearch; identityRedirects?:Record<string,string>; identitySuggestions?:IdentitySuggestion[]; mentions?:Mention[]; canUndoMerge?:boolean; canRewindMerge?:boolean; corrections?:ManualCorrection[]; }
export interface Settings { baseUrl: string; model: string; hasKey: boolean; }

export type CorrectionInput =
  | {kind:'character';personId:string;name:string;aliases:string[];description:string;appearance:string;nameType:'named'|'descriptive'}
  | {kind:'fact';personId:string;section:'profile'|'status';action:'upsert'|'remove';fact:CharacterFact}
  | {kind:'relation';action:'upsert'|'remove';relation:Relation};
export type ManualCorrection = CorrectionInput & {id:string;page:number};
