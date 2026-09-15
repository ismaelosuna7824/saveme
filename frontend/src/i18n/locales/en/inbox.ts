/** Textos de `inbox`. Misma forma que `es/inbox.ts`. */
export const inbox = {
  projects: 'projects',
  newProject: 'new',
  projectsLoadFailed: "couldn't list the projects",
  projectsEmpty: {
    title: 'No projects yet',
    hint: 'Create the first one: SaveMe will generate the 9 category folders inside.',
  },
  pending: {
    title: 'pending confirmations',
    waiting: '{count} waiting for a decision',
    none: 'nothing pending',
  },
  proposalsLoadFailed: "couldn't read the proposals",
  empty: {
    title: 'Nothing is waiting for your approval',
    /** The MCP tool name is interpolated as `<code>`. */
    hintBefore: 'When an agent proposes a summary with',
    hintAfter:
      ', it will show up here. The proposal lives for 15 minutes: that is its TTL. Nothing is written to disk until you decide where.',
    guarantee: 'nothing is written without `confirm`',
  },
  accepted: {
    title: 'Summary saved',
    savedIn: 'Saved in {category}',
  },
  confirmFailed: "Couldn't confirm the proposal",
  discardReason: 'discarded from the UI inbox',
  discarded: 'Proposal discarded, nothing was written',
  discardFailed: "Couldn't discard the proposal",
  expiry: {
    expired: 'expired',
    minutesLeft: 'expires in {count} min',
    at: 'expires {when}',
    expiredHint: 'The proposal expired: ask the agent to propose it again.',
  },
  whyCategory: 'why this category',
  orSaveIn: 'or save it in',
  filesTouched: {
    one: '{count} file',
    other: '{count} files',
  },
  retarget: {
    action: 'Save to another folder',
    title: 'save to another folder',
    project: 'project',
    category: 'category',
    chooseProject: 'choose a project',
    chooseCategory: 'choose a category',
    targetLabel: 'will be written to',
    descriptionBefore: 'The proposal is marked as',
    descriptionAfter: 'in the audit log: the destination is recorded as different from the inferred one.',
    submit: 'save here',
    saved: 'Saved to the chosen folder',
  },
} as const
