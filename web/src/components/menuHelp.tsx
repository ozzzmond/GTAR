import React from 'react'
import { ContextualHelp, type HelpTopic } from './ContextualHelp'

/**
 * #418: contextual help for GTAR's menus. Every menu gets one "?" that reuses the ProPresenter help
 * (ContextualHelp), with one short topic per option, so no menu carries a second help system.
 */
type Entry = [title: string, text: React.ReactNode]

/** One topic per option; only the first starts expanded, as in the ProPresenter help. */
const topics = (entries: Entry[]): HelpTopic[] =>
  entries.map(([title, text], index) => ({ title, content: <p>{text}</p>, defaultExpanded: index === 0 }))

interface MenuHelpProps {
  prefer?: 'below' | 'above'
  className?: string
}

export const SettingsHelp: React.FC<MenuHelpProps & { showInstall?: boolean }> = ({ showInstall = false, ...rest }) => (
  <ContextualHelp
    {...rest}
    id="settings-help"
    title="Settings"
    buttonTestId="settings-help-button"
    panelTestId="settings-help"
    quickSummary="App-wide preferences. Tap a row to open it."
    topics={topics([
      ['Theme', 'Choose the app colors and fonts, or build your own palette. You can also set which themes the sun and moon button in the header switches between.'],
      ['Backup & Restore', 'Save your songs and setlists to a backup file, or bring a backup back. Restoring changes what is on this device, so download a fresh backup first.'],
      ['Debug Logs', 'A technical record of what the app did, handy when reporting a problem. Recovery Data lives here too: safety copies GTAR keeps on this device. A dot on this row means a recovery copy could not be opened.'],
      ['Trash', 'On small screens, opens the Trash. Deleted songs and setlists wait there until you restore them or delete them for good.'],
      ...(showInstall ? [['Install App (PWA)', 'Adds GTAR to your home screen or desktop so it opens like an app and keeps working offline.'] as Entry] : []),
    ])}
  />
)

const EXTENSION_HELP: Record<string, string> = {
  'propresenter-follower': 'Follows the live slides and lyrics from a ProPresenter computer on the same network. Open the row to enter that computer\'s address.',
  'band-sync': 'Keeps the band on the leader\'s song, key and place in the chart. Switch it on, then open the row to start a room or join one.',
}

export const AdvancedToolsHelp: React.FC<MenuHelpProps & { extensions: Array<{ id: string; name: string; summary: string }>; stageTools?: string[] }> = ({ extensions, stageTools = [], ...rest }) => (
  <ContextualHelp
    {...rest}
    id="advanced-tools-help"
    title="Advanced Tools"
    buttonTestId="advanced-tools-help-button"
    panelTestId="advanced-tools-help"
    quickSummary="Optional integrations and song sources. Tap a row for its settings; the switch only turns it on or off."
    topics={topics([
      ['Online Song Sources', 'Lets the search bar also look for chord charts on the websites you choose. It stays off until you switch it on; your searches are then sent to those sites.'],
      ...stageTools.map((name): Entry => [name, `Opens the ${name} panel from any screen and adds its button to the Stage toolbar. Switching it off stops it and closes its panel.`]),
      ['MIDI', 'Connects a MIDI pedal or controller. It stays off until you switch it on. Open the row to connect a device and choose what each pedal or button does on Stage.'],
      ...extensions.map(({ id, name, summary }): Entry => [name, EXTENSION_HELP[id] ?? summary]),
      ['Status labels', 'Starting, Offline or Error appear beside a tool that needs attention. N/A means this device or browser cannot run it.'],
    ])}
  />
)

export const BandSyncHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="band-sync-help"
    title="Band Sync"
    buttonTestId="band-sync-help-button"
    panelTestId="band-sync-help"
    quickSummary="Keep the whole band on the leader's song, key and place in the chart."
    topics={topics([
      ['Start room', 'Makes you the leader and shows a room code and QR code. What you open on Stage is sent to everyone who joins.'],
      ['Join with code', 'Type the leader\'s room code, or scan their QR code with your camera, to follow along. Your Stage then shows the leader\'s song.'],
      ['Leave or End room', 'Leave room stops following. End room closes it for everyone. Closing the leader\'s tab gives up control, and an unused room expires on its own.'],
      ['Status', 'Shows your connection and the room code. Followers also see whether the leader is online, plus the current song and key.'],
      ['On / Off switch', 'Band Sync only works while its switch in Advanced Tools is on.'],
    ])}
  />
)

