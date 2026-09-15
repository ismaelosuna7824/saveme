/** Textos de `projects`. Misma forma que `es/projects.ts`. */
export const projects = {
  /**
   * Labels for the categories the core sends as keys (`feature`, `fix`…). The
   * `label` from the server is only a fallback for a category we don't know yet.
   */
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
} as const
