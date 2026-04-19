export enum IPC {
  // Series read
  MEMORY_LIST_SERIES      = 'memory:list-series',
  MEMORY_GET_SERIES       = 'memory:get-series',
  MEMORY_SAVE_SERIES      = 'memory:save-series',
  MEMORY_DELETE_SERIES    = 'memory:delete-series',

  // External DB read
  EXTERNAL_LIST_SERIES    = 'external:list-series',
  EXTERNAL_GET_SERIES     = 'external:get-series',
  EXTERNAL_CHECK_PATH     = 'external:check-path',

  // External DB write
  EXTERNAL_SAVE_SERIES    = 'external:save-series',
  EXTERNAL_DELETE_SERIES  = 'external:delete-series',

  // Settings
  SETTINGS_GET            = 'settings:get',
  SETTINGS_SAVE           = 'settings:save',

  // Graph session (restored on next launch)
  SESSION_GET             = 'session:get',
  SESSION_SAVE            = 'session:save',

  // Screenshot
  CAPTURE_RECT            = 'capture:rect',

  // Saved graphs (.tsv-graph files)
  GRAPH_SAVE              = 'graph:save',
  GRAPH_LIST              = 'graph:list',
  GRAPH_LOAD              = 'graph:load',
  GRAPH_DELETE            = 'graph:delete',
  GRAPH_IMPORT            = 'graph:import',
  GRAPH_EXPORT            = 'graph:export',

  // File dialogs
  DIALOG_OPEN_DB          = 'dialog:open-db',
  DIALOG_SAVE_DB          = 'dialog:save-db',
  DIALOG_CREATE_DB        = 'dialog:create-db',
  DIALOG_SAVE_PNG         = 'dialog:save-png',
  DIALOG_SAVE_CSV         = 'dialog:save-csv',
  DIALOG_EXPORT_SERIES    = 'dialog:export-series',

}