export const SongsLibraryHelp: React.FC<MenuHelpProps & { canImport?: boolean; canCheckDuplicates?: boolean }> = ({ canImport = false, canCheckDuplicates = false, className = '', ...rest }) => (
  <ContextualHelp
    {...rest}
    className={`[&>button]:w-11 [&>button]:h-11 [&>button]:rounded-xl sm:[&>button]:w-8 sm:[&>button]:h-8 sm:[&>button]:rounded-lg ${className}`}
    id="songs-library-help"
    title="Songs"
    buttonLabel="Help for managing songs"
    buttonTestId="songs-library-help-button"
    panelTestId="songs-library-help"
    quickSummary="Find, organise and manage the songs in your Songbook."
    topics={topics([
      ['Filters', 'Narrow the list by metadata status, setlist or tags. Set a filter back to All to see every song again.'],
      ['Sort', 'Order songs by Title, Artist or Date. Tap the active button again to reverse the order.'],
      ['Select', 'Shows checkboxes so you can pick several songs, then Add to tag, Add to Setlist or Delete them together. Deleted songs move to the Trash and can be restored.'],
      ...(canImport ? [['Import songs', 'In the ⋯ menu. Brings songs in from song files or a whole folder.'] as Entry] : []),
      ['Export songs', 'In the ⋯ menu. Saves songs as TXT or PDF to share or print.'],
      ...(canCheckDuplicates ? [['Check duplicates', 'In the ⋯ menu. Finds songs saved more than once and lets you move the extra copies to the Trash.'] as Entry] : []),
      ['Add Song', 'Starts a new, empty song in the editor.'],
    ])}
  />
)

export const SetlistsHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="setlists-help"
    title="Setlists"
    buttonLabel="Help for managing setlists"
    buttonTestId="setlists-help-button"
    panelTestId="setlists-help"
    quickSummary="Build, share and manage the setlists you play from."
    topics={topics([
      ['Sort', 'Order the setlist cards by your manual order, by title or by date.'],
      ['Manage', 'Open a setlist to rename it, search and add songs, change their order, or play in Stage.'],
      ['Share', 'Creates a link or QR code so someone else can import the setlist.'],
      ['Import Setlist', 'In the ⋯ menu. Adds a setlist that was shared with you, from a link or a file.'],
      ['Export Setlist', 'In the ⋯ menu of an open setlist. Saves it as a file you can keep or send.'],
      ['Add new setlist', 'Creates an empty setlist. Search and add songs to build your set.'],
      ['Inside a setlist', 'Play in Stage starts from the first song and follows the setlist order. The trash button moves the setlist to the Trash; your songs stay in the Songbook.'],
    ])}
  />
)

export const SetlistManagerHelp: React.FC<MenuHelpProps & { showFolder?: boolean }> = ({ showFolder = false, ...rest }) => (
  <ContextualHelp
    {...rest}
    id="setlist-manager-help"
    title="Setlist Manager"
    buttonTestId="setlist-manager-help-button"
    panelTestId="setlist-manager-help"
    quickSummary="Edit one setlist: its name, its songs and their order. Changes save right away."
    topics={topics([
      ['Setlist', 'Pick the setlist to edit. The pencil renames it.'],
      ...(showFolder ? [['Folder', 'Files the setlist in a folder so it is easier to find. Unfiled keeps it out of folders.'] as Entry] : []),
      ['Play Setlist in Stage', 'Opens the first available song on Stage, then follows the setlist order.'],
      ['Delete Setlist', 'Removes the setlist after you confirm. Your songs stay in the Songbook.'],
      ['Search Songs', 'Find songs by title, artist, key or tag, tick as many as you like and add them in one go. Songs already in the setlist are marked and cannot be added twice. Ctrl+K opens it too.'],
      ['Order', 'The arrows move a song up or down. The X removes it from this setlist only.'],
    ])}
  />
)

