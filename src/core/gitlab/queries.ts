// GraphQL queries for MR details and the shapes of their answers

// Stage 2: everything except comments. Cheap, so batches are large.
export const MERGE_REQUESTS_QUERY = `
  query MRFlowMergeRequests($projectPath: ID!, $iids: [String!]) {
    project(fullPath: $projectPath) {
      mergeRequests(iids: $iids, first: 100) {
        nodes {
          iid
          webUrl
          draft
          updatedAt
          detailedMergeStatus
          shouldBeRebased
          conflicts
          diffHeadSha
          userNotesCount
          resolvableDiscussionsCount
          resolvedDiscussionsCount
          approvedBy { nodes { id } }
        }
      }
    }
  }`;

// Stage 3: comments only (no system notes, which can be most of an MR's discussions), oldest first,
// each with its discussion. GitLab batch-loads the discussions per MR.
const NOTES_FIELDS = `
  pageInfo { hasNextPage endCursor }
  nodes { author { id } discussion { id resolvable resolved } }`;

export const MERGE_REQUESTS_NOTES_QUERY = `
  query MRFlowMergeRequestsNotes($projectPath: ID!, $iids: [String!]) {
    project(fullPath: $projectPath) {
      mergeRequests(iids: $iids, first: 100) {
        nodes {
          iid
          notes(filter: ONLY_COMMENTS, first: 100) { ${NOTES_FIELDS} }
        }
      }
    }
  }`;

export const MERGE_REQUEST_NOTES_PAGE_QUERY = `
  query MRFlowMergeRequestNotesPage($projectPath: ID!, $iid: String!, $after: String) {
    project(fullPath: $projectPath) {
      mergeRequest(iid: $iid) {
        notes(filter: ONLY_COMMENTS, first: 100, after: $after) { ${NOTES_FIELDS} }
      }
    }
  }`;

export interface MrNode {
  iid: string;
  webUrl?: string;
  draft?: boolean;
  updatedAt?: string;
  detailedMergeStatus?: string;
  shouldBeRebased?: boolean;
  conflicts?: boolean;
  diffHeadSha?: string;
  userNotesCount?: number;
  resolvableDiscussionsCount?: number;
  resolvedDiscussionsCount?: number;
  approvedBy?: { nodes: { id: string }[] };
}

export interface Note {
  author?: { id: string };
  discussion?: { id: string; resolvable: boolean; resolved: boolean };
}

export interface NotesPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Note[];
}

export interface MergeRequestsResponse<N> {
  project?: { mergeRequests?: { nodes?: N[] } } | null;
}

export interface NotesPageResponse {
  project?: { mergeRequest?: { notes?: NotesPage } | null } | null;
}

export interface MrNotesNode {
  iid: string;
  notes: NotesPage;
}
