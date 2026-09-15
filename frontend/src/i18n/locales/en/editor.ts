/** Textos de `editor`. Misma forma que `es/editor.ts`. */
export const editor = {
  mode: {
    live: {
      label: 'live',
      hint: "Renders markdown as you type. Syntax only appears on the cursor's line.",
    },
    source: {
      label: 'source',
      hint: 'Raw markdown, no decoration.',
    },
    split: {
      label: 'split',
      hint: 'Source on the left, preview on the right.',
    },
    preview: {
      label: 'preview',
      hint: 'Only the rendered document.',
    },
  },
  page: {
    openFailed: "Couldn't open the summary",
    notFound: "Couldn't find summary {id}",
    notFoundHint: 'It may have been deleted, or the index may be out of date. Reindexing fixes it.',
  },
  toolbar: {
    backTitle: 'Back to project (Esc)',
    titleLabel: 'Summary title',
    titlePlaceholder: 'summary title',
    saveTitle: 'Save (⌘S)',
    unsaved: 'unsaved changes',
    unchanged: 'no changes',
    saved: 'saved {when}',
    updated: 'updated {date}',
    author: 'author {author}',
    files_one: '{count} file',
    files_other: '{count} files',
    copyPath: 'Copy the file path',
    copyPathDone: 'Path copied',
    copyPathFailed: "Couldn't copy the path",
  },
  conflict: {
    title: 'the file changed on disk',
    bodyBefore:
      'Someone else — a person, an agent, or an external editor — wrote this file after we loaded it. The core rejected the save with',
    bodyAfter: 'so nothing gets clobbered. Your text is still here.',
    reload: 'reload from disk',
    reloadHint: 'discards your local changes and shows the version on disk.',
    overwrite: 'overwrite',
    overwriteHint: 'retries the save with the fresh hash: your version wins.',
    copyMine: 'copy my version',
    copyMineHint: 'sends it to the clipboard in case you want to rescue it.',
    copied: 'Your version is on the clipboard',
    copyFailed: "Couldn't copy your version",
    keep: 'Nothing is lost until you choose. If you close the dialog, you keep editing and can save later.',
    keepEditing: 'keep editing',
  },
  save: {
    failed: "Couldn't save",
    nothing: 'Nothing to save',
    reloadFailed: "Couldn't read the file from disk",
    reloaded: 'Loaded from disk',
    overwritten: 'Overwritten with your version',
    fetchFailed: "Couldn't read the file to overwrite",
  },
    mermaid: {
      rendering: 'drawing the diagram…',
      showSource: 'Show the diagram source',
      hideSource: 'Hide the source',
      error: 'The diagram has a syntax error',
    },
    delete: {
      action: 'delete the summary',
      title: 'Delete "{title}"?',
      description:
        'The file goes to the trash, it is not destroyed. You can get it back from Settings → workspace.',
      done: 'Summary deleted',
      failed: "Couldn't delete it",
    },
} as const