export const StagePreviewHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="stage-preview-help"
    title="Stage Preview"
    buttonTestId="stage-preview-help-button"
    panelTestId="stage-preview-help"
    quickSummary="The performance view of a song. These are its toolbar controls."
    topics={topics([
      ['Editor', 'Opens this song in the editor to make changes to chords and lyrics.'],
      ['Metronome and Tuner', 'Switch them on in Advanced Tools. Each one then gets its own button here.'],
      ['Key', 'Shows the key you are playing in. Tap it to transpose or reset. The chords change on screen; the chart text is not rewritten.'],
      ['Chords / NNS', 'Switches between chord letters and Nashville numbers. Numbers need the song\'s key. On phones this is in Stage Options.'],
      ['Auto-scroll', 'Starts or pauses automatic scrolling. The number is the speed; change it in Stage Options.'],
      ['Stage Options', 'Text size, layout, notation, screen wake and TV settings.'],
      ['Cast', 'Shows the chart on a TV or second screen. Tap again to stop presenting.'],
      ['Fullscreen', 'Hides the toolbars for distraction-free reading. Tap the screen to bring the controls back.'],
    ])}
  />
)

export const EditorHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="editor-help"
    title="Editor"
    buttonTestId="editor-help-button"
    panelTestId="editor-help"
    quickSummary="Edit song text, chords, sections and metadata."
    topics={topics([
      ['Save', 'Saves changes to the song and updates device storage (Ctrl+S). The indicator shows whether edits are saved.'],
      ['Brackets []', 'Wraps the selected text in square brackets for chords, or inserts empty brackets if nothing is selected.'],
      ['Insert Section', 'Adds section markers such as [Intro], [Verse], [Chorus], [Bridge], [Solo] or [Outro] at the cursor.'],
      ['Song Details', 'Opens the metadata panel to set key, tempo, time signature, capo, artist and tags.'],
      ['Sections vs Raw View', 'Sections View organizes the song into collapsible blocks. Raw Text View shows the full plain-text ChordPro file.'],
      ['Undo and Redo', 'Steps backward or forward through recent text and metadata changes.'],
      ['Clipboard tools', 'Paste, Copy, Select All and Clear provide quick actions for the editor text.'],
      ['New Song', 'Starts a blank song template with standard ChordPro metadata headers.'],
    ])}
  />
)

export const ThemeHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="stage-color-theme-help"
    title="Stage Color Theme"
    buttonTestId="theme-help-button"
    panelTestId="theme-help"
    quickSummary="Select, assign and customize color themes for Stage and the app."
    topics={topics([
      ['Theme selection', 'Tap any preset or custom theme card to choose it. The active theme is highlighted with a checkmark.'],
      ['Light Mode', 'Assigns this theme to the sun icon in the header. Tapping the header sun/moon button switches to your assigned light theme.'],
      ['Dark Mode', 'Assigns this theme to the moon icon in the header. Tapping the header sun/moon button switches to your assigned dark theme.'],
      ['Not Assigned', 'Removes this theme from the quick light/dark toggle so the header button does not cycle to it.'],
      ['Customize This Theme', 'Creates an editable copy of a preset where you can adjust colors and typography. Restore Factory Theme resets it.'],
      ['Save', 'Permanently saves your selected theme, custom colors, and mode assignments to device storage.'],
      ['Apply', 'Applies the selected theme immediately to preview it across the app without closing the dialog.'],
    ])}
  />
)

export const ImportSongsHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="import-songs-help"
    title="Import Songs"
    buttonTestId="import-songs-help-button"
    panelTestId="import-songs-help"
    quickSummary="Bring song files or folders into your Songbook."
    topics={topics([
      ['Supported formats', 'ChordPro (.pro, .cho, .chopro, .crd), text chord sheets (.txt), and OnSong (.onsong) files.'],
      ['Folder import', 'Imports all supported song files found inside a chosen folder in one step.'],
      ['OnSong files', 'OnSong files are converted to ChordPro format with an instant preview to review before saving.'],
      ['Duplicate handling', 'Imported songs are added to your library. Existing songs are preserved without silent overwriting.'],
    ])}
  />
)

export const ExportSongsHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="export-songs-help"
    title="Export Songs"
    buttonTestId="export-songs-help-button"
    panelTestId="export-songs-help"
    quickSummary="Export songs as ChordPro text or printable PDF."
    topics={topics([
      ['Export formats', 'TXT downloads ChordPro text with multiple songs separated by {new_song}. PDF opens formatted charts in the print view to save as PDF or print on paper.'],
      ['Saved vs Transposed key', 'For PDF export, choose Saved key to print original stored charts, or Current transposed key to print songs in your active stage performance pitch.'],
      ['Song filtering', 'Type keywords into Filter songs to search by title or artist. Filtering narrows what is shown without clearing your existing song selections.'],
      ['Bulk selection', 'Tap any song row to pick it. Use Select shown to choose all currently filtered songs at once, or Clear to deselect every song.'],
      ['Export action', 'Downloads the TXT file or opens your browser print dialog. If PDF print fails to open, check pop-up blockers. Only selected songs are exported.'],
    ])}
  />
)

