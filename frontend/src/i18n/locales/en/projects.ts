/** Textos de `projects`. Misma forma que `es/projects.ts`. */
export const projects = {
  /**
   * Labels for the categories the core sends as keys (`feature`, `fix`…). The
   * `label` from the server is only a fallback for a category we don't know yet.
   */
  newSummary: {
    action: 'Write a summary in this project',
    title: 'new summary',
    description:
      'It is saved exactly like an agent one: same frontmatter, same index, same history.',
    titleLabel: 'title',
    categoryLabel: 'category',
    bodyLabel: 'body (markdown)',
    inferHint: 'No category: it is inferred from the text.',
    chosenHint: 'Press it again to go back to inferring.',
    save: 'save',
    saved: 'Summary saved',
    already: 'That summary was already saved',
    failed: "couldn't save it",
  },
  category: {
    feature: 'Feature',
    fix: 'Fix',
    chore: 'Chore',
    refactor: 'Refactor',
    docs: 'Docs',
    infra: 'Infra',
    design: 'Design',
    research: 'Research',
    incident: 'Incident',
    uncategorized: 'Uncategorized',
    folderLabel: 'folder',
    sortNewest: 'sorted by creation date, newest first',
    empty: {
      title: 'Nothing in {category} yet',
      hint: "The folder exists (it's created with the project), but it's empty.",
    },
  },
  categoryDescription: {
    feature: 'New functionality the people using the product can see.',
    fix: 'Something that behaved incorrectly was corrected.',
    chore: 'Dependencies, tooling, versions, cleanup.',
    refactor: 'The code was restructured without changing its behaviour.',
    docs: 'Documentation, guides, and explanatory comments.',
    infra: 'CI/CD, build, deploy, and observability.',
    design: 'An architecture or design decision (lightweight ADR).',
    research: 'A spike, an exploration, or a comparison of options.',
    incident: 'A post-mortem of something that broke.',
    uncategorized: "Files that aren't in a known category folder.",
  },
  /** Lifecycle states of a summary (`SummaryStatus`). */
  status: {
    confirmed: 'confirmed',
    draft: 'draft',
    unmanaged: 'unmanaged',
  },
  summaryCount: {
    one: '{count} summary',
    other: '{count} summaries',
  },
  lastActivity: 'last activity',
  recentActivity: 'recent activity',
  /** Project category tabs. */
  tabs: {
    all: 'all',
  },
  resultsShown: '{shown} of {total}',
  loadFailed: "couldn't load the project",
  notFound: {
    title: "Couldn't find the project “{slug}”",
    hint: 'It may have been renamed, or the index may be out of date. Reindexing fixes it.',
  },
  path: {
    copy: 'Copy the project path',
    copied: 'Path copied',
    copyFailed: "Couldn't copy the path",
  },
  counts: {
    none: 'no summaries',
    entry: '{count} in {category}',
    more: '+{count} more',
  },
  export: {
    action: 'Export the project to a markdown file',
    done: 'Project exported',
    doneCount: '{count} summaries in one document',
    doneSkipped: "{count} summaries; {skipped} couldn't be read and are not in the document",
    failed: "couldn't export the project",
    filterName: 'Markdown document',
    docLine: {
      one: '{count} summary · exported on {date}',
      other: '{count} summaries · exported on {date}',
    },
    categoryHeading: '{category}',
    commit: 'commit',
    files: 'files:',
    skippedLine: {
      one: "{count} summary couldn't be read and is not here.",
      other: "{count} summaries couldn't be read and are not here.",
    },
  },
  list: {
    empty: 'No summaries here',
    loadFailed: "couldn't read the summaries",
  },
  empty: {
    title: "This project doesn't have any summaries yet",
    hint: 'When an agent confirms a proposal (or you write from the editor), they will show up here.',
  },
  search: {
    placeholder: 'search titles, summary and body…',
    label: 'Search summaries',
    clear: 'Clear search',
    searching: 'searching “{query}”…',
    results: 'results',
    resultCount: {
      one: '{count} result',
      other: '{count} results',
    },
    empty: {
      title: 'Nothing matches “{query}”',
    },
  },
  newProject: {
    title: 'new project',
    nameLabel: 'visible name',
    slugLabel: 'slug (optional)',
    description:
      'The 9 category folders are created inside the project, even if they are empty. The visible name is stored in the database; the slug is the directory on disk.',
    submit: 'create project',
    creating: 'creating…',
    created: 'Project {name} created',
    createdHint: 'Directory: {path}',
    createFailed: "Couldn't create the project",
  },
    delete: {
      action: 'delete the project',
      title: 'Delete "{name}"?',
      subtitle: 'The whole project is archived',
      description:
        'Its folder goes to the trash with its {count} summaries inside. Nothing is destroyed: you can get it back from Settings → workspace.',
      done: 'Project archived',
      failed: "Couldn't archive the project",
    },
  tag: {
    explain: 'Summaries from any project carrying this tag.',
    empty: {
      title: 'Nothing tagged #{tag}',
      hint: 'You may have removed it from everything, or the index may be stale: try reindexing from Settings.',
    },
  },
  briefing: {
    lastTitle: 'latest',
    lastHint: {
      one: '{count} summary in total · {active} with activity in the last {days} days',
      other: '{count} summaries in total · {active} with activity in the last {days} days',
    },
    emptyTitle: 'Nothing recorded in {days} days',
    emptyHint:
      'The project exists but has no recent summaries. If you expected to see something, the index may be stale: reindexing fixes it.',
    filesTitle: 'where the work went',
    filesHint: 'Files mentioned by summaries from the last {days} days',
    pendingTitle: 'waiting on a decision',
    pendingHint: 'Proposals nobody approved. The expired ones are the ones left half done',
    noPending: 'Nothing pending: no proposals waiting.',
    expired: 'expired',
    loadFailed: "couldn't read the briefing",
  },
  activity: {
    action: 'project pulse',
    title: 'pulse',
    hint: {
      one: '{count} summary across {active} of the last {days} days',
      other: '{count} summaries across {active} of the last {days} days',
    },
    empty: 'No activity to draw yet.',
    day: {
      one: '{date}: {count} summary',
      other: '{date}: {count} summaries',
    },
    dayEmpty: '{date}: nothing',
    summary: {
      one: '{count} summary spread across {active} of the last {days} days',
      other: '{count} summaries spread across {active} of the last {days} days',
    },
    less: 'less',
    more: 'more',
    loadFailed: "couldn't read the activity",
    weekday: {
      mon: 'Mon',
      tue: 'Tue',
      wed: 'Wed',
      thu: 'Thu',
      fri: 'Fri',
      sat: 'Sat',
      sun: 'Sun',
    },
    window: {
      quarter: '90 days',
      half: '6 months',
      year: 'a year',
    },
  },
  changelog: {
    action: 'export release notes',
    title: 'release notes',
    description: 'Summaries from {project} over a range, grouped by category.',
    since: 'from',
    until: 'to (inclusive)',
    preview: {
      one: '{count} entry in {sections} categories',
      other: '{count} entries in {sections} categories',
    },
    previewEmpty: 'Nothing recorded in that range.',
    previewFailed: "Couldn't count what is in that range.",
    download: 'save as…',
    filterName: 'Markdown',
    done: 'Release notes saved',
    doneCount: {
      one: '{count} entry',
      other: '{count} entries',
    },
    failed: "Couldn't build the release notes",
    docHeading: '{project} — changes',
    docLine: {
      one: 'From {from} to {to} · {count} entry',
      other: 'From {from} to {to} · {count} entries',
    },
    docEmpty: 'No changes recorded in this range.',
  },
} as const
