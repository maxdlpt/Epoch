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

  // Settings
  SETTINGS_GET            = 'settings:get',
  SETTINGS_SAVE           = 'settings:save',

  // File dialogs
  DIALOG_OPEN_DB          = 'dialog:open-db',
  DIALOG_SAVE_DB          = 'dialog:save-db',
  DIALOG_EXPORT_SERIES    = 'dialog:export-series'
}