export const BackupRestoreHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="backup-restore-help"
    title="Backup & Restore"
    buttonTestId="backup-restore-help-button"
    panelTestId="backup-restore-help"
    quickSummary="Save full library backups or restore from an existing backup file."
    topics={topics([
      ['Save backup file', 'Creates a complete, verified backup of your songs, setlists, folders, tag colors and settings, and opens your system share sheet to save it.'],
      ['Download backup', 'Saves the backup file directly to your browser’s default Downloads folder without opening the share sheet.'],
      ['Copy backup', 'Copies the full backup text to the clipboard so you can paste it into an email, notes app or text file.'],
      ['Restore from file', 'Reads a GTAR backup file and shows a preview before anything changes. You choose whether to merge or replace.'],
      ['Merge vs Replace (Destructive)', 'Merge adds new songs and updates setlists while keeping your existing library safe. Replace overwrites what is on this device with the backup contents. Always download a fresh backup before restoring or replacing.'],
      ['Settings recovery', 'If a restore is interrupted or you need to revert settings, GTAR keeps a recovery snapshot of your previous settings so you can undo or put them back.'],
    ])}
  />
)

export const DebugLogsHelp: React.FC<MenuHelpProps> = (props) => (
  <ContextualHelp
    {...props}
    id="debug-logs-help"
    title="Debug Logs"
    buttonTestId="debug-logs-help-button"
    panelTestId="debug-logs-help"
    quickSummary="Technical logs and crash diagnostics recorded on this device."
    topics={topics([
      ['Severity filters', 'Filter the log viewer by severity: ALL, ERROR, WARN, INFO, or DEBUG to isolate problems.'],
      ['Copy All', 'Copies the complete diagnostic log history to your clipboard so you can paste it into an issue report or message.'],
      ['Share', 'Opens your device share sheet to send the debug log file via email, messaging or air-drop.'],
      ['Download .log', 'Saves the full log history as a .log text file to your device Downloads folder.'],
      ['Clear (Destructive)', 'Permanently deletes all recorded debug logs from memory. This cannot be undone. Confirmation is required.'],
      ['Recovery Data', 'Shows emergency local backup copies kept on this device. You can download or restore older versions if needed.'],
    ])}
  />
)

export const StageOptionsHelp: React.FC<MenuHelpProps & { showQuickJump?: boolean }> = ({ showQuickJump = false, ...rest }) => (
  <ContextualHelp
    {...rest}
    id="stage-options-help"
    title="Stage Options"
    buttonTestId="stage-options-help-button"
    panelTestId="stage-options-help"
    quickSummary="Change how the chart looks and behaves on Stage. Changes apply right away."
    topics={topics([
      ['Auto-Scroll Speed', 'How fast the chart scrolls by itself, in pixels per second. Use a lower number for slower songs.'],
      ['Notation Mode', 'Chords shows letters such as G and Em. Numbers shows the Nashville Number System, which needs the song\'s key.'],
      ['Text size and style', 'Font Size sets the lyric size. Chord Scale makes chords larger or smaller than the lyrics. Weight, Line Spacing and Style help you read from a distance.'],
      ['Layout and controls', 'Two-Column splits long songs on wide screens. Auto-Hide fades the bars while you read. Floating Control Dock swaps the bottom bar for a dock you can drag.'],
      ['Keep Screen Awake', 'Stops the screen from dimming or locking while you play. It uses more battery, and some browsers do not support it.'],
      ['Fullscreen Mode', 'Fills the screen with the chart. Tap the screen to bring the controls back.'],
      ['TV & Second Screen', 'Pair / Cast shows the chart on a TV or second screen. The TV options choose chords or lyrics only, and the TV text size.'],
      ...(showQuickJump ? [['Setlist Quick-Jump', 'Tap a title to jump straight to that song in the queue.'] as Entry] : []),
    ])}
  />
)
